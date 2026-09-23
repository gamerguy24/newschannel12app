/**
 * Configuration, read from the environment.
 *
 * On Workers the bindings in wrangler.jsonc and the secrets set with
 * `wrangler secret put` arrive as process.env, so the same reader serves both
 * runtimes. Values are re-read per request through hydrate(), because a
 * module evaluated at isolate start cannot assume its bindings were there yet.
 */

/**
 * Where values come from. On Workers this is process.env populated from the
 * bindings, merged with the env object the runtime hands each request - the
 * belt and braces matter because an isolate may evaluate this module before
 * its bindings are readable.
 */
let source = typeof process !== 'undefined' && process.env ? process.env : {};

const str = (key, fallback = '') => (source[key] ?? fallback).toString().trim();
const num = (key, fallback) => {
  const v = Number.parseFloat(source[key]);
  return Number.isFinite(v) ? v : fallback;
};
const list = (key, fallback = []) => {
  const raw = str(key);
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

function parseMarkets(raw) {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, lat, lon] = entry.split(':');
      const point = { name: (name || '').trim(), lat: Number.parseFloat(lat), lon: Number.parseFloat(lon) };
      return Number.isFinite(point.lat) && Number.isFinite(point.lon) && point.name ? point : null;
    })
    .filter(Boolean);
}

function read() {
  return {
    port: Number.parseInt(str('PORT', '8787'), 10),
    nodeEnv: str('NODE_ENV', 'development'),
    userAgent: str('NWS_USER_AGENT', 'Storm12Weather/1.0 (contact@storm12weather.example)').replace(/^"|"$/g, ''),
    defaultLocation: {
      lat: num('DEFAULT_LAT', 36.1627),
      lon: num('DEFAULT_LON', -86.7816),
      name: str('DEFAULT_LOCATION_NAME', 'Nashville, TN').replace(/^"|"$/g, ''),
    },
    // The station's home NEXRAD. KOHX is Nashville (Old Hickory); every radar
    // surface falls back to it rather than to a hardcoded out-of-market site.
    defaultRadarSite: str('DEFAULT_RADAR_SITE', 'KOHX').toUpperCase(),
    coverageStates: list('COVERAGE_STATES', ['TN', 'KY', 'AL']).map((s) => s.toUpperCase()),
    // Which states' WSR-88D sites appear in radar pickers. Wider than the alert
    // coverage area, because a neighbouring radar often has the better view.
    radarStates: list('RADAR_STATES', ['TN', 'AL', 'KY', 'AR', 'NC', 'SC', 'GA']).map((s) => s.toUpperCase()),
    tickerMarkets: parseMarkets(
      str(
        'TICKER_MARKETS',
        'Nashville:36.1627:-86.7816,Murfreesboro:35.8456:-86.3903,Franklin:35.9251:-86.8689,Clarksville:36.5298:-87.3595,Columbia:35.6151:-87.0353,Cookeville:36.1628:-85.5016,Bowling Green:36.9685:-86.4808,Huntsville:34.7304:-86.5861',
      ).replace(/^"|"$/g, ''),
    ),
    liveStream: {
      url: str('LIVE_STREAM_URL'),
      type: str('LIVE_STREAM_TYPE', 'hls'),
    },
    lightning: {
      tileUrl: str('LIGHTNING_TILE_URL'),
      geojsonUrl: str('LIGHTNING_GEOJSON_URL'),
    },
    sponsor: {
      name: str('SPONSOR_NAME'),
      tagline: str('SPONSOR_TAGLINE'),
    },
    // Shared password for the newsroom admin panel. Unset disables the panel
    // outright - an unconfigured deployment must not ship an open back office.
    adminPassword: str('ADMIN_PASSWORD'),
    corsOrigins: list('CORS_ORIGINS', ['http://localhost:5173']),
  };
}

export const config = read();

/**
 * Re-read the environment onto the shared config object. The newsroom's saved
 * overrides are layered on top of this by the station store.
 */
export function hydrateConfig(env) {
  if (env) {
    const base = typeof process !== 'undefined' && process.env ? process.env : {};
    const strings = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') strings[key] = value;
    }
    source = { ...base, ...strings };
  }
  Object.assign(config, read());
  return config;
}

export default config;
