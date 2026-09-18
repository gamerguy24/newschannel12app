import { apiGet, apiGetEnvelope, apiGetRaw, apiStream } from '../api/client';
import type {
  AppConfig,
  BreakingWeather,
  CountySummary,
  CurrentConditions,
  DailyEntry,
  HourlyEntry,
  LatLon,
  NewsStory,
  RadarFrames,
  RadarOverlay,
  RadarPalette,
  RadarProduct,
  RadarSite,
  SearchResult,
  StationObservation,
  TextProduct,
  TrackedStorm,
  TropicalStorm,
  TropicalTrackPoint,
  WeatherAlert,
  WmsDescriptor,
} from '../api/types';

/**
 * WEATHER DATA SERVICE LAYER
 *
 * Every screen imports from here and nowhere else. Endpoint paths, query
 * shapes and provider quirks stay behind this boundary, so the API can be
 * repointed without touching a single component.
 */

const point = (loc: LatLon) => ({ lat: loc.lat, lon: loc.lon });

/* ----------------------------------------------------------------- config */

export const getAppConfig = () => apiGet<AppConfig>('/config');

export const getHealth = () =>
  apiGetRaw<{ ok: boolean; status: string; uptimeSeconds: number; cache: Record<string, number> }>('/health');

/* ------------------------------------------------------------- conditions */

export const getCurrent = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<CurrentConditions>('/weather/current', point(loc), { signal });

export const getHourly = (loc: LatLon, hours = 48, signal?: AbortSignal) =>
  apiGet<{ hours: HourlyEntry[]; source: string; degraded: boolean }>(
    '/weather/hourly',
    { ...point(loc), hours },
    { signal },
  );

export const getDaily = (loc: LatLon, days = 10, signal?: AbortSignal) =>
  apiGet<{ days: DailyEntry[]; source: string; degraded: boolean }>(
    '/weather/daily',
    { ...point(loc), days },
    { signal },
  );

/** Current conditions for the station's market list - the ticker towns. */
export const getMarkets = (signal?: AbortSignal) =>
  apiGet<{
    markets: Array<{ name: string; lat: number; lon: number; temperature: number | null; condition: string | null; icon: string }>;
  }>('/weather/markets', undefined, { signal });

export interface Overview {
  current: CurrentConditions | null;
  hourly: { hours: HourlyEntry[]; degraded: boolean };
  daily: { days: DailyEntry[]; degraded: boolean };
  breaking: BreakingWeather;
  errors: Array<{ section: string; error: string }>;
}

/** One request that fills the whole home screen. */
export const getOverview = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<Overview>('/weather/overview', point(loc), { signal });

export const getPointMetadata = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<{ gridId: string; radarStation: string; city: string; state: string; countyId: string; timeZone: string }>(
    '/weather/point',
    point(loc),
    { signal },
  );

/* ----------------------------------------------------------------- alerts */

export interface AlertFilterOptions {
  group?: string;
  kind?: string;
  tier?: string;
  event?: string;
  area?: string | string[];
  zone?: string;
}

export interface AlertFeed {
  alerts: WeatherAlert[];
  counts: {
    total: number;
    byKind: Record<string, number>;
    byGroup: Record<string, number>;
    byTier: Record<string, number>;
  };
  filters: {
    groups: Array<{ id: string; label: string }>;
    kinds: Array<{ id: string; label: string }>;
    tiers: Array<{ id: string; label: string }>;
  };
}

export const getAlerts = (
  params: (Partial<LatLon> & AlertFilterOptions) = {},
  signal?: AbortSignal,
) => apiGet<AlertFeed>('/alerts', params as Record<string, unknown>, { signal });

export interface SevereCenter {
  warnings: WeatherAlert[];
  watches: WeatherAlert[];
  advisories: WeatherAlert[];
  outlooks: Array<{
    day: string;
    available: boolean;
    maxRisk: { label: string; level: number; color: string; LABEL2?: string } | null;
    url?: string;
  }>;
  coverage: string[];
  counts: {
    warnings: number;
    watches: number;
    advisories: number;
    tornadoWarnings: number;
    emergencies: number;
  };
  filters: AlertFeed['filters'];
  updatedAt: string;
}

export const getSevereCenter = (area?: string[], signal?: AbortSignal) =>
  apiGet<SevereCenter>('/alerts/center', area ? { area } : undefined, { signal });

export const getBreaking = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<BreakingWeather>('/alerts/breaking', point(loc), { signal });

