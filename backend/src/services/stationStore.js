import crypto from 'node:crypto';
import config from '../config.js';

/**
 * STATION STORE
 *
 * The newsroom's own settings: station identity, closings, viewer alerts, the
 * graphics rundown and the graphic on program.
 *
 * The state lives in memory and is handed to a persistence adapter on every
 * commit. On Workers that adapter is the Newsroom Durable Object, which owns
 * the only writable copy; nothing here knows or cares where it is stored.
 *
 * Anything the admin panel saves here overlays the .env defaults. Because the
 * rest of the backend imports the `config` singleton directly, the overlay is
 * applied onto that same object - so a saved change takes effect on the next
 * request everywhere, with no restart and no rewiring of every call site.
 */

const EMPTY = {
  station: null,
  defaultLocation: null,
  defaultRadarSite: null,
  coverageStates: null,
  tickerMarkets: null,
  sponsor: null,
  liveStream: null,
  /** Live on-air control: a manual takeover and a forced radar site. */
  onAir: { takeover: null, forcedRadarSite: null, pinnedStoryId: null },
  closings: [],
  stationAlerts: [],
  graphics: [],
  /** The graphic on program, frozen at the moment it was taken. */
  program: null,
};

let state = structuredClone(EMPTY);

/* ------------------------------------------------------- persistence */

/**
 * Where a commit goes. The host installs this: the Durable Object writes to
 * its own storage, and a read-only copy of the store (an API worker serving a
 * request) installs nothing and simply never persists.
 */
let persist = () => {};

export function configureStore({ persist: writer } = {}) {
  persist = typeof writer === 'function' ? writer : () => {};
}

/** Load a snapshot over the current state - the start of every request. */
export function hydrateStore(snapshot) {
  state = { ...structuredClone(EMPTY), ...(snapshot ?? {}) };
  pruneExpired();
  applyOverrides();
  return state;
}

/* --------------------------------------------------------------- overlays */

/**
 * Baseline straight from the environment. Computed on demand rather than
 * captured once: a Worker isolate evaluates this module before its bindings
 * are necessarily readable, so a snapshot taken here could be all defaults.
 */
const baseline = () => ({
  station: { name: 'STORM 12 WEATHER', shortName: 'Storm 12', market: config.defaultLocation.name },
  defaultLocation: { ...config.defaultLocation },
  defaultRadarSite: config.defaultRadarSite,
  coverageStates: [...config.coverageStates],
  tickerMarkets: config.tickerMarkets.map((m) => ({ ...m })),
  sponsor: { ...config.sponsor },
  liveStream: { ...config.liveStream },
});

/**
 * Push the saved overlay onto the live config singleton. Only keys the
 * newsroom has actually set are overridden; everything else stays on .env.
 */
function applyOverrides() {
  config.defaultLocation = { ...baseline().defaultLocation, ...(state.defaultLocation ?? {}) };
  config.defaultRadarSite = (state.defaultRadarSite || baseline().defaultRadarSite).toUpperCase();
  config.coverageStates = (state.coverageStates?.length ? state.coverageStates : baseline().coverageStates).map((s) =>
    s.toUpperCase(),
  );
  config.tickerMarkets = state.tickerMarkets?.length ? state.tickerMarkets : baseline().tickerMarkets;
  config.sponsor = { ...baseline().sponsor, ...(state.sponsor ?? {}) };
  config.liveStream = { ...baseline().liveStream, ...(state.liveStream ?? {}) };
}

/** Kept for callers that only need the overlay applied to a fresh state. */
export function loadStore() {
  return hydrateStore(state);
}

export const getStore = () => state;

/** The station identity the client bootstraps from. */
export const getStationIdentity = () => ({ ...baseline().station, ...(state.station ?? {}) });

export const getBaseline = () => baseline();

function commit() {
  applyOverrides();
  persist(state);
  return state;
}

/* ------------------------------------------------------------- validation */

const num = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

