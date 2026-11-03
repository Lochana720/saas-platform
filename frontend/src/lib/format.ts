import type { InvoiceStatus, PaymentMethod, Role } from './types';

const lkr = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-LK', { notation: 'compact', maximumFractionDigits: 1 });

/** Amounts are stored in cents. */
export const money = (cents: number, currency = 'LKR') => `${currency} ${lkr.format(cents / 100)}`;
export const moneyPlain = (cents: number) => lkr.format(cents / 100);
export const moneyCompact = (cents: number) => compact.format(cents / 100);
export const toCents = (rupees: string | number) => Math.round(Number(rupees || 0) * 100);

export const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return date(iso);
}

export const invoiceNo = (n: number) => `INV-${n}`;

export const STATUS_LABEL: Record<InvoiceStatus | 'OVERDUE', string> = {
  DRAFT: 'Draft', SENT: 'Sent', PARTIALLY_PAID: 'Partially paid', PAID: 'Paid', VOID: 'Void', OVERDUE: 'Overdue',
};
export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', CHEQUE: 'Cheque', ONLINE: 'Online',
};
export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee' };
export const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'Full access, including team, billing and company settings',
  MANAGER: 'Customers, invoices, payments, analytics and audit logs',
  EMPLOYEE: 'Create and view customers and invoices',
};

export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
