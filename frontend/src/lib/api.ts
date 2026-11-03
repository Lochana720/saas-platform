import type { Session } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionRefreshed: (s: Session) => void = () => {};
let onUnauthorized: () => void = () => {};

export const setAccessToken = (t: string | null) => (accessToken = t);
export const setSessionHandlers = (refreshed: (s: Session) => void, unauthorized: () => void) => {
  onSessionRefreshed = refreshed;
  onUnauthorized = unauthorized;
};

// Several requests may 401 at once — share one refresh call between them
let refreshing: Promise<Session | null> | null = null;
export function refreshSession(): Promise<Session | null> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => (r.ok ? ((await r.json()) as Session) : null))
    .catch(() => null)
    .then((s) => {
      if (s) {
        accessToken = s.accessToken;
        onSessionRefreshed(s);
      }
      return s;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const s = await refreshSession();
    if (s) return request<T>(method, path, body, false);
    onUnauthorized();
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.message ?? `Request failed (${res.status})`, e.code, e.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