/** Coordinates have to be real, or every downstream forecast call 400s. */
function validPoint(lat, lon) {
  const la = num(lat);
  const lo = num(lon);
  if (la === null || lo === null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

/* ----------------------------------------------------------- station settings */

export function saveStation(patch) {
  const errors = [];

  if (patch.station) {
    state.station = {
      ...getStationIdentity(),
      name: text(patch.station.name, 60) || baseline().station.name,
      shortName: text(patch.station.shortName, 12) || baseline().station.shortName,
      market: text(patch.station.market, 80) || baseline().station.market,
    };
  }

  if (patch.defaultLocation) {
    const point = validPoint(patch.defaultLocation.lat, patch.defaultLocation.lon);
    if (!point) errors.push('Default location needs a valid latitude and longitude.');
    else {
      state.defaultLocation = { ...point, name: text(patch.defaultLocation.name, 80) || baseline().defaultLocation.name };
    }
  }

  if (patch.defaultRadarSite !== undefined) {
    // Validate the value as typed. Truncating first would quietly turn a
    // wrong id like "TOOLONG" into a valid-looking "TOOL".
    const site = String(patch.defaultRadarSite ?? '').trim().toUpperCase();
    if (site && !/^[A-Z]{3,4}$/.test(site)) errors.push('Radar site must be a 3-4 letter NEXRAD id, e.g. KOHX.');
    else state.defaultRadarSite = site || null;
  }

  if (patch.coverageStates !== undefined) {
    const states = (Array.isArray(patch.coverageStates) ? patch.coverageStates : [])
      .map((s) => text(s, 2).toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
    if (!states.length) errors.push('Pick at least one coverage state.');
    else state.coverageStates = [...new Set(states)];
  }

  if (patch.sponsor !== undefined) {
    state.sponsor = { name: text(patch.sponsor?.name, 60), tagline: text(patch.sponsor?.tagline, 120) };
  }

  if (patch.liveStream !== undefined) {
    const url = text(patch.liveStream?.url, 500);
    if (url && !/^https?:\/\//i.test(url)) errors.push('Live stream URL must start with http:// or https://');
    else state.liveStream = { url, type: text(patch.liveStream?.type, 12) || 'hls' };
  }

  if (errors.length) return { ok: false, errors };
  commit();
  return { ok: true, state };
}

/* --------------------------------------------------------- ticker markets */

export function saveMarkets(markets) {
  if (!Array.isArray(markets) || markets.length === 0) {
    return { ok: false, errors: ['The ticker needs at least one market.'] };
  }
  if (markets.length > 16) {
    return { ok: false, errors: ['Sixteen markets is the most the crawl can carry legibly.'] };
  }

  const cleaned = [];
  for (const [i, entry] of markets.entries()) {
    const name = text(entry?.name, 40);
    const point = validPoint(entry?.lat, entry?.lon);
    if (!name) return { ok: false, errors: [`Market ${i + 1} needs a name.`] };
    if (!point) return { ok: false, errors: [`${name} needs a valid latitude and longitude.`] };
    cleaned.push({ name, ...point });
  }

  state.tickerMarkets = cleaned;
  commit();
  return { ok: true, state };
}

/* ------------------------------------------------------------ on-air control */

export function saveOnAir(patch) {
  const current = state.onAir ?? structuredClone(EMPTY.onAir);

  if (patch.takeover === null || patch.takeover === false) {
    current.takeover = null;
  } else if (patch.takeover) {
    const headline = text(patch.takeover.headline, 120);
    if (!headline) return { ok: false, errors: ['A takeover needs a headline.'] };
    current.takeover = {
      id: `onair-${Date.now()}`,
      headline,
      detail: text(patch.takeover.detail, 400),
      tier: ['catastrophic', 'severe', 'moderate'].includes(patch.takeover.tier) ? patch.takeover.tier : 'severe',
      startedAt: new Date().toISOString(),
      expiresAt: patch.takeover.expiresAt ? new Date(patch.takeover.expiresAt).toISOString() : null,
    };
  }

  if (patch.forcedRadarSite !== undefined) {
    const site = text(patch.forcedRadarSite, 4).toUpperCase();
    current.forcedRadarSite = site || null;
  }
  if (patch.pinnedStoryId !== undefined) {
    current.pinnedStoryId = text(patch.pinnedStoryId, 200) || null;
  }

  state.onAir = current;
  commit();
  return { ok: true, state };
}

export function getOnAir() {
  const onAir = state.onAir ?? structuredClone(EMPTY.onAir);
  // An expired takeover is simply no longer on air.
  if (onAir.takeover?.expiresAt && new Date(onAir.takeover.expiresAt).getTime() < Date.now()) {
    return { ...onAir, takeover: null };
  }
  return onAir;
}

/* --------------------------------------------------------- school closings */

export const CLOSING_STATUSES = [
  { id: 'closed', label: 'Closed' },
  { id: 'delayed', label: 'Delayed Opening' },
  { id: 'early', label: 'Closing Early' },
  { id: 'virtual', label: 'Virtual / Remote Day' },
  { id: 'open', label: 'Open as Normal' },
];

export function saveClosing(entry) {
  const name = text(entry?.name, 120);
  if (!name) return { ok: false, errors: ['A closing needs the name of the school or district.'] };
  const status = CLOSING_STATUSES.some((s) => s.id === entry?.status) ? entry.status : 'closed';

  const record = {
    id: entry?.id || `closing-${crypto.randomUUID()}`,
    name,
    status,
    detail: text(entry?.detail, 200),
    county: text(entry?.county, 60),
    updatedAt: new Date().toISOString(),
  };

  // A district that calls back with an update replaces its earlier entry:
  // the same school must never appear twice in the on-air list.
  const existing = state.closings.findIndex(
    (c) => c.id === record.id || c.name.trim().toLowerCase() === record.name.trim().toLowerCase(),
  );
  if (existing >= 0) state.closings[existing] = { ...record, id: state.closings[existing].id };
  else state.closings.unshift(record);

  commit();
  return { ok: true, closing: record };
}

export function deleteClosing(id) {
  const before = state.closings.length;
  state.closings = state.closings.filter((c) => c.id !== id);
  commit();
  return { ok: state.closings.length < before };
}

export function clearClosings() {
  state.closings = [];
  commit();
  return { ok: true };
}

export const getClosings = () => state.closings;

/* ---------------------------------------------------------- station alerts */

/**
 * A station-issued alert. This is the newsroom speaking directly to viewers -
 * it is deliberately kept separate from NWS products so nothing the station
 * writes can ever be mistaken for an official government warning.
 */
export function saveStationAlert(entry) {
  const headline = text(entry?.headline, 140);
  if (!headline) return { ok: false, errors: ['A viewer alert needs a headline.'] };

  const severity = ['critical', 'important', 'info'].includes(entry?.severity) ? entry.severity : 'important';
  const minutes = Number.parseInt(entry?.durationMinutes, 10);
  const ttl = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 24 * 60) : 120;

  const record = {
    id: entry?.id || `station-${crypto.randomUUID()}`,
    headline,
    body: text(entry?.body, 800),
    severity,
    areas: text(entry?.areas, 300),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 60000).toISOString(),
    source: 'station',
  };

  const existing = state.stationAlerts.findIndex((a) => a.id === record.id);
  if (existing >= 0) state.stationAlerts[existing] = record;
  else state.stationAlerts.unshift(record);

  commit();
  return { ok: true, alert: record };
}

export function expireStationAlert(id) {
  const alert = state.stationAlerts.find((a) => a.id === id);
  if (alert) alert.expiresAt = new Date().toISOString();
  commit();
  return { ok: Boolean(alert) };
}

export function deleteStationAlert(id) {
  state.stationAlerts = state.stationAlerts.filter((a) => a.id !== id);
  commit();
  return { ok: true };
}

/** Only alerts that are still in force - expiry is enforced on read. */
export function getActiveStationAlerts() {
  const now = Date.now();
  return state.stationAlerts.filter((a) => new Date(a.expiresAt).getTime() > now);
}

export const getAllStationAlerts = () => state.stationAlerts;

const STATION_SEVERITY = {
  critical: { kind: 'warning', tier: 'severe', color: '#E01B24', rank: 25, label: 'Weather Alert' },
  important: { kind: 'advisory', tier: 'moderate', color: '#FFB800', rank: 55, label: 'Weather Bulletin' },
  info: { kind: 'statement', tier: 'minor', color: '#00B4E6', rank: 85, label: 'Weather Update' },
};

/**
 * Present a station alert in the same shape as an NWS product, so the banner,
 * the ticker and the notification path need no special case for it.
 *
 * `source` and `senderName` stay explicit, and the event name always carries
 * the station's own call sign: nothing the newsroom writes should ever be
 * mistakable for an official National Weather Service warning.
 */
export function toWeatherAlert(record) {
  const style = STATION_SEVERITY[record.severity] ?? STATION_SEVERITY.important;
  const identity = getStationIdentity();

  return {
    id: record.id,
    event: `${identity.shortName} ${style.label}`,
    headline: record.headline,
    description: record.body || null,
    instruction: null,
    areaDesc: record.areas || identity.market,
    areas: record.areas ? record.areas.split(/\s*[;,]\s*/).filter(Boolean) : [],
    severity: record.severity === 'critical' ? 'Severe' : 'Moderate',
    certainty: 'Observed',
    urgency: record.severity === 'critical' ? 'Immediate' : 'Expected',
    status: 'Actual',
    messageType: 'Alert',
    response: 'Monitor',
    category: 'Met',
    sent: record.issuedAt,
    effective: record.issuedAt,
    onset: record.issuedAt,
    expires: record.expiresAt,
    ends: record.expiresAt,
    senderName: identity.name,
    office: identity.shortName,
    kind: style.kind,
    group: 'other',
    tier: style.tier,
    rank: style.rank,
    color: style.color,
    isEmergency: false,
    ugc: [],
    same: [],
    nwsHeadline: null,
    threats: {},
    storm: null,
    geometry: null,
    centroid: null,
    bounds: null,
    vtec: null,
    source: 'station',
  };
}

/** Active station alerts, already in NWS-product shape. */
export const getStationWeatherAlerts = () => getActiveStationAlerts().map(toWeatherAlert);

/* --------------------------------------------------------------- graphics */

export function saveGraphic(entry) {
  const name = text(entry?.name, 80);
  if (!name) return { ok: false, errors: ['Name this graphic so the newsroom can find it again.'] };

  const record = {
    id: entry?.id || `gfx-${crypto.randomUUID()}`,
    name,
    template: text(entry?.template, 40) || 'conditions',
    fields: typeof entry?.fields === 'object' && entry.fields ? entry.fields : {},
    updatedAt: new Date().toISOString(),
  };

  const existing = state.graphics.findIndex((g) => g.id === record.id);
  if (existing >= 0) state.graphics[existing] = record;
  else state.graphics.unshift(record);

  commit();
  return { ok: true, graphic: record };
}

export function deleteGraphic(id) {
  state.graphics = state.graphics.filter((g) => g.id !== id);
  commit();
  return { ok: true };
}

export const getGraphics = () => state.graphics;

/* ---------------------------------------------------------------- program */

const PROGRAM_TEMPLATES = [
  'conditions',
  'hourly',
  'planner',
  'sevenday',
  'areatemps',
  'severe',
  'weatherday',
  'heatindex',
  'compare',
  'alertmap',
  'spcmap',
  'headlines',
  'quote',
  'alert',
  'ltconditions',
  'bug',
];

const hexColor = (value) => (/^#[0-9a-f]{3,8}$/i.test(String(value ?? '')) ? String(value) : '#3a4656');

/**
 * Take a graphic to air, or clear it with null.
 *
 * The studio sends a complete snapshot - resolved values, not live-data
 * references - because playout must show exactly what the operator saw in
 * preview when they pressed Take, not whatever the feed says a minute later.
 */
export function setProgram(payload) {
  if (payload === null || payload === undefined) {
    state.program = null;
    commit();
    return { ok: true, program: null };
  }
  if (!PROGRAM_TEMPLATES.includes(payload.template)) {
    return { ok: false, errors: ['That graphic template does not exist.'] };
  }

  const fields = {};
  for (const [key, value] of Object.entries(payload.fields ?? {}).slice(0, 24)) {
    fields[text(key, 32)] = text(value, 300);
  }
  const days = (Array.isArray(payload.days) ? payload.days : []).slice(0, 7).map((day) => ({
    date: text(day?.date, 32),
    icon: text(day?.icon, 40),
    high: num(day?.high),
    low: num(day?.low),
    feelsHigh: num(day?.feelsHigh),
    precipProbability: num(day?.precipProbability),
  }));

  const hours = (Array.isArray(payload.hours) ? payload.hours : []).slice(0, 24).map((hour) => ({
    time: text(hour?.time, 40),
    label: text(hour?.label, 12),
    hour: num(hour?.hour) ?? 0,
    dayLabel: text(hour?.dayLabel, 16),
    icon: text(hour?.icon, 40),
    temp: num(hour?.temp),
    precip: num(hour?.precip),
    condition: text(hour?.condition, 60),
  }));
  const places = (Array.isArray(payload.places) ? payload.places : [])
    .slice(0, 16)
    .map((place) => ({
      name: text(place?.name, 40),
      lat: num(place?.lat),
      lon: num(place?.lon),
      temp: num(place?.temp),
      feels: num(place?.feels),
      icon: text(place?.icon, 40),
    }))
    .filter((place) => place.name && place.lat !== null && place.lon !== null);
  // One entry per county under an alert - a statewide event is a few hundred.
  const areas = (Array.isArray(payload.areas) ? payload.areas : []).slice(0, 400).map((area) => ({
    id: text(area?.id, 8),
    label: text(area?.label, 60),
    color: hexColor(area?.color),
    rank: num(area?.rank) ?? 99,
  }));
  // Risk polygons, already simplified by the studio. Capped so one graphic
  // cannot fill the newsroom's storage with continental geometry.
  const outlook = (Array.isArray(payload.outlook) ? payload.outlook : []).slice(0, 8).map((shape) => ({
    level: num(shape?.level) ?? 0,
    label: text(shape?.label, 40),
    color: hexColor(shape?.color),
    rings: (Array.isArray(shape?.rings) ? shape.rings : []).slice(0, 12).map((ring) =>
      (Array.isArray(ring) ? ring : [])
        .slice(0, 600)
        .map((pt) => [num(pt?.[0]) ?? 0, num(pt?.[1]) ?? 0]),
    ),
  }));
  const outlooks = (Array.isArray(payload.outlooks) ? payload.outlooks : []).slice(0, 3).map((outlook) => ({
    day: text(outlook?.day, 8),
    label: text(outlook?.label, 60),
    level: num(outlook?.level) ?? -1,
    color: hexColor(outlook?.color),
  }));

  state.program = {
    id: `pgm-${Date.now()}`,
    name: text(payload.name, 80) || payload.template,
    sourceId: text(payload.sourceId, 80),
    template: payload.template,
    fields,
    days,
    hours,
    places,
    outlooks,
    areas,
    outlook,
    icon: text(payload.icon, 40) || 'cloudy',
    stamp: text(payload.stamp, 60),
    station: text(payload.station, 60) || getStationIdentity().name,
    market: text(payload.market, 80) || getStationIdentity().market,
    takenAt: new Date().toISOString(),
  };
  commit();
  return { ok: true, program: state.program };
}

export const getProgram = () => state.program ?? null;

/* ---------------------------------------------------------------- upkeep */

/** Drop anything that has aged out, so the file does not grow forever. */
export function pruneExpired() {
  const now = Date.now();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  state.stationAlerts = (state.stationAlerts ?? []).filter((a) => new Date(a.expiresAt).getTime() > cutoff);
  state.closings = (state.closings ?? []).filter((c) => new Date(c.updatedAt).getTime() > cutoff);
}

export default { loadStore, getStore };
