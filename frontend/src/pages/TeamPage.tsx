import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, UserPlus, X, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date, ROLE_HELP, ROLE_LABEL } from '../lib/format';
import type { Role } from '../lib/types';
import { Alert, Avatar, Badge, Button, Card, Field, Loading, Modal, PageHeader } from '../components/ui';

interface Members {
  members: { id: string; role: Role; createdAt: string; user: { id: string; name: string; email: string } }[];
  invitations: { id: string; email: string; role: Role; expiresAt: string; inviteUrl: string }[];
}

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" icon={copied ? <Check size={15} /> : <Copy size={15} />}
      onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

export function TeamPage() {
  const { can, session, reload: reloadSession } = useAuth();
  const { data, loading, reload } = useApi<Members>('/members');
  const manage = can('members:manage');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ inviteUrl: string }>('/members/invitations', { email, role });
      setCreated(res.inviteUrl);
      setEmail('');
      reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (id: string, r: Role, isMe: boolean) => {
    setRowError(null);
    try {
      await api.patch(`/members/${id}`, { role: r });
      reload();
      if (isMe) await reloadSession();
    } catch (e) {
      setRowError((e as Error).message);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from ${session?.tenant.name}? They will lose access immediately.`)) return;
    setRowError(null);
    try {
      await api.delete(`/members/${id}`);
      reload();
    } catch (e) {
      setRowError((e as Error).message);
    }
  };

  const revoke = async (id: string) => {
    await api.delete(`/members/invitations/${id}`);
    reload();
  };

  if (loading && !data) return <Loading />;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who can access this company, and what they can do."
        actions={manage && <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => { setInviteOpen(true); setCreated(null); setError(null); }}>Invite member</Button>}
      />
      {rowError && <Alert>{rowError}</Alert>}

      <Card flush title={`Members (${data?.members.length ?? 0})`}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th className="hide-sm">Joined</th><th /></tr></thead>
            <tbody>
              {data?.members.map((m) => {
                const isMe = m.user.id === session?.user.id;
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="person">
                        <Avatar name={m.user.name} />
                        <div><strong>{m.user.name}{isMe && <span className="muted"> (you)</span>}</strong><small className="muted">{m.user.email}</small></div>
                      </div>
                    </td>
                    <td>
                      {manage ? (
                        <select className="select-sm" value={m.role} onChange={(e) => changeRole(m.id, e.target.value as Role, isMe)} aria-label={`Role for ${m.user.name}`}>
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      ) : (
                        <Badge tone={m.role === 'ADMIN' ? 'accent' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
                      )}
                    </td>
                    <td className="muted hide-sm">{date(m.createdAt)}</td>
                    <td className="row-actions">
                      {manage && !isMe && <button className="icon-btn danger" onClick={() => remove(m.id, m.user.name)} aria-label={`Remove ${m.user.name}`}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {manage && data && data.invitations.length > 0 && (
        <Card flush title={`Pending invitations (${data.invitations.length})`}>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.invitations.map((i) => (
                  <tr key={i.id}>
                    <td className="strong">{i.email}</td>
                    <td><Badge>{ROLE_LABEL[i.role]}</Badge></td>
                    <td className="muted hide-sm">Expires {date(i.expiresAt)}</td>
                    <td className="row-actions">
                      <CopyLink url={i.inviteUrl} />
                      <button className="icon-btn danger" onClick={() => revoke(i.id)} aria-label={`Revoke invitation for ${i.email}`}><X size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="What each role can do">
        <ul className="role-list">
          {ROLES.map((r) => <li key={r}><Badge tone={r === 'ADMIN' ? 'accent' : 'neutral'}>{ROLE_LABEL[r]}</Badge><span>{ROLE_HELP[r]}</span></li>)}
        </ul>
      </Card>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a team member"
        footer={created ? <Button variant="primary" onClick={() => setInviteOpen(false)}>Done</Button> : <><Button onClick={() => setInviteOpen(false)}>Cancel</Button><Button variant="primary" type="submit" form="invite-form" loading={busy}>Create invitation</Button></>}>
        {created ? (
          <div className="stack">
            <Alert tone="ok">Invitation created. Share this link with them — it expires in 7 days.</Alert>
            <div className="copy-row"><code>{created}</code><CopyLink url={created} /></div>
          </div>
        ) : (
          <form id="invite-form" onSubmit={invite} className="stack">
            {error && (
              <Alert>
                {error.message} {error.code === 'PLAN_LIMIT_REACHED' && <Link to="/billing">Upgrade plan</Link>}
              </Alert>
            )}
            <Field label="Email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role" hint={ROLE_HELP[role]}>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
          </form>
        )}
      </Modal>
    </>
  );
}
