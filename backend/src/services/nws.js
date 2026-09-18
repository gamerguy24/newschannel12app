import { cachedJson, UpstreamError } from '../lib/http.js';
import { withCache } from '../lib/cache.js';
import { classifyEvent } from './alertCatalog.js';
import { geometryBounds, geometryCentroid, compassPoint } from '../lib/geo.js';
import config from '../config.js';

const API = 'https://api.weather.gov';

const round4 = (n) => Math.round(Number(n) * 10000) / 10000;
export const pointKey = (lat, lon) => `${round4(lat)},${round4(lon)}`;

/* ------------------------------------------------------------------ points */

/**
 * The NWS reports a place's legal Census name, which is not what a viewer
 * calls home: Nashville comes back as "Nashville-Davidson metropolitan
 * government (balance)". Trim the administrative wrapper so the name that
 * reaches a forecast, a graphic or the header is the one people use.
 */
export function tidyPlaceName(value) {
  if (!value) return value;
  const original = String(value).trim();
  let name = original.replace(/\s*\((balance|part|CDP)\)\s*$/i, '');

  // Only a consolidated city-county gets split on its separator: plenty of
  // real place names are hyphenated (Winston-Salem) and must survive intact.
  const consolidated = /\s+(metropolitan|metro|consolidated|unified|urban county)\s+government$/i.test(name);
  name = name.replace(/\s+(metropolitan|metro|consolidated|unified|urban county)\s+government$/i, '');
  if (consolidated) {
    const [first] = name.split(/\s*[/-]\s*/);
    if (first && first.length >= 3) name = first;
  }

  name = name.replace(/^(city|town|village|borough|township)\s+of\s+/i, '');
  name = name.replace(/\s+(city|town|village|borough|township)$/i, '');
  return name.trim() || original;
}

/**
 * /points is the entry point for every NWS product: it maps a coordinate to a
 * forecast office, grid cell, zones and the responsible radar site.
 */
export async function getPoint(lat, lon) {
  const key = pointKey(lat, lon);
  const data = await cachedJson(`point:${key}`, 60 * 60 * 12, `${API}/points/${key}`);
  const p = data?.properties ?? {};
  const rel = p.relativeLocation?.properties ?? {};
  return {
    lat: Number(lat),
    lon: Number(lon),
    gridId: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
    forecastOffice: p.gridId,
    forecastOfficeUrl: p.forecastOffice,
    radarStation: p.radarStation,
    timeZone: p.timeZone,
    city: tidyPlaceName(rel.city),
    state: rel.state,
    county: p.county,
    countyId: p.county ? p.county.split('/').pop() : undefined,
    forecastZone: p.forecastZone,
    forecastZoneId: p.forecastZone ? p.forecastZone.split('/').pop() : undefined,
    fireWeatherZone: p.fireWeatherZone,
    urls: {
      forecast: p.forecast,
      forecastHourly: p.forecastHourly,
      forecastGridData: p.forecastGridData,
      observationStations: p.observationStations,
    },
  };
}

/* ---------------------------------------------------------------- forecast */

const ICON_MAP = [
  [/tornado/i, 'tornado'],
  [/hurricane|tropical/i, 'hurricane'],
  [/tsra|thunder/i, 'thunderstorm'],
  [/blizzard/i, 'blizzard'],
  [/(freezing|sleet|ice)/i, 'sleet'],
  [/snow/i, 'snow'],
  [/rain_showers|showers/i, 'showers'],
  [/rain|drizzle/i, 'rain'],
  [/fog|haze/i, 'fog'],
  [/wind/i, 'windy'],
  [/hot/i, 'hot'],
  [/cold/i, 'cold'],
  // Order matters: "Partly Cloudy" must not be caught by the generic /cloudy/.
  [/bkn|mostly_cloudy|mostly cloudy/i, 'mostly-cloudy'],
  [/sct|few|partly/i, 'partly-cloudy'],
  [/ovc|overcast|cloudy/i, 'cloudy'],
  [/skc|clear|sunny|fair/i, 'clear'],
];

/** Map an NWS icon URL or text summary onto one of our own icon names. */
export function resolveIcon(iconUrl = '', shortForecast = '', isDaytime = true) {
  const haystack = `${iconUrl} ${shortForecast}`;
  for (const [re, name] of ICON_MAP) {
    if (re.test(haystack)) {
      if (name === 'clear') return isDaytime ? 'clear-day' : 'clear-night';
      if (name === 'partly-cloudy') return isDaytime ? 'partly-cloudy-day' : 'partly-cloudy-night';
      return name;
    }
  }
  return isDaytime ? 'clear-day' : 'clear-night';
}

