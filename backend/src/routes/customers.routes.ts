import { sequential } from '../lib/prisma.js';
import { Router } from 'express';
import { z } from 'zod';
import { audit, diff } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { PageQuery, pageArgs, pageResult } from '../lib/pagination.js';
import { requirePermission } from '../middleware/auth.js';

export const customersRouter = Router();

const optional = (s: z.ZodString) => s.optional().nullable().or(z.literal('').transform(() => null));
const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  email: optional(z.string().trim().toLowerCase().email()),
  phone: optional(z.string().trim().max(30)),
  address: optional(z.string().trim().max(500)),
});

customersRouter.get('/', requirePermission('customers:read'), async (req, res) => {
  const q = PageQuery.extend({ search: z.string().trim().optional() }).parse(req.query);
  const { tenantId } = req.auth!;
  const where = {
    tenantId,
    ...(q.search && {
      OR: [
        { name: { contains: q.search, mode: 'insensitive' as const } },
        { email: { contains: q.search, mode: 'insensitive' as const } },
      ],
    }),
  };
  const [rows, total] = await req.db((tx) =>
    sequential([
      tx.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(q),
        include: { _count: { select: { invoices: true } } },
      }),
      tx.customer.count({ where }),
    ]),
  );
  res.json(pageResult(rows, total, q));
});

customersRouter.get('/:id', requirePermission('customers:read'), async (req, res) => {
  const customer = await req.db((tx) =>
    tx.customer.findFirst({
      where: { id: String(req.params.id), tenantId: req.auth!.tenantId },
      include: { invoices: { orderBy: { number: 'desc' }, take: 20 } },
    }),
  );
  if (!customer) throw notFound('Customer');
  res.json(customer);
});

customersRouter.post('/', requirePermission('customers:write'), async (req, res) => {
  const body = CustomerSchema.parse(req.body);
  const customer = await req.db(async (tx) => {
    const customer = await tx.customer.create({ data: { ...body, tenantId: req.auth!.tenantId } });
    await audit(tx, req, { action: 'customer.created', entityType: 'Customer', entityId: customer.id, metadata: { name: customer.name } });
    return customer;
  });
  res.status(201).json(customer);
});

customersRouter.patch('/:id', requirePermission('customers:write'), async (req, res) => {
  const body = CustomerSchema.partial().parse(req.body);
  const id = String(req.params.id);
  const customer = await req.db(async (tx) => {
    const before = await tx.customer.findFirst({ where: { id, tenantId: req.auth!.tenantId } });
    if (!before) throw notFound('Customer');
    const after = await tx.customer.update({ where: { id }, data: body });
    await audit(tx, req, { action: 'customer.updated', entityType: 'Customer', entityId: id, metadata: diff(before, body) });
    return after;
  });
  res.json(customer);
});

customersRouter.delete('/:id', requirePermission('customers:delete'), async (req, res) => {
  const id = String(req.params.id);
  await req.db(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id, tenantId: req.auth!.tenantId },
      include: { _count: { select: { invoices: true } } },
    });
    if (!customer) throw notFound('Customer');
    if (customer._count.invoices > 0) throw badRequest('This customer has invoices and cannot be deleted');
    await tx.customer.delete({ where: { id } });
    await audit(tx, req, { action: 'customer.deleted', entityType: 'Customer', entityId: id, metadata: { name: customer.name } });
  });
  res.status(204).end();
});
