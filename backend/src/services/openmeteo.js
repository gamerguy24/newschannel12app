import { cachedJson } from '../lib/http.js';

/**
 * Open-Meteo (NOAA GFS/HRRR + ECMWF blend, free and key-free) fills the gaps
 * the NWS API leaves:
 *   - days 8-10 of the extended forecast (NWS publishes ~7)
 *   - UV index, sunrise/sunset, pressure and visibility trends
 *   - a national-model fallback when a WFO grid request fails
 */
const BASE = 'https://api.open-meteo.com/v1/forecast';

const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'uv_index_max',
  'sunrise',
  'sunset',
].join(',');

const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'pressure_msl',
  'surface_pressure',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'cape',
  'lifted_index',
].join(',');

const CURRENT = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'is_day',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
].join(',');

/** WMO weather codes -> our icon set + plain-English condition text. */
const WMO = {
  0: ['clear', 'Clear'],
  1: ['mostly-clear', 'Mostly Clear'],
  2: ['partly-cloudy', 'Partly Cloudy'],
  3: ['cloudy', 'Overcast'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing Fog'],
  51: ['rain', 'Light Drizzle'],
  53: ['rain', 'Drizzle'],
  55: ['rain', 'Heavy Drizzle'],
  56: ['sleet', 'Freezing Drizzle'],
  57: ['sleet', 'Freezing Drizzle'],
  61: ['rain', 'Light Rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy Rain'],
  66: ['sleet', 'Freezing Rain'],
  67: ['sleet', 'Freezing Rain'],
  71: ['snow', 'Light Snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy Snow'],
  77: ['snow', 'Snow Grains'],
  80: ['showers', 'Rain Showers'],
  81: ['showers', 'Rain Showers'],
  82: ['showers', 'Heavy Rain Showers'],
  85: ['snow', 'Snow Showers'],
  86: ['snow', 'Heavy Snow Showers'],
  95: ['thunderstorm', 'Thunderstorms'],
  96: ['thunderstorm', 'Thunderstorms with Hail'],
  99: ['thunderstorm', 'Severe Thunderstorms'],
};

export function decodeWeatherCode(code, isDay = true) {
  const [icon, text] = WMO[code] ?? ['cloudy', 'Unknown'];
  if (icon === 'clear') return { icon: isDay ? 'clear-day' : 'clear-night', text };
  if (icon === 'mostly-clear' || icon === 'partly-cloudy') {
    return { icon: isDay ? 'partly-cloudy-day' : 'partly-cloudy-night', text };
  }
  return { icon, text };
}

/** Is this WMO code a thunderstorm? Used for the hourly storm-risk column. */
export const isThunderCode = (code) => code >= 95 && code <= 99;

export async function getModelData(lat, lon, { days = 10 } = {}) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: DAILY,
    hourly: HOURLY,
    current: CURRENT,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: String(days),
    past_hours: '3',
  });
  const key = `om:${Math.round(lat * 100)}:${Math.round(lon * 100)}:${days}`;
  return cachedJson(key, 60 * 20, `${BASE}?${params.toString()}`);
}

/**
 * Open-Meteo returns naive local timestamps ("2026-08-31T13:00") plus a
 * separate UTC offset. Stamping the offset on turns them into unambiguous
 * instants, which everything downstream (charts, "now" lookups, the ticker)
 * depends on.
 */
