import { request } from '../lib/http.js';
import { cacheStats } from '../lib/cache.js';

/**
 * OPS DIAGNOSTICS
 *
 * What the newsroom needs to answer "is the weather wall about to go dark?":
 * which upstreams are answering, how fast, what has been failing, and how much
 * of the cache is doing the work.
 */

/* --------------------------------------------------------- error recorder */

const MAX_ERRORS = 60;
const recentErrors = [];

/** Called by the server's error middleware for every failed request. */
export function recordError({ method, url, status, message }) {
  recentErrors.unshift({
    at: new Date().toISOString(),
    method,
    url: String(url ?? '').slice(0, 200),
    status,
    message: String(message ?? '').slice(0, 300),
  });
  if (recentErrors.length > MAX_ERRORS) recentErrors.length = MAX_ERRORS;
}

export const getRecentErrors = () => recentErrors;
export function clearRecentErrors() {
  recentErrors.length = 0;
}

/* ---------------------------------------------------------- source probes */

const SOURCES = [
  { id: 'nws', name: 'NWS API', url: 'https://api.weather.gov/points/36.1627,-86.7816', critical: true },
  { id: 'rainviewer', name: 'RainViewer mosaic', url: 'https://api.rainviewer.com/public/weather-maps.json', critical: true },
  { id: 'metar', name: 'Aviation Weather METAR', url: 'https://aviationweather.gov/api/data/metar?ids=KBNA&format=json', critical: false },
  { id: 'spc', name: 'Storm Prediction Center', url: 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson', critical: false },
  { id: 'nhc', name: 'National Hurricane Center', url: 'https://www.nhc.noaa.gov/CurrentStorms.json', critical: false },
  { id: 'openmeteo', name: 'Open-Meteo model data', url: 'https://api.open-meteo.com/v1/forecast?latitude=36.16&longitude=-86.78&current=temperature_2m', critical: false },
];

/**
 * Probe every upstream in parallel. Each gets a short timeout and no retries:
 * this is a health check, not a fetch, and a slow source is itself the answer.
 */
export async function probeSources() {
  const checks = SOURCES.map(async (source) => {
    const started = Date.now();
    try {
      await request(source.url, { timeout: 8000, retries: 0 });
      return { ...source, status: 'up', ms: Date.now() - started, error: null };
    } catch (err) {
      return {
        ...source,
        status: err.name === 'AbortError' || /timeout/i.test(err.message) ? 'slow' : 'down',
        ms: Date.now() - started,
        error: err.message?.slice(0, 200) ?? 'Unreachable',
      };
    }
  });

  const sources = await Promise.all(checks);
  const down = sources.filter((s) => s.status !== 'up');
  const criticalDown = down.filter((s) => s.critical);

  return {
    sources,
    summary: {
      total: sources.length,
      up: sources.length - down.length,
      degraded: down.length,
      // "on air" means everything a broadcast actually depends on is answering.
      status: criticalDown.length ? 'critical' : down.length ? 'degraded' : 'nominal',
    },
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Workers have no process to interrogate: no uptime, no RSS. What an isolate
 * can honestly report is how long it has been serving and what it has cached,
 * so that is what ops sees - an isolate is recycled often, and a small number
 * here means a fresh isolate, not a restarted station.
 */
const startedAt = Date.now();

export function getDiagnosticsSnapshot() {
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: null,
    node: 'workerd',
    cache: cacheStats(),
    errors: getRecentErrors(),
    startedAt: new Date(startedAt).toISOString(),
  };
}
