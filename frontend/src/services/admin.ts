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
  StationVideo,
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

/* ----------------------------------------------------------------- video */

/**
 * Raw bytes to the newsroom.
 *
 * The JSON helper labels every body it sends as JSON, and the router on the
 * other end reads a JSON body up front - which would consume a video slice
 * before the handler ever saw it. So binary goes out through its own door.
 */
async function adminSend<T>(path: string, body: BodyInit, contentType: string, method = 'PUT'): Promise<T> {
  const token = readToken();
  const res = await fetch(`${BASE}/admin${path}`, {
    method,
    body,
    headers: {
      Accept: 'application/json',
      'Content-Type': contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('The admin API returned an unreadable response.', res.status || 502);
  }

  if (!res.ok) {
    if (res.status === 401) writeToken(null);
    throw new ApiError((parsed as { error?: string })?.error ?? `Upload failed (${res.status})`, res.status);
  }

  const envelope = parsed as Envelope<T>;
  return envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : (parsed as T);
}

export interface UploadProgress {
  sent: number;
  total: number;
  ratio: number;
}

/**
 * Put a video in the library.
 *
 * Open, send the slices, close. The slicing is not an optimisation - a Worker
 * will not accept a request body much past 100 MB, so a whole broadcast
 * cannot arrive in one piece. It also means the operator watches a real
 * progress bar rather than a spinner.
 *
 * Anything that goes wrong aborts the upload, so a half-written file is not
 * left sitting in the bucket being billed for.
 */
export async function uploadVideo(
  file: File,
  meta: { title: string; description?: string; durationSeconds?: number | null },
  onProgress?: (progress: UploadProgress) => void,
): Promise<StationVideo> {
  const { key, uploadId, partSize } = await adminFetch<{ key: string; uploadId: string; partSize: number }>(
    '/videos/uploads',
    { method: 'POST', body: JSON.stringify({ contentType: file.type, size: file.size }) },
  );

  try {
    const parts: Array<{ partNumber: number; etag: string }> = [];
    let sent = 0;
    let partNumber = 1;

    for (let offset = 0; offset < file.size; offset += partSize) {
      const slice = file.slice(offset, Math.min(offset + partSize, file.size));
      parts.push(
        await adminSend<{ partNumber: number; etag: string }>(
          `/videos/uploads/${uploadId}/parts/${partNumber}?key=${encodeURIComponent(key)}`,
          slice,
          'application/octet-stream',
        ),
      );
      sent += slice.size;
      onProgress?.({ sent, total: file.size, ratio: file.size ? sent / file.size : 1 });
      partNumber += 1;
    }

    const { video } = await adminFetch<{ video: StationVideo }>(`/videos/uploads/${uploadId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ key, parts, contentType: file.type, ...meta }),
    });
    return video;
  } catch (err) {
    await adminFetch(`/videos/uploads/${uploadId}?key=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
    throw err;
  }
}

export const attachVideoPoster = (id: string, poster: Blob) =>
  adminSend<{ video: StationVideo }>(`/videos/${id}/poster`, poster, 'image/jpeg');

export const updateVideo = (id: string, patch: { title?: string; description?: string }) =>
  adminFetch<{ video: StationVideo }>(`/videos/${id}`, { method: 'PUT', body: JSON.stringify(patch) });

export const deleteVideo = (id: string) => adminFetch<{ ok: true }>(`/videos/${id}`, { method: 'DELETE' });
