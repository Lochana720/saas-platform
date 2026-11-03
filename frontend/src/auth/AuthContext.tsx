import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSessionHandlers } from '../lib/api';
import type { Permission, Session } from '../lib/types';

interface AuthState {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { companyName: string; name: string; email: string; password: string }) => Promise<void>;
  acceptInvite: (token: string, data: { name?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  reload: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((s: Session | null) => {
    setAccessToken(s?.accessToken ?? null);
    setSession(s);
  }, []);

  useEffect(() => {
    setSessionHandlers(setSession, () => apply(null));
    // Restore the session from the httpOnly refresh cookie on page load
    refreshSession().then((s) => {
      apply(s);
      setLoading(false);
    });
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      login: async (email, password) => apply(await api.post<Session>('/auth/login', { email, password })),
      register: async (data) => apply(await api.post<Session>('/auth/register', data)),
      acceptInvite: async (token, data) => apply(await api.post<Session>(`/auth/invitations/${token}/accept`, data)),
      logout: async () => {
        await api.post('/auth/logout').catch(() => undefined);
        apply(null);
      },
      switchTenant: async (tenantId) => apply(await api.post<Session>('/auth/switch-tenant', { tenantId })),
      reload: async () => apply(await api.get<Session>('/auth/me')),
      can: (p) => Boolean(session?.permissions.includes(p)),
    }),
    [session, loading, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
