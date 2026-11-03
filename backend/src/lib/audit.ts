import type { Request } from 'express';
import type { Tx } from './prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface AuditEntry {
  action: string; // "<entity>.<verb>", e.g. "invoice.created"
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Writes an audit log row in the SAME transaction as the change it describes. */
export async function audit(tx: Tx, req: Request, entry: AuditEntry, override?: { tenantId: string; actorId: string }) {
  await tx.auditLog.create({
    data: {
      tenantId: override?.tenantId ?? req.auth!.tenantId,
      actorId: override?.actorId ?? req.auth?.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
    },
  });
}

/** Returns only the fields that changed, as { field: { from, to } }. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (b !== undefined && JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return changes as Prisma.InputJsonValue;
}
