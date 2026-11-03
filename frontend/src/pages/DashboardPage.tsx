import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, FileText, Plus } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import { date, invoiceNo, money, moneyCompact, STATUS_LABEL } from '../lib/format';
import type { Invoice, InvoiceStatus, Paged } from '../lib/types';
import { Button, Card, Empty, Loading, PageHeader, StatusBadge } from '../components/ui';

interface Summary {
  kpis: {
    revenueThisMonth: number; revenueLastMonth: number; revenueChangePct: number | null;
    outstanding: number; openInvoices: number; overdue: number; overdueInvoices: number; customers: number; members: number;
  };
  monthly: { month: string; revenue: number; invoiced: number }[];
  statusBreakdown: { status: InvoiceStatus; count: number; total: number }[];
  topCustomers: { id: string; name: string; paid: number; invoices: number }[];
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

function Kpi({ label, value, foot, tone }: { label: string; value: string; foot: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value mono">{value}</span>
      <span className="kpi-foot">{foot}</span>
    </div>
  );
}

const STATUS_ORDER: InvoiceStatus[] = ['PAID', 'PARTIALLY_PAID', 'SENT', 'DRAFT', 'VOID'];

export function DashboardPage() {
  const { session, can } = useAuth();
  const { data, loading } = useApi<Summary>('/analytics/summary');
  const recent = useApi<Paged<Invoice>>('/invoices?pageSize=6');

  if (loading || !data) return <Loading />;
  const { kpis } = data;
  const change = kpis.revenueChangePct;
  const statusTotal = data.statusBreakdown.reduce((s, x) => s + x.count, 0) || 1;
  const byStatus = new Map(data.statusBreakdown.map((s) => [s.status, s]));
  const maxTop = Math.max(1, ...data.topCustomers.map((c) => c.paid));

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${session!.user.name.split(' ')[0]}`}
        subtitle={`Here's how ${session!.tenant.name} is doing.`}
        actions={can('invoices:write') && <Link to="/invoices/new" className="btn btn-primary"><Plus size={16} />New invoice</Link>}
      />

      <div className="kpi-grid">
        <Kpi
          label="Collected this month"
          value={money(kpis.revenueThisMonth)}
          foot={
            change === null ? <span className="muted">No payments last month</span> : (
              <span className={change >= 0 ? 'up' : 'down'}>
                {change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(change)}% vs last month
              </span>
            )
          }
        />
        <Kpi label="Outstanding" value={money(kpis.outstanding)} foot={<span className="muted">{kpis.openInvoices} open invoices</span>} />
        <Kpi label="Overdue" value={money(kpis.overdue)} tone={kpis.overdue > 0 ? 'warn' : undefined} foot={<span className="muted">{kpis.overdueInvoices} past due date</span>} />
        <Kpi label="Customers" value={String(kpis.customers)} foot={<span className="muted">{kpis.members} team members</span>} />
      </div>

      <div className="grid-2-1">
        <Card title="Invoiced vs collected" actions={<span className="muted small">Last 12 months · LKR</span>}>
          <div className="chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.monthly} barGap={2} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} fontSize={12} stroke="var(--ink-3)" />
                <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} stroke="var(--ink-3)" width={52} />
                <Tooltip
                  cursor={{ fill: 'var(--hover)' }}
                  formatter={(v) => money(Number(v))}
                  labelFormatter={(m) => monthLabel(String(m))}
                  contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 13 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13 }} />
                <Bar dataKey="invoiced" name="Invoiced" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="revenue" name="Collected" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Invoices by status">
          <div className="status-bar" role="img" aria-label="Invoice status distribution">
            {STATUS_ORDER.map((s) => {
              const n = byStatus.get(s)?.count ?? 0;
              return n ? <span key={s} className={`seg seg-${s.toLowerCase()}`} style={{ width: `${(n / statusTotal) * 100}%` }} /> : null;
            })}
          </div>
          <ul className="status-list">
            {STATUS_ORDER.map((s) => {
              const row = byStatus.get(s);
              return (
                <li key={s}>
                  <span className={`dot seg-${s.toLowerCase()}`} />
                  <Link to={`/invoices?status=${s}`}>{STATUS_LABEL[s]}</Link>
                  <span className="mono muted">{row?.count ?? 0}</span>
                  <span className="mono">{moneyCompact(row?.total ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="grid-2-1">
        <Card title="Recent invoices" actions={<Link to="/invoices" className="link-sm">View all</Link>} flush>
          {recent.data?.data.length ? (
            <table className="table">
              <tbody>
                {recent.data.data.map((inv) => (
                  <tr key={inv.id}>
                    <td><Link to={`/invoices/${inv.id}`} className="mono strong">{invoiceNo(inv.number)}</Link></td>
                    <td>{inv.customer.name}</td>
                    <td className="muted hide-sm">{date(inv.issueDate)}</td>
                    <td><StatusBadge status={inv.status} overdue={inv.isOverdue} /></td>
                    <td className="num mono">{money(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon={<FileText />} title="No invoices yet">
              {can('invoices:write') && <Link to="/invoices/new"><Button variant="primary">Create your first invoice</Button></Link>}
            </Empty>
          )}
        </Card>

        <Card title="Top customers" actions={<span className="muted small">By amount collected</span>}>
          {data.topCustomers.length ? (
            <ul className="bars">
              {data.topCustomers.map((c) => (
                <li key={c.id}>
                  <div className="bars-row">
                    <span>{c.name}</span>
                    <span className="mono">{moneyCompact(c.paid)}</span>
                  </div>
                  <div className="bars-track"><span style={{ width: `${(c.paid / maxTop) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No payments recorded yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