const numberOf = (v) => {
  if (typeof v === 'number') return v;
  if (v && typeof v.value === 'number') return v.value;
  return null;
};

/**
 * Temperature-valued quantities. `units=us` converts the headline temperature
 * but NWS still returns gridded dewpoints tagged `wmoUnit:degC`, so honour the
 * unit code rather than assuming Fahrenheit.
 */
const tempOf = (v) => {
  const value = numberOf(v);
  if (value === null) return null;
  const unit = typeof v === 'object' && v !== null ? v.unitCode ?? '' : '';
  return /degC/i.test(unit) ? (value * 9) / 5 + 32 : value;
};

export async function getForecastPeriods(point) {
  const url = point.urls.forecast || `${API}/gridpoints/${point.gridId}/${point.gridX},${point.gridY}/forecast`;
  const data = await cachedJson(`fcst:${point.gridId}:${point.gridX},${point.gridY}`, 60 * 15, `${url}?units=us`);
  return (data?.properties?.periods ?? []).map((p) => ({
    number: p.number,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    isDaytime: p.isDaytime,
    temperature: p.temperature,
    temperatureUnit: p.temperatureUnit,
    precipProbability: numberOf(p.probabilityOfPrecipitation),
    dewpoint: tempOf(p.dewpoint),
    relativeHumidity: numberOf(p.relativeHumidity),
    windSpeed: p.windSpeed,
    windDirection: p.windDirection,
    shortForecast: p.shortForecast,
    detailedForecast: p.detailedForecast,
    icon: resolveIcon(p.icon, p.shortForecast, p.isDaytime),
  }));
}

export async function getHourlyPeriods(point) {
  const url =
    point.urls.forecastHourly || `${API}/gridpoints/${point.gridId}/${point.gridX},${point.gridY}/forecast/hourly`;
  const data = await cachedJson(`hourly:${point.gridId}:${point.gridX},${point.gridY}`, 60 * 15, `${url}?units=us`);
  return (data?.properties?.periods ?? []).map((p) => ({
    startTime: p.startTime,
    endTime: p.endTime,
    isDaytime: p.isDaytime,
    temperature: p.temperature,
    precipProbability: numberOf(p.probabilityOfPrecipitation),
    dewpoint: tempOf(p.dewpoint),
    relativeHumidity: numberOf(p.relativeHumidity),
    windSpeed: p.windSpeed,
    windDirection: p.windDirection,
    shortForecast: p.shortForecast,
    icon: resolveIcon(p.icon, p.shortForecast, p.isDaytime),
  }));
}

/** Raw gridpoint arrays give us sky cover, gusts and thunder potential. */
export async function getGridData(point) {
  const url = point.urls.forecastGridData || `${API}/gridpoints/${point.gridId}/${point.gridX},${point.gridY}`;
  return cachedJson(`grid:${point.gridId}:${point.gridX},${point.gridY}`, 60 * 20, url);
}

/* ------------------------------------------------------------ observations */

export async function getObservationStations(point) {
  const url =
    point.urls.observationStations || `${API}/gridpoints/${point.gridId}/${point.gridX},${point.gridY}/stations`;
  const data = await cachedJson(`stations:${point.gridId}:${point.gridX},${point.gridY}`, 60 * 60 * 6, url);
  return (data?.features ?? [])
    .map((f) => ({
      id: f.properties?.stationIdentifier,
      name: f.properties?.name,
      elevation: numberOf(f.properties?.elevation),
      lat: f.geometry?.coordinates?.[1],
      lon: f.geometry?.coordinates?.[0],
    }))
    .filter((s) => s.id);
}

const cToF = (c) => (c === null || c === undefined ? null : (c * 9) / 5 + 32);
const msToMph = (ms) => (ms === null || ms === undefined ? null : ms * 2.236936);
const mToMi = (m) => (m === null || m === undefined ? null : m / 1609.344);
const paToInHg = (pa) => (pa === null || pa === undefined ? null : pa / 3386.389);

