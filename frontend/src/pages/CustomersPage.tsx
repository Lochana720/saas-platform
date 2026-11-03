import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError, qs } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date } from '../lib/format';
import type { Customer, Paged } from '../lib/types';
import { Alert, Button, Card, Empty, Field, Loading, Modal, PageHeader, Pagination } from '../components/ui';

const blank = { name: '', email: '', phone: '', address: '' };

export function CustomersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, reload } = useApi<Paged<Customer>>(`/customers${qs({ search: debounced, page, pageSize: 15 })}`);

  const open = (c: Customer | 'new') => {
    setEditing(c);
    setError(null);
    setForm(c === 'new' ? blank : { name: c.name, email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '' });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing === 'new') await api.post('/customers', form);
      else if (editing) await api.patch(`/customers/${editing.id}`, form);
      setEditing(null);
      reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Customer) => {
    if (!confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/customers/${c.id}`);
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const fe = (f: string) => error?.details?.[f]?.[0];

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="People and businesses you invoice."
        actions={can('customers:write') && <Button variant="primary" icon={<Plus size={16} />} onClick={() => open('new')}>Add customer</Button>}
      />
      <Card flush>
        <div className="toolbar">
          <div className="search">
            <Search size={16} />
            <input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
          </div>
        </div>
        {loading && !data ? <Loading /> : data?.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Email</th><th className="hide-sm">Phone</th><th className="hide-sm">Location</th><th className="num">Invoices</th><th className="hide-sm">Added</th><th /></tr>
              </thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id}>
                    <td className="strong"><Link to={`/invoices?customerId=${c.id}`}>{c.name}</Link></td>
                    <td className="muted">{c.email ?? '—'}</td>
                    <td className="muted hide-sm">{c.phone ?? '—'}</td>
                    <td className="muted hide-sm">{c.address ?? '—'}</td>
                    <td className="num mono">{c._count?.invoices ?? 0}</td>
                    <td className="muted hide-sm">{date(c.createdAt)}</td>
                    <td className="row-actions">
                      {can('customers:write') && <button className="icon-btn" onClick={() => open(c)} aria-label={`Edit ${c.name}`}><Pencil size={15} /></button>}
                      {can('customers:delete') && !c._count?.invoices && <button className="icon-btn danger" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<Users />} title={debounced ? 'No matching customers' : 'No customers yet'}>
            {!debounced && 'Add your first customer to start invoicing.'}
          </Empty>
        )}
        {data && <Pagination {...data.pagination} onPage={setPage} />}
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add customer' : 'Edit customer'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" type="submit" form="customer-form" loading={busy}>Save</Button></>}
      >
        <form id="customer-form" onSubmit={save} className="stack">
          {error && !error.details && <Alert>{error.message}</Alert>}
          <Field label="Name" error={fe('name')}><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="row-2">
            <Field label="Email" error={fe('email')}><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone" error={fe('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+94 77 123 4567" /></Field>
          </div>
          <Field label="Address" error={fe('address')}><textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        </form>
      </Modal>
    </>
  );
}
