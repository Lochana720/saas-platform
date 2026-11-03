export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'ONLINE';
export type Permission =
  | 'tenant:manage' | 'members:read' | 'members:manage' | 'billing:read' | 'billing:manage'
  | 'customers:read' | 'customers:write' | 'customers:delete'
  | 'invoices:read' | 'invoices:write' | 'invoices:delete' | 'payments:create'
  | 'analytics:read' | 'audit:read';

export interface TenantSummary { id: string; name: string; slug: string; status?: string; role: Role }

export interface Session {
  accessToken: string;
  user: { id: string; email: string; name: string };
  tenant: { id: string; name: string; slug: string };
  role: Role;
  permissions: Permission[];
  tenants: TenantSummary[];
}

export interface Paged<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Customer {
  id: string; name: string; email: string | null; phone: string | null; address: string | null;
  createdAt: string; _count?: { invoices: number };
}

export interface InvoiceItem { id?: string; description: string; quantity: number; unitPrice: number; amount?: number }

export interface Payment {
  id: string; amount: number; method: PaymentMethod; reference: string | null; paidAt: string;
  recordedBy?: { name: string };
}

export interface Invoice {
  id: string; number: number; status: InvoiceStatus; issueDate: string; dueDate: string; currency: string;
  taxRate: number; subtotal: number; tax: number; total: number; amountPaid: number; balance: number;
  isOverdue: boolean; notes: string | null; createdAt: string;
  customer: Customer | { id: string; name: string };
  items?: InvoiceItem[]; payments?: Payment[]; createdBy?: { id: string; name: string };
}

export interface Plan {
  id: string; name: string; priceMonthly: number; maxUsers: number; maxInvoicesPerMonth: number | null; features: string[];
}

export interface AuditLog {
  id: string; action: string; entityType: string; entityId: string | null; metadata: Record<string, unknown> | null;
  ip: string | null; userAgent: string | null; createdAt: string; actor: { id: string; name: string; email: string } | null;
}
