import { cachedJson, cachedText } from '../lib/http.js';
import { parseRssItems, stripHtml } from './spc.js';

/** National Hurricane Center - active tropical systems, tracks and cones. */
const NHC = 'https://www.nhc.noaa.gov';

const CLASSIFICATION = {
  TD: 'Tropical Depression',
  TS: 'Tropical Storm',
  HU: 'Hurricane',
  MH: 'Major Hurricane',
  STD: 'Subtropical Depression',
  STS: 'Subtropical Storm',
  PTC: 'Potential Tropical Cyclone',
  PC: 'Post-Tropical Cyclone',
  DB: 'Disturbance',
  LO: 'Remnant Low',
  EX: 'Extratropical Low',
};

/** Saffir-Simpson category from sustained winds in knots. */
export function saffirSimpson(windKt) {
  const kt = Number(windKt);
  if (!Number.isFinite(kt)) return null;
  if (kt >= 137) return { category: 5, label: 'Category 5', color: '#FF00FF' };
  if (kt >= 113) return { category: 4, label: 'Category 4', color: '#FF3D3D' };
  if (kt >= 96) return { category: 3, label: 'Category 3', color: '#FF8C00' };
  if (kt >= 83) return { category: 2, label: 'Category 2', color: '#FFD400' };
  if (kt >= 64) return { category: 1, label: 'Category 1', color: '#FFF200' };
  if (kt >= 34) return { category: 0, label: 'Tropical Storm', color: '#00C2A8' };
  return { category: -1, label: 'Tropical Depression', color: '#5BA4E6' };
}