export function withOffset(timeStr, offsetSeconds = 0) {
  // Daily rows carry a bare date ("2026-08-31") - leave those alone.
  if (!timeStr || !timeStr.includes('T') || /[Zz]|[+-]\d{2}:\d{2}$/.test(timeStr)) return timeStr;
  const sign = offsetSeconds < 0 ? '-' : '+';
  const abs = Math.abs(offsetSeconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const withSeconds = timeStr.length === 16 ? `${timeStr}:00` : timeStr;
  return `${withSeconds}${sign}${hh}:${mm}`;
}

/** Column-oriented Open-Meteo arrays -> row objects with absolute times. */
function rows(block, keys, offsetSeconds = 0) {
  const times = block?.time ?? [];
  return times.map((time, i) => {
    const row = { time: withOffset(time, offsetSeconds) };
    for (const k of keys) {
      const value = block?.[k]?.[i] ?? null;
      // sunrise/sunset are timestamps too.
      row[k] = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? withOffset(value, offsetSeconds) : value;
    }
    return row;
  });
}

/** Visibility units vary with the unit system; normalise to statute miles. */
function toMiles(value, unit) {
  if (value === null || value === undefined) return null;
  if (unit === 'ft') return value / 5280;
  if (unit === 'mi') return value;
  return value / 1609.344; // metres
}

export async function getDailyModel(lat, lon, days = 10) {
  const data = await getModelData(lat, lon, { days });
  const daily = rows(data.daily, DAILY.split(','), data.utc_offset_seconds ?? 0);
  return daily.map((d) => {
    const decoded = decodeWeatherCode(d.weather_code, true);
    return {
      date: d.time,
      icon: decoded.icon,
      condition: decoded.text,
      high: d.temperature_2m_max === null ? null : Math.round(d.temperature_2m_max),
      low: d.temperature_2m_min === null ? null : Math.round(d.temperature_2m_min),
      feelsHigh: d.apparent_temperature_max === null ? null : Math.round(d.apparent_temperature_max),
      feelsLow: d.apparent_temperature_min === null ? null : Math.round(d.apparent_temperature_min),
      precipProbability: d.precipitation_probability_max,
      precipAmount: d.precipitation_sum,
      windMax: d.wind_speed_10m_max === null ? null : Math.round(d.wind_speed_10m_max),
      gustMax: d.wind_gusts_10m_max === null ? null : Math.round(d.wind_gusts_10m_max),
      windDirection: d.wind_direction_10m_dominant,
      uvIndexMax: d.uv_index_max === null ? null : Math.round(d.uv_index_max * 10) / 10,
      sunrise: d.sunrise,
      sunset: d.sunset,
      source: 'model',
    };
  });
}

export async function getHourlyModel(lat, lon, days = 4) {
  const data = await getModelData(lat, lon, { days });
  const visUnit = data.hourly_units?.visibility;
  const hourly = rows(data.hourly, HOURLY.split(','), data.utc_offset_seconds ?? 0);
  return hourly.map((h) => {
    const decoded = decodeWeatherCode(h.weather_code, true);
    return {
      time: h.time,
      temperature: h.temperature_2m,
      feelsLike: h.apparent_temperature,
      humidity: h.relative_humidity_2m,
      dewpoint: h.dew_point_2m,
      precipProbability: h.precipitation_probability,
      precipAmount: h.precipitation,
      condition: decoded.text,
      icon: decoded.icon,
      pressure: h.pressure_msl,
      cloudCover: h.cloud_cover,
      visibility: toMiles(h.visibility, visUnit),
      windSpeed: h.wind_speed_10m,
      windDirection: h.wind_direction_10m,
      windGust: h.wind_gusts_10m,
      uvIndex: h.uv_index,
      cape: h.cape,
      liftedIndex: h.lifted_index,
      thunder: isThunderCode(h.weather_code),
    };
  });
}

/**
 * Astronomy + UV for "today", used by the current-conditions panel where the
 * NWS API has no equivalent field.
 */
export async function getSupplementalCurrent(lat, lon) {
  const data = await getModelData(lat, lon, { days: 2 });
  const offset = data.utc_offset_seconds ?? 0;
  const daily = rows(data.daily, DAILY.split(','), offset);
  const today = daily[0] ?? {};
  const current = data.current ?? {};
  const hourly = rows(data.hourly, HOURLY.split(','), offset);
  // Pick the hour bracketing "now" on the absolute timeline.
  const nowMs = Date.now();
  const currentHour =
    hourly.reduce((best, h) => {
      const t = new Date(h.time).getTime();
      if (!Number.isFinite(t) || t > nowMs) return best;
      if (!best) return h;
      return t > new Date(best.time).getTime() ? h : best;
    }, null) ?? hourly[0] ?? {};
  return {
    isDay: current.is_day === 1,
    sunrise: today.sunrise ?? null,
    sunset: today.sunset ?? null,
    sunriseTomorrow: daily[1]?.sunrise ?? null,
    sunsetTomorrow: daily[1]?.sunset ?? null,
    uvIndex: currentHour.uv_index ?? null,
    uvIndexMax: today.uv_index_max ?? null,
    cape: currentHour.cape ?? null,
    liftedIndex: currentHour.lifted_index ?? null,
    pressureTrend: pressureTrend(hourly),
    modelTemperature: current.temperature_2m ?? null,
    modelFeelsLike: current.apparent_temperature ?? null,
    modelCondition: decodeWeatherCode(current.weather_code, current.is_day === 1),
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
  };
}

/** Compare the last three hours of MSLP to label rising / falling / steady. */
function pressureTrend(hourly) {
  const now = Date.now();
  const recent = hourly
    .filter((h) => {
      const t = new Date(h.time).getTime();
      return t <= now && t > now - 4 * 3600_000;
    })
    .map((h) => h.pressure_msl)
    .filter((v) => typeof v === 'number');
  if (recent.length < 2) return null;
  const delta = recent[recent.length - 1] - recent[0];
  const inHg = delta * 0.02953;
  if (Math.abs(inHg) < 0.02) return { direction: 'steady', changeInHg: Math.round(inHg * 100) / 100 };
  return { direction: inHg > 0 ? 'rising' : 'falling', changeInHg: Math.round(inHg * 100) / 100 };
}
