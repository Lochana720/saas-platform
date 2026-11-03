import { sequential } from '../lib/prisma.js';
import { Router } from 'express';
import { z } from 'zod';
import { PageQuery, pageArgs, pageResult } from '../lib/pagination.js';
import { requirePermission } from '../middleware/auth.js';
import type { Prisma } from '../generated/prisma/client.js';

export const auditRouter = Router();

auditRouter.get('/', requirePermission('audit:read'), async (req, res) => {
  const q = PageQuery.extend({
    action: z.string().trim().optional(),
    entityType: z.string().trim().optional(),
    actorId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }).parse(req.query);

  const where: Prisma.AuditLogWhereInput = {
    tenantId: req.auth!.tenantId,
    ...(q.action && { action: { startsWith: q.action } }),
    ...(q.entityType && { entityType: q.entityType }),
    ...(q.actorId && { actorId: q.actorId }),
    ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) } }),
  };

  const [rows, total, actions] = await req.db((tx) =>
    sequential([
      tx.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      tx.auditLog.count({ where }),
      tx.auditLog.findMany({ where: { tenantId: req.auth!.tenantId }, distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]),
  );
  res.json({ ...pageResult(rows, total, q), actions: actions.map((a) => a.action) });
});
