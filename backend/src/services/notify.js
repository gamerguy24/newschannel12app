import config from '../config.js';
import { getActiveAlerts } from './nws.js';
import { getStationWeatherAlerts, wasNotified } from './stationStore.js';
import { fanOut, pushConfigured } from '../../../worker/push.js';
import { runStore } from '../../../worker/store-bridge.js';

/**
 * TELLING PEOPLE
 *
 * A notice is written to the newsroom first and pushed second, because the
 * push carries no payload: a browser wakes up and asks what happened, and
 * the answer has to be waiting when it does.
 *
 * What is worth a buzz is deliberately narrow. Warnings mean take cover now;
 * watches and advisories do not, and a phone that goes off for every dense
 * fog advisory in Middle Tennessee gets its notifications switched off
 * inside a week - at which point the tornado warning does not arrive either.
 */

/** Warnings only. A watch means conditions are favourable, not happening. */
const URGENT_TIERS = new Set(['catastrophic', 'severe']);

const worthSending = (alert) => alert.kind === 'warning' && URGENT_TIERS.has(alert.tier);

/**
 * Save a notice and push it to everyone subscribed.
 *
 * Endpoints the push service reports as dead are dropped on the way past:
 * a browser that has been uninstalled or cleared would otherwise be retried
 * on every send for ever.
 */
export async function publishNotice(env, notice) {
  const saved = await runStore(env, 'addNotice', notice);
  if (!saved.ok) return saved;
  if (!pushConfigured(env)) return { ...saved, sent: 0, reason: 'push keys are not configured' };

  const subs = await runStore(env, 'getPushSubs');
  const endpoints = subs.map((sub) => sub.endpoint);
  if (!endpoints.length) return { ...saved, sent: 0 };

  const { sent, dead } = await fanOut(env, endpoints);
  if (dead.length) await runStore(env, 'removePushSubs', dead);
  return { ...saved, sent, dropped: dead.length };
}

/**
 * Look for warnings nobody has been told about yet.
 *
 * Run from the scheduled handler. Alerts are matched by id, so a warning
 * that stays active for an hour is announced once rather than every minute,
 * and the ids are recorded before the push goes out - announcing twice is
 * worse than not announcing at all if the send fails halfway.
 */
export async function scanForAlerts(env) {
  const data = await getActiveAlerts({ area: config.coverageStates });
  // The newsroom's own alerts count too, and they are the ones the station
  // actually controls. The public feed merges them the same way; a scan that
  // only read the NWS would stay silent on everything written in house.
  const live = [...getStationWeatherAlerts(), ...(data?.alerts ?? [])];
  const fresh = live.filter((alert) => worthSending(alert) && !wasNotified(alert.id));
  if (!fresh.length) return { checked: live.length, sent: 0 };

  await runStore(env, 'markNotified', fresh.map((alert) => alert.id));

  // One notice for the lot. Three counties going under the same warning in
  // the same minute is one event, not three buzzes.
  const lead = fresh[0];
  const notice =
    fresh.length === 1
      ? {
          kind: 'alert',
          title: lead.event,
          body: lead.areaDesc || lead.headline || 'Tap for details.',
          url: '/severe',
        }
      : {
          kind: 'alert',
          title: `${fresh.length} new warnings`,
          body: [...new Set(fresh.map((alert) => alert.event))].join(' · '),
          url: '/severe',
        };

  const result = await publishNotice(env, notice);
  return { checked: live.length, sent: result.sent ?? 0, notice: result.notice };
}
