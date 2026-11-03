import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { PageQuery, pageArgs, pageResult } from '../lib/pagination.js';
import { type Tx, sequential } from '../lib/prisma.js';
import { requirePermission } from '../middleware/auth.js';
import { assertInvoiceQuota } from '../services/subscription.js';
import { InvoiceStatus, PaymentMethod, type Prisma } from '../generated/prisma/client.js';

export const invoicesRouter = Router();

const ItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPrice: z.number().int().min(0).max(10_000_000_000), // cents
});

const InvoiceSchema = z
  .object({
    customerId: z.string().uuid(),
    issueDate: z.coerce.date(),
    dueDate: z.coerce.date(),
    taxRate: z.number().int().min(0).max(100).default(0),
    notes: z.string().trim().max(2000).optional().nullable(),
    items: z.array(ItemSchema).min(1, 'Add at least one line item').max(100),
  })
  .refine((v) => v.dueDate >= v.issueDate, { message: 'Due date must be on or after issue date', path: ['dueDate'] });

const OPEN_STATUSES: InvoiceStatus[] = ['SENT', 'PARTIALLY_PAID'];

export function computeTotals<T extends { quantity: number; unitPrice: number }>(items: T[], taxRate: number) {
  const lines = items.map((i) => ({ ...i, amount: i.quantity * i.unitPrice }));
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = Math.round((subtotal * taxRate) / 100);
  return { lines, subtotal, tax, total: subtotal + tax };
}

const withOverdue = <T extends { status: InvoiceStatus; dueDate: Date; total: number; amountPaid: number }>(inv: T) => ({
  ...inv,
  balance: inv.total - inv.amountPaid,
  isOverdue: OPEN_STATUSES.includes(inv.status) && inv.dueDate < new Date(),
});

async function loadInvoice(tx: Tx, tenantId: string, id: string) {
  const invoice = await tx.invoice.findFirst({
    where: { id, tenantId },
    include: {
      customer: true,
      items: true,
      payments: { orderBy: { paidAt: 'desc' }, include: { recordedBy: { select: { name: true } } } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

/** Customer must exist *in this tenant* — RLS makes other tenants' customers invisible. */
async function assertCustomer(tx: Tx, tenantId: string, customerId: string) {
  const c = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
  if (!c) throw badRequest('Customer not found');
}

// ---------------------------------------------------------------------------
invoicesRouter.get('/', requirePermission('invoices:read'), async (req, res) => {
  const q = PageQuery.extend({
    status: z.enum(['OVERDUE', ...Object.values(InvoiceStatus)]).optional(),
    customerId: z.string().uuid().optional(),
    search: z.string().trim().optional(),
  }).parse(req.query);
  const { tenantId } = req.auth!;

  const where: Prisma.InvoiceWhereInput = { tenantId };
  if (q.status === 'OVERDUE') Object.assign(where, { status: { in: OPEN_STATUSES }, dueDate: { lt: new Date() } });
  else if (q.status) where.status = q.status as InvoiceStatus;
  if (q.customerId) where.customerId = q.customerId;
  if (q.search) {
    const n = Number(q.search.replace(/\D/g, ''));
    where.OR = [
      { customer: { name: { contains: q.search, mode: 'insensitive' } } },
      ...(n ? [{ number: n }] : []),
    ];
  }

  const [rows, total] = await req.db((tx) =>
    sequential([
      tx.invoice.findMany({
        where,
        orderBy: { number: 'desc' },
        ...pageArgs(q),
        include: { customer: { select: { id: true, name: true } } },
      }),
      tx.invoice.count({ where }),
    ]),
  );
  res.json(pageResult(rows.map(withOverdue), total, q));
});

invoicesRouter.get('/:id', requirePermission('invoices:read'), async (req, res) => {
  const invoice = await req.db((tx) => loadInvoice(tx, req.auth!.tenantId, String(req.params.id)));
  res.json(withOverdue(invoice));
});

invoicesRouter.post('/', requirePermission('invoices:write'), async (req, res) => {
  const body = InvoiceSchema.parse(req.body);
  const { tenantId, userId } = req.auth!;
  const { lines, subtotal, tax, total } = computeTotals(body.items, body.taxRate);

  const invoice = await req.db(async (tx) => {
    await assertInvoiceQuota(tx, tenantId);
    await assertCustomer(tx, tenantId, body.customerId);
    // Per-tenant sequential numbers: lock this tenant's numbering for the transaction
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice-number:' + tenantId}))`;
    const last = await tx.invoice.aggregate({ where: { tenantId }, _max: { number: true } });

    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        number: (last._max.number ?? 1000) + 1,
        customerId: body.customerId,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
        taxRate: body.taxRate,
        notes: body.notes ?? null,
        subtotal,
        tax,
        total,
        createdById: userId,
        items: { create: lines.map((l) => ({ ...l, tenantId })) },
      },
    });
    await audit(tx, req, {
      action: 'invoice.created',
      entityType: 'Invoice',
      entityId: invoice.id,
      metadata: { number: invoice.number, total },
    });
    return loadInvoice(tx, tenantId, invoice.id);
  });
  res.status(201).json(withOverdue(invoice));
});

invoicesRouter.put('/:id', requirePermission('invoices:write'), async (req, res) => {
  const body = InvoiceSchema.parse(req.body);
  const { tenantId } = req.auth!;
  const id = String(req.params.id);
  const { lines, subtotal, tax, total } = computeTotals(body.items, body.taxRate);

  const invoice = await req.db(async (tx) => {
    const before = await loadInvoice(tx, tenantId, id);
    if (before.status !== 'DRAFT') throw badRequest('Only draft invoices can be edited');
    await assertCustomer(tx, tenantId, body.customerId);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id, tenantId } });
    await tx.invoice.update({
      where: { id },
      data: {
        customerId: body.customerId,
        issueDate: body.issueDate,
        dueDate: body.dueDate,
        taxRate: body.taxRate,
        notes: body.notes ?? null,
        subtotal,
        tax,
        total,
        items: { create: lines.map((l) => ({ ...l, tenantId })) },
      },
    });
    await audit(tx, req, {
      action: 'invoice.updated',
      entityType: 'Invoice',
      entityId: id,
      metadata: { number: before.number, total: { from: before.total, to: total } },
    });
    return loadInvoice(tx, tenantId, id);
  });
  res.json(withOverdue(invoice));
});

