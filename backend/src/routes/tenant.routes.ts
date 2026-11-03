import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { requirePermission } from '../middleware/auth.js';

export const tenantRouter = Router();

tenantRouter.get('/', async (req, res) => {
  const tenant = await req.db((tx) =>
    tx.tenant.findUniqueOrThrow({
      where: { id: req.auth!.tenantId },
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
    }),
  );
  res.json(tenant);
});

tenantRouter.patch('/', requirePermission('tenant:manage'), async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2).max(100) }).parse(req.body);
  const tenant = await req.db(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: req.auth!.tenantId } });
    const tenant = await tx.tenant.update({ where: { id: before.id }, data: { name } });
    await audit(tx, req, { action: 'tenant.updated', entityType: 'Tenant', entityId: tenant.id, metadata: { name: { from: before.name, to: name } } });
    return tenant;
  });
  res.json(tenant);
});
