import { cachedJson } from '../lib/http.js';
import { compassPoint, distanceMiles } from '../lib/geo.js';

/**
 * Live surface observations from the NOAA Aviation Weather Center METAR API.
 * This is what powers the Weather Stations map and the surface temperature
 * radar layer - real ASOS/AWOS reports, no key required.
 */
const AWC = 'https://aviationweather.gov/api/data/metar';

const cToF = (c) => (c === null || c === undefined ? null : (c * 9) / 5 + 32);
const ktToMph = (kt) => (kt === null || kt === undefined ? null : Math.round(kt * 1.15078));
const hpaToInHg = (hpa) => (hpa === null || hpa === undefined ? null : Math.round((hpa / 33.8639) * 100) / 100);

/** METAR present-weather codes -> readable text. */
const WX_CODES = {
  RA: 'Rain', SN: 'Snow', DZ: 'Drizzle', GR: 'Hail', GS: 'Small Hail', PL: 'Ice Pellets',
  IC: 'Ice Crystals', UP: 'Unknown Precip', TS: 'Thunderstorm', SH: 'Showers', FZ: 'Freezing',
  BR: 'Mist', FG: 'Fog', FU: 'Smoke', HZ: 'Haze', DU: 'Dust', SA: 'Sand', VA: 'Volcanic Ash',
  SQ: 'Squalls', FC: 'Funnel Cloud', SS: 'Sandstorm', DS: 'Duststorm', PO: 'Dust Whirls',
};

export function describeWeather(raw = '') {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  const described = parts.map((token) => {
    const intensity = token.startsWith('-') ? 'Light ' : token.startsWith('+') ? 'Heavy ' : '';
    const body = token.replace(/^[-+]/, '').replace(/^VC/, '');
    const vicinity = token.includes('VC') ? ' in Vicinity' : '';
    const chunks = body.match(/.{1,2}/g) ?? [];
    const words = chunks.map((c) => WX_CODES[c]).filter(Boolean);
    return words.length ? `${intensity}${words.join(' ')}${vicinity}` : null;
  });
  return described.filter(Boolean).join(', ') || null;
}

/** Cloud layers -> ceiling in feet (lowest broken/overcast layer). */
export function computeCeiling(clouds = []) {
  const ceilingLayer = clouds
    .filter((c) => ['BKN', 'OVC', 'OVX'].includes(c.cover) && Number.isFinite(c.base))
    .sort((a, b) => a.base - b.base)[0];
  return ceilingLayer ? ceilingLayer.base : null;
}

export function describeSky(clouds = []) {
  if (!clouds.length) return 'Clear';
  const worst = ['OVC', 'BKN', 'SCT', 'FEW', 'CLR', 'SKC'].find((c) => clouds.some((l) => l.cover === c));
  return { OVC: 'Overcast', BKN: 'Mostly Cloudy', SCT: 'Partly Cloudy', FEW: 'Mostly Clear', CLR: 'Clear', SKC: 'Clear' }[worst] ?? 'Clear';
}

function normalizeMetar(m) {
  const visibility = typeof m.visib === 'string' ? Number.parseFloat(m.visib.replace('+', '')) : m.visib;
  const clouds = (m.clouds ?? []).map((c) => ({ cover: c.cover, base: c.base }));
  return {
    id: m.icaoId,
    name: m.name || m.icaoId,
    lat: m.lat,
    lon: m.lon,
    elevationM: m.elev,
    observedAt: m.reportTime ? new Date(m.reportTime).toISOString() : null,
    temperature: cToF(m.temp) === null ? null : Math.round(cToF(m.temp)),
    dewpoint: cToF(m.dewp) === null ? null : Math.round(cToF(m.dewp)),
    relativeHumidity: relativeHumidity(m.temp, m.dewp),
    windDirection: typeof m.wdir === 'number' ? m.wdir : null,
    windCompass: typeof m.wdir === 'number' ? compassPoint(m.wdir) : m.wdir === 'VRB' ? 'VRB' : null,
    windSpeed: ktToMph(m.wspd),
    windGust: ktToMph(m.wgst),
    visibility: Number.isFinite(visibility) ? visibility : null,
    visibilityPlus: typeof m.visib === 'string' && m.visib.includes('+'),
    altimeter: hpaToInHg(m.altim),
    seaLevelPressure: hpaToInHg(m.slp),
    clouds,
    ceiling: computeCeiling(clouds),
    sky: describeSky(clouds),
    presentWeather: describeWeather(m.wxString),
    weatherCode: m.wxString || null,
    flightCategory: flightCategory(computeCeiling(clouds), Number.isFinite(visibility) ? visibility : null),
    raw: m.rawOb,
  };
}

function relativeHumidity(tempC, dewC) {
  if (typeof tempC !== 'number' || typeof dewC !== 'number') return null;
  const e = 6.112 * Math.exp((17.67 * dewC) / (dewC + 243.5));
  const es = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  return Math.round((e / es) * 100);
}

/** VFR / MVFR / IFR / LIFR - a compact way to colour the station map. */
export function flightCategory(ceiling, visibility) {
  const c = ceiling ?? 99999;
  const v = visibility ?? 99;
  if (c < 500 || v < 1) return { code: 'LIFR', color: '#FF00FF' };
  if (c < 1000 || v < 3) return { code: 'IFR', color: '#FF3D3D' };
  if (c <= 3000 || v <= 5) return { code: 'MVFR', color: '#3D8BFF' };
  return { code: 'VFR', color: '#22C55E' };
}

/** Observations inside a bounding box: minLon, minLat, maxLon, maxLat. */
export async function getStationsInBounds(bbox) {
  const [w, s, e, n] = bbox;
  const url = `${AWC}?bbox=${s.toFixed(2)},${w.toFixed(2)},${n.toFixed(2)},${e.toFixed(2)}&format=json`;
  const key = `metar:bbox:${[w, s, e, n].map((v) => v.toFixed(1)).join(',')}`;
  const data = await cachedJson(key, 60 * 5, url);
  const list = Array.isArray(data) ? data : [];
  return list.map(normalizeMetar).filter((st) => Number.isFinite(st.lat) && st.temperature !== null);
}

/** Observations for specific ICAO identifiers. */
export async function getStationsById(ids = []) {
  const clean = ids.map((i) => String(i).toUpperCase().trim()).filter(Boolean);
  if (!clean.length) return [];
  const url = `${AWC}?ids=${clean.join(',')}&format=json`;
  const data = await cachedJson(`metar:ids:${clean.sort().join(',')}`, 60 * 5, url);
  return (Array.isArray(data) ? data : []).map(normalizeMetar);
}

/** Nearest reporting stations to a point, sorted by distance. */
export async function getNearbyStations(lat, lon, radiusMiles = 90, limit = 60) {
  const degLat = radiusMiles / 69;
  const degLon = radiusMiles / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const stations = await getStationsInBounds([lon - degLon, lat - degLat, lon + degLon, lat + degLat]);
  return stations
    .map((st) => ({ ...st, distance: Math.round(distanceMiles({ lat, lon }, { lat: st.lat, lon: st.lon })) }))
    .filter((st) => st.distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
