import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, createCustomer, createInvoice, registerCompany, type Session } from './helpers.js';

describe('Role-based access control', () => {
  let admin: Session, manager: Session, employee: Session;
  let invoiceId: string;
  let customerId: string;

  beforeAll(async () => {
    admin = await registerCompany();
    // Free plan allows 3 users: admin + manager + employee
    manager = await addMember(admin, 'MANAGER');
    employee = await addMember(admin, 'EMPLOYEE');
    customerId = (await createCustomer(admin)).id;
    invoiceId = (await createInvoice(admin, customerId)).id;
  });

  it('employee can read and create invoices', async () => {
    expect((await api().get('/api/invoices').set(employee.auth)).status).toBe(200);
    await createInvoice(employee, customerId);
  });

  it.each([
    ['DELETE', () => `/api/invoices/${invoiceId}`],
    ['GET', () => '/api/analytics/summary'],
    ['GET', () => '/api/audit-logs'],
    ['GET', () => '/api/billing'],
  ])('employee is forbidden: %s %s', async (method, path) => {
    const req = method === 'DELETE' ? api().delete(path()) : api().get(path());
    expect((await req.set(employee.auth)).status).toBe(403);
  });

  it('employee cannot record payments, manager can', async () => {
    await api().post(`/api/invoices/${invoiceId}/send`).set(admin.auth).expect(200);
    const body = { amount: 1000, method: 'CASH' };
    expect((await api().post(`/api/invoices/${invoiceId}/payments`).set(employee.auth).send(body)).status).toBe(403);
    expect((await api().post(`/api/invoices/${invoiceId}/payments`).set(manager.auth).send(body)).status).toBe(201);
  });

  it('only admins can manage members and billing', async () => {
    const invite = { email: 'x@test.lk', role: 'EMPLOYEE' };
    expect((await api().post('/api/members/invitations').set(manager.auth).send(invite)).status).toBe(403);
    expect((await api().post('/api/billing/subscription').set(manager.auth).send({ planId: 'pro' })).status).toBe(403);
  });

  it('a role change takes effect immediately, without re-login', async () => {
    const members = await api().get('/api/members').set(admin.auth);
    const emp = members.body.members.find((m: { user: { id: string } }) => m.user.id === employee.userId);
    await api().patch(`/api/members/${emp.id}`).set(admin.auth).send({ role: 'MANAGER' }).expect(200);
    expect((await api().get('/api/analytics/summary').set(employee.auth)).status).toBe(200);
  });

  it('the last admin cannot be demoted', async () => {
    const members = await api().get('/api/members').set(admin.auth);
    const me = members.body.members.find((m: { user: { id: string } }) => m.user.id === admin.userId);
    const res = await api().patch(`/api/members/${me.id}`).set(admin.auth).send({ role: 'EMPLOYEE' });
    expect(res.status).toBe(400);
  });

  it('a removed member loses access immediately', async () => {
    const members = await api().get('/api/members').set(admin.auth);
    const mgr = members.body.members.find((m: { user: { id: string } }) => m.user.id === manager.userId);
    await api().delete(`/api/members/${mgr.id}`).set(admin.auth).expect(204);
    expect((await api().get('/api/invoices').set(manager.auth)).status).toBe(401);
  });
});
