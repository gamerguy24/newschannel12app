import { cachedJson, cachedText } from '../lib/http.js';

/** Storm Prediction Center convective outlooks and local storm reports. */
const SPC = 'https://www.spc.noaa.gov';

/** SPC categorical risk levels, ordered least to most significant. */
const RISK_STYLE = {
  TSTM: { label: 'General Thunderstorms', level: 0, color: '#C1E9C1' },
  MRGL: { label: 'Marginal', level: 1, color: '#66A366' },
  SLGT: { label: 'Slight', level: 2, color: '#FFE066' },
  ENH: { label: 'Enhanced', level: 3, color: '#FFA366' },
  MDT: { label: 'Moderate', level: 4, color: '#E06666' },
  HIGH: { label: 'High', level: 5, color: '#FF66FF' },
};

const PROB_LABEL = (v) => `${v}%`;

function styleFeature(feature) {
  const p = feature.properties ?? {};
  const code = (p.LABEL ?? p.label ?? '').toString().toUpperCase();
  const style = RISK_STYLE[code];
  return {
    ...feature,
    properties: {
      ...p,
      code,
      label: style?.label ?? p.LABEL2 ?? PROB_LABEL(code) ?? code,
      level: style?.level ?? null,
      color: style?.color ?? p.fill ?? '#8FA3BF',
      stroke: p.stroke ?? style?.color ?? '#8FA3BF',
    },
  };
}

const OUTLOOKS = {
  day1: { cat: 'day1otlk_cat', torn: 'day1otlk_torn', hail: 'day1otlk_hail', wind: 'day1otlk_wind' },
  day2: { cat: 'day2otlk_cat', torn: 'day2otlk_torn', hail: 'day2otlk_hail', wind: 'day2otlk_wind' },
  day3: { cat: 'day3otlk_cat', prob: 'day3otlk_prob' },
};

/**
 * A categorical (or probabilistic) convective outlook as GeoJSON, ready to
 * drop onto the map with its official risk colours.
 */
export async function getOutlook(day = 'day1', kind = 'cat') {
  const set = OUTLOOKS[day];
  if (!set) return null;
  const file = set[kind] ?? set.cat;
  if (!file) return null;
  const url = `${SPC}/products/outlook/${file}.nolyr.geojson`;
  const data = await cachedJson(`spc:${file}`, 60 * 10, url);
  const features = (data?.features ?? []).map(styleFeature).sort(
    (a, b) => (a.properties.level ?? 0) - (b.properties.level ?? 0),
  );
  return {
    day,
    kind,
    type: 'FeatureCollection',
    features,
    updatedAt: new Date().toISOString(),
    maxRisk: features.length ? features[features.length - 1].properties : null,
    source: 'NOAA Storm Prediction Center',
    url: `${SPC}/products/outlook/${day}otlk.html`,
  };
}

/** All three outlook days at a glance, for the Severe Weather Center header. */
export async function getOutlookSummary() {
  const days = ['day1', 'day2', 'day3'];
  const results = await Promise.allSettled(days.map((d) => getOutlook(d, 'cat')));
  return days.map((day, i) => {
    const r = results[i];
    if (r.status !== 'fulfilled' || !r.value) {
      return { day, available: false, maxRisk: null };
    }
    return {
      day,
      available: true,
      maxRisk: r.value.maxRisk,
      count: r.value.features.length,
      url: r.value.url,
    };
  });
}

/**
 * SPC local storm reports. The CSV is three concatenated sections (tornado,
 * wind, hail), each with its own header row.
 */
export async function getStormReports(which = 'today') {
  const file = which === 'yesterday' ? 'yesterday' : 'today';
  const csv = await cachedText(`spc:reports:${file}`, 60 * 5, `${SPC}/climo/reports/${file}.csv`);
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const reports = [];
  let section = null;

  for (const line of lines) {
    if (line.startsWith('Time,')) {
      // The second column names the section: F_Scale | Speed | Size
      const second = line.split(',')[1];
      section = second === 'F_Scale' ? 'tornado' : second === 'Speed' ? 'wind' : 'hail';
      continue;
    }
    if (!section) continue;
    const cells = splitCsvLine(line);
    if (cells.length < 7) continue;
    const [time, magnitude, location, county, state, lat, lon, ...rest] = cells;
    const latitude = Number.parseFloat(lat);
    const longitude = Number.parseFloat(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    reports.push({
      type: section,
      time,
      magnitude,
      magnitudeLabel: formatMagnitude(section, magnitude),
      location,
      county,
      state,
      lat: latitude,
      lon: longitude,
      comments: rest.join(', ').trim(),
    });
  }

  return {
    day: file,
    reports,
    counts: {
      tornado: reports.filter((r) => r.type === 'tornado').length,
      wind: reports.filter((r) => r.type === 'wind').length,
      hail: reports.filter((r) => r.type === 'hail').length,
    },
    source: 'NOAA Storm Prediction Center local storm reports',
    updatedAt: new Date().toISOString(),
  };
}

function formatMagnitude(type, value) {
  if (!value || value === 'UNK') return type === 'tornado' ? 'Tornado' : 'Unknown';
  if (type === 'tornado') return `EF${value}`;
  if (type === 'wind') return `${value} mph`;
  // Hail magnitudes are reported in hundredths of an inch.
  const inches = Number.parseFloat(value) / 100;
  return Number.isFinite(inches) ? `${inches.toFixed(2)}"` : value;
}

/** CSV split that respects quoted comment fields containing commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Active SPC mesoscale discussions and watches, parsed from the RSS feed. */
export async function getMesoscaleDiscussions() {
  try {
    const xml = await cachedText('spc:md', 60 * 5, `${SPC}/products/spcmdrss.xml`);
    return parseRssItems(xml).slice(0, 12);
  } catch {
    return [];
  }
}

export function parseRssItems(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((item) => ({
    title: pick(item, 'title'),
    link: pick(item, 'link'),
    description: stripHtml(pick(item, 'description')),
    pubDate: pick(item, 'pubDate'),
  }));
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim());
}

export function stripHtml(html = '') {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeEntities(text = '') {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code) => {
    if (named[code]) return named[code];
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return full;
  });
}
