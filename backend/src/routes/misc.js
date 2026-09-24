import { Router } from '../../../worker/router.js';
import config from '../config.js';
import { asyncRoute, cacheFor, envelope, readLocation, readNumber, HttpError } from './helpers.js';
import {
  CLOSING_STATUSES,
  getClosings,
  getOnAir,
  getActiveStationAlerts,
  getProgram,
  getStationIdentity,
} from '../services/stationStore.js';
import { getCoverageCounties, resolveCounty, reverse, search } from '../services/geocode.js';
import { getNews, NEWS_CATEGORIES } from '../services/news.js';
import { getCurrentConditions, getDailyForecast, getHourlyForecast } from '../services/conditions.js';
import { getActiveAlerts, getTextProduct, getZoneGeometry } from '../services/nws.js';
import { getNearbyStations } from '../services/metar.js';
import { getBreakingWeather, getStormTracks } from '../services/storms.js';
import { getNearestRadarSites } from '../services/radar.js';
import { cacheStats } from '../lib/cache.js';

const router = Router();

/* ---------------------------------------------------------------- playout */

/**
 * The graphic on program. Polled by the /output page, which the vision mixer
 * loads as a browser source - so it must never be served from a cache.
 */
router.get('/graphics/program', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(envelope({ program: getProgram() }));
});

/* --------------------------------------------------------------- location */

/** LOCATION SYSTEM - one search box across cities, ZIPs and counties. */
router.get(
  '/location/search',
  asyncRoute(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return cacheFor(res, 60).json(envelope({ results: [], query: q }));
    const limit = readNumber(req.query.limit, 10, { min: 1, max: 25 });
    const results = await search(q, { limit });
    return cacheFor(res, 3600).json(envelope({ results, query: q }));
  }),
);

router.get(
  '/location/reverse',
  asyncRoute(async (req, res) => {
    const location = readLocation(req, { required: true });
    const result = await reverse(location.lat, location.lon);
    cacheFor(res, 3600).json(envelope(result));
  }),
);

/** LOCAL COUNTY WEATHER - the full coverage-area county list. */
router.get(
  '/location/counties',
  asyncRoute(async (req, res) => {
    const counties = await getCoverageCounties();
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const filtered = q
      ? counties.filter((c) => c.name.toLowerCase().includes(q) || c.state.toLowerCase() === q)
      : counties;
    cacheFor(res, 3600).json(
      envelope({ counties: filtered, total: counties.length, states: config.coverageStates }),
    );
  }),
);

/**
 * Everything for one county: conditions, forecasts, radar site, alerts,
 * observations and the responsible office's forecast discussion.
 */
router.get(
  '/location/county/:zoneId',
  asyncRoute(async (req, res) => {
    const zoneId = String(req.params.zoneId).toUpperCase();
    const county = await resolveCounty(zoneId);
    if (!county) throw new HttpError(404, `Unknown county zone ${zoneId}`);

    const location = { lat: county.lat, lon: county.lon, name: county.label };

    const [current, hourly, daily, alerts, stations, radar, discussion] = await Promise.allSettled([
      getCurrentConditions(location),
      getHourlyForecast(location, { hours: 48 }),
      getDailyForecast(location, { days: 10 }),
      getActiveAlerts({ zone: zoneId }),
      getNearbyStations(county.lat, county.lon, 60, 20),
      getNearestRadarSites(county.lat, county.lon, 4),
      county.cwa?.[0] ? getTextProduct(county.cwa[0], 'AFD') : Promise.resolve(null),
    ]);

    const value = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
    const alertData = value(alerts, { alerts: [] });

    cacheFor(res, 120).json(
      envelope({
        county,
        current: value(current, null),
        hourly: value(hourly, { hours: [] }),
        daily: value(daily, { days: [] }),
        warnings: alertData.alerts.filter((a) => a.kind === 'warning'),
        watches: alertData.alerts.filter((a) => a.kind === 'watch'),
        advisories: alertData.alerts.filter((a) => a.kind === 'advisory' || a.kind === 'statement'),
        observations: value(stations, []),
        radarSites: value(radar, []),
        discussion: value(discussion, null),
      }),
    );
  }),
);

