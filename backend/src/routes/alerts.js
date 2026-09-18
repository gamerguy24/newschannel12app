import { Router } from '../../../worker/router.js';
import config from '../config.js';
import { asyncRoute, cacheFor, envelope, readLocation, readNumber } from './helpers.js';
import { getActiveAlerts } from '../services/nws.js';
import { ALERT_GROUPS, ALERT_KINDS, SEVERITY_TIERS } from '../services/alertCatalog.js';
import { getBreakingWeather, getStormTracks } from '../services/storms.js';
import { getOutlookSummary } from '../services/spc.js';
import { getStationWeatherAlerts } from '../services/stationStore.js';

const router = Router();

/**
 * Station-issued alerts ride alongside the NWS feed, always ahead of it: if
 * the newsroom has said something, the viewer should see it first. They keep
 * their own `source: 'station'` marker so the UI can label them honestly.
 */
const withStationAlerts = (alerts) => [...getStationWeatherAlerts(), ...alerts];

/**
 * SEVERE WEATHER CENTER feed.
 *
 * Filterable by location (point), state/county (area, zone), alert type
 * (group), product kind (warning/watch/advisory) and severity tier.
 */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const { area, zone, point: pointParam, group, kind, tier, event } = req.query;

    const query = {};
    if (zone) query.zone = zone;
    else if (area) query.area = area;
    else if (pointParam || req.query.lat) {
      const location = readLocation(req);
      query.point = `${location.lat},${location.lon}`;
    } else {
      query.area = config.coverageStates;
    }

    const { alerts: nwsAlerts, updatedAt, stale } = await getActiveAlerts(query);
    const alerts = withStationAlerts(nwsAlerts);

    const wanted = (value, list) => {
      if (!value) return true;
      const set = new Set(String(value).split(',').map((s) => s.trim().toLowerCase()));
      return list.some((v) => set.has(String(v).toLowerCase()));
    };

    const filtered = alerts.filter(
      (a) =>
        wanted(group, [a.group]) &&
        wanted(kind, [a.kind]) &&
        wanted(tier, [a.tier]) &&
        (!event || a.event.toLowerCase().includes(String(event).toLowerCase())),
    );

    const counts = {
      total: filtered.length,
      byKind: countBy(filtered, 'kind'),
      byGroup: countBy(filtered, 'group'),
      byTier: countBy(filtered, 'tier'),
    };

    cacheFor(res, 45).json(
      envelope(
        {
          alerts: filtered,
          counts,
          filters: { groups: ALERT_GROUPS, kinds: ALERT_KINDS, tiers: SEVERITY_TIERS },
          scope: query,
        },
        { updatedAt, stale },
      ),
    );
  }),
);

/** Everything the Severe Weather Center header needs in one request. */
router.get(
  '/center',
  asyncRoute(async (req, res) => {
    const area = req.query.area ? String(req.query.area).split(',') : config.coverageStates;
    const [alertsResult, outlookResult] = await Promise.allSettled([
      getActiveAlerts({ area }),
      getOutlookSummary(),
    ]);

    const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value.alerts : [];
    const warnings = alerts.filter((a) => a.kind === 'warning');
    const watches = alerts.filter((a) => a.kind === 'watch');
    const advisories = alerts.filter((a) => a.kind === 'advisory' || a.kind === 'statement');

    cacheFor(res, 45).json(
      envelope({
        warnings,
        watches,
        advisories,
        outlooks: outlookResult.status === 'fulfilled' ? outlookResult.value : [],
        coverage: area,
        counts: {
          warnings: warnings.length,
          watches: watches.length,
          advisories: advisories.length,
          tornadoWarnings: warnings.filter((a) => a.group === 'tornado').length,
          emergencies: alerts.filter((a) => a.isEmergency).length,
        },
        filters: { groups: ALERT_GROUPS, kinds: ALERT_KINDS, tiers: SEVERITY_TIERS },
        updatedAt: new Date().toISOString(),
      }),
    );
  }),
);

/** The single alert that owns the BREAKING WEATHER banner. */
router.get(
  '/breaking',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const data = await getBreakingWeather(location);
    // The service already folds in anything the newsroom put on air.
    cacheFor(res, data.fromStation ? 10 : 30).json(envelope(data));
  }),
);

/** STORM TRACKER - live storm vectors, ETAs and projected paths. */
router.get(
  '/storms',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const radiusMiles = readNumber(req.query.radius, 200, { min: 25, max: 600 });
    const data = await getStormTracks(location, {
      radiusMiles,
      includeStatements: req.query.statements === 'true',
    });
    cacheFor(res, 30).json(envelope(data));
  }),
);

/** GeoJSON of active alert polygons, for the map overlay. */
router.get(
  '/geojson',
  asyncRoute(async (req, res) => {
    const area = req.query.area ? String(req.query.area).split(',') : config.coverageStates;
    const kinds = req.query.kind ? new Set(String(req.query.kind).split(',')) : null;
    const { alerts, updatedAt } = await getActiveAlerts({ area });

    const features = alerts
      .filter((a) => a.geometry && (!kinds || kinds.has(a.kind)))
      .map((a) => ({
        type: 'Feature',
        geometry: a.geometry,
        properties: {
          id: a.id,
          event: a.event,
          kind: a.kind,
          tier: a.tier,
          group: a.group,
          color: a.color,
          headline: a.headline,
          areaDesc: a.areaDesc,
          expires: a.ends,
          isEmergency: a.isEmergency,
          office: a.office,
        },
      }));

    cacheFor(res, 45).json({ type: 'FeatureCollection', features, updatedAt });
  }),
);

/**
 * WEATHER ALERT NOTIFICATIONS - a Server-Sent Events stream. The client
 * subscribes once and the server pushes new alerts as the NWS issues them,
 * instead of every device polling independently.
 */
router.get('/stream', (req, res) => {
  const location = readLocation(req);
  const scope = req.query.zone
    ? { zone: String(req.query.zone) }
    : req.query.area
      ? { area: String(req.query.area).split(',') }
      : { point: `${location.lat},${location.lon}` };

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const seen = new Set();
  let closed = false;

  const send = (event, payload) => {
    if (closed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const poll = async () => {
    if (closed) return;
    try {
      const { alerts: nwsAlerts, updatedAt } = await getActiveAlerts(scope);
      const alerts = withStationAlerts(nwsAlerts);
      const fresh = alerts.filter((a) => !seen.has(a.id));
      for (const alert of alerts) seen.add(alert.id);
      send('alerts', { alerts, fresh, updatedAt, scope });
    } catch (err) {
      send('error', { message: err.message });
    }
  };

  send('open', { scope, interval: 60 });
  poll();

  // 60s matches the NWS alert refresh cadence; the response is cached so
  // concurrent viewers share one upstream call.
  const timer = setInterval(poll, 60_000);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 25_000);

  req.on('close', () => {
    closed = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    res.end();
  });
});

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const k = item[key] ?? 'unknown';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

export default router;
