/** Geodesy helpers used by the storm tracker, ticker and county tools. */

const R_MILES = 3958.7613;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

export function distanceMiles(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from true north. */
export function bearingDegrees(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(degrees) {
  if (!Number.isFinite(degrees)) return null;
  return COMPASS[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
}

/** Project a point `miles` along `bearing` degrees. */
export function projectPoint(origin, bearing, miles) {
  const angular = miles / R_MILES;
  const brg = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brg));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
}

/** Flatten any GeoJSON geometry into a list of {lat,lon} rings. */
function collectRings(geometry) {
  if (!geometry) return [];
  const { type, coordinates } = geometry;
  if (type === 'Polygon') return [coordinates[0] || []];
  if (type === 'MultiPolygon') return coordinates.map((poly) => poly[0] || []);
  if (type === 'LineString') return [coordinates];
  if (type === 'MultiLineString') return coordinates;
  if (type === 'Point') return [[coordinates]];
  if (type === 'GeometryCollection') return (geometry.geometries || []).flatMap(collectRings);
  return [];
}

/** Area-weighted centroid of a GeoJSON geometry, in {lat, lon}. */
export function geometryCentroid(geometry) {
  const rings = collectRings(geometry);
  let sumLat = 0;
  let sumLon = 0;
  let count = 0;
  for (const ring of rings) {
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      sumLon += coord[0];
      sumLat += coord[1];
      count += 1;
    }
  }
  if (!count) return null;
  return { lat: sumLat / count, lon: sumLon / count };
}

/** Bounding box [west, south, east, north] of a geometry. */
export function geometryBounds(geometry) {
  const rings = collectRings(geometry);
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  let seen = false;
  for (const ring of rings) {
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      seen = true;
      w = Math.min(w, coord[0]);
      e = Math.max(e, coord[0]);
      s = Math.min(s, coord[1]);
      n = Math.max(n, coord[1]);
    }
  }
  return seen ? [w, s, e, n] : null;
}

/** Ray-casting point-in-polygon across every ring of a geometry. */
export function pointInGeometry(point, geometry) {
  const rings = collectRings(geometry);
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i]?.[0];
      const yi = ring[i]?.[1];
      const xj = ring[j]?.[0];
      const yj = ring[j]?.[1];
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const intersects = yi > point.lat !== yj > point.lat &&
        point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** Shortest distance in miles from a point to a geometry (0 if inside). */
export function distanceToGeometry(point, geometry) {
  if (pointInGeometry(point, geometry)) return 0;
  const rings = collectRings(geometry);
  let best = Infinity;
  for (const ring of rings) {
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      best = Math.min(best, distanceMiles(point, { lat: coord[1], lon: coord[0] }));
    }
  }
  return Number.isFinite(best) ? best : null;
}
