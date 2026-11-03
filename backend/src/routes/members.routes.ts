import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/tokens.js';
import { requirePermission } from '../middleware/auth.js';
import type { Tx } from '../lib/prisma.js';
import { can } from '../lib/permissions.js';
import { assertSeatAvailable } from '../services/subscription.js';
import { Role } from '../generated/prisma/enums.js';

export const membersRouter = Router();
const RoleSchema = z.enum(Role);
const INVITE_DAYS = 7;

membersRouter.get('/', requirePermission('members:read'), async (req, res) => {
  const { tenantId, role } = req.auth!;
  const canManage = can(role, 'members:manage');
  const result = await req.db(async (tx) => {
    const members = await tx.membership.findMany({
      where: { tenantId },
      select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const invitations = canManage
      ? await tx.invitation.findMany({
          where: { tenantId, acceptedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, token: true, expiresAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    return {
      members,
      invitations: invitations.map(({ token, ...i }) => ({ ...i, inviteUrl: `${env.APP_URL}/invite/${token}` })),
    };
  });
  res.json(result);
});

membersRouter.post('/invitations', requirePermission('members:manage'), async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email(), role: RoleSchema }).parse(req.body);
  const { tenantId, userId } = req.auth!;

  const invite = await req.db(async (tx) => {
    const isMember = await tx.membership.findFirst({ where: { tenantId, user: { email: body.email } } });
    if (isMember) throw conflict('This person is already a member');
    const pending = await tx.invitation.findFirst({
      where: { tenantId, email: body.email, acceptedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pending) throw conflict('An active invitation already exists for this email');
    await assertSeatAvailable(tx, tenantId);

    const invite = await tx.invitation.create({
      data: {
        tenantId,
        email: body.email,
        role: body.role,
        token: randomToken(32),
        invitedById: userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
    });
    await audit(tx, req, { action: 'invitation.created', entityType: 'Invitation', entityId: invite.id, metadata: body });
    return invite;
  });

  // No email service in this project: the admin copies the link and shares it.
  res.status(201).json({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    inviteUrl: `${env.APP_URL}/invite/${invite.token}`,
  });
});

membersRouter.delete('/invitations/:id', requirePermission('members:manage'), async (req, res) => {
  const id = String(req.params.id);
  await req.db(async (tx) => {
    const invite = await tx.invitation.findFirst({ where: { id, tenantId: req.auth!.tenantId, acceptedAt: null } });
    if (!invite) throw notFound('Invitation');
    await tx.invitation.delete({ where: { id } });
    await audit(tx, req, { action: 'invitation.revoked', entityType: 'Invitation', entityId: id, metadata: { email: invite.email } });
  });
  res.status(204).end();
});

/** Guard: a company must always keep at least one admin. */
async function assertNotLastAdmin(tx: Tx, tenantId: string, membershipId: string) {
  const target = await tx.membership.findFirst({ where: { id: membershipId, tenantId } });
  if (!target) throw notFound('Member');
  if (target.role === 'ADMIN') {
    const admins = await tx.membership.count({ where: { tenantId, role: 'ADMIN' } });
    if (admins <= 1) throw badRequest('A company must have at least one admin');
  }
  return target;
}

membersRouter.patch('/:id', requirePermission('members:manage'), async (req, res) => {
  const { role } = z.object({ role: RoleSchema }).parse(req.body);
  const id = String(req.params.id);
  const updated = await req.db(async (tx) => {
    const target = await assertNotLastAdmin(tx, req.auth!.tenantId, id);
    if (target.role === role) return target;
    const updated = await tx.membership.update({ where: { id }, data: { role } });
    await audit(tx, req, {
      action: 'member.role_changed',
      entityType: 'Membership',
      entityId: id,
      metadata: { userId: target.userId, from: target.role, to: role },
    });
    return updated;
  });
  res.json(updated);
});

membersRouter.delete('/:id', requirePermission('members:manage'), async (req, res) => {
  const id = String(req.params.id);
  await req.db(async (tx) => {
    const target = await assertNotLastAdmin(tx, req.auth!.tenantId, id);
    if (target.userId === req.auth!.userId) throw badRequest('You cannot remove yourself');
    await tx.membership.delete({ where: { id } });
    await audit(tx, req, { action: 'member.removed', entityType: 'Membership', entityId: id, metadata: { userId: target.userId, role: target.role } });
  });
  res.status(204).end();
});
