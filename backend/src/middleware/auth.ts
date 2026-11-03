import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { can, ROLE_PERMISSIONS, type Permission } from '../lib/permissions.js';
import { withContext, type Tx } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  permissions: readonly Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Run queries scoped to the authenticated tenant (RLS context set). */
      db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
    }
  }
}

/**
 * 1. Verifies the JWT.
 * 2. Re-loads the membership from the database on every request, so a removed
 *    member or a changed role takes effect immediately (not when the JWT expires).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return next(unauthorized());

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    return next(unauthorized('Session expired, please sign in again'));
  }

  const ctx = { tenantId: payload.tid, userId: payload.sub };
  const membership = await withContext(ctx, (tx) =>
    tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: payload.tid, userId: payload.sub } },
      include: { tenant: { select: { status: true } } },
    }),
  );
  if (!membership) return next(unauthorized('You are no longer a member of this company'));
  if (membership.tenant.status !== 'ACTIVE') return next(forbidden('This company account is suspended'));

  req.auth = {
    userId: payload.sub,
    tenantId: payload.tid,
    role: membership.role,
    permissions: ROLE_PERMISSIONS[membership.role],
  };
  req.db = (fn) => withContext(ctx, fn);
  next();
}

export const requirePermission =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    const missing = permissions.filter((p) => !can(req.auth!.role, p));
    if (missing.length) return next(forbidden(`Missing permission: ${missing.join(', ')}`));
    next();
  };
