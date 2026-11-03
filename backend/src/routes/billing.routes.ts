import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { requirePermission } from '../middleware/auth.js';
import { getSubscription, getUsage, newPeriod } from '../services/subscription.js';

export const billingRouter = Router();

billingRouter.get('/', requirePermission('billing:read'), async (req, res) => {
  const { tenantId } = req.auth!;
  const result = await req.db(async (tx) => {
    const plans = await tx.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    const subscription = await getSubscription(tx, tenantId);
    const usage = await getUsage(tx, tenantId);
    return { plans, subscription, usage };
  });
  res.json(result);
});

/**
 * Change plan. This uses a MOCK payment provider (instant success) so the project
 * runs without real credentials. To go live, replace this handler with a Stripe /
 * PayHere checkout session and apply the change from the provider's webhook.
 */
billingRouter.post('/subscription', requirePermission('billing:manage'), async (req, res) => {
  const { planId } = z.object({ planId: z.string().min(1) }).parse(req.body);
  const { tenantId } = req.auth!;

  const subscription = await req.db(async (tx) => {
    const plan = await tx.plan.findUnique({ where: { id: planId } });
    if (!plan) throw badRequest('Unknown plan');
    const current = await getSubscription(tx, tenantId);
    if (current.planId === planId && !current.cancelAtPeriodEnd) throw badRequest(`You are already on the ${plan.name} plan`);

    const usage = await getUsage(tx, tenantId);
    if (usage.seatsUsed > plan.maxUsers) {
      throw badRequest(`The ${plan.name} plan allows ${plan.maxUsers} users but you have ${usage.seatsUsed}. Remove members or invitations first.`);
    }

    const updated = await tx.subscription.update({
      where: { tenantId },
      data: { planId, status: 'ACTIVE', cancelAtPeriodEnd: false, ...newPeriod() },
      include: { plan: true },
    });
    await audit(tx, req, {
      action: 'subscription.changed',
      entityType: 'Subscription',
      entityId: updated.id,
      metadata: { from: current.planId, to: planId, priceMonthly: plan.priceMonthly },
    });
    return updated;
  });
  res.json(subscription);
});

billingRouter.post('/subscription/cancel', requirePermission('billing:manage'), async (req, res) => {
  const { tenantId } = req.auth!;
  const subscription = await req.db(async (tx) => {
    const current = await getSubscription(tx, tenantId);
    if (current.planId === 'free') throw badRequest('The Free plan has nothing to cancel');
    const updated = await tx.subscription.update({
      where: { tenantId },
      data: { cancelAtPeriodEnd: true },
      include: { plan: true },
    });
    await audit(tx, req, {
      action: 'subscription.canceled',
      entityType: 'Subscription',
      entityId: updated.id,
      metadata: { plan: current.planId, endsAt: current.currentPeriodEnd.toISOString() },
    });
    return updated;
  });
  res.json(subscription);
});
