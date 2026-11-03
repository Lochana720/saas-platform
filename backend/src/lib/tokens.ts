import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

export interface AccessPayload {
  sub: string; // user id
  tid: string; // active tenant id
}

export function signAccessToken(userId: string, tenantId: string) {
  return jwt.sign({ tid: tenantId } satisfies Omit<AccessPayload, 'sub'>, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  if (!decoded.sub || typeof decoded.tid !== 'string') throw new Error('Malformed token');
  return { sub: decoded.sub, tid: decoded.tid };
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export async function issueRefreshToken(userId: string, tenantId: string) {
  const token = randomToken(48);
  await prisma.refreshToken.create({
    data: {
      userId,
      tenantId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

/**
 * Rotation: each refresh token is single-use. Re-using an already-revoked token
 * means it was stolen, so every session of that user is revoked.
 */
export async function rotateRefreshToken(token: string, tenantOverride?: string) {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record) return null;
  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  if (record.expiresAt < new Date()) return null;

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const tenantId = tenantOverride ?? record.tenantId;
  const refreshToken = await issueRefreshToken(record.userId, tenantId);
  return { userId: record.userId, tenantId, refreshToken };
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
