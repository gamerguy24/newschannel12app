import { dispatch } from './router.js';
import { hydrate } from './store-bridge.js';
import { Newsroom } from './newsroom.js';
import config, { hydrateConfig } from '../backend/src/config.js';
import { HttpError } from '../backend/src/routes/helpers.js';
import { recordError } from '../backend/src/services/diagnostics.js';
import weatherRoutes from '../backend/src/routes/weather.js';
import alertRoutes from '../backend/src/routes/alerts.js';
import mapRoutes from '../backend/src/routes/maps.js';
import miscRoutes from '../backend/src/routes/misc.js';
import adminRoutes from '../backend/src/routes/admin.js';

/**
 * STORM 12 WEATHER - the Worker.
 *
 * One Worker serves the whole station: /api/* runs here, and every other path
 * is a static asset or the SPA shell, handed straight to the assets binding.
 *
 * Each request hydrates two things before any route runs - the environment
 * config, and the newsroom's saved state - because a Worker isolate starts
 * with neither and may be recycled at any time.
 */

export { Newsroom };

// Mount order matters: the specific prefixes are matched before the bare /api
// routers, exactly as the Express app mounted them.
const MOUNTS = [
  { prefix: '/api/weather', router: weatherRoutes },
  { prefix: '/api/alerts', router: alertRoutes },
  { prefix: '/api/admin', router: adminRoutes },
  { prefix: '/api', router: mapRoutes },
  { prefix: '/api', router: miscRoutes },
];

/** Playout and the admin panel read state that must not be a moment stale. */
const needsFreshState = (pathname) =>
  pathname === '/api/graphics/program' || pathname.startsWith('/api/admin');

function corsHeaders(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const self = url.origin;
  const allowed = origin === self || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*');
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function errorResponse(err, request, url) {
  const status = err instanceof HttpError ? err.status : (err?.status ?? 502);
  const payload = {
    ok: false,
    error: err?.message || 'Upstream weather data is unavailable',
    detail: err?.detail ?? undefined,
  };
  if (config.nodeEnv !== 'production') payload.stack = err?.stack;

  // Every failure is kept for the admin panel's ops view, not just the 500s -
  // a wave of 4xx is exactly what an operator needs to see.
  recordError({ method: request.method, url: url.pathname + url.search, status, message: err?.message });
  if (status >= 500) console.error(`[storm12] ${request.method} ${url.pathname} -> ${status}: ${err?.message}`);

  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Anything that is not the API is the site: assets, then the SPA shell.
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    hydrateConfig(env);
    const cors = corsHeaders(request, url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors ?? {} });
    }

    let response;
    try {
      await hydrate(env, { fresh: needsFreshState(url.pathname) });
      response = await dispatch(MOUNTS, request, url, { env, ctx });
      if (!response) {
        response = new Response(
          JSON.stringify({ ok: false, error: `No API route for ${request.method} ${url.pathname}` }),
          { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } },
        );
      }
    } catch (err) {
      response = errorResponse(err, request, url);
    }

    if (cors) {
      response = new Response(response.body, response);
      for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    }
    return response;
  },
};
