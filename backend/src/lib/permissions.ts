import type { Role } from '../generated/prisma/enums.js';

/**
 * Permission-based access control. Routes check a *permission*, never a role
 * name, so roles can be re-shaped without touching route code.
 */
export const PERMISSIONS = [
  'tenant:manage',
  'members:read',
  'members:manage',
  'billing:read',
  'billing:manage',
  'customers:read',
  'customers:write',
  'customers:delete',
  'invoices:read',
  'invoices:write',
  'invoices:delete',
  'payments:create',
  'analytics:read',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  MANAGER: [
    'members:read',
    'billing:read',
    'customers:read',
    'customers:write',
    'customers:delete',
    'invoices:read',
    'invoices:write',
    'invoices:delete',
    'payments:create',
    'analytics:read',
    'audit:read',
  ],
  EMPLOYEE: ['members:read', 'customers:read', 'customers:write', 'invoices:read', 'invoices:write'],
};

export const can = (role: Role, permission: Permission) => ROLE_PERMISSIONS[role].includes(permission);