/** Latest METAR-derived observation from an NWS station, normalised to US units. */
export async function getLatestObservation(stationId) {
  const data = await cachedJson(
    `obs:${stationId}`,
    60 * 5,
    `${API}/stations/${stationId}/observations/latest?require_qc=false`,
  );
  const p = data?.properties;
  if (!p) return null;
  const tempC = numberOf(p.temperature);
  const dewC = numberOf(p.dewpoint);
  const windChillC = numberOf(p.windChill);
  const heatIndexC = numberOf(p.heatIndex);
  const feelsC = heatIndexC ?? windChillC ?? tempC;
  const dir = numberOf(p.windDirection);
  return {
    stationId,
    observedAt: p.timestamp,
    textDescription: p.textDescription,
    temperature: cToF(tempC),
    dewpoint: cToF(dewC),
    feelsLike: cToF(feelsC),
    heatIndex: cToF(heatIndexC),
    windChill: cToF(windChillC),
    relativeHumidity: numberOf(p.relativeHumidity),
    windSpeed: msToMph(numberOf(p.windSpeed)),
    windGust: msToMph(numberOf(p.windGust)),
    windDirection: dir,
    windCompass: compassPoint(dir),
    visibility: mToMi(numberOf(p.visibility)),
    barometricPressure: paToInHg(numberOf(p.barometricPressure)),
    seaLevelPressure: paToInHg(numberOf(p.seaLevelPressure)),
    cloudLayers: (p.cloudLayers ?? []).map((l) => ({
      amount: l.amount,
      base: numberOf(l.base) === null ? null : Math.round(numberOf(l.base) * 3.28084),
    })),
    icon: resolveIcon(p.icon, p.textDescription, true),
    raw: p.rawMessage,
  };
}

/**
 * Walk the nearest stations until one returns a usable temperature. Rural
 * grids routinely have a closest station that has been offline for hours.
 */
export async function getCurrentObservation(point) {
  const stations = await getObservationStations(point);
  if (stations.length === 0) {
    throw new UpstreamError('No observation stations for this grid', { status: 404 });
  }
  for (const station of stations.slice(0, 5)) {
    try {
      const obs = await getLatestObservation(station.id);
      if (obs && obs.temperature !== null) return { ...obs, station };
    } catch {
      // Station offline - fall through to the next closest one.
    }
  }
  return null;
}

/* ------------------------------------------------------------------ alerts */

const STORM_MOTION = /([\d-]{10}T[\d:+-]+)\.\.\.storm\.\.\.(\d{1,3})DEG\.\.\.(\d{1,3})KT\.\.\.(.*)$/i;

/** Parse the `eventMotionDescription` VTEC parameter into a real storm vector. */
function parseStormMotion(parameters = {}) {
  const raw = parameters.eventMotionDescription?.[0];
  if (!raw) return null;
  const m = raw.match(STORM_MOTION);
  if (!m) return null;
  const [, observedAt, degStr, ktStr, coordStr] = m;
  const directionDeg = Number.parseInt(degStr, 10);
  const speedKt = Number.parseInt(ktStr, 10);
  // Two encodings exist in the wild: modern decimal degrees ("39.3,-112.74")
  // and legacy hundredths-of-a-degree integers ("4046 -9427 4055 -9410").
  const tokens = coordStr.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const nums = tokens.map((t) => (t.includes('.') ? Number(t) : Number(t) / 100));
  const positions = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    positions.push({ lat: nums[i], lon: nums[i + 1] });
  }
  const headingDeg = (directionDeg + 180) % 360;
  return {
    observedAt,
    // NWS reports the direction the storm is coming FROM.
    directionFromDeg: directionDeg,
    directionFrom: compassPoint(directionDeg),
    headingDeg,
    heading: compassPoint(headingDeg),
    speedKt,
    speedMph: Math.round(speedKt * 1.15078),
    positions,
    raw,
  };
}

const firstParam = (parameters, key) => parameters?.[key]?.[0] ?? null;

