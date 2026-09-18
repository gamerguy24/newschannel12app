import {
  getCurrentObservation,
  getForecastPeriods,
  getHourlyPeriods,
  getPoint,
  resolveIcon,
} from './nws.js';
import { getDailyModel, getHourlyModel, getSupplementalCurrent } from './openmeteo.js';
import { compassPoint } from '../lib/geo.js';

/**
 * The composition layer: NWS is authoritative for anything a local forecast
 * office issues, and the national model fills only the fields NWS does not
 * publish (UV, astronomy, days 8-10, deep hourly). Each merged field records
 * where it came from so the UI can attribute it.
 */

const round = (v, digits = 0) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** UV index -> the standard WHO exposure category. */
export function uvCategory(uv) {
  if (uv === null || uv === undefined) return null;
  if (uv >= 11) return { label: 'Extreme', color: '#B21E7B' };
  if (uv >= 8) return { label: 'Very High', color: '#FF3D3D' };
  if (uv >= 6) return { label: 'High', color: '#FFA200' };
  if (uv >= 3) return { label: 'Moderate', color: '#FFD400' };
  return { label: 'Low', color: '#22C55E' };
}

/** Is it currently between sunrise and sunset at this location? */
export function isDaytime(sunrise, sunset, now = Date.now()) {
  const up = sunrise ? new Date(sunrise).getTime() : null;
  const down = sunset ? new Date(sunset).getTime() : null;
  if (!up || !down) return true;
  return now >= up && now < down;
}

/**
 * CURRENT CONDITIONS - the big number on the home screen.
 */
export async function getCurrentConditions(location) {
  const point = await getPoint(location.lat, location.lon);
  const [obsResult, supplementalResult] = await Promise.allSettled([
    getCurrentObservation(point),
    getSupplementalCurrent(location.lat, location.lon),
  ]);

  const obs = obsResult.status === 'fulfilled' ? obsResult.value : null;
  const supplemental = supplementalResult.status === 'fulfilled' ? supplementalResult.value : null;
  const daytime = supplemental ? isDaytime(supplemental.sunrise, supplemental.sunset) : true;

  // Prefer the real observation; fall back to the model so the app never shows
  // an empty temperature when a station drops out.
  const temperature = obs?.temperature ?? supplemental?.modelTemperature ?? null;
  const feelsLike = obs?.feelsLike ?? supplemental?.modelFeelsLike ?? temperature;
  const condition = obs?.textDescription ?? supplemental?.modelCondition?.text ?? null;
  const icon = obs
    ? resolveIcon('', obs.textDescription ?? '', daytime)
    : supplemental?.modelCondition?.icon ?? (daytime ? 'clear-day' : 'clear-night');

  const uv = supplemental?.uvIndex ?? null;

  return {
    location: {
      lat: location.lat,
      lon: location.lon,
      name: location.name ?? [point.city, point.state].filter(Boolean).join(', '),
      city: point.city,
      state: point.state,
      county: point.countyId,
      timeZone: point.timeZone ?? supplemental?.timezone ?? null,
      office: point.gridId,
      radarStation: point.radarStation,
      forecastZone: point.forecastZoneId,
    },
    observation: {
      temperature: round(temperature),
      feelsLike: round(feelsLike),
      condition,
      icon,
      humidity: round(obs?.relativeHumidity),
      dewpoint: round(obs?.dewpoint),
      windSpeed: round(obs?.windSpeed),
      windDirection: obs?.windDirection ?? null,
      windCompass: obs?.windCompass ?? compassPoint(obs?.windDirection),
      windGust: round(obs?.windGust),
      visibility: round(obs?.visibility, 1),
      pressure: round(obs?.barometricPressure ?? obs?.seaLevelPressure, 2),
      pressureTrend: supplemental?.pressureTrend ?? null,
      ceiling: obs?.cloudLayers?.find((l) => ['BKN', 'OVC'].includes(l.amount))?.base ?? null,
      heatIndex: round(obs?.heatIndex),
      windChill: round(obs?.windChill),
      observedAt: obs?.observedAt ?? null,
      stationId: obs?.station?.id ?? obs?.stationId ?? null,
      stationName: obs?.station?.name ?? null,
      raw: obs?.raw ?? null,
      source: obs ? 'NWS observation' : 'model',
    },
    astronomy: {
      sunrise: supplemental?.sunrise ?? null,
      sunset: supplemental?.sunset ?? null,
      sunriseTomorrow: supplemental?.sunriseTomorrow ?? null,
      sunsetTomorrow: supplemental?.sunsetTomorrow ?? null,
      isDaytime: daytime,
    },
    uv: { index: round(uv, 1), max: round(supplemental?.uvIndexMax, 1), category: uvCategory(uv) },
    instability: { cape: round(supplemental?.cape), liftedIndex: round(supplemental?.liftedIndex, 1) },
    degraded: !obs,
  };
}

