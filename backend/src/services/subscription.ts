import { type Tx, sequential } from '../lib/prisma.js';
import { planLimit } from '../lib/errors.js';

export const FREE_PLAN_ID = 'free';
const PERIOD_DAYS = 30;

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
export const startOfMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Loads the tenant's subscription and lazily applies period roll-over:
 *  - period ended + cancelAtPeriodEnd → downgrade to Free
 *  - period ended otherwise          → renew for another period (mock billing)
 * In production this would be driven by payment-provider webhooks instead.
 */
export async function getSubscription(tx: Tx, tenantId: string) {
  let sub = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!sub) throw new Error(`Tenant ${tenantId} has no subscription`);

  const now = new Date();
  if (sub.currentPeriodEnd <= now) {
    const downgrade = sub.cancelAtPeriodEnd;
    sub = await tx.subscription.update({
      where: { tenantId },
      data: {
        planId: downgrade ? FREE_PLAN_ID : sub.planId,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodStart: now,
        currentPeriodEnd: addDays(now, PERIOD_DAYS),
      },
      include: { plan: true },
    });
  }
  return sub;
}

export async function getUsage(tx: Tx, tenantId: string) {
  const [members, pendingInvites, invoicesThisMonth] = await sequential([
    tx.membership.count({ where: { tenantId } }),
    tx.invitation.count({ where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
    tx.invoice.count({ where: { tenantId, createdAt: { gte: startOfMonth() } } }),
  ]);
  return { members, pendingInvites, seatsUsed: members + pendingInvites, invoicesThisMonth };
}

export async function assertSeatAvailable(tx: Tx, tenantId: string) {
  const sub = await getSubscription(tx, tenantId);
  const usage = await getUsage(tx, tenantId);
  if (usage.seatsUsed >= sub.plan.maxUsers) {
    throw planLimit(
      `Your ${sub.plan.name} plan allows ${sub.plan.maxUsers} users (including pending invites). Upgrade to add more.`,
    );
  }
}

export async function assertInvoiceQuota(tx: Tx, tenantId: string) {
  const sub = await getSubscription(tx, tenantId);
  if (sub.plan.maxInvoicesPerMonth == null) return;
  const usage = await getUsage(tx, tenantId);
  if (usage.invoicesThisMonth >= sub.plan.maxInvoicesPerMonth) {
    throw planLimit(
      `Your ${sub.plan.name} plan allows ${sub.plan.maxInvoicesPerMonth} invoices per month. Upgrade for unlimited invoices.`,
    );
  }
}

export const newPeriod = () => {
  const now = new Date();
  return { currentPeriodStart: now, currentPeriodEnd: addDays(now, PERIOD_DAYS) };
};