export function normalizeAlert(feature) {
  const p = feature?.properties;
  if (!p) return null;
  const klass = classifyEvent(p.event || '');
  const headlineText = `${p.headline || ''} ${p.description || ''}`;
  const isEmergency = /(tornado emergency|flash flood emergency|particularly dangerous situation)/i.test(headlineText);
  const params = p.parameters ?? {};
  const geometry = feature.geometry ?? null;

  return {
    id: p.id,
    event: p.event,
    headline: p.headline,
    description: p.description,
    instruction: p.instruction,
    areaDesc: p.areaDesc,
    areas: (p.areaDesc || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean),
    severity: p.severity,
    certainty: p.certainty,
    urgency: p.urgency,
    status: p.status,
    messageType: p.messageType,
    response: p.response,
    category: p.category,
    sent: p.sent,
    effective: p.effective,
    onset: p.onset,
    expires: p.expires,
    ends: p.ends || p.expires,
    senderName: p.senderName,
    office: (p.senderName || '').replace(/^NWS\s+/, ''),
    kind: klass.kind,
    group: klass.group,
    tier: isEmergency ? 'catastrophic' : klass.tier,
    rank: isEmergency ? Math.max(0, klass.rank - 5) : klass.rank,
    color: klass.color,
    isEmergency,
    ugc: params.UGC ?? p.geocode?.UGC ?? [],
    same: p.geocode?.SAME ?? [],
    affectedZones: p.affectedZones ?? [],
    nwsHeadline: firstParam(params, 'NWSheadline'),
    threats: {
      maxHailSize: firstParam(params, 'maxHailSize'),
      maxWindGust: firstParam(params, 'maxWindGust'),
      tornadoDetection: firstParam(params, 'tornadoDetection'),
      tornadoDamageThreat: firstParam(params, 'tornadoDamageThreat'),
      thunderstormDamageThreat: firstParam(params, 'thunderstormDamageThreat'),
      flashFloodDamageThreat: firstParam(params, 'flashFloodDamageThreat'),
      flashFloodDetection: firstParam(params, 'flashFloodDetection'),
      waterspoutDetection: firstParam(params, 'waterspoutDetection'),
      hailThreat: firstParam(params, 'hailThreat'),
      windThreat: firstParam(params, 'windThreat'),
    },
    storm: parseStormMotion(params),
    geometry,
    centroid: geometry ? geometryCentroid(geometry) : null,
    bounds: geometry ? geometryBounds(geometry) : null,
    vtec: params.VTEC?.[0] ?? null,
  };
}

const isLive = (a) => {
  if (!a) return false;
  if (a.status && a.status !== 'Actual') return false;
  if (a.messageType === 'Cancel') return false;
  const ends = new Date(a.ends || a.expires || 0).getTime();
  return !Number.isFinite(ends) || ends > Date.now() - 60_000;
};

/**
 * Active alerts. Accepts any of the NWS /alerts/active filters; results are
 * normalised, de-duplicated and sorted by broadcast priority.
 */
export async function getActiveAlerts(query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  const data = await cachedJson(`alerts:${qs}`, 45, `${API}/alerts/active?${qs}`);
  const seen = new Set();
  const alerts = [];
  for (const feature of data?.features ?? []) {
    const alert = normalizeAlert(feature);
    if (!alert || seen.has(alert.id) || !isLive(alert)) continue;
    seen.add(alert.id);
    alerts.push(alert);
  }
  alerts.sort((a, b) => a.rank - b.rank || new Date(b.sent) - new Date(a.sent));
  return { alerts, updatedAt: data?.updated ?? new Date().toISOString(), stale: Boolean(data?._stale) };
}

/* ------------------------------------------------------ forecast discussion */

/** Latest Area Forecast Discussion (or any text product) for an office. */
export async function getTextProduct(office, type = 'AFD') {
  const wfo = String(office || '').toUpperCase();
  const list = await cachedJson(
    `products:${type}:${wfo}`,
    60 * 10,
    `${API}/products/types/${type}/locations/${wfo}`,
  );
  const head = list?.['@graph']?.[0];
  if (!head) return null;
  const product = await cachedJson(`product:${head.id}`, 60 * 30, `${API}/products/${head.id}`);
  return {
    id: product.id,
    productCode: product.productCode,
    productName: product.productName,
    office: product.issuingOffice,
    issuedAt: product.issuanceTime,
    text: product.productText,
    recent: (list['@graph'] ?? []).slice(0, 5).map((item) => ({
      id: item.id,
      issuedAt: item.issuanceTime,
      office: item.issuingOffice,
      name: item.productName,
    })),
  };
}

export async function getProductById(id) {
  const product = await cachedJson(`product:${id}`, 60 * 60, `${API}/products/${id}`);
  return {
    id: product.id,
    productCode: product.productCode,
    productName: product.productName,
    office: product.issuingOffice,
    issuedAt: product.issuanceTime,
    text: product.productText,
  };
}

