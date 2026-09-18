/**
 * Tiny in-process TTL cache with stale-while-error semantics.
 *
 * Upstream services (api.weather.gov, SPC, NHC) are free and rate limited, so
 * every outbound request funnels through here. When an upstream fails we keep
 * serving the last good payload until `staleMs` elapses rather than throwing a
 * blank screen at the viewer.
 */
const store = new Map();
const inflight = new Map();

const now = () => Date.now();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires > now()) return entry.value;
  return undefined;
}

export function cacheSet(key, value, ttlMs, staleMs = ttlMs * 10) {
  store.set(key, { value, expires: now() + ttlMs, staleUntil: now() + ttlMs + staleMs });
  return value;
}

function readStale(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.staleUntil > now()) return entry.value;
  store.delete(key);
  return undefined;
}

/**
 * Run `producer` at most once per key per TTL window. Concurrent callers share
 * the same promise so a burst of viewers becomes one upstream request.
 */
export async function withCache(key, ttlMs, producer, { staleMs = ttlMs * 10 } = {}) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const value = await producer();
      cacheSet(key, value, ttlMs, staleMs);
      return value;
    } catch (err) {
      const stale = readStale(key);
      if (stale !== undefined) {
        // Mark the payload so the UI can show a "last good data" indicator.
        if (stale && typeof stale === 'object' && !Array.isArray(stale)) {
          return { ...stale, _stale: true, _staleReason: err.message };
        }
        return stale;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

export function cacheStats() {
  let live = 0;
  let stale = 0;
  const t = now();
  for (const entry of store.values()) {
    if (entry.expires > t) live += 1;
    else if (entry.staleUntil > t) stale += 1;
  }
  return { entries: store.size, live, stale, inflight: inflight.size };
}

export function cacheClear() {
  store.clear();
}
