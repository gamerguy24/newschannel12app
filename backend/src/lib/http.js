import config from '../config.js';
import { withCache } from './cache.js';

export class UpstreamError extends Error {
  constructor(message, { status = 502, url, body } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const DEFAULT_TIMEOUT = 12_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() with an abort timeout, backoff retries and the NWS-mandated
 * descriptive User-Agent. Every upstream call in the app goes through this.
 */
export async function request(url, { headers = {}, timeout = DEFAULT_TIMEOUT, retries = 2, accept } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': config.userAgent,
          Accept: accept || 'application/json',
          ...headers,
        },
      });
      if (!res.ok) {
        if (RETRY_STATUS.has(res.status) && attempt < retries) {
          const retryAfter = Number.parseInt(res.headers.get('retry-after') || '', 10);
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 350 * 2 ** attempt);
          continue;
        }
        const body = await res.text().catch(() => '');
        throw new UpstreamError(`Upstream ${res.status} for ${url}`, {
          status: res.status === 404 ? 404 : 502,
          url,
          body: body.slice(0, 400),
        });
      }
      return res;
    } catch (err) {
      lastError = err;
      const retryable = err.name === 'AbortError' || err.name === 'TypeError' || err instanceof TypeError;
      if (retryable && attempt < retries) {
        await sleep(350 * 2 ** attempt);
        continue;
      }
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(`Network failure for ${url}: ${err.message}`, { url });
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new UpstreamError(`Request failed for ${url}`, { url });
}

export async function getJson(url, options = {}) {
  const res = await request(url, { accept: 'application/geo+json, application/json', ...options });
  return res.json();
}

export async function getText(url, options = {}) {
  const res = await request(url, { accept: 'text/plain, text/html, */*', ...options });
  return res.text();
}

/** Cached JSON GET. `ttl` is seconds. */
export const cachedJson = (key, ttlSeconds, url, options = {}) =>
  withCache(key, ttlSeconds * 1000, () => getJson(url, options));

/** Cached plain-text GET. `ttl` is seconds. */
export const cachedText = (key, ttlSeconds, url, options = {}) =>
  withCache(key, ttlSeconds * 1000, () => getText(url, options));
