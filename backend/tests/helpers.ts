import request from 'supertest';
import { createApp } from '../src/app.js';

export const app = createApp();
export const api = () => request(app);

const uid = () => Math.random().toString(36).slice(2, 10);

export interface Session {
  token: string;
  tenantId: string;
  userId: string;
  cookie: string[];
  auth: { Authorization: string };
}

const toSession = (res: request.Response): Session => ({
  token: res.body.accessToken,
  tenantId: res.body.tenant.id,
  userId: res.body.user.id,
  cookie: ([] as string[]).concat(res.headers['set-cookie'] ?? []),
  auth: { Authorization: `Bearer ${res.body.accessToken}` },
});

export async function registerCompany(name = `Test Co ${uid()}`) {
  const email = `owner-${uid()}@test.lk`;
  const res = await api().post('/api/auth/register').send({ companyName: name, name: 'Owner', email, password: 'Password123!' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...toSession(res), email };
}

/** Invite a new user with `role` and accept the invitation; returns their session. */
export async function addMember(admin: Session, role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
  const email = `${role.toLowerCase()}-${uid()}@test.lk`;
  const inv = await api().post('/api/members/invitations').set(admin.auth).send({ email, role });
  if (inv.status !== 201) throw new Error(`invite failed: ${inv.status} ${JSON.stringify(inv.body)}`);
  const token = inv.body.inviteUrl.split('/invite/')[1];
  const res = await api().post(`/api/auth/invitations/${token}/accept`).send({ name: role, password: 'Password123!' });
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.body)}`);
  return toSession(res);
}

export async function createCustomer(s: Session, name = `Customer ${uid()}`) {
  const res = await api().post('/api/customers').set(s.auth).send({ name, email: `${uid()}@cust.lk` });
  if (res.status !== 201) throw new Error(`customer failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createInvoice(s: Session, customerId: string, unitPrice = 100_000) {
  const res = await api()
    .post('/api/invoices')
    .set(s.auth)
    .send({
      customerId,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      taxRate: 18,
      items: [{ description: 'Consulting', quantity: 2, unitPrice }],
    });
  if (res.status !== 201) throw new Error(`invoice failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
