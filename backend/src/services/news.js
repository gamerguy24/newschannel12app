import config from '../config.js';
import { cachedText } from '../lib/http.js';
import { getActiveAlerts, getForecastPeriods, getPoint, getTextProduct, listProducts, getProductById } from './nws.js';
import { getMesoscaleDiscussions, getOutlookSummary, getStormReports, parseRssItems, stripHtml } from './spc.js';
import { getActiveStorms, getTropicalOutlook } from './nhc.js';

/**
 * STORM 12 WEATHER NEWS
 *
 * Every story here is generated from a live official product - an NWS warning,
 * an SPC outlook, an NHC advisory, a forecast discussion. Nothing is written
 * ahead of time and nothing is placeholder copy: if a source has no story to
 * tell right now, that category simply comes back empty.
 */

export const NEWS_CATEGORIES = [
  { id: 'breaking', label: 'Breaking Weather', accent: '#FF1B1B' },
  { id: 'severe', label: 'Severe Weather', accent: '#FFA200' },
  { id: 'local', label: 'Local Weather', accent: '#00A3E0' },
  { id: 'tropical', label: 'Tropical', accent: '#B21E7B' },
  { id: 'forecast', label: 'Forecast', accent: '#22C55E' },
  { id: 'safety', label: 'Weather Safety', accent: '#7B68EE' },
];

const NWS_HEADLINE_RSS = 'https://www.weather.gov/rss_page.php?site_name=nws';
const GOES_CONUS = 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/latest.jpg';
const GOES_SECTOR = (sector) => `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${sector}/GEOCOLOR/latest.jpg`;

/**
 * Thumbnails are either a real NOAA image or a named original graphic the
 * frontend renders as SVG - never a stock photo we do not own.
 */
const graphic = (variant) => ({ kind: 'graphic', variant });
const photo = (url, alt) => ({ kind: 'image', url, alt });

const summarize = (text, max = 320) => {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') || max)}...`;
};

const story = (s) => ({
  id: s.id,
  category: s.category,
  headline: s.headline,
  summary: s.summary,
  publishedAt: s.publishedAt ?? new Date().toISOString(),
  source: s.source,
  thumbnail: s.thumbnail,
  body: s.body ?? null,
  link: s.link ?? null,
  priority: s.priority ?? 50,
  meta: s.meta ?? null,
});

/* ------------------------------------------------------------- categories */

async function breakingStories(area) {
  const { alerts } = await getActiveAlerts({ area });
  return alerts
    .filter((a) => a.kind === 'warning' && (a.tier === 'catastrophic' || a.tier === 'severe'))
    .slice(0, 8)
    .map((a) =>
      story({
        id: `alert:${a.id}`,
        category: 'breaking',
        headline: a.isEmergency ? `${a.event.toUpperCase()} - ${a.areas[0] ?? ''}`.trim() : `${a.event} issued for ${a.areas.slice(0, 3).join(', ')}`,
        summary: summarize(a.headline || a.description),
        body: [a.description, a.instruction].filter(Boolean).join('\n\n'),
        publishedAt: a.sent,
        source: `NWS ${a.office}`,
        thumbnail: graphic(a.group === 'tornado' ? 'tornado' : a.group === 'flood' ? 'flood' : 'severe'),
        priority: a.rank,
        meta: { event: a.event, expires: a.ends, areas: a.areas, color: a.color, tier: a.tier },
      }),
    );
}

