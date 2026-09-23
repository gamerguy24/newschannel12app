import { Router } from '../../../worker/router.js';
import config from '../config.js';
import { asyncRoute, cacheFor, envelope, readLocation, readNumber, HttpError } from './helpers.js';
import { getIemFallbackFrames, getNearestRadarSites, getRadarFrames, getRadarProducts, RADAR_OVERLAYS, RADAR_PALETTES } from '../services/radar.js';
import { getOutlook, getOutlookSummary, getStormReports } from '../services/spc.js';
import { getNearbyStations, getStationsInBounds } from '../services/metar.js';
import { getRadarStations } from '../services/nws.js';
import { getActiveStorms, getStormTrack, getTropicalImagery, getTropicalOutlook } from '../services/nhc.js';
import { NEXRAD_PRODUCTS, getSweepImage } from '../services/nexrad.js';
import { getBroadcastPlaces, getCountyBoundaries } from '../services/broadcastMap.js';

const router = Router();

const ESRI_SERVICES = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const ESRI_CANVAS = `${ESRI_SERVICES}/Canvas`;
const ESRI_ATTRIBUTION = 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors';

/* ------------------------------------------------------------------ radar */

/** Animation frame index for the smooth radar loop. */
router.get(
  '/radar/frames',
  asyncRoute(async (req, res) => {
    try {
      const frames = await getRadarFrames();
      return cacheFor(res, 60).json(envelope(frames, { fallback: false }));
    } catch (err) {
      // RainViewer down: fall back to the Iowa State time-lagged composite so
      // the loop keeps running instead of the radar page going blank.
      const fallback = getIemFallbackFrames();
      return cacheFor(res, 60).json(
        envelope({ ...fallback, tileTemplate: null }, { fallback: true, reason: err.message }),
      );
    }
  }),
);

/** Radar product catalogue for the selected site. */
router.get(
  '/radar/products',
  asyncRoute(async (req, res) => {
    const site = typeof req.query.site === 'string' ? req.query.site : config.defaultRadarSite;
    cacheFor(res, 3600).json(
      envelope({
        site: site.toUpperCase(),
        products: getRadarProducts({ site }),
        overlays: RADAR_OVERLAYS,
        palettes: RADAR_PALETTES,
      }),
    );
  }),
);

/** WSR-88D site list, sorted by distance when a coordinate is supplied. */
router.get(
  '/radar/sites',
  asyncRoute(async (req, res) => {
    const hasPoint = req.query.lat !== undefined && req.query.lon !== undefined;
    if (hasPoint) {
      const location = readLocation(req);
      const limit = readNumber(req.query.limit, 15, { min: 1, max: 200 });
      const sites = await getNearestRadarSites(location.lat, location.lon, limit);
      return cacheFor(res, 3600).json(envelope({ sites, nearest: sites[0] ?? null }));
    }
    const sites = await getRadarStations();
    return cacheFor(res, 3600).json(envelope({ sites }));
  }),
);

/* ------------------------------------------------- broadcast map furniture */

/** County outlines across the coverage states, for the map's boundary layer. */
router.get(
  '/map/counties',
  asyncRoute(async (req, res) => {
    const counties = await getCountyBoundaries();
    cacheFor(res, 60 * 60 * 12).json(counties);
  }),
);

/** The towns this station puts on its map, with the zoom each appears at. */
router.get('/map/places', (req, res) => {
  cacheFor(res, 60 * 60 * 24).json(envelope({ places: getBroadcastPlaces() }));
});

/* -------------------------------------------------- NEXRAD Level III (AWS) */

/** What the station's own radar can show, and where the data comes from. */
router.get('/radar/nexrad/products', (req, res) => {
  cacheFor(res, 3600).json(
    envelope({
      products: Object.values(NEXRAD_PRODUCTS),
      source: 'NOAA NEXRAD Level III via the AWS Open Data registry',
      bucket: 's3://unidata-nexrad-level3',
    }),
  );
});

/**
 * The rendered sweep itself, positioned by the bounds from the route below.
 * Registered ahead of the metadata route because ":product" would otherwise
 * match "N0B.png" and reject it as an unknown product.
 */
