import { useState } from 'react';
import { Check } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';
import { date, money } from '../lib/format';
import type { Plan } from '../lib/types';
import { Alert, Badge, Button, Card, Loading, PageHeader } from '../components/ui';

interface Billing {
  plans: Plan[];
  subscription: { planId: string; status: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; plan: Plan };
  usage: { members: number; pendingInvites: number; seatsUsed: number; invoicesThisMonth: number };
}

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="meter">
      <div className="meter-row"><span>{label}</span><span className="mono">{used}{max ? ` / ${max}` : ' · unlimited'}</span></div>
      <div className={`progress ${pct >= 90 ? 'progress-warn' : ''}`}><span style={{ width: max ? `${pct}%` : '4%' }} /></div>
    </div>
  );
}

export function BillingPage() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<Billing>('/billing');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const manage = can('billing:manage');

  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { subscription: sub, usage } = data;

  const change = async (plan: Plan) => {
    const up = plan.priceMonthly > sub.plan.priceMonthly;
    if (!confirm(`${up ? 'Upgrade' : 'Switch'} to ${plan.name} for ${money(plan.priceMonthly)}/month?\n\n(Demo mode: no real payment is taken.)`)) return;
    setBusy(plan.id); setError(null); setNotice(null);
    try {
      await api.post('/billing/subscription', { planId: plan.id });
      setNotice(`You're now on the ${plan.name} plan.`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!confirm(`Cancel ${sub.plan.name}? You keep access until ${date(sub.currentPeriodEnd)}, then move to Free.`)) return;
    setBusy('cancel'); setError(null);
    try {
      await api.post('/billing/subscription/cancel');
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Billing" subtitle="Your subscription plan and usage." />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}

      <div className="grid-2-1">
        <Card title="Current plan">
          <div className="current-plan">
            <div>
              <div className="plan-name">{sub.plan.name} {sub.cancelAtPeriodEnd ? <Badge tone="warn">Cancels {date(sub.currentPeriodEnd)}</Badge> : <Badge tone="ok">Active</Badge>}</div>
              <div className="muted">
                {sub.plan.priceMonthly ? <>{money(sub.plan.priceMonthly)} / month · renews {date(sub.currentPeriodEnd)}</> : 'Free forever'}
              </div>
            </div>
            {manage && sub.planId !== 'free' && !sub.cancelAtPeriodEnd && (
              <Button variant="ghost" loading={busy === 'cancel'} onClick={cancel}>Cancel plan</Button>
            )}
          </div>
        </Card>
        <Card title="Usage">
          <div className="stack">
            <Meter label="Users (incl. pending invites)" used={usage.seatsUsed} max={sub.plan.maxUsers} />
            <Meter label="Invoices this month" used={usage.invoicesThisMonth} max={sub.plan.maxInvoicesPerMonth} />
          </div>
        </Card>
      </div>

      <div className="plans">
        {data.plans.map((p) => {
          const current = p.id === sub.planId && !sub.cancelAtPeriodEnd;
          return (
            <div key={p.id} className={`plan ${current ? 'plan-current' : ''} ${p.id === 'pro' ? 'plan-featured' : ''}`}>
              {p.id === 'pro' && <span className="plan-tag">Most popular</span>}
              <h3>{p.name}</h3>
              <div className="plan-price"><span className="mono">{p.priceMonthly ? money(p.priceMonthly) : 'LKR 0'}</span><small>/ month</small></div>
              <ul>{p.features.map((f) => <li key={f}><Check size={15} />{f}</li>)}</ul>
              {current ? (
                <Button disabled className="btn-block">Current plan</Button>
              ) : manage ? (
                <Button variant={p.priceMonthly > sub.plan.priceMonthly ? 'primary' : 'secondary'} className="btn-block" loading={busy === p.id} onClick={() => change(p)}>
                  {p.priceMonthly > sub.plan.priceMonthly ? 'Upgrade' : 'Switch'} to {p.name}
                </Button>
              ) : (
                <p className="muted small center">Ask an admin to change plans</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small center">Demo billing: plan changes apply instantly with no charge. In production this connects to Stripe or PayHere checkout + webhooks.</p>
    </>
  );
}
