import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck, Building2, Receipt, BarChart3 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import type { Role } from '../lib/types';
import { Alert, Button, Field, Loading } from '../components/ui';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-side">
        <div className="brand brand-lg">
          <img src="/favicon.svg" alt="" width={34} height={34} />
          <span>Ledgerly</span>
        </div>
        <div className="auth-pitch">
          <h2>One platform. Every company. Nothing shared that shouldn't be.</h2>
          <ul>
            <li><Building2 size={18} /> Run several companies from one login</li>
            <li><Receipt size={18} /> Invoices, payments and customers in one place</li>
            <li><ShieldCheck size={18} /> Database-level tenant isolation and full audit trail</li>
            <li><BarChart3 size={18} /> Live revenue and cash-flow analytics</li>
          </ul>
        </div>
        <p className="auth-foot">Portfolio project · React, Node.js, PostgreSQL RLS, Prisma</p>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const fieldErr = (e: unknown, f: string) => (e instanceof ApiError ? e.details?.[f]?.[0] : undefined);

const DEMO = [
  { email: 'admin@lankatraders.lk', label: 'Admin' },
  { email: 'manager@demo.lk', label: 'Manager · 2 companies' },
  { email: 'staff@lankatraders.lk', label: 'Employee' },
];

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle={<>New here? <Link to="/register">Create a company account</Link></>}>
      <form onSubmit={submit} className="stack">
        {error ? <Alert>{errMsg(error)}</Alert> : null}
        <Field label="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" type="submit" loading={busy} className="btn-block">Sign in</Button>
      </form>
      <div className="demo-box">
        <span className="field-label">Demo accounts · password <code>Password123!</code></span>
        <div className="demo-list">
          {DEMO.map((d) => (
            <button key={d.email} type="button" className="demo-chip" onClick={() => { setEmail(d.email); setPassword('Password123!'); }}>
              <strong>{d.label}</strong>
              <small>{d.email}</small>
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your company" subtitle={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="stack">
        {error && !(error instanceof ApiError && error.details) ? <Alert>{errMsg(error)}</Alert> : null}
        <Field label="Company name" error={fieldErr(error, 'companyName')}><input required value={form.companyName} onChange={set('companyName')} placeholder="e.g. Lanka Traders (Pvt) Ltd" /></Field>
        <Field label="Your name" error={fieldErr(error, 'name')}><input required value={form.name} onChange={set('name')} autoComplete="name" /></Field>
        <Field label="Work email" error={fieldErr(error, 'email')}><input type="email" required value={form.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Password" error={fieldErr(error, 'password')} hint="At least 8 characters"><input type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Button variant="primary" type="submit" loading={busy} className="btn-block">Create company</Button>
        <p className="muted small center">You start on the Free plan: 3 users, 20 invoices a month.</p>
      </form>
    </AuthShell>
  );
}

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { acceptInvite, session, logout } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ email: string; role: Role; company: string; userExists: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<typeof invite>(`/auth/invitations/${token}`).then(setInvite).catch((e) => setLoadError(errMsg(e)));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (session) await logout();
      await acceptInvite(token, { name: invite?.userExists ? undefined : name, password });
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <AuthShell title="Invitation unavailable" subtitle={loadError}>
        <Link to="/login" className="btn btn-secondary btn-block">Go to sign in</Link>
      </AuthShell>
    );
  }
  if (!invite) return <div className="fullscreen"><Loading /></div>;

  return (
    <AuthShell
      title={`Join ${invite.company}`}
      subtitle={<>You were invited as <strong>{ROLE_LABEL[invite.role]}</strong> · {invite.email}</>}
    >
      <form onSubmit={submit} className="stack">
        {error ? <Alert>{errMsg(error)}</Alert> : null}
        {invite.userExists ? (
          <Alert tone="info">You already have an account. Enter your password to add this company to it.</Alert>
        ) : (
          <Field label="Your name"><input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
        )}
        <Field label={invite.userExists ? 'Password' : 'Choose a password'} hint={invite.userExists ? undefined : 'At least 8 characters'}>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button variant="primary" type="submit" loading={busy} className="btn-block">Accept invitation</Button>
      </form>
    </AuthShell>
  );
}