export const getStormTracks = (loc: LatLon, radius = 200, signal?: AbortSignal) =>
  apiGet<{ storms: TrackedStorm[]; reference: LatLon & { name: string }; count: number; updatedAt: string }>(
    '/alerts/storms',
    { ...point(loc), radius },
    { signal },
  );

export const getAlertGeoJson = (params: { area?: string[]; kind?: string } = {}, signal?: AbortSignal) =>
  apiGetRaw<GeoJSON.FeatureCollection>('/alerts/geojson', params as Record<string, unknown>, { signal });

/** Live alert push. The caller owns closing the returned EventSource. */
export const openAlertStream = (loc: LatLon) => apiStream('/alerts/stream', point(loc));

/* ------------------------------------------------------------------ radar */

export const getRadarFrames = (signal?: AbortSignal) =>
  apiGetEnvelope<RadarFrames>('/radar/frames', undefined, { signal });

export const getRadarProducts = (site: string, signal?: AbortSignal) =>
  apiGet<{ site: string; products: RadarProduct[]; overlays: RadarOverlay[]; palettes: RadarPalette[] }>(
    '/radar/products',
    { site },
    { signal },
  );

export const getRadarSites = (loc?: LatLon, limit = 15, signal?: AbortSignal) =>
  apiGet<{ sites: RadarSite[]; nearest?: RadarSite | null }>(
    '/radar/sites',
    loc ? { ...point(loc), limit } : undefined,
    { signal },
  );

/* -------------------------------------------------------------------- SPC */

export const getSpcOutlook = (day = 'day1', kind = 'cat', signal?: AbortSignal) =>
  apiGet<GeoJSON.FeatureCollection & { maxRisk: { label: string; color: string } | null; url: string }>(
    '/spc/outlook',
    { day, kind },
    { signal },
  );

export interface StormReport {
  type: 'tornado' | 'wind' | 'hail';
  time: string;
  magnitudeLabel: string;
  location: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  comments: string;
}

export const getStormReports = (day: 'today' | 'yesterday' = 'today', signal?: AbortSignal) =>
  apiGet<{ reports: StormReport[]; counts: Record<string, number>; day: string }>(
    '/spc/reports',
    { day },
    { signal },
  );

/* --------------------------------------------------------------- stations */

export const getStations = (
  params: (Partial<LatLon> & { radius?: number; limit?: number; bbox?: string }),
  signal?: AbortSignal,
) => apiGet<{ stations: StationObservation[]; count: number }>('/stations', params as Record<string, unknown>, { signal });

/* ---------------------------------------------------------------- tropics */

export const getTropics = (signal?: AbortSignal) =>
  apiGet<{
    storms: TropicalStorm[];
    updatedAt: string;
    outlooks: Array<{ basin: string; items: Array<{ title: string; summary: string; link: string; publishedAt: string }> }>;
    imagery: { images: Array<{ id: string; label: string; url: string }> };
    error: string | null;
  }>('/tropics', undefined, { signal });

export const getTropicalStorm = (id: string, signal?: AbortSignal) =>
  apiGet<{ storm: TropicalStorm; track: TropicalTrackPoint[]; raw: string }>(`/tropics/${id}`, undefined, { signal });

/* --------------------------------------------------------------- location */

export const searchLocations = (q: string, signal?: AbortSignal) =>
  apiGet<{ results: SearchResult[]; query: string }>('/location/search', { q }, { signal });

export const reverseGeocode = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<SearchResult & LatLon>('/location/reverse', point(loc), { signal });

export const getCounties = (q?: string, signal?: AbortSignal) =>
  apiGet<{ counties: CountySummary[]; total: number; states: string[] }>('/location/counties', { q }, { signal });

export interface CountyDetail {
  county: CountySummary & LatLon & { geometry: GeoJSON.Geometry; bounds: number[]; radarStation: string | null };
  current: CurrentConditions | null;
  hourly: { hours: HourlyEntry[] };
  daily: { days: DailyEntry[] };
  warnings: WeatherAlert[];
  watches: WeatherAlert[];
  advisories: WeatherAlert[];
  observations: StationObservation[];
  radarSites: RadarSite[];
  discussion: TextProduct | null;
}

export const getCountyDetail = (zoneId: string, signal?: AbortSignal) =>
  apiGet<CountyDetail>(`/location/county/${zoneId}`, undefined, { signal });

/* -------------------------------------------------------------- discussion */

export const getDiscussion = (
  params: { office?: string; type?: string } & Partial<LatLon>,
  signal?: AbortSignal,
) => apiGetEnvelope<TextProduct>('/weather/discussion', params as Record<string, unknown>, { signal });

