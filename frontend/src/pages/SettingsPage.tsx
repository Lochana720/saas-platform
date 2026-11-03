import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date } from '../lib/format';
import { Alert, Button, Card, Field, Loading, PageHeader } from '../components/ui';

export function SettingsPage() {
  const { reload } = useAuth();
  const { data, loading } = useApi<{ id: string; name: string; slug: string; createdAt: string }>('/tenant');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setName(data.name); }, [data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/tenant', { name });
      await reload();
      setMsg({ ok: true, text: 'Company name updated.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (loading || !data) return <Loading />;
  return (
    <>
      <PageHeader title="Company settings" />
      <Card title="Profile">
        <form onSubmit={save} className="stack narrow">
          {msg && <Alert tone={msg.ok ? 'ok' : 'danger'}>{msg.text}</Alert>}
          <Field label="Company name"><input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Workspace ID" hint="Used internally to isolate your data"><input value={data.id} readOnly className="mono" /></Field>
          <p className="muted small">Created {date(data.createdAt)} · slug <code>{data.slug}</code></p>
          <div><Button variant="primary" type="submit" loading={busy}>Save changes</Button></div>
        </form>
      </Card>
    </>
  );
}