/** Recent products of a type across the whole country (used by Weather News). */
export async function listProducts(type, { limit = 20, location } = {}) {
  // This NWS build rejects a `limit` query parameter, so page client-side.
  const path = location
    ? `${API}/products/types/${type}/locations/${String(location).toUpperCase()}`
    : `${API}/products/types/${type}`;
  const list = await cachedJson(`productlist:${type}:${location ?? 'all'}`, 60 * 10, path);
  return (list?.['@graph'] ?? []).slice(0, limit).map((item) => ({
    id: item.id,
    issuedAt: item.issuanceTime,
    office: item.issuingOffice,
    name: item.productName,
    code: item.productCode,
  }));
}

/* ------------------------------------------------------------------- zones */

/** Every county zone in a state, for the county browser. */
export async function getCountyZones(state) {
  const st = String(state).toUpperCase();
  return withCache(`zones:county:${st}`, 1000 * 60 * 60 * 24, async () => {
    const data = await cachedJson(
      `zones:raw:${st}`,
      60 * 60 * 24,
      `${API}/zones?type=county&area=${st}&include_geometry=false`,
    );
    return (data?.features ?? [])
      .map((f) => {
        const p = f.properties ?? {};
        return {
          id: p.id,
          name: p.name,
          state: p.state,
          type: p.type,
          cwa: p.cwa ?? [],
          timeZone: p.timeZone?.[0],
          radarStation: p.radarStation,
        };
      })
      .filter((z) => z.id);
  });
}

export async function getZoneGeometry(zoneId) {
  const data = await cachedJson(`zone:geom:${zoneId}`, 60 * 60 * 24 * 7, `${API}/zones/county/${zoneId}`);
  const geometry = data?.geometry ?? null;
  return {
    id: data?.properties?.id ?? zoneId,
    name: data?.properties?.name,
    state: data?.properties?.state,
    cwa: data?.properties?.cwa ?? [],
    radarStation: data?.properties?.radarStation,
    geometry,
    centroid: geometry ? geometryCentroid(geometry) : null,
    bounds: geometry ? geometryBounds(geometry) : null,
  };
}

/* ---------------------------------------------------------- radar stations */

/**
 * The WSR-88D sites in this station's region.
 *
 * The NWS radar endpoint returns all 159 sites nationwide, which is noise for
 * a Middle Tennessee newsroom: nobody here needs the Alaska list in a site
 * picker. This is the network across Tennessee and its neighbours, which is
 * stable enough to state explicitly - a bounding box would sweep in halves of
 * Missouri and Virginia and still miss the point.
 *
 * Widen it with RADAR_STATES in .env.
 */
export const REGIONAL_RADAR_SITES = {
  TN: ['KOHX', 'KNQA', 'KMRX'],
  AL: ['KBMX', 'KHTX', 'KMXX', 'KEOX', 'KMOB'],
  KY: ['KLVX', 'KPAH', 'KJKL', 'KHPX'],
  AR: ['KLZK', 'KSRX'],
  NC: ['KRAX', 'KMHX', 'KLTX'],
  SC: ['KCAE', 'KCLX', 'KGSP'],
  GA: ['KFFC', 'KJGX', 'KVAX'],
};

/** Site ids the configured coverage states allow, as a lookup. */
function allowedSites() {
  const states = config.radarStates?.length ? config.radarStates : Object.keys(REGIONAL_RADAR_SITES);
  const allowed = new Map();
  for (const state of states) {
    for (const id of REGIONAL_RADAR_SITES[state] ?? []) allowed.set(id, state);
  }
  return allowed;
}

export async function getRadarStations({ all = false } = {}) {
  const stations = await withCache('radar:stations', 1000 * 60 * 60 * 12, async () => {
    const data = await cachedJson('radar:stations:raw', 60 * 60 * 12, `${API}/radar/stations?stationType=WSR-88D`);
    return (data?.features ?? [])
      .map((f) => {
        const p = f.properties ?? {};
        return {
          id: p.id,
          name: p.name,
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0],
          timeZone: p.timeZone,
          mode: p.rda?.properties?.volumeCoveragePatternDescription ?? null,
          status: p.rda?.properties?.operabilityStatus ?? null,
          lastReceived: p.latency?.levelTwoLastReceivedTime ?? null,
        };
      })
      .filter((s) => s.id && Number.isFinite(s.lat));
  });

  if (all) return stations;

  // Regional by default: the site picker and the nearest-site lookup should
  // only ever offer radars this newsroom would actually put on air.
  const allowed = allowedSites();
  return stations
    .filter((s) => allowed.has(s.id))
    .map((s) => ({ ...s, state: allowed.get(s.id) }));
}

export { API as NWS_API };