router.get(
  '/location/zone/:zoneId',
  asyncRoute(async (req, res) => {
    const zone = await getZoneGeometry(String(req.params.zoneId).toUpperCase());
    cacheFor(res, 86400).json(envelope(zone));
  }),
);

/* ------------------------------------------------------------------- news */

/** STORM 12 WEATHER NEWS. */
router.get(
  '/news',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const limit = readNumber(req.query.limit, 30, { min: 1, max: 60 });
    const news = await getNews({ location, category, limit });
    cacheFor(res, 300).json(envelope(news));
  }),
);

router.get('/news/categories', (req, res) => {
  cacheFor(res, 86400).json(envelope({ categories: NEWS_CATEGORIES }));
});

/* ------------------------------------------------------------------- live */

/**
 * LIVE WEATHER.
 *
 * The station's stream, and nothing standing in for it. When nothing is being
 * broadcast the page says so plainly - a radar loop dressed up as "latest
 * weather video" tells a viewer the station is on air when it is not.
 */
router.get(
  '/live',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);
    const [conditions, daily, breaking, radarSites] = await Promise.allSettled([
      getCurrentConditions(location),
      getDailyForecast(location, { days: 5 }),
      getBreakingWeather(location),
      getNearestRadarSites(location.lat, location.lon, 3),
    ]);

    const value = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
    const current = value(conditions, null);
    const site = current?.location?.radarStation ?? value(radarSites, [])[0]?.id ?? config.defaultRadarSite;
    const breakingData = value(breaking, { active: false });
    const identity = getStationIdentity();

    const stream = config.liveStream.url
      ? {
          available: true,
          type: config.liveStream.type,
          url: config.liveStream.url,
          title: `${identity.name} Live`,
        }
      : {
          available: false,
          reason: 'Nothing is being streamed right now.',
        };

    cacheFor(res, 60).json(
      envelope({
        stream,
        // What the viewer can reach instead while the stream is dark. These
        // are links, deliberately not presented as a broadcast.
        offAir: { radarSite: site },
        coverage: {
          // "Live coverage" is on when a warning is active for the viewer.
          status: breakingData.active && breakingData.takeover ? 'severe' : breakingData.active ? 'watching' : 'normal',
          label: breakingData.active && breakingData.takeover
            ? 'Severe weather coverage'
            : breakingData.active
              ? 'Tracking active alerts'
              : 'Regular coverage',
          alertCount: breakingData.totalActive ?? 0,
        },
        current,
        forecast: value(daily, { days: [] }),
        breaking: breakingData,
      }),
    );
  }),
);

/* -------------------------------------------------------------- broadcast */

/** BROADCAST MODE - a single payload driving every 1920x1080 element. */
router.get(
  '/broadcast',
  asyncRoute(async (req, res) => {
    const location = readLocation(req);

    // Every piece here is independent, so they all go out together. The ticker
    // markets used to wait for the forecast to settle before they even started,
    // which doubled the worst case on a cold cache for no reason - and this is
    // the one request the whole broadcast stage waits on.
    const tickerMarkets = config.tickerMarkets.slice(0, 8);
    const [current, hourly, daily, breaking, storms, alerts, ...markets] = await Promise.allSettled([
      getCurrentConditions(location),
      getHourlyForecast(location, { hours: 12 }),
      getDailyForecast(location, { days: 7 }),
      getBreakingWeather(location),
      getStormTracks(location, { radiusMiles: 150 }),
      getActiveAlerts({ area: config.coverageStates }),
      ...tickerMarkets.map(async (m) => {
        const c = await getCurrentConditions(m);
        return { name: m.name.toUpperCase(), temperature: c.observation.temperature, icon: c.observation.icon };
      }),
    ]);

    const value = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
    const currentData = value(current, null);

    cacheFor(res, 60).json(
      envelope({
        current: currentData,
        hourly: value(hourly, { hours: [] }),
        daily: value(daily, { days: [] }),
        breaking: value(breaking, { active: false }),
        storms: value(storms, { storms: [] }),
        alerts: value(alerts, { alerts: [] }).alerts.slice(0, 12),
        markets: markets.filter((r) => r.status === 'fulfilled').map((r) => r.value),
        radarSite: currentData?.location?.radarStation ?? config.defaultRadarSite,
        sponsor: config.sponsor.name ? config.sponsor : null,
        station: { name: 'STORM 12 WEATHER', market: config.defaultLocation.name },
      }),
    );
  }),
);

