import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env, isProd } from '../config/env.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { ROLE_PERMISSIONS } from '../lib/permissions.js';
import { prisma, setTenant, withContext } from '../lib/prisma.js';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken } from '../lib/tokens.js';
import { authenticate } from '../middleware/auth.js';
import { FREE_PLAN_ID, newPeriod } from '../services/subscription.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'refresh_token';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in a few minutes' } },
});

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

/** All companies the user belongs to (RLS: own memberships via app.user_id). */
export function listUserTenants(userId: string) {
  return withContext({ userId }, (tx) =>
    tx.membership.findMany({
      where: { userId },
      select: { role: true, tenant: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ).then((rows) => rows.map((m) => ({ ...m.tenant, role: m.role })));
}

async function startSession(res: Response, userId: string, tenantId: string) {
  const refreshToken = await issueRefreshToken(userId, tenantId);
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
  return signAccessToken(userId, tenantId);
}

async function sessionPayload(userId: string, tenantId: string, accessToken: string) {
  const [user, tenants] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true } }),
    listUserTenants(userId),
  ]);
  const current = tenants.find((t) => t.id === tenantId);
  if (!current) throw unauthorized('No access to this company');
  return {
    accessToken,
    user,
    tenant: { id: current.id, name: current.name, slug: current.slug },
    role: current.role,
    permissions: ROLE_PERMISSIONS[current.role],
    tenants,
  };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';

// ---------------------------------------------------------------------------
// POST /api/auth/register — create a new company (tenant) + its first admin
// ---------------------------------------------------------------------------
const RegisterSchema = z.object({
  companyName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  email,
  password,
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = RegisterSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw conflict('An account with this email already exists. Sign in instead.');
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  const slug = `${slugify(body.companyName)}-${Math.random().toString(36).slice(2, 7)}`;

  // One transaction: user, tenant, admin membership, Free subscription, audit entry
  const { user, tenant } = await withContext({}, async (tx) => {
    const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
    const tenant = await tx.tenant.create({ data: { name: body.companyName, slug } });
    await setTenant(tx, tenant.id); // RLS context for the tenant-owned rows below
    await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'ADMIN' } });
    await tx.subscription.create({ data: { tenantId: tenant.id, planId: FREE_PLAN_ID, ...newPeriod() } });
    await audit(tx, req, { action: 'tenant.created', entityType: 'Tenant', entityId: tenant.id, metadata: { name: tenant.name } }, { tenantId: tenant.id, actorId: user.id });
    return { user, tenant };
  });

  const accessToken = await startSession(res, user.id, tenant.id);
  res.status(201).json(await sessionPayload(user.id, tenant.id, accessToken));
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
const LoginSchema = z.object({ email, password: z.string().min(1), tenantId: z.string().uuid().optional() });
// Hash of a random string: comparing against it keeps response time constant
// for unknown emails (prevents user enumeration via timing).
const DUMMY_HASH = bcrypt.hashSync('timing-attack-dummy-password', 12);

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = LoginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');

  const tenants = (await listUserTenants(user.id)).filter((t) => t.status === 'ACTIVE');
  if (!tenants.length) throw forbidden('Your account is not a member of any active company');
  const tenant = tenants.find((t) => t.id === body.tenantId) ?? tenants[0];

  await withContext({ tenantId: tenant.id, userId: user.id }, (tx) =>
    audit(tx, req, { action: 'user.login', entityType: 'User', entityId: user.id }, { tenantId: tenant.id, actorId: user.id }),
  );

  const accessToken = await startSession(res, user.id, tenant.id);
  res.json(await sessionPayload(user.id, tenant.id, accessToken));
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh — rotate refresh token (httpOnly cookie), new access token
// ---------------------------------------------------------------------------
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No session');
  const rotated = await rotateRefreshToken(token);
  if (!rotated) {
    res.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path });
    throw unauthorized('Session expired, please sign in again');
  }
  res.cookie(REFRESH_COOKIE, rotated.refreshToken, cookieOptions);
  const accessToken = signAccessToken(rotated.userId, rotated.tenantId);
  res.json(await sessionPayload(rotated.userId, rotated.tenantId, accessToken));
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) await revokeRefreshToken(token);
  res.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path });
  res.status(204).end();
});

authRouter.get('/me', authenticate, async (req, res) => {
  const header = req.get('authorization')!.slice(7);
  res.json(await sessionPayload(req.auth!.userId, req.auth!.tenantId, header));
});

// ---------------------------------------------------------------------------
// POST /api/auth/switch-tenant — move the session to another company
// ---------------------------------------------------------------------------
authRouter.post('/switch-tenant', authenticate, async (req, res) => {
  const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.body);
  const tenants = await listUserTenants(req.auth!.userId);
  const target = tenants.find((t) => t.id === tenantId && t.status === 'ACTIVE');
  if (!target) throw forbidden('You are not a member of that company');

  const old = req.cookies?.[REFRESH_COOKIE];
  if (old) await revokeRefreshToken(old);
  const accessToken = await startSession(res, req.auth!.userId, tenantId);
  res.json(await sessionPayload(req.auth!.userId, tenantId, accessToken));
});

// ---------------------------------------------------------------------------
// Public invitation endpoints
// ---------------------------------------------------------------------------
const loadInvite = (token: string) =>
  withContext({ inviteToken: token }, (tx) =>
    tx.invitation.findUnique({ where: { token }, include: { tenant: { select: { id: true, name: true } } } }),
  );

authRouter.get('/invitations/:token', async (req, res) => {
  const invite = await loadInvite(String(req.params.token));
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw badRequest('This invitation is invalid or has expired');
  const existingUser = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  res.json({ email: invite.email, role: invite.role, company: invite.tenant.name, userExists: Boolean(existingUser) });
});

const AcceptSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), password });

authRouter.post('/invitations/:token/accept', authLimiter, async (req, res) => {
  const token = String(req.params.token);
  const body = AcceptSchema.parse(req.body);
  const invite = await loadInvite(token);
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw badRequest('This invitation is invalid or has expired');

  let user = await prisma.user.findUnique({ where: { email: invite.email } });
  if (user) {
    if (!(await bcrypt.compare(body.password, user.passwordHash))) throw unauthorized('Incorrect password for this account');
  } else {
    if (!body.name) throw badRequest('Name is required to create your account');
    user = await prisma.user.create({
      data: { email: invite.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 12) },
    });
  }
  const userId = user.id;

  await withContext({ inviteToken: token, userId }, async (tx) => {
    await setTenant(tx, invite.tenantId);
    const already = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: invite.tenantId, userId } } });
    if (!already) await tx.membership.create({ data: { tenantId: invite.tenantId, userId, role: invite.role } });
    await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    await audit(
      tx,
      req,
      { action: 'member.joined', entityType: 'Membership', entityId: userId, metadata: { email: invite.email, role: invite.role } },
      { tenantId: invite.tenantId, actorId: userId },
    );
  });

  const accessToken = await startSession(res, userId, invite.tenantId);
  res.json(await sessionPayload(userId, invite.tenantId, accessToken));
});
