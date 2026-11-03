import { sequential } from '../lib/prisma.js';
import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { startOfMonth } from '../services/subscription.js';

export const analyticsRouter = Router();

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

analyticsRouter.get('/summary', requirePermission('analytics:read'), async (req, res) => {
  const { tenantId } = req.auth!;
  const now = new Date();
  const thisMonth = startOfMonth(now);
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const data = await req.db(async (tx) => {
    // Raw SQL is ALSO protected by RLS — the policies apply to every query on this connection.
    const [revenueRows, invoicedRows, topCustomers, statusGroups, open, overdue, revThis, revLast, customers, members] =
      await sequential([
        tx.$queryRaw<{ month: string; amount: number }[]>`
          SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month, SUM(amount)::int AS amount
          FROM "Payment" WHERE "tenantId" = ${tenantId} AND "paidAt" >= ${twelveMonthsAgo}
          GROUP BY 1 ORDER BY 1`,
        tx.$queryRaw<{ month: string; amount: number }[]>`
          SELECT to_char(date_trunc('month', "issueDate"), 'YYYY-MM') AS month, SUM(total)::int AS amount
          FROM "Invoice" WHERE "tenantId" = ${tenantId} AND "issueDate" >= ${twelveMonthsAgo}
            AND status NOT IN ('DRAFT', 'VOID')
          GROUP BY 1 ORDER BY 1`,
        tx.$queryRaw<{ id: string; name: string; paid: number; invoices: number }[]>`
          SELECT c.id, c.name, COALESCE(SUM(i."amountPaid"), 0)::int AS paid, COUNT(i.id)::int AS invoices
          FROM "Customer" c JOIN "Invoice" i ON i."customerId" = c.id AND i.status <> 'VOID'
          WHERE c."tenantId" = ${tenantId}
          GROUP BY c.id, c.name ORDER BY paid DESC LIMIT 5`,
        tx.invoice.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true }, _sum: { total: true } }),
        tx.invoice.aggregate({
          where: { tenantId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
          _sum: { total: true, amountPaid: true },
          _count: { _all: true },
        }),
        tx.invoice.aggregate({
          where: { tenantId, status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: now } },
          _sum: { total: true, amountPaid: true },
          _count: { _all: true },
        }),
        tx.payment.aggregate({ where: { tenantId, paidAt: { gte: thisMonth } }, _sum: { amount: true } }),
        tx.payment.aggregate({ where: { tenantId, paidAt: { gte: lastMonth, lt: thisMonth } }, _sum: { amount: true } }),
        tx.customer.count({ where: { tenantId } }),
        tx.membership.count({ where: { tenantId } }),
      ]);

    const revenue = new Map(revenueRows.map((r) => [r.month, r.amount]));
    const invoiced = new Map(invoicedRows.map((r) => [r.month, r.amount]));
    const months = Array.from({ length: 12 }, (_, i) => {
      const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)));
      return { month: key, revenue: revenue.get(key) ?? 0, invoiced: invoiced.get(key) ?? 0 };
    });

    const thisRevenue = revThis._sum.amount ?? 0;
    const lastRevenue = revLast._sum.amount ?? 0;
    return {
      kpis: {
        revenueThisMonth: thisRevenue,
        revenueLastMonth: lastRevenue,
        revenueChangePct: lastRevenue ? Math.round(((thisRevenue - lastRevenue) / lastRevenue) * 100) : null,
        outstanding: (open._sum.total ?? 0) - (open._sum.amountPaid ?? 0),
        openInvoices: open._count._all,
        overdue: (overdue._sum.total ?? 0) - (overdue._sum.amountPaid ?? 0),
        overdueInvoices: overdue._count._all,
        customers,
        members,
      },
      monthly: months,
      statusBreakdown: statusGroups.map((g) => ({ status: g.status, count: g._count._all, total: g._sum.total ?? 0 })),
      topCustomers,
    };
  });
  res.json(data);
});
