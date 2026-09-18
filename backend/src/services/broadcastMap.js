import config from '../config.js';
import { cachedJson } from '../lib/http.js';
import { withCache } from '../lib/cache.js';

/**
 * BROADCAST MAP FURNITURE
 *
 * The county lines and place names that turn a satellite basemap into a
 * weather map. A station chooses which towns appear - that judgement is what
 * makes the map readable - so the list is explicit rather than whatever a
 * generic label layer decides to draw.
 *
 * Coordinates were resolved once through the app's own geocoder and checked
 * against the viewing area, so they are exact rather than transcribed.
 *
 * tier 1 = anchor city, 2 = major, 3 = market town, 4 = small town. Tiers map
 * to zoom thresholds so the map thins out as you pull back instead of
 * collapsing into a wall of overlapping text.
 */
export const BROADCAST_PLACES = [
  { name: 'Nashville', state: 'TN', tier: 1, lat: 36.1659, lon: -86.7844 },
  { name: 'Clarksville', state: 'TN', tier: 2, lat: 36.5298, lon: -87.3594 },
  { name: 'Murfreesboro', state: 'TN', tier: 2, lat: 35.8456, lon: -86.3903 },
  { name: 'Franklin', state: 'TN', tier: 2, lat: 35.9251, lon: -86.8689 },
  { name: 'Columbia', state: 'TN', tier: 2, lat: 35.6151, lon: -87.0353 },
  { name: 'Cookeville', state: 'TN', tier: 2, lat: 36.1628, lon: -85.5016 },
  { name: 'Jackson', state: 'TN', tier: 2, lat: 35.6145, lon: -88.814 },
  { name: 'Hopkinsville', state: 'KY', tier: 2, lat: 36.8656, lon: -87.4912 },
  { name: 'Bowling Green', state: 'KY', tier: 2, lat: 36.9903, lon: -86.4436 },
  { name: 'Huntsville', state: 'AL', tier: 2, lat: 34.7304, lon: -86.5859 },
  { name: 'Knoxville', state: 'TN', tier: 2, lat: 35.9606, lon: -83.9207 },
  { name: 'Chattanooga', state: 'TN', tier: 2, lat: 35.0456, lon: -85.3097 },
  { name: 'Gallatin', state: 'TN', tier: 3, lat: 36.3884, lon: -86.4467 },
  { name: 'Lebanon', state: 'TN', tier: 3, lat: 36.2081, lon: -86.2911 },
  { name: 'Springfield', state: 'TN', tier: 3, lat: 36.5092, lon: -86.885 },
  { name: 'Dickson', state: 'TN', tier: 3, lat: 36.077, lon: -87.3878 },
  { name: 'Shelbyville', state: 'TN', tier: 3, lat: 35.4834, lon: -86.4603 },
  { name: 'Tullahoma', state: 'TN', tier: 3, lat: 35.362, lon: -86.2094 },
  { name: 'Manchester', state: 'TN', tier: 3, lat: 35.4817, lon: -86.0886 },
  { name: 'McMinnville', state: 'TN', tier: 3, lat: 35.6834, lon: -85.77 },
  { name: 'Crossville', state: 'TN', tier: 3, lat: 35.949, lon: -85.0269 },
  { name: 'Lawrenceburg', state: 'TN', tier: 3, lat: 35.2423, lon: -87.3347 },
  { name: 'Waverly', state: 'TN', tier: 3, lat: 36.084, lon: -87.7947 },
  { name: 'Paris', state: 'TN', tier: 3, lat: 36.302, lon: -88.3267 },
  { name: 'Savannah', state: 'TN', tier: 3, lat: 35.2248, lon: -88.2492 },
  { name: 'Smyrna', state: 'TN', tier: 3, lat: 35.9828, lon: -86.5186 },
  { name: 'Hendersonville', state: 'TN', tier: 3, lat: 36.3048, lon: -86.62 },
  { name: 'Mount Juliet', state: 'TN', tier: 3, lat: 36.2, lon: -86.5186 },
  { name: 'Brentwood', state: 'TN', tier: 3, lat: 36.0331, lon: -86.7828 },
  { name: 'La Vergne', state: 'TN', tier: 3, lat: 36.0156, lon: -86.5819 },
  { name: 'Fayetteville', state: 'TN', tier: 3, lat: 35.152, lon: -86.5705 },
  { name: 'Winchester', state: 'TN', tier: 3, lat: 35.1859, lon: -86.1122 },
  { name: 'Livingston', state: 'TN', tier: 3, lat: 36.3834, lon: -85.323 },
  { name: 'Centerville', state: 'TN', tier: 3, lat: 35.779, lon: -87.467 },
  { name: 'Camden', state: 'TN', tier: 3, lat: 36.059, lon: -88.0978 },
  { name: 'Dyersburg', state: 'TN', tier: 3, lat: 36.0345, lon: -89.3856 },
  { name: 'Union City', state: 'TN', tier: 3, lat: 36.4242, lon: -89.057 },
  { name: 'Jamestown', state: 'TN', tier: 4, lat: 36.4276, lon: -84.9319 },
  { name: 'Linden', state: 'TN', tier: 4, lat: 35.6173, lon: -87.8395 },
  { name: 'Clifton', state: 'TN', tier: 4, lat: 35.387, lon: -87.9953 },
  { name: 'Ashland City', state: 'TN', tier: 4, lat: 36.2742, lon: -87.0642 },
  { name: 'Carthage', state: 'TN', tier: 4, lat: 36.2523, lon: -85.9517 },
  { name: 'Woodbury', state: 'TN', tier: 4, lat: 35.8276, lon: -86.0717 },
  { name: 'Pulaski', state: 'TN', tier: 4, lat: 35.1998, lon: -87.0308 },
  { name: 'Russellville', state: 'KY', tier: 4, lat: 36.8453, lon: -86.8872 },
  { name: 'Franklin', state: 'KY', tier: 4, lat: 36.7223, lon: -86.5772 },
  { name: 'Scottsville', state: 'KY', tier: 4, lat: 36.7534, lon: -86.1905 },
  { name: 'Fort Campbell', state: 'KY', tier: 4, lat: 36.6543, lon: -87.4606 },
];

