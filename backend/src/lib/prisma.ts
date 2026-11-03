import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

export type Tx = Prisma.TransactionClient;

export interface DbContext {
  tenantId?: string;
  userId?: string;
  inviteToken?: string;
}

/**
 * Runs `fn` inside a transaction whose Postgres session variables identify the
 * current tenant / user. Row-Level Security policies read these variables, so
 * every query inside `fn` can only ever see rows of that tenant.
 *
 * `set_config(..., true)` is transaction-local: the values vanish at COMMIT, so
 * pooled connections can never leak one tenant's context into another request.
 */
export function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT
        set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
        set_config('app.user_id', ${ctx.userId ?? ''}, true),
        set_config('app.invite_token', ${ctx.inviteToken ?? ''}, true)`;
      return fn(tx);
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/** Switch the tenant context mid-transaction (used when accepting an invitation). */
export async function setTenant(tx: Tx, tenantId: string) {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

/**
 * Inside an interactive transaction all queries share ONE connection, so they
 * must run one after another. Prisma queries are lazy (they start when awaited),
 * so this runs them in order while keeping the convenient tuple typing.
 */
export async function sequential<T extends readonly unknown[]>(queries: [...T]): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results: unknown[] = [];
  for (const q of queries) results.push(await q);
  return results as { -readonly [K in keyof T]: Awaited<T[K]> };
}