router.get(
  '/radar/nexrad/:site/:product.png',
  asyncRoute(async (req, res) => {
    const { site } = req.params;
    const product = String(req.params.product).toUpperCase();
    if (!NEXRAD_PRODUCTS[product]) throw new HttpError(404, `Unknown NEXRAD product ${product}`);

    const sweep = await getSweepImage(site, product);
    res
      .set('Content-Type', 'image/png')
      .set('Cache-Control', 'public, max-age=60')
      .set('X-Scan-Time', sweep.timestamp)
      .send(sweep.png);
  }),
);

/**
 * Metadata for the newest sweep: where to place the image and when it was
 * taken. The client needs the bounds before it can position the overlay.
 */
router.get(
  '/radar/nexrad/:site/:product',
  asyncRoute(async (req, res) => {
    const { site, product } = req.params;
    if (!NEXRAD_PRODUCTS[product.toUpperCase()]) {
      throw new HttpError(404, `Unknown NEXRAD product ${product}`);
    }
    const sweep = await getSweepImage(site, product.toUpperCase());
    // Short cache: a WSR-88D turns out a new volume scan every 4-6 minutes.
    cacheFor(res, 60).json(
      envelope({
        site: sweep.site,
        product: sweep.product,
        productName: sweep.productName,
        units: sweep.units,
        elevationAngle: sweep.elevationAngle,
        timestamp: sweep.timestamp,
        bounds: sweep.bounds,
        radar: { lat: sweep.radarLat, lon: sweep.radarLon },
        imageUrl: `/api/radar/nexrad/${sweep.site}/${sweep.product}.png`,
        key: sweep.key,
        source: sweep.source,
      }),
    );
  }),
);

/* -------------------------------------------------------------------- SPC */

router.get(
  '/spc/outlook',
  asyncRoute(async (req, res) => {
    const day = typeof req.query.day === 'string' ? req.query.day : 'day1';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : 'cat';
    const outlook = await getOutlook(day, kind);
    if (!outlook) throw new HttpError(404, `No SPC outlook for ${day}/${kind}`);
    cacheFor(res, 600).json(envelope(outlook));
  }),
);

router.get(
  '/spc/summary',
  asyncRoute(async (req, res) => {
    cacheFor(res, 600).json(envelope({ outlooks: await getOutlookSummary() }));
  }),
);

router.get(
  '/spc/reports',
  asyncRoute(async (req, res) => {
    const day = req.query.day === 'yesterday' ? 'yesterday' : 'today';
    const reports = await getStormReports(day);
    cacheFor(res, 300).json(envelope(reports));
  }),
);

/* --------------------------------------------------------------- stations */

/**
 * WEATHER STATIONS - live surface observations, either near a point or across
 * a map viewport.
 */
router.get(
  '/stations',
  asyncRoute(async (req, res) => {
    if (typeof req.query.bbox === 'string') {
      const parts = req.query.bbox.split(',').map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new HttpError(400, 'bbox must be minLon,minLat,maxLon,maxLat');
      }
      const stations = await getStationsInBounds(parts);
      return cacheFor(res, 300).json(envelope({ stations, bbox: parts, count: stations.length }));
    }
    const location = readLocation(req);
    const radius = readNumber(req.query.radius, 90, { min: 10, max: 300 });
    const limit = readNumber(req.query.limit, 60, { min: 1, max: 300 });
    const stations = await getNearbyStations(location.lat, location.lon, radius, limit);
    return cacheFor(res, 300).json(envelope({ stations, count: stations.length, radius, location }));
  }),
);

/* ---------------------------------------------------------------- tropics */

router.get(
  '/tropics',
  asyncRoute(async (req, res) => {
    const [storms, atlantic, pacific] = await Promise.allSettled([
      getActiveStorms(),
      getTropicalOutlook('at'),
      getTropicalOutlook('ep'),
    ]);
    cacheFor(res, 300).json(
      envelope({
        storms: storms.status === 'fulfilled' ? storms.value.storms : [],
        updatedAt: storms.status === 'fulfilled' ? storms.value.updatedAt : new Date().toISOString(),
        outlooks: [
          atlantic.status === 'fulfilled' ? atlantic.value : null,
          pacific.status === 'fulfilled' ? pacific.value : null,
        ].filter(Boolean),
        imagery: getTropicalImagery('atlantic'),
        error: storms.status === 'rejected' ? storms.reason?.message : null,
      }),
    );
  }),
);

router.get(
  '/tropics/:stormId',
  asyncRoute(async (req, res) => {
    const detail = await getStormTrack(req.params.stormId);
    if (!detail) throw new HttpError(404, `No active storm with id ${req.params.stormId}`);
    cacheFor(res, 300).json(envelope(detail));
  }),
);

