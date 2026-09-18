import { DurableObject } from 'cloudflare:workers';
import * as store from '../backend/src/services/stationStore.js';

/**
 * NEWSROOM
 *
 * The one writable copy of everything the station controls: identity and
 * coverage, the ticker markets, school closings, viewer alerts, the graphics
 * rundown, and the graphic on program.
 *
 * This replaces the station.json file the Node build wrote beside the server.
 * A Durable Object rather than KV because takes must be seen immediately:
 * the playout page polls once a second, and a second of eventual consistency
 * is a second of the wrong graphic on air. One instance, one writer, no races.
 *
 * The validation and mutation logic is the same stationStore module the Node
 * build used - it only ever kept state in memory and handed commits to a
 * persistence adapter, so here the adapter is this object's own storage.
 */
export class Newsroom extends DurableObject {
  #loaded = false;
  #write = null;

  /** Pull the stored state into the store module once per instance. */
  async #load() {
    if (this.#loaded) return;
    const snapshot = (await this.ctx.storage.get('state')) ?? null;
    store.configureStore({
      persist: (state) => {
        // Durable Objects gate output until writes land, so the caller cannot
        // see a result that outlived its own storage write.
        this.#write = this.ctx.storage.put('state', JSON.parse(JSON.stringify(state)));
      },
    });
    store.hydrateStore(snapshot);
    this.#loaded = true;
  }

  /** The whole state, for a worker hydrating itself before serving a request. */
  async snapshot() {
    await this.#load();
    return store.getStore();
  }

  /**
   * Run one store mutation in here, where the only writable copy lives, and
   * hand back both its result and the state it produced - the caller uses the
   * state to refresh its own read cache without a second round trip.
   */
  async run(method, args = []) {
    await this.#load();
    const fn = store[method];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown newsroom operation: ${method}`);
    }
    const result = fn(...args);
    if (this.#write) {
      await this.#write;
      this.#write = null;
    }
    return { result, state: store.getStore() };
  }
}

export default Newsroom;