/** "28.0N" / "77.4W" -> signed decimal degrees. */
function parseCoord(value) {
  if (typeof value === 'number') return value;
  const m = String(value ?? '').match(/^([\d.]+)\s*([NSEW])$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  const hemi = m[2].toUpperCase();
  return hemi === 'S' || hemi === 'W' ? -n : n;
}

function parseMovement(storm) {
  const dir = Number.parseFloat(storm.movementDir);
  const speed = Number.parseFloat(storm.movementSpeed);
  if (!Number.isFinite(dir) && !Number.isFinite(speed)) return null;
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const heading = Number.isFinite(dir) ? COMPASS[Math.round((dir % 360) / 22.5) % 16] : null;
  return {
    directionDeg: Number.isFinite(dir) ? dir : null,
    heading,
    speedKt: Number.isFinite(speed) ? speed : null,
    speedMph: Number.isFinite(speed) ? Math.round(speed * 1.15078) : null,
    text: heading && Number.isFinite(speed) ? `${heading} at ${Math.round(speed * 1.15078)} mph` : null,
  };
}

/**
 * Every active storm the NHC is tracking, in every basin, normalised for the
 * Tropical Weather Center.
 */
export async function getActiveStorms() {
  const data = await cachedJson('nhc:current', 60 * 5, `${NHC}/CurrentStorms.json`);
  const storms = (data?.activeStorms ?? []).map((s) => {
    const windKt = Number.parseFloat(s.intensity);
    const cat = saffirSimpson(windKt);
    const classification = String(s.classification || '').toUpperCase();
    const isMajor = cat && cat.category >= 3;
    return {
      id: s.id,
      binNumber: s.binNumber,
      name: s.name,
      basin: s.id?.slice(0, 2)?.toUpperCase() ?? null,
      basinName: basinName(s.id),
      classification,
      classificationName:
        isMajor && classification === 'HU' ? 'Major Hurricane' : CLASSIFICATION[classification] ?? classification,
      category: cat?.category ?? null,
      categoryLabel: cat?.label ?? null,
      color: cat?.color ?? '#5BA4E6',
      maxWindsKt: Number.isFinite(windKt) ? windKt : null,
      maxWindsMph: Number.isFinite(windKt) ? Math.round(windKt * 1.15078) : null,
      pressureMb: Number.parseFloat(s.pressure) || null,
      lat: parseCoord(s.latitude),
      lon: parseCoord(s.longitude),
      movement: parseMovement(s),
      lastUpdate: s.lastUpdate,
      advisoryNumber: s.publicAdvisory?.advNum ?? null,
      products: {
        publicAdvisory: s.publicAdvisory?.url ?? null,
        forecastAdvisory: s.forecastAdvisory?.url ?? null,
        forecastDiscussion: s.forecastDiscussion?.url ?? null,
        windSpeedProbabilities: s.windSpeedProbabilities?.url ?? null,
        trackCone: s.trackCone?.zoomURL ?? s.trackCone?.url ?? null,
      },
      // GIS products published alongside each advisory.
      gis: {
        cone: s.trackCone?.url ?? null,
        bestTrack: s.bestTrack?.url ?? null,
        windRadii: s.windRadii?.url ?? null,
        initialRadii: s.initialWindExtent?.url ?? null,
      },
    };
  });

  storms.sort((a, b) => (b.maxWindsKt ?? 0) - (a.maxWindsKt ?? 0));

  return {
    storms,
    updatedAt: data?.metadata?.generated ?? new Date().toISOString(),
    source: 'NOAA National Hurricane Center',
    stale: Boolean(data?._stale),
  };
}

function basinName(id = '') {
  const prefix = String(id).slice(0, 2).toLowerCase();
  if (prefix === 'al') return 'Atlantic';
  if (prefix === 'ep') return 'Eastern Pacific';
  if (prefix === 'cp') return 'Central Pacific';
  return 'Other';
}

/**
 * Tropical weather outlooks (the "areas to watch" discussions) plus the
 * headline advisory feed, sourced from the NHC RSS products.
 */
export async function getTropicalOutlook(basin = 'at') {
  const feed = basin === 'ep' ? 'index-ep.xml' : 'index-at.xml';
  try {
    const xml = await cachedText(`nhc:rss:${basin}`, 60 * 10, `${NHC}/${feed}`);
    const items = parseRssItems(xml);
    return {
      basin: basin === 'ep' ? 'Eastern Pacific' : 'Atlantic',
      items: items.map((i) => ({
        title: i.title,
        summary: stripHtml(i.description).slice(0, 1200),
        link: i.link,
        publishedAt: i.pubDate ? new Date(i.pubDate).toISOString() : null,
      })),
      source: 'NOAA National Hurricane Center',
    };
  } catch (err) {
    return { basin, items: [], error: err.message, source: 'NOAA National Hurricane Center' };
  }
}

/** Static NHC satellite imagery for the tropics page. */
export function getTropicalImagery(basin = 'atlantic') {
  const sector = basin === 'epacific' ? 'eastpac' : 'atlantic';
  return {
    basin: sector,
    images: [
      {
        id: 'geocolor',
        label: 'GOES GeoColor',
        url: `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${sector === 'atlantic' ? 'taw' : 'eps'}/GEOCOLOR/latest.jpg`,
      },
      {
        id: 'ir',
        label: 'Infrared',
        url: `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${sector === 'atlantic' ? 'taw' : 'eps'}/13/latest.jpg`,
      },
      {
        id: 'wv',
        label: 'Water Vapor',
        url: `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/${sector === 'atlantic' ? 'taw' : 'eps'}/09/latest.jpg`,
      },
    ],
    source: 'NOAA NESDIS / GOES',
  };
}

/**
 * Forecast track + cone for one storm. The NHC publishes these as zipped
 * shapefiles, so we reconstruct the track from the public forecast advisory
 * text, which is stable, plain text and always current.
 */
export async function getStormTrack(stormId) {
  const { storms } = await getActiveStorms();
  const storm = storms.find((s) => s.id === stormId);
  if (!storm) return null;
  const advisoryUrl = storm.products.forecastAdvisory;
  if (!advisoryUrl) return { storm, track: [], source: 'NOAA National Hurricane Center' };

  const text = await cachedText(`nhc:adv:${stormId}`, 60 * 10, advisoryUrl.replace(/^http:/, 'https:'));
  return { storm, track: parseForecastAdvisory(text), raw: text, source: 'NOAA National Hurricane Center' };
}

const FORECAST_LINE =
  /^(?:FORECAST VALID|OUTLOOK VALID)\s+(\d{2})\/(\d{4})Z\s+([\d.]+)([NS])\s+([\d.]+)([EW])/gim;
const MAXWIND_LINE = /^MAX WIND\s+(\d+)\s*KT/gim;

/** Pull the forecast positions out of an NHC public forecast advisory. */
export function parseForecastAdvisory(text = '') {
  const positions = [];
  let m;
  FORECAST_LINE.lastIndex = 0;
  while ((m = FORECAST_LINE.exec(text)) !== null) {
    const [, day, hhmm, latStr, latHemi, lonStr, lonHemi] = m;
    positions.push({
      day: Number.parseInt(day, 10),
      timeZ: hhmm,
      lat: parseCoord(`${latStr}${latHemi}`),
      lon: parseCoord(`${lonStr}${lonHemi}`),
    });
  }
  // Winds appear in the same order as the forecast positions.
  const winds = [];
  MAXWIND_LINE.lastIndex = 0;
  while ((m = MAXWIND_LINE.exec(text)) !== null) winds.push(Number.parseInt(m[1], 10));

  return positions.map((p, i) => {
    const windKt = winds[i + 1] ?? winds[i] ?? null;
    const cat = saffirSimpson(windKt);
    return {
      ...p,
      maxWindsKt: windKt,
      maxWindsMph: windKt ? Math.round(windKt * 1.15078) : null,
      category: cat?.category ?? null,
      categoryLabel: cat?.label ?? null,
      color: cat?.color ?? '#5BA4E6',
    };
  });
}