async function severeStories() {
  const stories = [];
  const [outlooks, discussions, reports] = await Promise.allSettled([
    getOutlookSummary(),
    getMesoscaleDiscussions(),
    getStormReports('today'),
  ]);

  if (outlooks.status === 'fulfilled') {
    for (const day of outlooks.value) {
      if (!day.available || !day.maxRisk || (day.maxRisk.level ?? 0) < 1) continue;
      const dayNumber = day.day.replace('day', '');
      stories.push(
        story({
          id: `spc:${day.day}:${day.maxRisk.ISSUE ?? ''}`,
          category: 'severe',
          headline: `SPC Day ${dayNumber}: ${day.maxRisk.LABEL2 ?? day.maxRisk.label} of Severe Storms`,
          summary: `The Storm Prediction Center has issued a ${(day.maxRisk.LABEL2 ?? day.maxRisk.label).toLowerCase()} for Day ${dayNumber}, valid ${formatWindow(day.maxRisk.VALID_ISO, day.maxRisk.EXPIRE_ISO)}. Forecaster: ${day.maxRisk.FORECASTER ?? 'SPC'}.`,
          publishedAt: day.maxRisk.ISSUE_ISO ?? new Date().toISOString(),
          source: 'NOAA Storm Prediction Center',
          thumbnail: graphic('severe'),
          link: day.url,
          priority: 10 - (day.maxRisk.level ?? 0),
          meta: { risk: day.maxRisk.label, level: day.maxRisk.level, color: day.maxRisk.color },
        }),
      );
    }
  }

  if (discussions.status === 'fulfilled') {
    for (const md of discussions.value.slice(0, 4)) {
      stories.push(
        story({
          id: `md:${md.link ?? md.title}`,
          category: 'severe',
          headline: md.title,
          summary: summarize(md.description),
          body: md.description,
          publishedAt: md.pubDate ? new Date(md.pubDate).toISOString() : null,
          source: 'NOAA Storm Prediction Center',
          thumbnail: graphic('radar'),
          link: md.link,
          priority: 20,
        }),
      );
    }
  }

  if (reports.status === 'fulfilled' && reports.value.reports.length) {
    const c = reports.value.counts;
    stories.push(
      story({
        id: `reports:${reports.value.day}`,
        category: 'severe',
        headline: `${c.tornado + c.wind + c.hail} Storm Reports Logged Today`,
        summary: `Storm spotters and the public have reported ${c.tornado} tornado${c.tornado === 1 ? '' : 'es'}, ${c.wind} damaging wind event${c.wind === 1 ? '' : 's'} and ${c.hail} hail report${c.hail === 1 ? '' : 's'} nationwide so far today.`,
        source: 'NOAA Storm Prediction Center',
        thumbnail: graphic('reports'),
        priority: 30,
        meta: { counts: c, sample: reports.value.reports.slice(0, 6) },
      }),
    );
  }

  return stories;
}

async function localStories(location) {
  const stories = [];
  const point = await getPoint(location.lat, location.lon).catch(() => null);
  if (!point?.gridId) return stories;

  const [afd, sps, forecast] = await Promise.allSettled([
    getTextProduct(point.gridId, 'AFD'),
    listProducts('SPS', { limit: 3, location: point.gridId }),
    getForecastPeriods(point),
  ]);

  if (afd.status === 'fulfilled' && afd.value) {
    const synopsis = extractSection(afd.value.text, ['SYNOPSIS', 'KEY MESSAGES', 'SHORT TERM']);
    stories.push(
      story({
        id: `afd:${afd.value.id}`,
        category: 'local',
        headline: `Forecast Discussion: ${point.city ?? point.gridId} Area`,
        summary: summarize(synopsis || afd.value.text, 360),
        body: afd.value.text,
        publishedAt: afd.value.issuedAt,
        source: `NWS ${afd.value.office}`,
        thumbnail: photo(GOES_CONUS, 'GOES GeoColor satellite imagery of the continental United States'),
        link: `/discussion?office=${point.gridId}`,
        priority: 15,
        meta: { office: point.gridId },
      }),
    );
  }

  if (sps.status === 'fulfilled') {
    for (const product of sps.value.slice(0, 2)) {
      const full = await getProductById(product.id).catch(() => null);
      if (!full) continue;
      stories.push(
        story({
          id: `sps:${product.id}`,
          category: 'local',
          headline: `Special Weather Statement - ${product.office}`,
          summary: summarize(full.text.split('\n').filter((l) => l.trim().length > 40).slice(0, 3).join(' ')),
          body: full.text,
          publishedAt: product.issuedAt,
          source: `NWS ${product.office}`,
          thumbnail: graphic('statement'),
          priority: 18,
        }),
      );
    }
  }

  if (forecast.status === 'fulfilled' && forecast.value.length) {
    const today = forecast.value[0];
    stories.push(
      story({
        id: `fcst:${point.gridId}:${today.startTime}`,
        category: 'forecast',
        headline: `${today.name}: ${today.shortForecast}, ${today.temperature}°`,
        summary: summarize(today.detailedForecast, 400),
        body: forecast.value
          .slice(0, 6)
          .map((p) => `${p.name.toUpperCase()}\n${p.detailedForecast}`)
          .join('\n\n'),
        publishedAt: today.startTime,
        source: `NWS ${point.gridId}`,
        thumbnail: graphic(today.icon),
        priority: 25,
        meta: { temperature: today.temperature, icon: today.icon },
      }),
    );
  }

  return stories;
}

