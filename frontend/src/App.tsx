import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import type { Permission } from './lib/types';
import { LoginPage, RegisterPage, AcceptInvitePage } from './pages/AuthPages';
// Charts library is only needed on the dashboard: load it as a separate chunk
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
import { CustomersPage } from './pages/CustomersPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { InvoiceEditorPage } from './pages/InvoiceEditorPage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { TeamPage } from './pages/TeamPage';
import { BillingPage } from './pages/BillingPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SettingsPage } from './pages/SettingsPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="fullscreen"><Loading /></div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="fullscreen"><Loading /></div>;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Hides pages the current role can't use (the API enforces this too). */
function Gate({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <Navigate to="/invoices" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          <Route path="/invite/:token" element={<AcceptInvitePage />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Gate perm="analytics:read"><Suspense fallback={<Loading />}><DashboardPage /></Suspense></Gate>} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/new" element={<Gate perm="invoices:write"><InvoiceEditorPage /></Gate>} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="invoices/:id/edit" element={<Gate perm="invoices:write"><InvoiceEditorPage /></Gate>} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="billing" element={<Gate perm="billing:read"><BillingPage /></Gate>} />
            <Route path="audit-logs" element={<Gate perm="audit:read"><AuditLogPage /></Gate>} />
            <Route path="settings" element={<Gate perm="tenant:manage"><SettingsPage /></Gate>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
