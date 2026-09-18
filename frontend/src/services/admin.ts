import { ApiError } from '../api/client';
import type {
  AdminDiagnostics,
  AdminState,
  ClosingsFeed,
  Envelope,
  GraphicSnapshot,
  OnAirState,
  ProgramGraphic,
  SchoolClosing,
  StationAlert,
  StationGraphic,
} from '../api/types';

/**
 * ADMIN SERVICE LAYER
 *
 * The newsroom's side of the API. Kept apart from the public weather service
 * on purpose: these calls carry a bearer token, they are never memoised, and
 * a stale read here would be a person editing yesterday's settings.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '/api';
const TOKEN_KEY = 'nc12.adminToken';

export function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing: the session simply will not survive a reload.
  }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const res = await fetch(`${BASE}/admin${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('The admin API returned an unreadable response.', res.status || 502);
  }

  if (!res.ok) {
    // A dead session should log the operator out rather than look like a bug.
    if (res.status === 401) writeToken(null);
    throw new ApiError((body as { error?: string })?.error ?? `Request failed (${res.status})`, res.status);
  }

  const envelope = body as Envelope<T>;
  return envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : (body as T);
}

/* ------------------------------------------------------------- sessions */

export const getSession = () => adminFetch<{ configured: boolean; authenticated: boolean }>('/session');

export async function login(password: string): Promise<void> {
  const { token } = await adminFetch<{ token: string }>('/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  writeToken(token);
}

export const logout = () => writeToken(null);

/* ---------------------------------------------------------------- state */

export const getAdminState = () => adminFetch<AdminState>('/state');

export const saveStation = (patch: Record<string, unknown>) =>
  adminFetch<{ ok: true }>('/station', { method: 'PUT', body: JSON.stringify(patch) });

export const saveMarkets = (markets: Array<{ name: string; lat: number; lon: number }>) =>
  adminFetch<{ ok: true }>('/markets', { method: 'PUT', body: JSON.stringify({ markets }) });

export const saveOnAir = (patch: Partial<OnAirState> | { takeover: null }) =>
  adminFetch<{ ok: true }>('/onair', { method: 'PUT', body: JSON.stringify(patch) });

/* ------------------------------------------------------------- closings */

export const saveClosing = (closing: Partial<SchoolClosing>) =>
  adminFetch<{ closing: SchoolClosing }>('/closings', { method: 'POST', body: JSON.stringify(closing) });

export const deleteClosing = (id: string) => adminFetch<{ ok: boolean }>(`/closings/${id}`, { method: 'DELETE' });

export const clearClosings = () => adminFetch<{ ok: boolean }>('/closings/clear', { method: 'POST' });

/* -------------------------------------------------------- viewer alerts */

export const issueStationAlert = (alert: {
  headline: string;
  body: string;
  severity: string;
  areas: string;
  durationMinutes: number;
}) => adminFetch<{ alert: StationAlert }>('/alerts', { method: 'POST', body: JSON.stringify(alert) });

export const expireStationAlert = (id: string) =>
  adminFetch<{ ok: boolean }>(`/alerts/${id}/expire`, { method: 'POST' });

export const deleteStationAlert = (id: string) =>
  adminFetch<{ ok: boolean }>(`/alerts/${id}`, { method: 'DELETE' });

/* ------------------------------------------------------------- graphics */

export const saveGraphic = (graphic: Partial<StationGraphic>) =>
  adminFetch<{ graphic: StationGraphic }>('/graphics', { method: 'POST', body: JSON.stringify(graphic) });

export const deleteGraphic = (id: string) => adminFetch<{ ok: boolean }>(`/graphics/${id}`, { method: 'DELETE' });

/** Put a frozen snapshot on program - what the /output browser source plays. */
export const takeProgram = (program: GraphicSnapshot & { name: string; sourceId: string }) =>
  adminFetch<{ program: ProgramGraphic }>('/program', { method: 'PUT', body: JSON.stringify({ program }) });

export const clearProgram = () =>
  adminFetch<{ program: null }>('/program', { method: 'PUT', body: JSON.stringify({ program: null }) });

/* ---------------------------------------------------------- diagnostics */

export const getDiagnostics = () => adminFetch<AdminDiagnostics>('/diagnostics');

export const purgeCache = () =>
  adminFetch<{ cleared: number }>('/cache/purge', { method: 'POST' });

export const clearErrorLog = () => adminFetch<{ ok: true }>('/errors/clear', { method: 'POST' });

/* ------------------------------------------- public newsroom surfaces */

export async function getClosings(signal?: AbortSignal): Promise<ClosingsFeed> {
  const res = await fetch(`${BASE}/closings`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ApiError('Closings are unavailable right now.', res.status);
  return (await res.json()).data as ClosingsFeed;
}
