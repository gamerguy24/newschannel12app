import { hydrateStore } from '../backend/src/services/stationStore.js';

/**
 * The worker's side of the newsroom state.
 *
 * Reads are served from a snapshot hydrated into the store module, so every
 * existing read path - the ticker, the breaking banner, the closings feed -
 * keeps working untouched. Writes are never applied here: they are handed to
 * the Durable Object, which owns the only writable copy, and the state it
 * returns refreshes this isolate immediately.
 */

// One station, one instance. If this app ever runs more than one station,
// this name is the seam to split on.
const INSTANCE = 'station';

/** A snapshot this fresh is worth reusing; a take must never wait on it. */
const SNAPSHOT_TTL_MS = 2000;

let cache = { at: 0, snapshot: null };

const stub = (env) => env.NEWSROOM.get(env.NEWSROOM.idFromName(INSTANCE));

/** Load newsroom state into this isolate before a request touches it. */
export async function hydrate(env, { fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache.snapshot && now - cache.at < SNAPSHOT_TTL_MS) {
    hydrateStore(cache.snapshot);
    return cache.snapshot;
  }
  const snapshot = await stub(env).snapshot();
  cache = { at: now, snapshot };
  hydrateStore(snapshot);
  return snapshot;
}

/** Run one mutation in the Durable Object and adopt the state it produced. */
export async function runStore(env, method, ...args) {
  const { result, state } = await stub(env).run(method, args);
  cache = { at: Date.now(), snapshot: state };
  hydrateStore(state);
  return result;
}