invoicesRouter.post('/:id/send', requirePermission('invoices:write'), async (req, res) => {
  const id = String(req.params.id);
  const invoice = await req.db(async (tx) => {
    const inv = await loadInvoice(tx, req.auth!.tenantId, id);
    if (inv.status !== 'DRAFT') throw badRequest('Only draft invoices can be marked as sent');
    await tx.invoice.update({ where: { id }, data: { status: 'SENT' } });
    await audit(tx, req, { action: 'invoice.sent', entityType: 'Invoice', entityId: id, metadata: { number: inv.number } });
    return loadInvoice(tx, req.auth!.tenantId, id);
  });
  res.json(withOverdue(invoice));
});

invoicesRouter.post('/:id/void', requirePermission('invoices:delete'), async (req, res) => {
  const id = String(req.params.id);
  const invoice = await req.db(async (tx) => {
    const inv = await loadInvoice(tx, req.auth!.tenantId, id);
    if (inv.status === 'VOID') throw badRequest('Invoice is already void');
    if (inv.amountPaid > 0) throw badRequest('Invoices with payments cannot be voided');
    await tx.invoice.update({ where: { id }, data: { status: 'VOID' } });
    await audit(tx, req, { action: 'invoice.voided', entityType: 'Invoice', entityId: id, metadata: { number: inv.number } });
    return loadInvoice(tx, req.auth!.tenantId, id);
  });
  res.json(withOverdue(invoice));
});

invoicesRouter.delete('/:id', requirePermission('invoices:delete'), async (req, res) => {
  const id = String(req.params.id);
  await req.db(async (tx) => {
    const inv = await loadInvoice(tx, req.auth!.tenantId, id);
    if (inv.status !== 'DRAFT') throw badRequest('Only draft invoices can be deleted — void it instead');
    await tx.invoice.delete({ where: { id } });
    await audit(tx, req, { action: 'invoice.deleted', entityType: 'Invoice', entityId: id, metadata: { number: inv.number } });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
const PaymentSchema = z.object({
  amount: z.number().int().min(1),
  method: z.enum(PaymentMethod),
  reference: z.string().trim().max(100).optional().nullable(),
  paidAt: z.coerce.date().default(() => new Date()),
});

invoicesRouter.post('/:id/payments', requirePermission('payments:create'), async (req, res) => {
  const body = PaymentSchema.parse(req.body);
  const id = String(req.params.id);
  const { tenantId, userId } = req.auth!;

  const invoice = await req.db(async (tx) => {
    // Row lock prevents two concurrent payments from overpaying the invoice
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
    const inv = await loadInvoice(tx, tenantId, id);
    if (!OPEN_STATUSES.includes(inv.status)) throw badRequest('Payments can only be recorded on sent or partially paid invoices');
    const balance = inv.total - inv.amountPaid;
    if (body.amount > balance) throw badRequest(`Amount exceeds the outstanding balance (${(balance / 100).toFixed(2)})`);

    const payment = await tx.payment.create({
      data: { tenantId, invoiceId: id, recordedById: userId, ...body, reference: body.reference ?? null },
    });
    const amountPaid = inv.amountPaid + body.amount;
    await tx.invoice.update({
      where: { id },
      data: { amountPaid, status: amountPaid >= inv.total ? 'PAID' : 'PARTIALLY_PAID' },
    });
    await audit(tx, req, {
      action: 'payment.recorded',
      entityType: 'Invoice',
      entityId: id,
      metadata: { paymentId: payment.id, number: inv.number, amount: body.amount, method: body.method },
    });
    return loadInvoice(tx, tenantId, id);
  });
  res.status(201).json(withOverdue(invoice));
});
