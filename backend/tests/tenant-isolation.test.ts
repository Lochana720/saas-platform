import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { api, createCustomer, createInvoice, registerCompany, type Session } from './helpers.js';

/**
 * The most important property of a multi-tenant system:
 * Company A must never be able to read or modify Company B's data.
 */
describe('Tenant isolation — API layer', () => {
  let a: Session, b: Session;
  let customerA: { id: string; name: string };
  let invoiceA: { id: string };

  beforeAll(async () => {
    a = await registerCompany('Company A');
    b = await registerCompany('Company B');
    customerA = await createCustomer(a, 'Secret Customer of A');
    invoiceA = await createInvoice(a, customerA.id);
  });

  it('B does not see A’s customers in lists', async () => {
    const res = await api().get('/api/customers?pageSize=100').set(b.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).not.toContain(customerA.id);
  });

  it('B gets 404 for A’s customer and invoice by id', async () => {
    expect((await api().get(`/api/customers/${customerA.id}`).set(b.auth)).status).toBe(404);
    expect((await api().get(`/api/invoices/${invoiceA.id}`).set(b.auth)).status).toBe(404);
  });

  it('B cannot modify or delete A’s records', async () => {
    expect((await api().patch(`/api/customers/${customerA.id}`).set(b.auth).send({ name: 'Hacked' })).status).toBe(404);
    expect((await api().delete(`/api/invoices/${invoiceA.id}`).set(b.auth)).status).toBe(404);
    expect((await api().post(`/api/invoices/${invoiceA.id}/send`).set(b.auth)).status).toBe(404);
  });

  it('B cannot attach A’s customer to its own invoice', async () => {
    const res = await api()
      .post('/api/invoices')
      .set(b.auth)
      .send({ customerId: customerA.id, issueDate: new Date(), dueDate: new Date(), items: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    expect(res.status).toBe(400);
  });

  it('B cannot switch its session into A’s tenant', async () => {
    const res = await api().post('/api/auth/switch-tenant').set(b.auth).send({ tenantId: a.tenantId });
    expect(res.status).toBe(403);
  });

  it('A still sees its own data unchanged', async () => {
    const res = await api().get(`/api/customers/${customerA.id}`).set(a.auth);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Secret Customer of A');
  });
});

/**
 * Defence in depth: even raw SQL with NO tenant filter, run as the app's
 * database role, cannot cross tenants because PostgreSQL RLS enforces it.
 */
describe('Tenant isolation — PostgreSQL Row-Level Security', () => {
  let a: Session, b: Session;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    a = await registerCompany();
    b = await registerCompany();
    await createInvoice(a, (await createCustomer(a)).id);
    await createInvoice(b, (await createCustomer(b)).id);
    await client.connect();
  });
  afterAll(() => client.end());

  const asTenant = async <T>(tenantId: string, sql: string, params: unknown[] = []) => {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return r.rows as T[];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  };

  it('SELECT without WHERE only returns the current tenant’s rows', async () => {
    const rows = await asTenant<{ tenantId: string }>(a.tenantId, 'SELECT "tenantId" FROM "Invoice"');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([a.tenantId]));
  });

  it('with no tenant context, tenant tables look empty', async () => {
    const r = await client.query('SELECT count(*)::int AS n FROM "Invoice"');
    expect(r.rows[0].n).toBe(0);
  });

  it('cannot INSERT a row for another tenant', async () => {
    await expect(
      asTenant(a.tenantId, `INSERT INTO "Customer" (id, "tenantId", name, "updatedAt") VALUES (gen_random_uuid()::text, $1, 'evil', now())`, [b.tenantId]),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot UPDATE another tenant’s rows (0 rows affected)', async () => {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
    const r = await client.query(`UPDATE "Customer" SET name = 'pwned' WHERE "tenantId" = $1`, [b.tenantId]);
    await client.query('ROLLBACK');
    expect(r.rowCount).toBe(0);
  });

  it('audit log is append-only for the app role', async () => {
    await expect(asTenant(a.tenantId, `UPDATE "AuditLog" SET action = 'tampered'`)).rejects.toThrow(/permission denied/);
    await expect(asTenant(a.tenantId, `DELETE FROM "AuditLog"`)).rejects.toThrow(/permission denied/);
  });
});
