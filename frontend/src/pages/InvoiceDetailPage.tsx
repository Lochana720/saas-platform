import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Banknote, Pencil, Printer, Send, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date, invoiceNo, isoDay, METHOD_LABEL, money, moneyPlain, toCents } from '../lib/format';
import type { Customer, Invoice, PaymentMethod } from '../lib/types';
import { Alert, Button, Card, Field, Loading, Modal, StatusBadge } from '../components/ui';

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, session } = useAuth();
  const { data: inv, setData, error, loading } = useApi<Invoice>(`/invoices/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  if (loading && !inv) return <Loading />;
  if (error || !inv) return <Alert>{error ?? 'Invoice not found'} <Link to="/invoices">Back to invoices</Link></Alert>;

  const act = async (name: string, fn: () => Promise<Invoice | void>) => {
    setBusy(name);
    setActionError(null);
    try {
      const updated = await fn();
      if (updated) setData(updated);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const customer = inv.customer as Customer;
  const open = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';

  return (
    <>
      <Link to="/invoices" className="back no-print"><ArrowLeft size={16} /> Invoices</Link>
      <header className="page-header no-print">
        <div>
          <h1 className="mono">{invoiceNo(inv.number)} <StatusBadge status={inv.status} overdue={inv.isOverdue} /></h1>
          <p className="muted">Created by {inv.createdBy?.name} · {date(inv.createdAt)}</p>
        </div>
        <div className="page-actions">
          <Button icon={<Printer size={16} />} onClick={() => window.print()}>Print</Button>
          {inv.status === 'DRAFT' && can('invoices:write') && (
            <>
              <Link to={`/invoices/${inv.id}/edit`} className="btn btn-secondary"><Pencil size={16} />Edit</Link>
              <Button variant="primary" icon={<Send size={16} />} loading={busy === 'send'} onClick={() => act('send', () => api.post(`/invoices/${inv.id}/send`))}>Mark as sent</Button>
            </>
          )}
          {open && can('payments:create') && (
            <Button variant="primary" icon={<Banknote size={16} />} onClick={() => setPayOpen(true)}>Record payment</Button>
          )}
          {inv.status === 'DRAFT' && can('invoices:delete') && (
            <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === 'delete'}
              onClick={() => confirm('Delete this draft invoice?') && act('delete', async () => { await api.delete(`/invoices/${inv.id}`); navigate('/invoices'); })}>Delete</Button>
          )}
          {open && inv.amountPaid === 0 && can('invoices:delete') && (
            <Button variant="danger" icon={<Ban size={16} />} loading={busy === 'void'}
              onClick={() => confirm('Void this invoice? It will stay on record but can no longer be paid.') && act('void', () => api.post(`/invoices/${inv.id}/void`))}>Void</Button>
          )}
        </div>
      </header>
      {actionError && <Alert>{actionError}</Alert>}

      <div className="grid-2-1">
        <article className="card invoice-doc">
          <div className="doc-head">
            <div>
              <div className="doc-from">{session?.tenant.name}</div>
              <div className="muted small">Invoice</div>
              <div className="doc-number mono">{invoiceNo(inv.number)}</div>
            </div>
            <dl className="doc-meta">
              <div><dt>Issued</dt><dd>{date(inv.issueDate)}</dd></div>
              <div><dt>Due</dt><dd className={inv.isOverdue ? 'text-danger' : ''}>{date(inv.dueDate)}</dd></div>
              <div><dt>Amount due</dt><dd className="mono strong">{money(inv.balance)}</dd></div>
            </dl>
          </div>
          <div className="doc-to">
            <span className="muted small">Billed to</span>
            <strong>{customer.name}</strong>
            {customer.address && <span>{customer.address}</span>}
            {customer.email && <span className="muted">{customer.email}</span>}
            {customer.phone && <span className="muted">{customer.phone}</span>}
          </div>
          <div className="table-wrap">
            <table className="table doc-table">
              <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inv.items?.map((i) => (
                  <tr key={i.id}>
                    <td>{i.description}</td>
                    <td className="num mono">{i.quantity}</td>
                    <td className="num mono">{moneyPlain(i.unitPrice)}</td>
                    <td className="num mono">{moneyPlain(i.amount ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="totals">
            <div><dt>Subtotal</dt><dd className="mono">{money(inv.subtotal)}</dd></div>
            <div><dt>Tax ({inv.taxRate}%)</dt><dd className="mono">{money(inv.tax)}</dd></div>
            <div className="totals-grand"><dt>Total</dt><dd className="mono">{money(inv.total)}</dd></div>
            {inv.amountPaid > 0 && <div><dt>Paid</dt><dd className="mono">− {money(inv.amountPaid)}</dd></div>}
            {inv.amountPaid > 0 && <div className="totals-grand"><dt>Balance</dt><dd className="mono">{money(inv.balance)}</dd></div>}
          </dl>
          {inv.notes && <p className="doc-notes">{inv.notes}</p>}
        </article>

        <Card title="Payments" className="no-print">
          {inv.total > 0 && (
            <div className="progress-wrap">
              <div className="progress"><span style={{ width: `${Math.min(100, (inv.amountPaid / inv.total) * 100)}%` }} /></div>
              <span className="muted small">{money(inv.amountPaid)} of {money(inv.total)} paid</span>
            </div>
          )}
          {inv.payments?.length ? (
            <ul className="payments">
              {inv.payments.map((p) => (
                <li key={p.id}>
                  <div>
                    <strong className="mono">{money(p.amount)}</strong>
                    <span className="muted small">{METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </div>
                  <div className="right">
                    <span>{date(p.paidAt)}</span>
                    <span className="muted small">by {p.recordedBy?.name}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{inv.status === 'DRAFT' ? 'Mark the invoice as sent before recording payments.' : 'No payments recorded yet.'}</p>
          )}
        </Card>
      </div>

      <PaymentModal open={payOpen} invoice={inv} onClose={() => setPayOpen(false)} onSaved={(u) => { setData(u); setPayOpen(false); }} />
    </>
  );
}

function PaymentModal({ open, invoice, onClose, onSaved }: { open: boolean; invoice: Invoice; onClose: () => void; onSaved: (i: Invoice) => void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(isoDay(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<Invoice>(`/invoices/${invoice.id}/payments`, {
        amount: toCents(amount || invoice.balance / 100),
        method,
        reference: reference || null,
        paidAt,
      });
      setAmount('');
      setReference('');
      onSaved(updated);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Record payment · ${invoiceNo(invoice.number)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="pay-form" loading={busy}>Record payment</Button></>}>
      <form id="pay-form" onSubmit={submit} className="stack">
        {error && <Alert>{error}</Alert>}
        <Field label="Amount (LKR)" hint={<>Outstanding: <button type="button" className="link-btn" onClick={() => setAmount(String(invoice.balance / 100))}>{money(invoice.balance)}</button></>}>
          <input type="number" min="0.01" step="0.01" max={invoice.balance / 100} placeholder={String(invoice.balance / 100)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="row-2">
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Payment date"><input type="date" required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        </div>
        <Field label="Reference" hint="Cheque number, bank reference, etc."><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