async function tropicalStories() {
  const stories = [];
  const [active, outlook] = await Promise.allSettled([getActiveStorms(), getTropicalOutlook('at')]);

  if (active.status === 'fulfilled') {
    for (const s of active.value.storms.slice(0, 5)) {
      stories.push(
        story({
          id: `storm:${s.id}:${s.advisoryNumber ?? s.lastUpdate}`,
          category: 'tropical',
          headline: `${s.classificationName} ${s.name}: ${s.maxWindsMph} mph, moving ${s.movement?.text ?? 'slowly'}`,
          summary: `${s.classificationName} ${s.name} is centered near ${formatCoord(s.lat, 'NS')}, ${formatCoord(s.lon, 'EW')} in the ${s.basinName} basin with maximum sustained winds of ${s.maxWindsMph} mph and a minimum central pressure of ${s.pressureMb ?? 'unknown'} mb.`,
          publishedAt: s.lastUpdate,
          source: 'NOAA National Hurricane Center',
          thumbnail: photo(GOES_SECTOR(s.basin === 'EP' ? 'eps' : 'taw'), `GOES satellite view of ${s.name}`),
          link: s.products.publicAdvisory,
          priority: 5,
          meta: { stormId: s.id, category: s.category, color: s.color },
        }),
      );
    }
  }

  if (outlook.status === 'fulfilled') {
    for (const item of outlook.value.items.slice(0, 3)) {
      if (!/outlook/i.test(item.title)) continue;
      stories.push(
        story({
          id: `two:${item.link ?? item.title}`,
          category: 'tropical',
          headline: item.title,
          summary: summarize(item.summary, 360),
          body: item.summary,
          publishedAt: item.publishedAt,
          source: 'NOAA National Hurricane Center',
          thumbnail: photo(GOES_SECTOR('taw'), 'GOES satellite view of the tropical Atlantic'),
          link: item.link,
          priority: 22,
        }),
      );
    }
  }

  return stories;
}

