import config from '../config.js';
import { NEXRAD_PRODUCTS } from './nexrad.js';
import { cachedJson } from '../lib/http.js';
import { getRadarStations } from './nws.js';
import { distanceMiles } from '../lib/geo.js';

/**
 * Radar source catalogue.
 *
 * Everything here is a public, no-key NOAA/NWS-derived service:
 *  - RainViewer serves the seamless animated CONUS+global mosaic used for the
 *    smooth loop (built from NEXRAD Level III in the US).
 *  - NCEP's public GeoServer serves official per-site WSR-88D super-resolution
 *    products (base reflectivity, base velocity, hydrometeor class, storm
 *    total precip) plus CONUS mosaics (echo tops, precipitation type).
 *  - Iowa State Mesonet serves time-lagged NEXRAD composites, used as the
 *    animation fallback when RainViewer is unavailable.
 */

const RAINVIEWER = 'https://api.rainviewer.com/public/weather-maps.json';
const NCEP_GEOSERVER = 'https://opengeo.ncep.noaa.gov/geoserver';
const IEM_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
const IEM_WMS = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi';

/** RainViewer colour schemes we expose in the UI. */
export const RADAR_PALETTES = [
  { id: 4, name: 'Storm 12', description: 'High-contrast broadcast reflectivity' },
  { id: 6, name: 'NEXRAD Level III', description: 'Classic NWS reflectivity ramp' },
  { id: 2, name: 'Universal Blue', description: 'Low-glare palette for long loops' },
  { id: 7, name: 'Rainbow SELEX', description: 'Extended dBZ resolution' },
  { id: 8, name: 'Dark Sky', description: 'Muted palette for night broadcasts' },
];

/**
 * Fetch the RainViewer frame index. Each frame is a discrete radar sweep with
 * its own tile path, which is what lets the client preload frames and animate
 * without re-requesting tiles.
 */
export async function getRadarFrames() {
  const data = await cachedJson('radar:rainviewer', 60, RAINVIEWER);
  const host = data?.host ?? 'https://tilecache.rainviewer.com';
  const past = data?.radar?.past ?? [];
  const nowcast = data?.radar?.nowcast ?? [];
  const satellite = data?.satellite?.infrared ?? [];

  const frame = (f, kind) => ({
    time: f.time,
    timestamp: new Date(f.time * 1000).toISOString(),
    path: f.path,
    kind,
  });

  return {
    host,
    generated: data?.generated ? new Date(data.generated * 1000).toISOString() : new Date().toISOString(),
    radar: {
      past: past.map((f) => frame(f, 'past')),
      nowcast: nowcast.map((f) => frame(f, 'forecast')),
    },
    satellite: satellite.map((f) => frame(f, 'past')),
    /**
     * Tile template. `{path}` is substituted per frame by the client so one
     * template covers the whole loop.
     * size: 256|512, color: palette id, options: `${smooth}_${snow}`
     */
    tileTemplate: `${host}{path}/512/{z}/{x}/{y}/{color}/1_1.png`,
    satelliteTemplate: `${host}{path}/512/{z}/{x}/{y}/0/0_0.png`,
    stale: Boolean(data?._stale),
  };
}

/**
 * Iowa State time-lagged NEXRAD composite. Used as the animation fallback:
 * twelve 5-minute steps of the same base reflectivity mosaic.
 */
export function getIemFallbackFrames() {
  const steps = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];
  const now = Date.now();
  return {
    source: 'Iowa State Mesonet NEXRAD composite',
    frames: steps.map((minutesAgo) => ({
      minutesAgo,
      timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
      url: `${IEM_TILES}/nexrad-n0q-900913${minutesAgo ? `-m${String(minutesAgo).padStart(2, '0')}m` : ''}/{z}/{x}/{y}.png`,
    })),
  };
}

/**
 * A WMS endpoint descriptor. The client feeds `url` + `layer` straight into
 * Leaflet's native WMS tile layer, which builds the bbox request itself.
 */
const wms = (workspace, layer) => ({
  url: `${NCEP_GEOSERVER}/${workspace}/ows`,
  layer,
  version: '1.1.1',
  format: 'image/png',
  transparent: true,
});

/**
 * Every product offered by the radar page. `scope: 'site'` products are
 * rendered from the selected WSR-88D; `scope: 'mosaic'` products are national.
 */