/* --------------------------------------------------- newsroom bulletins */

/**
 * SCHOOL CLOSINGS. Entered by the newsroom in the admin panel - there is no
 * public feed for this; a local station takes them by phone and by form, the
 * way it always has.
 */
router.get('/closings', (req, res) => {
  const closings = getClosings();
  const byStatus = closings.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  res.set('Cache-Control', 'public, max-age=30').json(
    envelope({
      closings,
      statuses: CLOSING_STATUSES,
      counts: { total: closings.length, byStatus },
      updatedAt: closings[0]?.updatedAt ?? null,
    }),
  );
});

/** Alerts written by the station itself, kept distinct from NWS products. */
router.get('/station-alerts', (req, res) => {
  res.set('Cache-Control', 'no-store').json(
    envelope({
      alerts: getActiveStationAlerts(),
      onAir: getOnAir(),
      station: getStationIdentity(),
    }),
  );
});

/* ----------------------------------------------------------------- config */

/** Client bootstrap: everything the app needs before its first render. */
router.get('/config', (req, res) => {
  cacheFor(res, 300).json(
    envelope({
      station: getStationIdentity(),
      defaultLocation: config.defaultLocation,
      defaultRadarSite: config.defaultRadarSite,
      coverageStates: config.coverageStates,
      tickerMarkets: config.tickerMarkets,
      liveStream: { available: Boolean(config.liveStream.url), type: config.liveStream.type },
      sponsor: config.sponsor.name ? config.sponsor : null,
      features: {
        lightning: Boolean(config.lightning.tileUrl || config.lightning.geojsonUrl),
        // SRV is decoded here from the Level III feed, so it needs no licence.
        stormRelativeVelocity: true,
        liveStream: Boolean(config.liveStream.url),
      },
      sources: [
        { id: 'nws', name: 'NOAA / National Weather Service API', url: 'https://api.weather.gov' },
        { id: 'nexrad', name: 'NOAA NCEP NEXRAD Level III', url: 'https://opengeo.ncep.noaa.gov/geoserver' },
        { id: 'rainviewer', name: 'RainViewer radar mosaic', url: 'https://www.rainviewer.com' },
        { id: 'spc', name: 'NOAA Storm Prediction Center', url: 'https://www.spc.noaa.gov' },
        { id: 'nhc', name: 'NOAA National Hurricane Center', url: 'https://www.nhc.noaa.gov' },
        { id: 'metar', name: 'NOAA Aviation Weather Center METAR', url: 'https://aviationweather.gov' },
        { id: 'openmeteo', name: 'Open-Meteo (NOAA GFS/HRRR)', url: 'https://open-meteo.com' },
        { id: 'iem', name: 'Iowa State Mesonet NEXRAD composite', url: 'https://mesonet.agron.iastate.edu' },
      ],
    }),
  );
});

/** Health + cache diagnostics. */
router.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    status: 'up',
    uptimeSeconds: Math.round(process.uptime()),
    cache: cacheStats(),
    time: new Date().toISOString(),
  });
});

export default router;
