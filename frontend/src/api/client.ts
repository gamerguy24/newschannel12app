import type { Envelope } from './types';

/**
 * The single door between the UI and weather data.
 *
 * Nothing in the UI ever calls an upstream weather provider directly: swapping
 * a data source means editing the backend service layer, not a component.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  status: number;
  detail?: unknown;

  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  /** Something the viewer can act on, rather than a stack trace. */
  get friendly(): string {
    if (this.status === 0) return 'No connection. Check your network and try again.';
    if (this.status === 404) return 'That weather product is not available right now.';
    if (this.status === 429) return 'The weather service is rate limiting us. Retrying shortly.';
    if (this.status >= 500) return 'The weather service is not responding. Showing the last good data.';
    return this.message;
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Short-lived response memo. The backend already caches hard; this exists so
 * that two components mounting at once (say the header and the ticker) share a
 * single network round trip.
 */
const memo = new Map<string, { at: number; promise: Promise<unknown> }>();
const MEMO_MS = 4000;

const abortError = () =>
  typeof DOMException === 'undefined'
    ? Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
    : new DOMException('The operation was aborted.', 'AbortError');

/**
 * Hand a shared (memoised) request to one caller.
 *
 * The memo exists so two components mounting at once share a round trip - but
 * that means one caller's AbortSignal must never reject the promise the others
 * are holding. React's StrictMode makes this immediate: it mounts, unmounts and
 * remounts every effect, and the unmount's abort would otherwise surface to the
 * remounted component as "No connection". So a caller that goes away stops
 * listening; the shared request carries on for whoever is still waiting.
 */
function forCaller<T>(shared: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = () => signal.removeEventListener('abort', onAbort);
    shared.then(
      (value) => {
        settle();
        resolve(value);
      },
      (err) => {
        settle();
        reject(err);
      },
    );
  });
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.pathname + url.search;
}

async function rawFetch<T>(url: string, options: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError('The weather service returned an unreadable response.', res.status || 502);
    }

    if (!res.ok) {
      const message =
        (body as { error?: string })?.error ?? `Request failed with status ${res.status}`;
      throw new ApiError(message, res.status, (body as { detail?: unknown })?.detail);
    }
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      // A caller-initiated abort is not an error condition worth surfacing.
      if (options.signal?.aborted) throw err;
      throw new ApiError('The weather service took too long to respond.', 408);
    }
    throw new ApiError((err as Error).message || 'Network request failed', 0);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** GET an enveloped endpoint and hand back just the payload. */
export async function apiGet<T>(
  path: string,
  params?: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<T> {
  const url = buildUrl(path, params);
  const cached = memo.get(url);
  if (cached && Date.now() - cached.at < MEMO_MS) {
    return forCaller(cached.promise as Promise<T>, options.signal);
  }

  // The shared request deliberately carries no caller signal - only the
  // timeout - so no single consumer can cancel it out from under the others.
  const promise = rawFetch<Envelope<T> | T>(url, { timeoutMs: options.timeoutMs }).then((body) => {
    if (body && typeof body === 'object' && 'data' in (body as Envelope<T>)) {
      return (body as Envelope<T>).data;
    }
    return body as T;
  });

  memo.set(url, { at: Date.now(), promise });
  promise.catch(() => memo.delete(url));
  return forCaller(promise, options.signal);
}

/** GET an enveloped endpoint keeping the envelope metadata (stale flags etc). */
export async function apiGetEnvelope<T>(
  path: string,
  params?: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  return rawFetch<Envelope<T>>(buildUrl(path, params), options);
}

/** GET a bare (non-enveloped) JSON document, e.g. GeoJSON collections. */
export async function apiGetRaw<T>(
  path: string,
  params?: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<T> {
  return rawFetch<T>(buildUrl(path, params), options);
}

/** Open a Server-Sent Events stream (used for live alert notifications). */
export function apiStream(path: string, params?: Record<string, unknown>): EventSource {
  return new EventSource(buildUrl(path, params));
}

export function clearApiMemo(): void {
  memo.clear();
}
