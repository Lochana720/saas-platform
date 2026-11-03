import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { invoiceNo, isoDay, money, toCents } from '../lib/format';
import type { Customer, Invoice, Paged } from '../lib/types';
import { Alert, Button, Card, Field, Loading, PageHeader } from '../components/ui';

interface Line { key: number; description: string; quantity: string; unitPrice: string }
let nextKey = 1;
const newLine = (): Line => ({ key: nextKey++, description: '', quantity: '1', unitPrice: '' });

export function InvoiceEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const customers = useApi<Paged<Customer>>('/customers?pageSize=100');
  const existing = useApi<Invoice>(id ? `/invoices/${id}` : null);

  const today = new Date();
  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(isoDay(today));
  const [dueDate, setDueDate] = useState(isoDay(new Date(today.getTime() + 30 * 86_400_000)));
  const [taxRate, setTaxRate] = useState('18');
  const [notes, setNotes] = useState('Thank you for your business.');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const inv = existing.data;
    if (!inv) return;
    setCustomerId(inv.customer.id);
    setIssueDate(inv.issueDate.slice(0, 10));
    setDueDate(inv.dueDate.slice(0, 10));
    setTaxRate(String(inv.taxRate));
    setNotes(inv.notes ?? '');
    setLines((inv.items ?? []).map((i) => ({ key: nextKey++, description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice / 100) })));
  }, [existing.data]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * toCents(l.unitPrice), 0);
    const tax = Math.round((subtotal * (Number(taxRate) || 0)) / 100);
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxRate]);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      customerId,
      issueDate,
      dueDate,
      taxRate: Number(taxRate) || 0,
      notes,
      items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: toCents(l.unitPrice) })),
    };
    try {
      const saved = id ? await api.put<Invoice>(`/invoices/${id}`, body) : await api.post<Invoice>('/invoices', body);
      navigate(`/invoices/${saved.id}`);
    } catch (err) {
      setError(err as ApiError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  if (customers.loading || (id && !existing.data)) return <Loading />;
  if (existing.data && existing.data.status !== 'DRAFT') {
    return <Alert>Only draft invoices can be edited. <Link to={`/invoices/${id}`}>Back to invoice</Link></Alert>;
  }
  const noCustomers = !customers.data?.data.length;
  const detailMsgs = error?.details ? Object.entries(error.details).map(([k, v]) => `${k}: ${v[0]}`) : [];

  return (
    <form onSubmit={submit}>
      <Link to={id ? `/invoices/${id}` : '/invoices'} className="back"><ArrowLeft size={16} /> Back</Link>
      <PageHeader
        title={existing.data ? `Edit ${invoiceNo(existing.data.number)}` : 'New invoice'}
        subtitle="Saved as a draft. You can mark it as sent when it’s ready."
        actions={<Button variant="primary" type="submit" loading={busy} disabled={noCustomers}>{id ? 'Save changes' : 'Create draft'}</Button>}
      />
      {error && (
        <Alert>
          {error.message}
          {detailMsgs.length > 0 && <ul>{detailMsgs.map((m) => <li key={m}>{m}</li>)}</ul>}
          {error.code === 'PLAN_LIMIT_REACHED' && <> <Link to="/billing">View plans</Link></>}
        </Alert>
      )}
      {noCustomers && <Alert tone="info">You need a customer first. <Link to="/customers">Add a customer</Link></Alert>}

      <div className="grid-2-1">
        <Card title="Line items">
          <div className="lines">
            <div className="line line-head">
              <span>Description</span><span>Qty</span><span>Unit price (LKR)</span><span className="num">Amount</span><span />
            </div>
            {lines.map((l) => (
              <div className="line" key={l.key}>
                <input required placeholder="Item or service" value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} aria-label="Description" />
                <input required type="number" min={1} step={1} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} aria-label="Quantity" />
                <input required type="number" min={0} step="0.01" placeholder="0.00" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} aria-label="Unit price" />
                <span className="num mono">{money((Number(l.quantity) || 0) * toCents(l.unitPrice))}</span>
                <button type="button" className="icon-btn danger" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove line">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" icon={<Plus size={16} />} onClick={() => setLines((ls) => [...ls, newLine()])}>Add line</Button>

          <dl className="totals">
            <div><dt>Subtotal</dt><dd className="mono">{money(totals.subtotal)}</dd></div>
            <div><dt>Tax ({Number(taxRate) || 0}%)</dt><dd className="mono">{money(totals.tax)}</dd></div>
            <div className="totals-grand"><dt>Total</dt><dd className="mono">{money(totals.total)}</dd></div>
          </dl>
        </Card>

        <Card title="Details">
          <div className="stack">
            <Field label="Customer">
              <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="" disabled>Select a customer</option>
                {customers.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="row-2">
              <Field label="Issue date"><input type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
              <Field label="Due date"><input type="date" required min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            </div>
            <Field label="Tax rate (%)" hint="Sri Lanka VAT is 18%"><input type="number" min={0} max={100} step={1} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></Field>
            <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </Card>
      </div>
    </form>
  );
}