async function safetyStories(area) {
  const stories = [];
  const { alerts } = await getActiveAlerts({ area });

  // The NWS `instruction` field is official, authoritative safety guidance.
  const withInstruction = alerts.filter((a) => a.instruction && a.kind === 'warning');
  const seenEvents = new Set();
  for (const alert of withInstruction) {
    if (seenEvents.has(alert.event)) continue;
    seenEvents.add(alert.event);
    stories.push(
      story({
        id: `safety:${alert.event}:${alert.id}`,
        category: 'safety',
        headline: `What To Do In A ${alert.event}`,
        summary: summarize(alert.instruction, 300),
        body: alert.instruction,
        publishedAt: alert.sent,
        source: `NWS ${alert.office}`,
        thumbnail: graphic('safety'),
        priority: 35,
      }),
    );
    if (stories.length >= 3) break;
  }

  try {
    const xml = await cachedText('news:nws-headline', 60 * 30, NWS_HEADLINE_RSS);
    for (const item of parseRssItems(xml).slice(0, 2)) {
      stories.push(
        story({
          id: `nws:${item.link ?? item.title}`,
          category: 'safety',
          headline: item.title,
          summary: summarize(stripHtml(item.description), 400),
          body: stripHtml(item.description),
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          source: 'National Weather Service',
          thumbnail: photo(GOES_CONUS, 'GOES GeoColor satellite imagery'),
          link: item.link,
          priority: 40,
        }),
      );
    }
  } catch {
    // The national headline feed is optional colour, not a hard dependency.
  }

  return stories;
}

/* ------------------------------------------------------------------ public */

/**
 * Assemble the newsroom. Sources are fetched in parallel and a failing source
 * removes its stories rather than breaking the page.
 */
export async function getNews({ location, category, limit = 30 } = {}) {
  const loc = location ?? config.defaultLocation;
  const area = config.coverageStates;

  const tasks = {
    breaking: () => breakingStories(area),
    severe: () => severeStories(),
    local: () => localStories(loc),
    forecast: () => localStories(loc),
    tropical: () => tropicalStories(),
    safety: () => safetyStories(area),
  };

  // 'local' and 'forecast' share one upstream pass; run it once.
  const runners =
    category && category !== 'all'
      ? [[category, tasks[category]]].filter(([, fn]) => fn)
      : [
          ['breaking', tasks.breaking],
          ['severe', tasks.severe],
          ['local', tasks.local],
          ['tropical', tasks.tropical],
          ['safety', tasks.safety],
        ];

  const settled = await Promise.allSettled(runners.map(([, fn]) => fn()));
  const failures = [];
  let stories = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') stories.push(...result.value);
    else failures.push({ source: runners[i][0], error: result.reason?.message });
  });

  // De-duplicate (localStories yields both local + forecast entries).
  const byId = new Map();
  for (const s of stories) if (!byId.has(s.id)) byId.set(s.id, s);
  stories = [...byId.values()];

  if (category && category !== 'all') stories = stories.filter((s) => s.category === category);

  stories.sort(
    (a, b) => a.priority - b.priority || new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0),
  );

  return {
    stories: stories.slice(0, limit),
    categories: NEWS_CATEGORIES,
    counts: NEWS_CATEGORIES.reduce((acc, c) => {
      acc[c.id] = stories.filter((s) => s.category === c.id).length;
      return acc;
    }, {}),
    failures,
    updatedAt: new Date().toISOString(),
  };
}

/* ----------------------------------------------------------------- helpers */

/** Pull a named section out of an NWS text product. */
export function extractSection(text = '', names = []) {
  for (const name of names) {
    const re = new RegExp(`^\\.?${name}[.\\s]*[\\s\\S]*?$`, 'im');
    const start = text.search(re);
    if (start === -1) continue;
    const rest = text.slice(start);
    const end = rest.slice(1).search(/^\s*[&$]{2}|^\.[A-Z][A-Z /]{3,}\.\.\./m);
    return rest
      .slice(0, end > 0 ? end : 900)
      .replace(new RegExp(`^\\.?${name}[.\\s]*`, 'i'), '')
      .trim();
  }
  return '';
}

function formatWindow(startIso, endIso) {
  if (!startIso) return 'today';
  const fmt = (iso) =>
    new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      timeZone: 'UTC',
    });
  return endIso ? `${fmt(startIso)}Z to ${fmt(endIso)}Z` : `${fmt(startIso)}Z`;
}

function formatCoord(value, axis) {
  if (!Number.isFinite(value)) return 'unknown';
  const hemi = axis === 'NS' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(1)}°${hemi}`;
}
