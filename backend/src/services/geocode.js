import config from '../config.js';
import { cachedJson } from '../lib/http.js';
import { withCache } from '../lib/cache.js';
import { getCountyZones, getZoneGeometry } from './nws.js';
import { distanceMiles } from '../lib/geo.js';

/**
 * Location search across three free, key-free providers:
 *   - Zippopotam.us for US ZIP codes
 *   - Open-Meteo's geocoder for city / place names
 *   - the NWS zone catalogue for county names inside the coverage area
 */
const ZIP_API = 'https://api.zippopotam.us/us';
const PLACE_API = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'Puerto Rico': 'PR',
};

const abbr = (state) => STATE_ABBR[state] ?? (state?.length === 2 ? state.toUpperCase() : state);

const isZip = (q) => /^\d{5}(-\d{4})?$/.test(q.trim());

async function searchZip(query) {
  const zip = query.trim().slice(0, 5);
  try {
    const data = await cachedJson(`zip:${zip}`, 60 * 60 * 24 * 30, `${ZIP_API}/${zip}`);
    return (data?.places ?? []).map((place) => ({
      id: `zip:${zip}`,
      type: 'zip',
      name: place['place name'],
      state: place['state abbreviation'],
      label: `${place['place name']}, ${place['state abbreviation']} ${zip}`,
      detail: `ZIP ${zip}`,
      lat: Number.parseFloat(place.latitude),
      lon: Number.parseFloat(place.longitude),
    }));
  } catch {
    return [];
  }
}

async function searchPlace(query, limit = 8) {
  const params = new URLSearchParams({ name: query, count: '20', language: 'en', format: 'json' });
  try {
    const data = await cachedJson(`place:${query.toLowerCase()}`, 60 * 60 * 24, `${PLACE_API}?${params}`);
    const results = data?.results ?? [];
    // The geocoder is global; a US local-news app ranks domestic hits first.
    const scored = results
      .map((r) => ({
        id: `place:${r.id}`,
        type: 'city',
        name: r.name,
        state: r.country_code === 'US' ? abbr(r.admin1) : r.admin1,
        country: r.country_code,
        county: r.admin2 ?? null,
        label:
          r.country_code === 'US'
            ? `${r.name}, ${abbr(r.admin1) ?? ''}`.trim().replace(/,$/, '')
            : `${r.name}, ${r.country ?? r.country_code}`,
        detail: r.admin2 ? `${r.admin2}${r.country_code === 'US' ? ' County' : ''}` : r.country,
        population: r.population ?? 0,
        lat: r.latitude,
        lon: r.longitude,
        domestic: r.country_code === 'US',
      }))
      .sort((a, b) => Number(b.domestic) - Number(a.domestic) || b.population - a.population);
    return scored.slice(0, limit);
  } catch {
    return [];
  }
}

/** Flat list of every county in the configured coverage area. */
export async function getCoverageCounties() {
  return withCache('coverage:counties', 1000 * 60 * 60 * 12, async () => {
    const settled = await Promise.allSettled(config.coverageStates.map((s) => getCountyZones(s)));
    const counties = [];
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const zone of result.value) {
        counties.push({
          id: zone.id,
          type: 'county',
          name: zone.name,
          state: zone.state,
          label: `${zone.name} County, ${zone.state}`,
          detail: `NWS ${zone.cwa?.[0] ?? ''} - zone ${zone.id}`,
          cwa: zone.cwa,
          timeZone: zone.timeZone,
        });
      }
    }
    counties.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
    return counties;
  });
}

async function searchCounty(query, limit = 6) {
  const counties = await getCoverageCounties();
  const q = query.toLowerCase().replace(/\s+county$/, '');
  return counties
    .filter((c) => c.name.toLowerCase().includes(q))
    .slice(0, limit)
    .map((c) => ({ ...c, lat: null, lon: null }));
}

/**
 * Unified search. Returns a mixed, ranked list of ZIPs, cities and counties so
 * one search box covers every way a viewer might name where they live.
 */
export async function search(query, { limit = 10 } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];

  if (isZip(q)) {
    const zips = await searchZip(q);
    if (zips.length) return zips.slice(0, limit);
  }

  const countySlots = Math.min(3, Math.max(1, Math.floor(limit / 3)));
  const [places, counties] = await Promise.all([searchPlace(q, limit), searchCounty(q, countySlots)]);

  // Cities lead - most searches are city searches - but counties always keep a
  // few reserved slots so "Fulton" still surfaces Fulton County.
  const kept = counties.slice(0, countySlots);
  const merged = [...places.slice(0, Math.max(0, limit - kept.length)), ...kept];
  return merged.slice(0, limit);
}

/** Resolve a county zone into a usable coordinate + geometry. */
export async function resolveCounty(zoneId) {
  const zone = await getZoneGeometry(zoneId);
  if (!zone?.centroid) return null;
  return {
    id: zone.id,
    type: 'county',
    name: zone.name,
    state: zone.state,
    label: `${zone.name} County, ${zone.state}`,
    lat: zone.centroid.lat,
    lon: zone.centroid.lon,
    geometry: zone.geometry,
    bounds: zone.bounds,
    cwa: zone.cwa,
    radarStation: zone.radarStation,
  };
}

/** Reverse geocode for the "use my location" button. */
export async function reverse(lat, lon) {
  const key = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`;
  try {
    const data = await cachedJson(
      key,
      60 * 60 * 24,
      `${REVERSE_API}?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    );
    const state = abbr(data?.principalSubdivision);
    const city = data?.city || data?.locality || data?.localityInfo?.administrative?.[3]?.name;
    return {
      id: `geo:${lat.toFixed(3)},${lon.toFixed(3)}`,
      type: 'coords',
      name: city || 'Current Location',
      state,
      // County comes from the authoritative NWS /points lookup, not from here.
      label: city && state ? `${city}, ${state}` : 'Current Location',
      lat,
      lon,
    };
  } catch {
    // Reverse geocoding is a nicety; the NWS point lookup still names the city.
    return { id: `geo:${lat.toFixed(3)},${lon.toFixed(3)}`, type: 'coords', name: 'Current Location', label: 'Current Location', lat, lon };
  }
}

/** Nearest coverage-area market to a coordinate, for ticker localisation. */
export function nearestMarket(lat, lon) {
  if (!config.tickerMarkets.length) return null;
  return config.tickerMarkets
    .map((m) => ({ ...m, distance: distanceMiles({ lat, lon }, m) }))
    .sort((a, b) => a.distance - b.distance)[0];
}
