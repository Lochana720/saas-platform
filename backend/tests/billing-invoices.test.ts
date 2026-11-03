import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, createCustomer, createInvoice, registerCompany, type Session } from './helpers.js';
import { computeTotals } from '../src/routes/invoices.routes.js';

describe('Invoice totals', () => {
  it('calculates subtotal, tax and total in cents', () => {
    const t = computeTotals([{ quantity: 3, unitPrice: 1050 }, { quantity: 1, unitPrice: 999 }], 18);
    expect(t.subtotal).toBe(4149);
    expect(t.tax).toBe(747);
    expect(t.total).toBe(4896);
  });
});

describe('Invoice & payment lifecycle', () => {
  let s: Session;
  let invoice: { id: string; total: number; number: number };

  beforeAll(async () => {
    s = await registerCompany();
    invoice = await createInvoice(s, (await createCustomer(s)).id, 50_000);
  });

  it('numbers invoices sequentially per tenant', async () => {
    const next = await createInvoice(s, (await createCustomer(s)).id);
    expect(next.number).toBe(invoice.number + 1);
  });

  it('rejects payments on a draft', async () => {
    const res = await api().post(`/api/invoices/${invoice.id}/payments`).set(s.auth).send({ amount: 100, method: 'CASH' });
    expect(res.status).toBe(400);
  });

  it('partial payment → PARTIALLY_PAID, overpayment rejected, full → PAID', async () => {
    await api().post(`/api/invoices/${invoice.id}/send`).set(s.auth).expect(200);
    const half = Math.floor(invoice.total / 2);
    let res = await api().post(`/api/invoices/${invoice.id}/payments`).set(s.auth).send({ amount: half, method: 'BANK_TRANSFER' });
    expect(res.body.status).toBe('PARTIALLY_PAID');
    expect(res.body.balance).toBe(invoice.total - half);

    res = await api().post(`/api/invoices/${invoice.id}/payments`).set(s.auth).send({ amount: invoice.total, method: 'CASH' });
    expect(res.status).toBe(400);

    res = await api().post(`/api/invoices/${invoice.id}/payments`).set(s.auth).send({ amount: invoice.total - half, method: 'CASH' });
    expect(res.body.status).toBe('PAID');
    expect(res.body.payments).toHaveLength(2);
  });

  it('paid invoices cannot be edited or voided', async () => {
    expect((await api().post(`/api/invoices/${invoice.id}/void`).set(s.auth)).status).toBe(400);
    expect((await api().delete(`/api/invoices/${invoice.id}`).set(s.auth)).status).toBe(400);
  });

  it('every change was written to the audit log', async () => {
    const res = await api().get('/api/audit-logs?pageSize=100').set(s.auth);
    const actions = res.body.data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['tenant.created', 'invoice.created', 'invoice.sent', 'payment.recorded']));
  });
});

describe('Subscription plan limits', () => {
  it('Free plan blocks a 4th user, Pro plan allows it', async () => {
    const admin = await registerCompany();
    await addMember(admin, 'EMPLOYEE');
    await addMember(admin, 'EMPLOYEE');
    const blocked = await api().post('/api/members/invitations').set(admin.auth).send({ email: 'fourth@test.lk', role: 'EMPLOYEE' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('PLAN_LIMIT_REACHED');

    await api().post('/api/billing/subscription').set(admin.auth).send({ planId: 'pro' }).expect(200);
    await api().post('/api/members/invitations').set(admin.auth).send({ email: 'fourth@test.lk', role: 'EMPLOYEE' }).expect(201);
  });

  it('cannot downgrade below current seat usage', async () => {
    const admin = await registerCompany();
    await api().post('/api/billing/subscription').set(admin.auth).send({ planId: 'pro' }).expect(200);
    for (let i = 0; i < 3; i++) await addMember(admin, 'EMPLOYEE');
    const res = await api().post('/api/billing/subscription').set(admin.auth).send({ planId: 'free' });
    expect(res.status).toBe(400);
  });
});

describe('Refresh token rotation', () => {
  it('re-using an old refresh token revokes the whole session family', async () => {
    const s = await registerCompany();
    const first = await api().post('/api/auth/refresh').set('Cookie', s.cookie).expect(200);
    const newCookie = ([] as string[]).concat(first.headers['set-cookie']);
    // Attacker replays the ORIGINAL (already used) token:
    expect((await api().post('/api/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
    // ...which also kills the legitimate newer token
    expect((await api().post('/api/auth/refresh').set('Cookie', newCookie)).status).toBe(401);
  });
});