/**
 * HOURLY FORECAST - NWS hourly grid, extended with model hours beyond the
 * grid's range so the strip always covers at least 48 hours.
 */
export async function getHourlyForecast(location, { hours = 48 } = {}) {
  const point = await getPoint(location.lat, location.lon).catch(() => null);
  const [nwsResult, modelResult] = await Promise.allSettled([
    point ? getHourlyPeriods(point) : Promise.resolve([]),
    getHourlyModel(location.lat, location.lon, Math.ceil(hours / 24) + 1),
  ]);

  const model = modelResult.status === 'fulfilled' ? modelResult.value : [];
  const modelByHour = new Map(model.map((m) => [new Date(m.time).toISOString().slice(0, 13), m]));
  const nws = nwsResult.status === 'fulfilled' ? nwsResult.value : [];

  const now = Date.now() - 30 * 60_000;
  const merged = [];
  const seen = new Set();

  for (const period of nws) {
    const t = new Date(period.startTime).getTime();
    if (!Number.isFinite(t) || t < now) continue;
    const key = new Date(period.startTime).toISOString().slice(0, 13);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = modelByHour.get(key);
    merged.push({
      time: period.startTime,
      temperature: round(period.temperature),
      feelsLike: round(m?.feelsLike ?? period.temperature),
      condition: period.shortForecast,
      icon: period.icon,
      precipProbability: period.precipProbability ?? m?.precipProbability ?? null,
      precipAmount: round(m?.precipAmount, 2),
      humidity: round(period.relativeHumidity ?? m?.humidity),
      dewpoint: round(period.dewpoint ?? m?.dewpoint),
      windSpeed: parseWindSpeed(period.windSpeed) ?? round(m?.windSpeed),
      windDirection: period.windDirection ?? compassPoint(m?.windDirection) ?? null,
      windGust: round(m?.windGust),
      // Storm probability blends the NWS wording with model instability.
      stormProbability: stormProbability(period, m),
      isDaytime: period.isDaytime,
      source: 'nws',
    });
    if (merged.length >= hours) break;
  }

  // Extend with model hours if the NWS grid ran out first.
  if (merged.length < hours) {
    for (const m of model) {
      const t = new Date(m.time).getTime();
      const key = new Date(m.time).toISOString().slice(0, 13);
      if (!Number.isFinite(t) || t < now || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        time: m.time,
        temperature: round(m.temperature),
        feelsLike: round(m.feelsLike),
        condition: m.condition,
        icon: m.icon,
        precipProbability: m.precipProbability,
        precipAmount: round(m.precipAmount, 2),
        humidity: round(m.humidity),
        dewpoint: round(m.dewpoint),
        windSpeed: round(m.windSpeed),
        windDirection: compassPoint(m.windDirection),
        windGust: round(m.windGust),
        stormProbability: stormProbability(null, m),
        isDaytime: null,
        source: 'model',
      });
      if (merged.length >= hours) break;
    }
  }

  merged.sort((a, b) => new Date(a.time) - new Date(b.time));
  return { hours: merged.slice(0, hours), source: nws.length ? 'NWS gridpoint + model' : 'model', degraded: !nws.length };
}

/** "10 to 15 mph" / "SW 12 mph" -> 15 */
function parseWindSpeed(text) {
  if (!text) return null;
  const numbers = String(text).match(/\d+/g);
  if (!numbers) return null;
  return Number.parseInt(numbers[numbers.length - 1], 10);
}