/* ------------------------------------------------------------ map catalog */

/**
 * WEATHER MAP layer catalogue. Layers are declarative so the client can stack
 * any combination without the map code knowing about individual providers.
 */
router.get(
  '/map/layers',
  asyncRoute(async (req, res) => {
    const site = typeof req.query.site === 'string' ? req.query.site.toUpperCase() : config.defaultRadarSite;
    const radarProducts = getRadarProducts({ site });

    const layers = [
      ...radarProducts
        // The station's own AWS Level III products lead; the NCEP WMS layers
        // they replace are gone from the map rather than sitting alongside
        // them showing the same field from a different source.
        .filter((p) =>
          ['N0B', 'N0S', 'N0C', 'N0X', 'composite', 'satellite', 'lightning', 'temperature'].includes(p.id),
        )
        .map((p) => ({
          id: p.id,
          name: p.name,
          category: p.id === 'satellite' ? 'satellite' : p.id === 'temperature' ? 'surface' : 'radar',
          metaUrl: p.metaUrl ?? null,
          type: p.type,
          url: p.url ?? null,
          wms: p.wms ?? null,
          animated: p.animated,
          available: p.available,
          unavailableReason: p.unavailableReason ?? null,
          defaultOpacity: p.id === 'satellite' ? 0.7 : 0.8,
        })),
      { id: 'wind', name: 'Surface Wind', category: 'surface', type: 'observations', field: 'wind', available: true, defaultOpacity: 1 },
      { id: 'dewpoint', name: 'Dew Point', category: 'surface', type: 'observations', field: 'dewpoint', available: true, defaultOpacity: 1 },
      { id: 'pressure', name: 'Pressure', category: 'surface', type: 'observations', field: 'pressure', available: true, defaultOpacity: 1 },
      { id: 'metar', name: 'METAR Stations', category: 'surface', type: 'stations', available: true, defaultOpacity: 1 },
      { id: 'radar-sites', name: 'Radar Sites', category: 'radar', type: 'radar-sites', available: true, defaultOpacity: 1 },
      { id: 'counties', name: 'County Lines', category: 'radar', type: 'counties', available: true, defaultOpacity: 1 },
      { id: 'places', name: 'City Names', category: 'radar', type: 'places', available: true, defaultOpacity: 1 },
      { id: 'warnings', name: 'Warnings', category: 'alerts', type: 'alerts', filter: 'warning', available: true, defaultOpacity: 0.85 },
      { id: 'watches', name: 'Watches', category: 'alerts', type: 'alerts', filter: 'watch', available: true, defaultOpacity: 0.6 },
      { id: 'advisories', name: 'Advisories', category: 'alerts', type: 'alerts', filter: 'advisory', available: true, defaultOpacity: 0.45 },
      { id: 'spc-day1', name: 'SPC Day 1 Outlook', category: 'outlook', type: 'spc', day: 'day1', available: true, defaultOpacity: 0.5 },
      { id: 'spc-day2', name: 'SPC Day 2 Outlook', category: 'outlook', type: 'spc', day: 'day2', available: true, defaultOpacity: 0.5 },
      { id: 'spc-day3', name: 'SPC Day 3 Outlook', category: 'outlook', type: 'spc', day: 'day3', available: true, defaultOpacity: 0.5 },
      { id: 'reports', name: 'Storm Reports', category: 'reports', type: 'reports', available: true, defaultOpacity: 1 },
      { id: 'tracks', name: 'Storm Tracks', category: 'reports', type: 'tracks', available: true, defaultOpacity: 1 },
    ];

    cacheFor(res, 3600).json(
      envelope({
        layers,
        site,
        // Esri's canvas basemaps still serve without an API key; CARTO now
        // watermarks every unauthenticated tile with "API KEY REQUIRED".
        basemaps: [
          { id: 'dark', name: 'Broadcast Dark', url: `${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTRIBUTION },
          { id: 'light', name: 'Daylight', url: `${ESRI_CANVAS}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTRIBUTION },
          { id: 'terrain', name: 'Terrain', url: `${ESRI_SERVICES}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, attribution: ESRI_ATTRIBUTION },
        ],
        lightning: {
          configured: Boolean(config.lightning.tileUrl || config.lightning.geojsonUrl),
        },
      }),
    );
  }),
);

export default router;