/** Smallest zoom at which each tier is worth drawing. */
const TIER_MIN_ZOOM = { 1: 4, 2: 6, 3: 7, 4: 8 };

export function getBroadcastPlaces() {
  return BROADCAST_PLACES.map((place) => ({ ...place, minZoom: TIER_MIN_ZOOM[place.tier] ?? 8 }));
}

/**
 * County outlines for the radar coverage states.
 *
 * From the Census Bureau's TIGERweb service, which is public and key-free.
 * The NWS zone endpoint looked like the obvious source, but its
 * `include_geometry` flag is ignored on the list route - every feature comes
 * back with a null geometry, and pulling 600+ zones one at a time is not a
 * request this app is going to make.
 *
 * Geometry is generalised server-side to roughly 900 m: county lines on a
 * regional map need to read as boundaries, not survey data. Full precision is
 * 10 MB for Tennessee alone; this is about 70 KB.
 */
const TIGERWEB =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';

const STATE_FIPS = {
  AL: '01', AR: '05', GA: '13', KY: '21', NC: '37', SC: '45', TN: '47',
  FL: '12', IL: '17', IN: '18', LA: '22', MS: '28', MO: '29', OH: '39', VA: '51', WV: '54',
};

async function countiesForState(state) {
  const fips = STATE_FIPS[state];
  if (!fips) return [];

  const params = new URLSearchParams({
    where: `STATE='${fips}'`,
    outFields: 'NAME,STATE,GEOID',
    returnGeometry: 'true',
    outSR: '4326',
    // ~900 m simplification: boundary lines, not survey precision.
    maxAllowableOffset: '0.008',
    geometryPrecision: '4',
    f: 'geojson',
  });

  const data = await cachedJson(`counties:${state}`, 60 * 60 * 24 * 7, `${TIGERWEB}?${params}`);
  return (data?.features ?? [])
    .filter((feature) => feature.geometry)
    .map((feature) => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        id: feature.properties?.GEOID,
        name: feature.properties?.NAME,
        state,
      },
    }));
}

export async function getCountyBoundaries() {
  const states = config.radarStates;
  return withCache(`map:counties:${states.join(',')}`, 1000 * 60 * 60 * 24, async () => {
    const results = await Promise.allSettled(states.map((state) => countiesForState(state)));

    const features = [];
    for (const [i, result] of results.entries()) {
      if (result.status !== 'fulfilled') {
        // Never let a state fail silently: an empty map is indistinguishable
        // from "no counties" unless the reason is written down.
        console.warn(`[nc12] county boundaries for ${states[i]} failed: ${result.reason?.message}`);
        continue;
      }
      features.push(...result.value);
    }

    if (!features.length) {
      // Caching an empty collection would blank the map for a whole day.
      throw new Error('No county boundaries could be loaded from TIGERweb');
    }

    return { type: 'FeatureCollection', features, states, updatedAt: new Date().toISOString() };
  });
}
