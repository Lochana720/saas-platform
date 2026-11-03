import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { qs } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date, invoiceNo, money, STATUS_LABEL } from '../lib/format';
import type { Invoice, InvoiceStatus, Paged } from '../lib/types';
import { Card, Empty, Loading, PageHeader, Pagination, StatusBadge } from '../components/ui';

const TABS: ('' | InvoiceStatus | 'OVERDUE')[] = ['', 'DRAFT', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'VOID'];

export function InvoicesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const customerId = params.get('customerId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(params.get('search') ?? '');

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => search !== (params.get('search') ?? '') && update({ search, page: '' }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { data, loading } = useApi<Paged<Invoice>>(
    `/invoices${qs({ status, customerId, search: params.get('search'), page, pageSize: 15 })}`,
  );

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Create, send and track payment on invoices."
        actions={can('invoices:write') && <Link to="/invoices/new" className="btn btn-primary"><Plus size={16} />New invoice</Link>}
      />
      <Card flush>
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t || 'all'} role="tab" aria-selected={status === t} className={`tab ${status === t ? 'active' : ''}`} onClick={() => update({ status: t, page: '' })}>
              {t ? STATUS_LABEL[t] : 'All'}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input placeholder="Search customer or invoice number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
          </div>
          {customerId && (
            <button className="chip" onClick={() => update({ customerId: '', page: '' })}>
              Filtered by customer <X size={14} />
            </button>
          )}
        </div>
        {loading && !data ? <Loading /> : data?.data.length ? (
          <div className="table-wrap">
            <table className="table table-click">
              <thead>
                <tr>
                  <th>Number</th><th>Customer</th><th className="hide-sm">Issued</th><th className="hide-sm">Due</th><th>Status</th>
                  <th className="num">Total</th><th className="num hide-sm">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((inv) => (
                  <tr key={inv.id} onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <td><Link to={`/invoices/${inv.id}`} className="mono strong" onClick={(e) => e.stopPropagation()}>{invoiceNo(inv.number)}</Link></td>
                    <td>{inv.customer.name}</td>
                    <td className="muted hide-sm">{date(inv.issueDate)}</td>
                    <td className={`hide-sm ${inv.isOverdue ? 'text-danger' : 'muted'}`}>{date(inv.dueDate)}</td>
                    <td><StatusBadge status={inv.status} overdue={inv.isOverdue} /></td>
                    <td className="num mono">{money(inv.total)}</td>
                    <td className="num mono hide-sm">{inv.status === 'VOID' ? '—' : money(inv.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<FileText />} title="No invoices found">Try a different filter or create a new invoice.</Empty>
        )}
        {data && <Pagination {...data.pagination} onPage={(p) => update({ page: String(p) })} />}
      </Card>
    </>
  );
}