/**
 * Chance of thunderstorms for an hour. NWS wording is authoritative when it
 * mentions thunder; otherwise CAPE and the model weather code carry it.
 */
function stormProbability(period, model) {
  const mentionsThunder = period && /thunder|t-storm|tstm/i.test(period.shortForecast ?? '');
  if (mentionsThunder) {
    const pop = period.precipProbability ?? model?.precipProbability ?? 30;
    return Math.max(20, Math.round(pop));
  }
  if (model?.thunder) return Math.max(20, Math.round(model.precipProbability ?? 30));
  const cape = model?.cape ?? 0;
  const pop = model?.precipProbability ?? period?.precipProbability ?? 0;
  if (cape > 1500 && pop >= 30) return Math.round(Math.min(60, pop * 0.7));
  if (cape > 800 && pop >= 40) return Math.round(Math.min(40, pop * 0.5));
  return 0;
}

/**
 * 10-DAY FORECAST - NWS day/night periods for the first week, model days for
 * the tail. Every entry is a full calendar day with a high, a low and text.
 */
export async function getDailyForecast(location, { days = 10 } = {}) {
  const point = await getPoint(location.lat, location.lon).catch(() => null);
  const [nwsResult, modelResult] = await Promise.allSettled([
    point ? getForecastPeriods(point) : Promise.resolve([]),
    getDailyModel(location.lat, location.lon, days),
  ]);

  const periods = nwsResult.status === 'fulfilled' ? nwsResult.value : [];
  const model = modelResult.status === 'fulfilled' ? modelResult.value : [];
  const modelByDate = new Map(model.map((m) => [m.date, m]));

  /** Group NWS day/night periods into calendar days. */
  const byDate = new Map();
  for (const period of periods) {
    const date = localDateKey(period.startTime);
    if (!byDate.has(date)) byDate.set(date, { date, day: null, night: null });
    const bucket = byDate.get(date);
    if (period.isDaytime) bucket.day = period;
    else bucket.night = period;
  }

  const result = [];
  const dates = [...new Set([...byDate.keys(), ...modelByDate.keys()])].sort();

  for (const date of dates) {
    const bucket = byDate.get(date);
    const m = modelByDate.get(date);
    const day = bucket?.day;
    const night = bucket?.night;
    if (!day && !night && !m) continue;

    const high = day?.temperature ?? m?.high ?? null;
    const low = night?.temperature ?? m?.low ?? null;
    const primary = day ?? night;

    result.push({
      date,
      timestamp: primary?.startTime ?? `${date}T12:00:00`,
      name: day?.name ?? night?.name ?? null,
      high: round(high),
      low: round(low),
      icon: primary?.icon ?? m?.icon ?? 'cloudy',
      condition: primary?.shortForecast ?? m?.condition ?? null,
      detail: day?.detailedForecast ?? night?.detailedForecast ?? null,
      nightCondition: night?.shortForecast ?? null,
      nightDetail: night?.detailedForecast ?? null,
      nightIcon: night?.icon ?? null,
      precipProbability:
        day?.precipProbability ?? night?.precipProbability ?? m?.precipProbability ?? null,
      precipAmount: m?.precipAmount ?? null,
      windSpeed: parseWindSpeed(day?.windSpeed ?? night?.windSpeed) ?? m?.windMax ?? null,
      windDirection: day?.windDirection ?? night?.windDirection ?? compassPoint(m?.windDirection) ?? null,
      windGust: m?.gustMax ?? null,
      humidity: round(day?.relativeHumidity ?? night?.relativeHumidity),
      dewpoint: round(day?.dewpoint ?? night?.dewpoint),
      uvIndexMax: m?.uvIndexMax ?? null,
      sunrise: m?.sunrise ?? null,
      sunset: m?.sunset ?? null,
      source: day || night ? 'nws' : 'model',
    });
    if (result.length >= days) break;
  }

  return {
    days: result.slice(0, days),
    source: periods.length ? 'NWS forecast + model extension' : 'model',
    degraded: !periods.length,
  };
}

/** YYYY-MM-DD in the timestamp's own offset, not the server's. */
function localDateKey(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : new Date(iso).toISOString().slice(0, 10);
}
