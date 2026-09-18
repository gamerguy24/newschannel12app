import { Router } from '../../../worker/router.js';
import { asyncRoute, cacheFor, envelope, readLocation, readNumber } from './helpers.js';
import { getClosings, getStationWeatherAlerts } from '../services/stationStore.js';
import { getCurrentConditions, getDailyForecast, getHourlyForecast } from '../services/conditions.js';
import { getActiveAlerts, getPoint, getTextProduct, getProductById } from '../services/nws.js';
import { getBreakingWeather } from '../services/storms.js';

const router = Router();

/** Current conditions for a coordinate. */
router.get(
  '/current',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const data = await getCurrentConditions(location);
    cacheFor(res, 120).json(envelope(data));
  }),
);

/** Hourly forecast - at least 48 hours, up to 156. */
router.get(
  '/hourly',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const hours = readNumber(req.query.hours, 48, { min: 6, max: 156 });
    const data = await getHourlyForecast(location, { hours });
    cacheFor(res, 600).json(envelope(data));
  }),
);

/** Extended forecast - up to 10 days. */
router.get(
  '/daily',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const days = readNumber(req.query.days, 10, { min: 1, max: 14 });
    const data = await getDailyForecast(location, { days });
    cacheFor(res, 900).json(envelope(data));
  }),
);

/**
 * One call that fills the entire home screen. Sub-requests are independent, so
 * a failure in any one section degrades that card instead of the page.
 */
router.get(
  '/overview',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const [current, hourly, daily, breaking] = await Promise.allSettled([
      getCurrentConditions(location),
      getHourlyForecast(location, { hours: 48 }),
      getDailyForecast(location, { days: 10 }),
      getBreakingWeather(location),
    ]);

    const unwrap = (result, fallback) => (result.status === 'fulfilled' ? result.value : fallback);
    const errors = [];
    const record = (name, result) => {
      if (result.status === 'rejected') errors.push({ section: name, error: result.reason?.message });
    };
    record('current', current);
    record('hourly', hourly);
    record('daily', daily);
    record('breaking', breaking);

    cacheFor(res, 120).json(
      envelope({
        current: unwrap(current, null),
        hourly: unwrap(hourly, { hours: [] }),
        daily: unwrap(daily, { days: [] }),
        breaking: unwrap(breaking, { active: false }),
        errors,
      }),
    );
  }),
);

/** NWS grid metadata for a coordinate (office, zone, radar site). */
router.get(
  '/point',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const data = await getPoint(location.lat, location.lon);
    cacheFor(res, 3600).json(envelope(data));
  }),
);

/**
 * NWS FORECAST DISCUSSION. Accepts an office directly, or resolves the office
 * responsible for a coordinate.
 */
router.get(
  '/discussion',
  asyncRoute(async (req, res) => {
    let office = typeof req.query.office === 'string' ? req.query.office.toUpperCase() : null;
    let point = null;
    if (!office) {
      const location = readLocation(req);
      point = await getPoint(location.lat, location.lon);
      office = point.gridId;
    }
    const type = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : 'AFD';
    const product = await getTextProduct(office, type);
    if (!product) {
      return res.status(404).json({ ok: false, error: `No ${type} product available for ${office}` });
    }
    return cacheFor(res, 600).json(
      envelope(product, { office, type, city: point?.city ?? null, state: point?.state ?? null }),
    );
  }),
);

/** Any NWS text product by id (used by the discussion archive selector). */
router.get(
  '/product/:id',
  asyncRoute(async (req, res) => {
    const product = await getProductById(req.params.id);
    cacheFor(res, 3600).json(envelope(product));
  }),
);

/** Ticker-ready temperatures for the station's market list. */
router.get(
  '/markets',
  asyncRoute(async (req, res) => {
    const { tickerMarkets } = await import('../config.js').then((m) => m.default);
    const results = await Promise.allSettled(
      tickerMarkets.map(async (market) => {
        const conditions = await getCurrentConditions(market);
        return {
          name: market.name,
          lat: market.lat,
          lon: market.lon,
          temperature: conditions.observation.temperature,
          condition: conditions.observation.condition,
          icon: conditions.observation.icon,
        };
      }),
    );
    const markets = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    cacheFor(res, 300).json(envelope({ markets }));
  }),
);

/** Alerts scoped to the market list, for the ticker's alert crawl. */
router.get(
  '/ticker',
  asyncRoute(async (req, res) => {
    const config = await import('../config.js').then((m) => m.default);
    const location = readLocation(req);

    const [alertsResult, marketsResult] = await Promise.allSettled([
      getActiveAlerts({ area: config.coverageStates }),
      Promise.allSettled(
        config.tickerMarkets.map(async (market) => {
          const conditions = await getCurrentConditions(market);
          return {
            name: market.name.toUpperCase(),
            temperature: conditions.observation.temperature,
            icon: conditions.observation.icon,
            condition: conditions.observation.condition,
          };
        }),
      ),
    ]);

    const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value.alerts : [];
    const markets =
      marketsResult.status === 'fulfilled'
        ? marketsResult.value.filter((r) => r.status === 'fulfilled').map((r) => r.value)
        : [];

    // Collapse many identical alerts into one ticker line per event type.
    const byEvent = new Map();
    for (const alert of alerts) {
      const existing = byEvent.get(alert.event);
      if (existing) {
        existing.count += 1;
        existing.areas.push(...alert.areas);
        if (new Date(alert.ends) > new Date(existing.expires)) existing.expires = alert.ends;
      } else {
        byEvent.set(alert.event, {
          event: alert.event,
          kind: alert.kind,
          tier: alert.tier,
          color: alert.color,
          count: 1,
          areas: [...alert.areas],
          expires: alert.ends,
        });
      }
    }

    // The newsroom's own lines lead the crawl, ahead of the NWS roll-up.
    const stationItems = getStationWeatherAlerts().map((a) => ({
      type: 'station',
      tier: a.tier,
      color: a.color,
      text: `${a.event.toUpperCase()}: ${a.headline}`,
    }));

    const closings = getClosings();
    const closingItems = closings.length
      ? [
          {
            type: 'closings',
            color: '#7B68EE',
            text: `${closings.length} SCHOOL CLOSING${closings.length === 1 ? '' : 'S'} AND DELAYS - see the closings page`,
          },
        ]
      : [];

    const alertItems = [...byEvent.values()]
      .sort((a, b) => (a.tier === 'catastrophic' ? -1 : 1) - (b.tier === 'catastrophic' ? -1 : 1))
      .slice(0, 6)
      .map((entry) => ({
        type: 'alert',
        tier: entry.tier,
        color: entry.color,
        text: `${entry.event.toUpperCase()} in effect for ${[...new Set(entry.areas)].slice(0, 4).join(', ')}${
          entry.areas.length > 4 ? ` and ${entry.areas.length - 4} more` : ''
        } until ${formatTime(entry.expires)}`,
      }));

    const marketItems = markets.map((m) => ({
      type: 'market',
      text: `${m.name} ${m.temperature === null ? '--' : `${m.temperature}°`}`,
      icon: m.icon,
    }));

    cacheFor(res, 120).json(
      envelope({
        items: [...stationItems, ...closingItems, ...alertItems, ...marketItems],
        alertCount: alerts.length,
        closingCount: closings.length,
        location,
        updatedAt: new Date().toISOString(),
      }),
    );
  }),
);

function formatTime(iso) {
  if (!iso) return 'further notice';
  return new Date(iso)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, ' ');
}

export default router;
