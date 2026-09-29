import { Router } from '../../../worker/router.js';
import { asyncRoute, envelope, HttpError } from './helpers.js';
import { getLatestNotice } from '../services/stationStore.js';
import { pushConfigured } from '../../../worker/push.js';
import { runStore } from '../../../worker/store-bridge.js';

/**
 * NOTIFICATIONS, VIEWER SIDE
 *
 * Subscribing is deliberately open: anyone reading the site may ask to be
 * told about a tornado warning, and requiring an account to receive one
 * would be a strange thing for a station to do. Sending is not open - only
 * the scheduled scan and the newsroom's own publish actions create a notice.
 *
 * A subscription is an endpoint the browser hands us and nothing else. There
 * is no name, no address, and no way to work out who it belongs to.
 */

const router = Router();

/** What the browser needs to subscribe, and whether it is worth trying. */
router.get('/notifications/key', (req, res) => {
  res.set('Cache-Control', 'no-store').json(
    envelope({
      publicKey: req.env?.VAPID_PUBLIC_KEY ?? null,
      configured: pushConfigured(req.env),
    }),
  );
});

router.post(
  '/notifications/subscribe',
  asyncRoute(async (req, res) => {
    const endpoint = String(req.body?.endpoint ?? '');
    const outcome = await runStore(req.env, 'addPushSub', endpoint);
    if (!outcome.ok) throw new HttpError(400, outcome.errors.join(' '));
    res.json(envelope({ ok: true }));
  }),
);

router.post(
  '/notifications/unsubscribe',
  asyncRoute(async (req, res) => {
    await runStore(req.env, 'removePushSubs', [String(req.body?.endpoint ?? '')]);
    res.json(envelope({ ok: true }));
  }),
);

/**
 * What to show.
 *
 * The push that woke the service worker carried no payload, so this is the
 * message. Never cached: the whole point is that it is the newest one.
 */
router.get('/notifications/latest', (req, res) => {
  res.set('Cache-Control', 'no-store').json(envelope({ notice: getLatestNotice() }));
});

export default router;
