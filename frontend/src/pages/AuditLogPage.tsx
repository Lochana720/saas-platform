import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { qs } from '../lib/api';
import { useApi } from '../lib/useApi';
import { dateTime, timeAgo } from '../lib/format';
import type { AuditLog, Paged } from '../lib/types';
import { Avatar, Card, Empty, Loading, PageHeader, Pagination } from '../components/ui';

const ACTION_TEXT: Record<string, string> = {
  'tenant.created': 'created the company',
  'tenant.updated': 'updated company settings',
  'user.login': 'signed in',
  'member.joined': 'joined the company',
  'member.role_changed': 'changed a member’s role',
  'member.removed': 'removed a member',
  'invitation.created': 'invited a member',
  'invitation.revoked': 'revoked an invitation',
  'customer.created': 'added a customer',
  'customer.updated': 'updated a customer',
  'customer.deleted': 'deleted a customer',
  'invoice.created': 'created an invoice',
  'invoice.updated': 'edited an invoice',
  'invoice.sent': 'marked an invoice as sent',
  'invoice.voided': 'voided an invoice',
  'invoice.deleted': 'deleted a draft invoice',
  'payment.recorded': 'recorded a payment',
  'subscription.changed': 'changed the subscription plan',
  'subscription.canceled': 'canceled the subscription',
};

function summary(log: AuditLog) {
  const m = (log.metadata ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof m.number === 'number') bits.push(`INV-${m.number}`);
  if (typeof m.name === 'string') bits.push(m.name);
  if (typeof m.email === 'string') bits.push(m.email);
  if (typeof m.amount === 'number') bits.push(`LKR ${(m.amount / 100).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`);
  if (m.from && m.to && typeof m.from === 'string') bits.push(`${m.from} → ${m.to}`);
  return bits.join(' · ');
}

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading } = useApi<Paged<AuditLog> & { actions: string[] }>(`/audit-logs${qs({ page, action, pageSize: 25 })}`);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change in this company, who made it and when. Entries can’t be edited or deleted." />
      <Card flush>
        <div className="toolbar">
          <select className="select-sm" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action">
            <option value="">All activity</option>
            {data?.actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {loading && !data ? <Loading /> : data?.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Activity</th><th className="hide-sm">Details</th><th>When</th></tr></thead>
              <tbody>
                {data.data.map((log) => (
                  <Fragment key={log.id}>
                    <tr className="clickable" onClick={() => setOpen(open === log.id ? null : log.id)}>
                      <td>{open === log.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td>
                        <div className="person">
                          <Avatar name={log.actor?.name ?? 'System'} size={28} />
                          <span><strong>{log.actor?.name ?? 'System'}</strong> {ACTION_TEXT[log.action] ?? log.action}</span>
                        </div>
                      </td>
                      <td className="muted hide-sm">{summary(log)}</td>
                      <td className="muted nowrap" title={dateTime(log.createdAt)}>{timeAgo(log.createdAt)}</td>
                    </tr>
                    {open === log.id && (
                      <tr className="detail-row">
                        <td />
                        <td colSpan={3}>
                          <dl className="kv">
                            <dt>Action</dt><dd className="mono">{log.action}</dd>
                            <dt>Entity</dt><dd className="mono">{log.entityType} {log.entityId}</dd>
                            <dt>Time</dt><dd>{dateTime(log.createdAt)}</dd>
                            <dt>IP address</dt><dd className="mono">{log.ip ?? '—'}</dd>
                            <dt>Device</dt><dd className="muted">{log.userAgent ?? '—'}</dd>
                            {log.metadata && <><dt>Data</dt><dd><pre>{JSON.stringify(log.metadata, null, 2)}</pre></dd></>}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<ScrollText />} title="No activity yet" />
        )}
        {data && <Pagination {...data.pagination} onPage={setPage} />}
      </Card>
    </>
  );
}
