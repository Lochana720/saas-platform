import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileText, UserCog, CreditCard, ScrollText, Settings, LogOut, ChevronsUpDown, Check, Menu, Building2,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../lib/format';
import type { Permission } from '../lib/types';
import { Avatar } from './ui';

const NAV: { to: string; label: string; icon: typeof Users; perm: Permission }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'analytics:read' },
  { to: '/invoices', label: 'Invoices', icon: FileText, perm: 'invoices:read' },
  { to: '/customers', label: 'Customers', icon: Users, perm: 'customers:read' },
  { to: '/team', label: 'Team', icon: UserCog, perm: 'members:read' },
  { to: '/billing', label: 'Billing', icon: CreditCard, perm: 'billing:read' },
  { to: '/audit-logs', label: 'Audit log', icon: ScrollText, perm: 'audit:read' },
  { to: '/settings', label: 'Settings', icon: Settings, perm: 'tenant:manage' },
];

function TenantSwitcher() {
  const { session, switchTenant } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!session) return null;

  return (
    <div className="switcher" ref={ref}>
      <button className="switcher-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="switcher-logo"><Building2 size={16} /></span>
        <span className="switcher-text">
          <strong>{session.tenant.name}</strong>
          <small>{ROLE_LABEL[session.role]}</small>
        </span>
        <ChevronsUpDown size={15} className="switcher-chev" />
      </button>
      {open && (
        <div className="switcher-menu">
          <div className="switcher-label">Your companies</div>
          {session.tenants.map((t) => (
            <button
              key={t.id}
              className="switcher-item"
              onClick={async () => {
                setOpen(false);
                if (t.id !== session.tenant.id) {
                  await switchTenant(t.id);
                  navigate('/');
                }
              }}
            >
              <span>
                {t.name}
                <small>{ROLE_LABEL[t.role]}</small>
              </span>
              {t.id === session.tenant.id && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { session, logout, can } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);
  if (!session) return null;

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Ledgerly</span>
        </div>
        <TenantSwitcher />
        <nav className="nav">
          {NAV.filter((n) => can(n.perm)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <Avatar name={session.user.name} size={34} />
          <div className="sidebar-user-text">
            <strong>{session.user.name}</strong>
            <small>{session.user.email}</small>
          </div>
          <button className="icon-btn on-dark" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <div className="main">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <span className="topbar-title">{session.tenant.name}</span>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