export function getRadarProducts({ site = config.defaultRadarSite } = {}) {
  const s = String(site || config.defaultRadarSite).toLowerCase();
  const products = [
    // The station's own radar leads: Level III straight from NOAA's open data
    // bucket, decoded and rendered here. The national mosaic below is a
    // third-party convenience, not the primary source.
    ...Object.values(NEXRAD_PRODUCTS).map((p) => ({
      id: p.id,
      name: p.name,
      short: p.short,
      scope: 'site',
      animated: false,
      type: 'nexrad',
      units: p.units,
      url: `/api/radar/nexrad/${String(site).toUpperCase()}/${p.id}.png`,
      metaUrl: `/api/radar/nexrad/${String(site).toUpperCase()}/${p.id}`,
      description: p.description,
      available: true,
    })),
    {
      id: 'composite',
      name: 'NEXRAD Composite',
      short: 'NEXRAD',
      scope: 'mosaic',
      animated: true,
      type: 'rainviewer',
      units: 'dBZ',
      description: 'Seamless national base reflectivity mosaic, animated.',
      available: true,
    },
    {
      id: 'reflectivity',
      name: 'Base Reflectivity',
      short: 'REFL',
      scope: 'site',
      animated: false,
      type: 'wms',
      units: 'dBZ',
      wms: wms(s, `${s}_sr_bref`),
      description: 'Super-resolution 0.5° base reflectivity from the selected radar.',
      available: true,
    },
    {
      id: 'velocity',
      name: 'Base Velocity',
      short: 'VEL',
      scope: 'site',
      animated: false,
      type: 'wms',
      units: 'kt',
      wms: wms(s, `${s}_sr_bvel`),
      description: 'Super-resolution 0.5° radial velocity. Green = toward radar, red = away.',
      available: true,
    },
    {
      id: 'precip-type',
      name: 'Precipitation Type',
      short: 'PTYPE',
      scope: 'mosaic',
      animated: false,
      type: 'wms',
      wms: wms('conus', 'conus_pcpn_typ'),
      description: 'National rain / snow / mix / ice classification mosaic.',
      available: true,
    },
    {
      id: 'precip-total',
      name: 'Storm Total Precipitation',
      short: 'STP',
      scope: 'site',
      animated: false,
      type: 'wms',
      units: 'in',
      wms: wms(s, `${s}_bdsa`),
      description: 'Storm total accumulation estimated by the selected radar.',
      available: true,
    },
    {
      id: 'echo-tops',
      name: 'Echo Tops',
      short: 'TOPS',
      scope: 'mosaic',
      animated: false,
      type: 'wms',
      units: 'kft',
      wms: wms('conus', 'conus_neet_v18'),
      description: 'Height of the highest radar echo - a proxy for updraft strength.',
      available: true,
    },
    {
      id: 'hydrometeor',
      name: 'Hydrometeor Class',
      short: 'HCA',
      scope: 'site',
      animated: false,
      type: 'wms',
      wms: wms(s, `${s}_bdhc`),
      description: 'Dual-pol classification: rain, hail, graupel, debris and more.',
      available: true,
    },
    {
      id: 'satellite',
      name: 'Satellite (IR)',
      short: 'SAT',
      scope: 'mosaic',
      animated: true,
      type: 'rainviewer-satellite',
      description: 'GOES infrared cloud-top imagery, animated.',
      available: true,
    },
    {
      id: 'lightning',
      name: 'Lightning',
      short: 'LTG',
      scope: 'mosaic',
      animated: false,
      type: config.lightning.tileUrl ? 'xyz' : 'geojson',
      url: config.lightning.tileUrl || config.lightning.geojsonUrl || null,
      description: 'Cloud-to-ground strike density.',
      available: Boolean(config.lightning.tileUrl || config.lightning.geojsonUrl),
      unavailableReason:
        'Lightning detection networks are commercially licensed. Set LIGHTNING_TILE_URL or LIGHTNING_GEOJSON_URL to your station feed.',
    },
    {
      id: 'temperature',
      name: 'Surface Temperature',
      short: 'TEMP',
      scope: 'mosaic',
      animated: false,
      type: 'observations',
      units: 'F',
      description: 'Live temperatures plotted from reporting METAR/ASOS stations.',
      available: true,
    },
  ];
  return products;
}

/** Vector overlays that can be stacked on top of any radar product. */
export const RADAR_OVERLAYS = [
  { id: 'warnings', name: 'Warnings', type: 'alerts', filter: 'warning', default: true },
  { id: 'watches', name: 'Watches', type: 'alerts', filter: 'watch', default: true },
  { id: 'advisories', name: 'Advisories', type: 'alerts', filter: 'advisory', default: false },
  { id: 'tracks', name: 'Storm Tracks', type: 'tracks', default: true },
  { id: 'spc', name: 'SPC Outlook', type: 'spc', default: false },
  { id: 'reports', name: 'Storm Reports', type: 'reports', default: false },
  { id: 'stations', name: 'METAR Stations', type: 'stations', default: false },
  { id: 'sites', name: 'Radar Sites', type: 'sites', default: true },
  { id: 'counties', name: 'County Lines', type: 'counties', default: true },
  { id: 'places', name: 'City Names', type: 'places', default: true },
];

/** Nearest WSR-88D sites to a point, for the radar site selector. */
export async function getNearestRadarSites(lat, lon, limit = 12) {
  const sites = await getRadarStations();
  return sites
    .map((s) => ({ ...s, distance: Math.round(distanceMiles({ lat, lon }, { lat: s.lat, lon: s.lon })) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export const IEM_COMPOSITE_WMS = IEM_WMS;