export const getProduct = (id: string, signal?: AbortSignal) =>
  apiGet<TextProduct>(`/weather/product/${id}`, undefined, { signal });

/* ------------------------------------------------------------------- news */

export const getNews = (
  params: { category?: string; limit?: number } & Partial<LatLon> = {},
  signal?: AbortSignal,
) =>
  apiGet<{
    stories: NewsStory[];
    categories: Array<{ id: string; label: string; accent: string }>;
    counts: Record<string, number>;
    failures: Array<{ source: string; error: string }>;
  }>('/news', params as Record<string, unknown>, { signal });

/* ------------------------------------------------------------------- live */

export interface LiveWeather {
  stream: { available: boolean; type?: string; url?: string; title?: string; reason?: string };
  /** Where a viewer can go while the stream is dark - links, not a broadcast. */
  offAir: { radarSite: string };
  coverage: { status: 'normal' | 'watching' | 'severe'; label: string; alertCount: number };
  current: CurrentConditions | null;
  forecast: { days: DailyEntry[] };
  breaking: BreakingWeather;
}

export const getLive = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<LiveWeather>('/live', point(loc), { signal });

/* --------------------------------------------------------------- ticker */

export interface TickerItem {
  type: 'alert' | 'market';
  text: string;
  tier?: string;
  color?: string;
  icon?: string;
}

export const getTicker = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<{ items: TickerItem[]; alertCount: number; updatedAt: string }>('/weather/ticker', point(loc), { signal });

/* ------------------------------------------------------------- broadcast */

export interface BroadcastPayload {
  current: CurrentConditions | null;
  hourly: { hours: HourlyEntry[] };
  daily: { days: DailyEntry[] };
  breaking: BreakingWeather;
  storms: { storms: TrackedStorm[] };
  alerts: WeatherAlert[];
  markets: Array<{ name: string; temperature: number | null; icon: string }>;
  radarSite: string;
  sponsor: { name: string; tagline: string } | null;
  station: { name: string; market: string };
}

export const getBroadcast = (loc: LatLon, signal?: AbortSignal) =>
  apiGet<BroadcastPayload>('/broadcast', point(loc), { signal });

/* ------------------------------------------------------------------ maps */

export interface MapLayerDef {
  id: string;
  name: string;
  category: 'radar' | 'satellite' | 'surface' | 'alerts' | 'outlook' | 'reports';
  type: string;
  /** For 'nexrad' layers: where to read the sweep bounds and scan time. */
  metaUrl?: string | null;
  url?: string | null;
  wms?: WmsDescriptor | null;
  field?: string;
  filter?: string;
  day?: string;
  animated?: boolean;
  available: boolean;
  unavailableReason?: string | null;
  defaultOpacity: number;
}

export const getMapLayers = (site?: string, signal?: AbortSignal) =>
  apiGet<{
    layers: MapLayerDef[];
    site: string;
    basemaps: Array<{ id: string; name: string; url: string; attribution: string }>;
    lightning: { configured: boolean };
  }>('/map/layers', site ? { site } : undefined, { signal });

/* ------------------------------------------------- NEXRAD Level III (AWS) */

export interface NexradSweep {
  site: string;
  product: string;
  productName: string;
  units: string;
  elevationAngle: number;
  timestamp: string;
  bounds: { north: number; south: number; east: number; west: number };
  radar: { lat: number; lon: number };
  imageUrl: string;
  key: string;
  source: string;
}

/**
 * The newest Level III sweep for a site, decoded and rendered by our own
 * backend from NOAA's open data bucket. Returns where to place the image and
 * when the volume scan was taken.
 */
export const getNexradSweep = (site: string, product: string, signal?: AbortSignal) =>
  apiGet<NexradSweep>(`/radar/nexrad/${site}/${product}`, undefined, { signal });

/* -------------------------------------------------- broadcast map furniture */

export interface BroadcastPlaceDef {
  name: string;
  state: string;
  tier: number;
  lat: number;
  lon: number;
  minZoom: number;
}

/** County outlines across the coverage states, as one GeoJSON collection. */
export const getCountyBoundaries = (signal?: AbortSignal) =>
  apiGetRaw<GeoJSON.FeatureCollection>('/map/counties', undefined, { signal });

/** The towns this station puts on its map. */
export const getBroadcastPlaces = (signal?: AbortSignal) =>
  apiGet<{ places: BroadcastPlaceDef[] }>('/map/places', undefined, { signal });
