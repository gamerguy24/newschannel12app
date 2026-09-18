import config from '../config.js';

/** Wrap an async route so rejections reach the error middleware. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Read a lat/lon pair from the query string, falling back to the station's
 * default market so every endpoint works without arguments.
 */
export function readLocation(req, { required = false } = {}) {
  const lat = Number.parseFloat(req.query.lat);
  const lon = Number.parseFloat(req.query.lon);
  const name = typeof req.query.name === 'string' ? req.query.name : undefined;

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new HttpError(400, 'Coordinates out of range', { lat, lon });
    }
    return { lat, lon, name };
  }
  if (required) throw new HttpError(400, 'lat and lon query parameters are required');
  return { ...config.defaultLocation };
}

export function readNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Set a shared cache header so proxies and the browser both back off. */
export const cacheFor = (res, seconds, staleSeconds = seconds * 4) => {
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${staleSeconds}`);
  return res;
};

/** Wrap a payload with the metadata every client response carries. */
export const envelope = (data, extra = {}) => ({
  ok: true,
  fetchedAt: new Date().toISOString(),
  ...extra,
  data,
});
