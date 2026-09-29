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
  /** The video library. The files live in R2; only the card lives here. */
  videos: [],
  /** Blog posts, newest first once published. */
  posts: [],
  /** Uploaded stills, referenced by posts. The bytes are in R2. */
  media: [],
  /** Browsers that asked to be told. Endpoint only - see worker/push.js. */
  pushSubs: [],
  /** What has been sent, newest first. The service worker reads the top one. */
  notices: [],
  /** Alert ids already pushed, so a running warning is announced once. */
  notified: [],
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

  // Taking to air checks the template; saving has to check it too, or a
  // rundown built before a template was retired keeps a dead item in it.
  const template = text(entry?.template, 40);
  if (template && !PROGRAM_TEMPLATES.includes(template)) {
    return { ok: false, errors: ['That graphic template does not exist.'] };
  }

  const record = {
    id: entry?.id || `gfx-${crypto.randomUUID()}`,
    name,
    template: template || PROGRAM_TEMPLATES[0],
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

/* ----------------------------------------------------------------- video */

/**
 * A clip in the library.
 *
 * The file itself is in R2 and is never touched here - this is the card that
 * describes it: what it is called, where its bytes are, and when it went up.
 * The two keys are written by the upload route once the object is complete,
 * so a record here always points at something that exists.
 */
export function saveVideo(entry) {
  const title = text(entry?.title, 120);
  if (!title) return { ok: false, errors: ['Give the video a title so the newsroom can find it.'] };

  const key = text(entry?.key, 200);
  if (!key) return { ok: false, errors: ['A video record needs the key of its stored file.'] };

  const existing = state.videos.find((v) => v.id === entry?.id);
  const record = {
    id: entry?.id || `vid-${crypto.randomUUID()}`,
    title,
    description: text(entry?.description, 600),
    key,
    posterKey: text(entry?.posterKey, 200) || existing?.posterKey || null,
    contentType: text(entry?.contentType, 80) || 'video/mp4',
    size: Number.isFinite(Number(entry?.size)) ? Math.max(0, Math.round(Number(entry.size))) : 0,
    durationSeconds: Number.isFinite(Number(entry?.durationSeconds))
      ? Math.max(0, Math.round(Number(entry.durationSeconds)))
      : null,
    publishedAt: existing?.publishedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const at = state.videos.findIndex((v) => v.id === record.id);
  if (at >= 0) state.videos[at] = record;
  else state.videos.unshift(record);

  commit();
  return { ok: true, video: record };
}

/**
 * Rename or re-describe a clip without touching its bytes.
 *
 * The merge happens in here rather than in the route because the route reads
 * a snapshot that can be a couple of seconds old; the Durable Object holds
 * the only copy that is certainly current.
 */
export function updateVideo(id, patch) {
  const video = state.videos.find((v) => v.id === id);
  if (!video) return { ok: false, errors: ['That video is not in the library.'] };

  if (patch?.title !== undefined) {
    const title = text(patch.title, 120);
    if (!title) return { ok: false, errors: ['A video needs a title.'] };
    video.title = title;
  }
  if (patch?.description !== undefined) video.description = text(patch.description, 600);
  video.updatedAt = new Date().toISOString();

  commit();
  return { ok: true, video };
}

/** Point a clip at its poster frame, handing back the one it replaces. */
export function attachPoster(id, key) {
  const video = state.videos.find((v) => v.id === id);
  if (!video) return { ok: false, errors: ['That video is not in the library.'] };

  const previousPosterKey = video.posterKey ?? null;
  video.posterKey = text(key, 200) || null;
  video.updatedAt = new Date().toISOString();

  commit();
  return { ok: true, video, previousPosterKey };
}

export function deleteVideo(id) {
  const record = state.videos.find((v) => v.id === id) ?? null;
  state.videos = state.videos.filter((v) => v.id !== id);
  commit();
  // The caller needs the keys back: the card is gone from the newsroom, but
  // the bytes are still sitting in the bucket until somebody removes them.
  return { ok: true, video: record };
}

/** Newest first, which is the only order a video library is ever read in. */
export const getVideos = () =>
  [...state.videos].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

/* ------------------------------------------------------------- the blog */

/**
 * An uploaded still.
 *
 * Images are registered here rather than addressed by their bucket key, so a
 * post can reference one by id and the key never has to appear in a page or
 * a URL. It also means the same still can lead two posts without being
 * uploaded twice.
 */
export function saveMedia(entry) {
  const key = text(entry?.key, 200);
  if (!key) return { ok: false, errors: ['A media record needs the key of its stored file.'] };

  const record = {
    id: entry?.id || `img-${crypto.randomUUID()}`,
    key,
    contentType: text(entry?.contentType, 80) || 'image/jpeg',
    size: Number.isFinite(Number(entry?.size)) ? Math.max(0, Math.round(Number(entry.size))) : 0,
    uploadedAt: new Date().toISOString(),
  };

  state.media.unshift(record);
  commit();
  return { ok: true, media: record };
}

export const getMedia = () => state.media;
export const findMedia = (id) => state.media.find((m) => m.id === id) ?? null;

/** A title turned into something that can live in a URL. */
function slugify(value, fallback) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

const BLOCK_TYPES = ['text', 'heading', 'image', 'video'];

/**
 * The body of a post, as ordered blocks rather than markup.
 *
 * Blocks instead of HTML or markdown on purpose: the page renders each one as
 * a React element, so there is no markup to sanitise and no path by which
 * anything typed into the editor can become live HTML on the public site.
 */
function cleanBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .slice(0, 80)
    .map((block) => {
      const type = BLOCK_TYPES.includes(block?.type) ? block.type : 'text';
      const base = { id: text(block?.id, 60) || `blk-${crypto.randomUUID()}`, type };
      if (type === 'image') {
        return { ...base, mediaId: text(block?.mediaId, 60), caption: text(block?.caption, 240) };
      }
      if (type === 'video') {
        return { ...base, videoId: text(block?.videoId, 60), caption: text(block?.caption, 240) };
      }
      return { ...base, value: text(block?.value, type === 'heading' ? 160 : 4000) };
    })
    // A block with nothing in it is an editing artefact, not content.
    .filter((block) =>
      block.type === 'image' ? block.mediaId : block.type === 'video' ? block.videoId : block.value,
    );
}

export function savePost(entry) {
  const title = text(entry?.title, 160);
  if (!title) return { ok: false, errors: ['Give the post a title.'] };

  const existing = state.posts.find((p) => p.id === entry?.id) ?? null;
  const id = existing?.id || `post-${crypto.randomUUID()}`;
  const wanted = slugify(entry?.slug || title, id);
  // Two posts cannot share a URL, so a repeat gets the id stitched on.
  const clash = state.posts.some((p) => p.slug === wanted && p.id !== id);
  const published = entry?.status === 'published';

  const record = {
    id,
    slug: clash ? `${wanted}-${id.slice(-6)}` : wanted,
    title,
    summary: text(entry?.summary, 400),
    heroMediaId: text(entry?.heroMediaId, 60) || null,
    blocks: cleanBlocks(entry?.blocks),
    status: published ? 'published' : 'draft',
    // First publish stamps the date; editing a live post does not move it.
    publishedAt: published ? existing?.publishedAt ?? new Date().toISOString() : null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const at = state.posts.findIndex((p) => p.id === id);
  if (at >= 0) state.posts[at] = record;
  else state.posts.unshift(record);

  commit();
  // Editing a live post must not buzz everybody again, so the caller is told
  // whether this is the moment it went public.
  return { ok: true, post: record, firstPublish: published && !existing?.publishedAt };
}

export function deletePost(id) {
  const post = state.posts.find((p) => p.id === id) ?? null;
  state.posts = state.posts.filter((p) => p.id !== id);

  // Stills this post used, that no surviving post uses, are now unreachable.
  let orphaned = [];
  if (post) {
    const used = new Set(
      state.posts.flatMap((p) => [p.heroMediaId, ...p.blocks.map((b) => b.mediaId)]).filter(Boolean),
    );
    const mine = [post.heroMediaId, ...post.blocks.map((b) => b.mediaId)].filter(Boolean);
    const drop = new Set(mine.filter((mediaId) => !used.has(mediaId)));
    orphaned = state.media.filter((m) => drop.has(m.id));
    state.media = state.media.filter((m) => !drop.has(m.id));
  }

  commit();
  return { ok: true, post, orphaned };
}

/** Everything, drafts included - the newsroom's own view. */
export const getPosts = () =>
  [...state.posts].sort((a, b) =>
    String(b.publishedAt ?? b.updatedAt).localeCompare(String(a.publishedAt ?? a.updatedAt)),
  );

/** Only what has actually been published, which is all a viewer may see. */
export const getPublishedPosts = () => getPosts().filter((p) => p.status === 'published');

export const findPost = (slug) => getPublishedPosts().find((p) => p.slug === slug) ?? null;

/* --------------------------------------------------------- notifications */

/**
 * A browser that wants to be told.
 *
 * Only the endpoint is kept. A payload-less push needs nothing else, so the
 * station never holds the key material that would let it encrypt to somebody
 * else's browser - there is nothing here worth stealing.
 */
export function addPushSub(endpoint) {
  const url = text(endpoint, 500);
  if (!/^https:\/\//.test(url)) return { ok: false, errors: ['That is not a push endpoint.'] };

  // Re-subscribing is normal: a browser hands back the same endpoint every
  // time until it is revoked.
  if (!state.pushSubs.some((s) => s.endpoint === url)) {
    state.pushSubs.push({ endpoint: url, createdAt: new Date().toISOString() });
    commit();
  }
  return { ok: true, count: state.pushSubs.length };
}

export function removePushSubs(endpoints) {
  const drop = new Set((Array.isArray(endpoints) ? endpoints : [endpoints]).filter(Boolean));
  if (!drop.size) return { ok: true, count: state.pushSubs.length };
  const before = state.pushSubs.length;
  state.pushSubs = state.pushSubs.filter((s) => !drop.has(s.endpoint));
  if (state.pushSubs.length !== before) commit();
  return { ok: true, count: state.pushSubs.length };
}

export const getPushSubs = () => state.pushSubs;

/**
 * Record something worth telling people about.
 *
 * The notice is written before anything is pushed, because the push carries
 * no payload: the service worker wakes up and asks what happened, and the
 * answer has to already be here when it does.
 */
export function addNotice(entry) {
  const title = text(entry?.title, 120);
  if (!title) return { ok: false, errors: ['A notice needs a title.'] };

  const notice = {
    id: entry?.id || `note-${crypto.randomUUID()}`,
    kind: ['alert', 'post', 'video'].includes(entry?.kind) ? entry.kind : 'post',
    title,
    body: text(entry?.body, 300),
    url: text(entry?.url, 300) || '/',
    sentAt: new Date().toISOString(),
  };

  state.notices.unshift(notice);
  // A rolling window: nobody reads back through a notification history, and
  // the newsroom record is not the place to keep one.
  state.notices = state.notices.slice(0, 30);
  commit();
  return { ok: true, notice };
}

export const getNotices = () => state.notices;
export const getLatestNotice = () => state.notices[0] ?? null;

/** Have we already announced this alert? */
export const wasNotified = (id) => state.notified.includes(id);

export function markNotified(ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((id) => text(id, 200)).filter(Boolean);
  if (!list.length) return { ok: true };
  // Newest at the front, capped: an alert that has aged out of this list has
  // long since expired, so it cannot be announced twice.
  state.notified = [...list, ...state.notified.filter((id) => !list.includes(id))].slice(0, 400);
  commit();
  return { ok: true };
}

/* ---------------------------------------------------------------- program */

const PROGRAM_TEMPLATES = [
  'twopanel',
  'hourstrip',
  'raintiming',
  'threeperiod',
  'records',
  'activity',
  'kids',
  'areatemps',
  'heatindex',
  'alertmap',
  'spcmap',
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
