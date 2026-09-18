import crypto from 'node:crypto';
import { Router } from '../../../worker/router.js';
import config from '../config.js';
import { asyncRoute, envelope, HttpError } from './helpers.js';
import { cacheClear, cacheStats } from '../lib/cache.js';
import {
  CLOSING_STATUSES,
  getAllStationAlerts,
  getBaseline,
  getClosings,
  getGraphics,
  getOnAir,
  getProgram,
  getStationIdentity,
  getStore,
} from '../services/stationStore.js';
// Every mutation runs in the Newsroom Durable Object, which holds the only
// writable copy of station state; this worker only ever reads a snapshot.
import { runStore } from '../../../worker/store-bridge.js';
import { clearRecentErrors, getDiagnosticsSnapshot, probeSources } from '../services/diagnostics.js';

/**
 * ADMIN API
 *
 * Everything behind the newsroom door. Authentication is a single shared
 * password from the environment - the right weight for a station intranet
 * tool, and deliberately not a user database nobody asked for.
 *
 * When ADMIN_PASSWORD is unset the whole surface is disabled rather than
 * open: an unconfigured deployment must never ship an unlocked admin panel.
 */

const router = Router();

const SESSION_HOURS = 12;
/**
 * Tokens are signed with a key derived from the password, so changing the
 * password instantly invalidates every session that was issued under the old
 * one. A restart keeps sessions valid, which is what an operator expects.
 */
const signingKey = () => crypto.createHash('sha256').update(`nc12:${config.adminPassword}`).digest();

function issueToken() {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = `${expires}`;
  const mac = crypto.createHmac('sha256', signingKey()).update(payload).digest('hex');
  return `${payload}.${mac}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;

  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest('hex');
  const a = Buffer.from(mac, 'hex');
  const b = Buffer.from(expected, 'hex');
  // Constant-time compare so a token cannot be guessed a byte at a time.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  return Number(payload) > Date.now();
}

const adminConfigured = () => Boolean(config.adminPassword);

function requireAdmin(req, res, next) {
  if (!adminConfigured()) {
    throw new HttpError(503, 'Admin panel is disabled. Set ADMIN_PASSWORD in .env to enable it.');
  }
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !verifyToken(token)) throw new HttpError(401, 'Sign in to the admin panel to continue.');
  return next();
}

/* -------------------------------------------------------------- sessions */

router.get('/session', (req, res) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  res.json(
    envelope({
      configured: adminConfigured(),
      authenticated: adminConfigured() && Boolean(token) && verifyToken(token),
    }),
  );
});

/** Failed sign-ins are slowed down so the shared password cannot be hammered. */
let failures = 0;
let lockedUntil = 0;

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    if (!adminConfigured()) {
      throw new HttpError(503, 'Admin panel is disabled. Set ADMIN_PASSWORD in .env to enable it.');
    }
    if (Date.now() < lockedUntil) {
      throw new HttpError(429, 'Too many failed attempts. Try again in a minute.');
    }

    const supplied = String(req.body?.password ?? '');
    const expected = config.adminPassword;
    const a = crypto.createHash('sha256').update(supplied).digest();
    const b = crypto.createHash('sha256').update(expected).digest();

    if (!crypto.timingSafeEqual(a, b)) {
      failures += 1;
      if (failures >= 5) {
        lockedUntil = Date.now() + 60000;
        failures = 0;
      }
      // A deliberate pause: cheap for an operator, expensive for a script.
      await new Promise((resolve) => setTimeout(resolve, 400));
      throw new HttpError(401, 'That password is not right.');
    }

    failures = 0;
    res.json(envelope({ token: issueToken(), expiresInHours: SESSION_HOURS }));
  }),
);

/* ------------------------------------------------------------------ state */

router.get(
  '/state',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const store = getStore();
    res.json(
      envelope({
        station: getStationIdentity(),
        effective: {
          defaultLocation: config.defaultLocation,
          defaultRadarSite: config.defaultRadarSite,
          coverageStates: config.coverageStates,
          tickerMarkets: config.tickerMarkets,
          sponsor: config.sponsor,
          liveStream: config.liveStream,
        },
        baseline: getBaseline(),
        onAir: getOnAir(),
        closings: getClosings(),
        closingStatuses: CLOSING_STATUSES,
        stationAlerts: getAllStationAlerts(),
        graphics: getGraphics(),
        program: getProgram(),
        overrides: {
          station: Boolean(store.station),
          defaultLocation: Boolean(store.defaultLocation),
          defaultRadarSite: Boolean(store.defaultRadarSite),
          coverageStates: Boolean(store.coverageStates),
          tickerMarkets: Boolean(store.tickerMarkets),
          sponsor: Boolean(store.sponsor),
          liveStream: Boolean(store.liveStream),
        },
      }),
    );
  }),
);

const result = (res, outcome) => {
  if (!outcome.ok) throw new HttpError(400, outcome.errors.join(' '));
  return res.json(envelope({ ok: true, ...outcome }));
};

/* ------------------------------------------------------ station settings */

router.put(
  '/station',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'saveStation', req.body ?? {}))),
);

router.put(
  '/markets',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'saveMarkets', req.body?.markets ?? []))),
);

/* ------------------------------------------------------- on-air control */

router.put(
  '/onair',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'saveOnAir', req.body ?? {}))),
);

/* ------------------------------------------------------ school closings */

router.post(
  '/closings',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'saveClosing', req.body ?? {}))),
);

router.delete(
  '/closings/:id',
  requireAdmin,
  asyncRoute(async (req, res) => res.json(envelope(await runStore(req.env, 'deleteClosing', req.params.id)))),
);

router.post(
  '/closings/clear',
  requireAdmin,
  asyncRoute(async (req, res) => res.json(envelope(await runStore(req.env, 'clearClosings')))),
);

/* ------------------------------------------------------- viewer alerts */

router.post(
  '/alerts',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'saveStationAlert', req.body ?? {}))),
);

router.post(
  '/alerts/:id/expire',
  requireAdmin,
  asyncRoute(async (req, res) => res.json(envelope(await runStore(req.env, 'expireStationAlert', req.params.id)))),
);

router.delete(
  '/alerts/:id',
  requireAdmin,
  asyncRoute(async (req, res) => res.json(envelope(await runStore(req.env, 'deleteStationAlert', req.params.id)))),
);

/* ------------------------------------------------------------- graphics */

router.post(
  '/graphics',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'saveGraphic', req.body ?? {}))),
);

/** Take a graphic to program, or clear program with `{ program: null }`. */
router.put(
  '/program',
  requireAdmin,
  asyncRoute(async (req, res) => result(res, await runStore(req.env, 'setProgram', req.body?.program ?? null))),
);

router.delete(
  '/graphics/:id',
  requireAdmin,
  asyncRoute(async (req, res) => res.json(envelope(await runStore(req.env, 'deleteGraphic', req.params.id)))),
);

/* ---------------------------------------------------------- diagnostics */

router.get(
  '/diagnostics',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const health = await probeSources();
    res.set('Cache-Control', 'no-store').json(envelope({ ...getDiagnosticsSnapshot(), ...health }));
  }),
);

router.post(
  '/cache/purge',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const before = cacheStats();
    cacheClear();
    res.json(envelope({ ok: true, cleared: before.entries, cache: cacheStats() }));
  }),
);

router.post(
  '/errors/clear',
  requireAdmin,
  asyncRoute(async (req, res) => {
    clearRecentErrors();
    res.json(envelope({ ok: true }));
  }),
);

export default router;
