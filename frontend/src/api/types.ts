/** Shapes returned by the Storm 12 weather API. */

export interface Envelope<T> {
  ok: true;
  fetchedAt: string;
  data: T;
  updatedAt?: string;
  stale?: boolean;
  fallback?: boolean;
  reason?: string;
  office?: string;
  type?: string;
  city?: string | null;
  state?: string | null;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface SavedLocation extends LatLon {
  id: string;
  type: 'city' | 'zip' | 'county' | 'coords';
  name: string;
  label: string;
  state?: string;
  detail?: string;
  zoneId?: string;
  nickname?: string;
}

export interface SearchResult extends Partial<LatLon> {
  id: string;
  type: SavedLocation['type'];
  name: string;
  label: string;
  state?: string;
  detail?: string;
  county?: string | null;
  population?: number;
}

/* ------------------------------------------------------------- conditions */

export type IconName =
  | 'clear-day' | 'clear-night' | 'partly-cloudy-day' | 'partly-cloudy-night'
  | 'mostly-cloudy' | 'cloudy' | 'rain' | 'showers' | 'thunderstorm' | 'snow'
  | 'sleet' | 'blizzard' | 'fog' | 'windy' | 'hot' | 'cold' | 'tornado' | 'hurricane';

export interface Observation {
  temperature: number | null;
  feelsLike: number | null;
  condition: string | null;
  icon: IconName;
  humidity: number | null;
  dewpoint: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windCompass: string | null;
  windGust: number | null;
  visibility: number | null;
  pressure: number | null;
  pressureTrend: { direction: 'rising' | 'falling' | 'steady'; changeInHg: number } | null;
  ceiling: number | null;
  heatIndex: number | null;
  windChill: number | null;
  observedAt: string | null;
  stationId: string | null;
  stationName: string | null;
  raw: string | null;
  source: string;
}

export interface CurrentConditions {
  location: {
    lat: number;
    lon: number;
    name: string;
    city?: string;
    state?: string;
    county?: string;
    timeZone: string | null;
    office?: string;
    radarStation?: string;
    forecastZone?: string;
  };
  observation: Observation;
  astronomy: {
    sunrise: string | null;
    sunset: string | null;
    sunriseTomorrow: string | null;
    sunsetTomorrow: string | null;
    isDaytime: boolean;
  };
  uv: { index: number | null; max: number | null; category: { label: string; color: string } | null };
  instability: { cape: number | null; liftedIndex: number | null };
  degraded: boolean;
}

export interface HourlyEntry {
  time: string;
  temperature: number | null;
  feelsLike: number | null;
  condition: string | null;
  icon: IconName;
  precipProbability: number | null;
  precipAmount: number | null;
  humidity: number | null;
  dewpoint: number | null;
  windSpeed: number | null;
  windDirection: string | null;
  windGust: number | null;
  stormProbability: number;
  isDaytime: boolean | null;
  source: 'nws' | 'model';
}

export interface DailyEntry {
  date: string;
  timestamp: string;
  name: string | null;
  high: number | null;
  low: number | null;
  icon: IconName;
  condition: string | null;
  detail: string | null;
  nightCondition: string | null;
  nightDetail: string | null;
  nightIcon: IconName | null;
  precipProbability: number | null;
  precipAmount: number | null;
  windSpeed: number | null;
  windDirection: string | null;
  windGust: number | null;
  humidity: number | null;
  dewpoint: number | null;
  /** Apparent-temperature range: what a heat-index graphic plots. */
  feelsHigh: number | null;
  feelsLow: number | null;
  uvIndexMax: number | null;
  sunrise: string | null;
  sunset: string | null;
  source: 'nws' | 'model';
}

/* ----------------------------------------------------------------- alerts */

export type AlertKind = 'warning' | 'watch' | 'advisory' | 'statement';
export type AlertTier = 'catastrophic' | 'severe' | 'moderate' | 'minor';
export type AlertGroup =
  | 'tornado' | 'thunderstorm' | 'flood' | 'winter' | 'tropical' | 'wind' | 'heat' | 'other';

export interface StormMotion {
  observedAt: string;
  directionFromDeg: number;
  directionFrom: string | null;
  headingDeg: number;
  heading: string | null;
  speedKt: number;
  speedMph: number;
  positions: LatLon[];
  raw: string;
}

export interface WeatherAlert {
  id: string;
  event: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areaDesc: string;
  areas: string[];
  severity: string;
  certainty: string;
  urgency: string;
  status: string;
  messageType: string;
  response: string;
  category: string;
  sent: string;
  effective: string;
  onset: string | null;
  expires: string;
  ends: string;
  senderName: string;
  office: string;
  kind: AlertKind;
  group: AlertGroup;
  tier: AlertTier;
  rank: number;
  color: string;
  isEmergency: boolean;
  ugc: string[];
  same: string[];
  nwsHeadline: string | null;
  threats: Record<string, string | null>;
  storm: StormMotion | null;
  geometry: GeoJSON.Geometry | null;
  centroid: LatLon | null;
  bounds: [number, number, number, number] | null;
  vtec: string | null;
  /** 'station' marks an alert written by the newsroom, not the NWS. */
  source?: 'station';
}

export interface StormPotential {
  id: string;
  label: string;
  detail: string | null;
  severity: 'low' | 'moderate' | 'high' | 'extreme';
}

export interface StormEta {
  minutes: number | null;
  distance: number;
  alongTrack?: number;
  crossTrack: number;
  status: 'approaching' | 'passing' | 'departing';
}

export interface TrackedStorm {
  id: string;
  event: string;
  kind: AlertKind;
  tier: AlertTier;
  color: string;
  isEmergency: boolean;
  headline: string | null;
  areas: string[];
  areaDesc: string;
  expires: string;
  office: string;
  position: LatLon;
  positionText: string | null;
  movement: {
    headingDeg: number;
    heading: string | null;
    directionFrom: string | null;
    speedMph: number;
    speedKt: number;
    text: string;
  };
  observedAt: string;
  track: Array<LatLon & { minutes: number; miles: number }>;
  eta: StormEta | null;
  distance: number | null;
  distanceToWarning: number | null;
  insideWarning: boolean;
  potential: StormPotential[];
  geometry: GeoJSON.Geometry | null;
  threats: Record<string, string | null>;
}

export interface BreakingWeather {
  active: boolean;
  takeover?: boolean;
  /** True when the newsroom, not the NWS, owns the banner. */
  fromStation?: boolean;
  alert?: WeatherAlert;
  storm?: {
    position: LatLon;
    positionText: string | null;
    movement: string;
    heading: string | null;
    speedMph: number;
    track: Array<LatLon & { minutes: number; miles: number }>;
    eta: StormEta | null;
    distance: number;
  } | null;
  potential?: StormPotential[];
  others?: WeatherAlert[];
  totalActive?: number;
  updatedAt: string;
}

/* ------------------------------------------------------------------ radar */

export interface RadarFrame {
  time: number;
  timestamp: string;
  path: string;
  kind: 'past' | 'forecast';
}

export interface RadarFrames {
  host: string;
  generated: string;
  radar: { past: RadarFrame[]; nowcast: RadarFrame[] };
  satellite: RadarFrame[];
  tileTemplate: string | null;
  satelliteTemplate?: string;
  stale?: boolean;
  frames?: Array<{ minutesAgo: number; timestamp: string; url: string }>;
  source?: string;
}

/** A WMS endpoint descriptor Leaflet can consume directly. */
export interface WmsDescriptor {
  url: string;
  layer: string;
  version?: string;
  format?: string;
  transparent?: boolean;
}

export interface RadarProduct {
  id: string;
  name: string;
  short: string;
  scope: 'site' | 'mosaic';
  animated: boolean;
  /** 'nexrad' is a Level III sweep our own backend decodes and renders. */
  type: 'nexrad' | 'rainviewer' | 'rainviewer-satellite' | 'wms' | 'xyz' | 'geojson' | 'observations';
  units?: string;
  url?: string | null;
  wms?: WmsDescriptor | null;
  /** Where to fetch the sweep's bounds and scan time, for 'nexrad'. */
  metaUrl?: string;
  description: string;
  available: boolean;
  unavailableReason?: string;
}

export interface RadarOverlay {
  id: string;
  name: string;
  type: string;
  filter?: string;
  default?: boolean;
}

export interface RadarPalette {
  id: number;
  name: string;
  description: string;
}

export interface RadarSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  status: string | null;
  lastReceived: string | null;
  distance?: number;
}

/* --------------------------------------------------------------- stations */

export interface StationObservation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  observedAt: string | null;
  temperature: number | null;
  dewpoint: number | null;
  relativeHumidity: number | null;
  windDirection: number | null;
  windCompass: string | null;
  windSpeed: number | null;
  windGust: number | null;
  visibility: number | null;
  visibilityPlus: boolean;
  altimeter: number | null;
  seaLevelPressure: number | null;
  ceiling: number | null;
  sky: string;
  presentWeather: string | null;
  flightCategory: { code: string; color: string };
  raw: string;
  distance?: number;
}

/* ---------------------------------------------------------------- tropics */

export interface TropicalStorm {
  id: string;
  name: string;
  basin: string | null;
  basinName: string;
  classification: string;
  classificationName: string;
  category: number | null;
  categoryLabel: string | null;
  color: string;
  maxWindsKt: number | null;
  maxWindsMph: number | null;
  pressureMb: number | null;
  lat: number | null;
  lon: number | null;
  movement: { heading: string | null; speedMph: number | null; text: string | null } | null;
  lastUpdate: string;
  advisoryNumber: string | null;
  products: Record<string, string | null>;
}

export interface TropicalTrackPoint extends LatLon {
  day: number;
  timeZ: string;
  maxWindsKt: number | null;
  maxWindsMph: number | null;
  category: number | null;
  categoryLabel: string | null;
  color: string;
}

/* ------------------------------------------------------------------- news */

export interface NewsStory {
  id: string;
  category: 'breaking' | 'severe' | 'local' | 'tropical' | 'forecast' | 'safety';
  headline: string;
  summary: string;
  publishedAt: string;
  source: string;
  thumbnail: { kind: 'graphic'; variant: string } | { kind: 'image'; url: string; alt: string };
  body: string | null;
  link: string | null;
  priority: number;
  meta: Record<string, unknown> | null;
}

/* ----------------------------------------------------------------- config */

export interface AppConfig {
  station: { name: string; shortName: string; market: string };
  defaultLocation: { lat: number; lon: number; name: string };
  /** The station's home NEXRAD, used whenever no site is chosen. */
  defaultRadarSite: string;
  coverageStates: string[];
  tickerMarkets: Array<{ name: string; lat: number; lon: number }>;
  liveStream: { available: boolean; type: string };
  sponsor: { name: string; tagline: string } | null;
  features: { lightning: boolean; stormRelativeVelocity: boolean; liveStream: boolean };
  sources: Array<{ id: string; name: string; url: string }>;
}

export interface CountySummary {
  id: string;
  type: 'county';
  name: string;
  state: string;
  label: string;
  detail: string;
  cwa: string[];
  timeZone?: string;
}

export interface TextProduct {
  id: string;
  productCode: string;
  productName: string;
  office: string;
  issuedAt: string;
  text: string;
  recent?: Array<{ id: string; issuedAt: string; office: string; name: string }>;
}

/* ------------------------------------------------------------- newsroom */

export type ClosingStatus = 'closed' | 'delayed' | 'early' | 'virtual' | 'open';

export interface SchoolClosing {
  id: string;
  name: string;
  status: ClosingStatus;
  detail: string;
  county: string;
  updatedAt: string;
}

export interface ClosingsFeed {
  closings: SchoolClosing[];
  statuses: Array<{ id: ClosingStatus; label: string }>;
  counts: { total: number; byStatus: Partial<Record<ClosingStatus, number>> };
  updatedAt: string | null;
}

export type StationAlertSeverity = 'critical' | 'important' | 'info';

/** An alert written by the newsroom, never an NWS product. */
export interface StationAlert {
  id: string;
  headline: string;
  body: string;
  severity: StationAlertSeverity;
  areas: string;
  issuedAt: string;
  expiresAt: string;
  source: 'station';
}

export interface OnAirState {
  takeover: {
    id: string;
    headline: string;
    detail: string;
    tier: 'catastrophic' | 'severe' | 'moderate';
    startedAt: string;
    expiresAt: string | null;
  } | null;
  forcedRadarSite: string | null;
  pinnedStoryId: string | null;
}

export interface StationGraphic {
  id: string;
  name: string;
  template: string;
  fields: Record<string, string>;
  updatedAt: string;
}

/** One forecast day as a graphic draws it. */
export interface GraphicDay {
  date: string;
  icon: string;
  high: number | null;
  low: number | null;
  feelsHigh: number | null;
  precipProbability: number | null;
}

/** One forecast hour, with its label already formatted in the station's zone. */
export interface GraphicHour {
  time: string;
  /** "3 PM" */
  label: string;
  /** 0-23, local to the station. */
  hour: number;
  /** "Today", "Tomorrow" or a weekday. */
  dayLabel: string;
  icon: string;
  temp: number | null;
  precip: number | null;
  condition: string;
}

/** A town on the area temperature map. */
export interface GraphicPlace {
  name: string;
  lat: number;
  lon: number;
  temp: number | null;
  /** Heat index where one applies, otherwise apparent temperature. */
  feels: number | null;
  icon: string;
}

/** One county under an alert, for the alert map. */
export interface GraphicAlertArea {
  /** County FIPS, matching the id on the county outlines. */
  id: string;
  label: string;
  color: string;
  rank: number;
}

/** One SPC convective outlook day. Level runs -1 (none), 0 (thunder), 1-5. */
export interface GraphicOutlook {
  day: string;
  label: string;
  level: number;
  color: string;
}

/** One SPC risk area, simplified for transport and drawn by the outlook map. */
export interface GraphicOutlookShape {
  level: number;
  label: string;
  color: string;
  /** Rings of [lon, lat]. */
  rings: Array<Array<[number, number]>>;
}

/** Everything a graphic template draws from, with every value resolved. */
export interface GraphicSnapshot {
  template: string;
  fields: Record<string, string>;
  days: GraphicDay[];
  hours?: GraphicHour[];
  places?: GraphicPlace[];
  outlooks?: GraphicOutlook[];
  areas?: GraphicAlertArea[];
  outlook?: GraphicOutlookShape[];
  icon: string;
  stamp: string;
  station: string;
  market: string;
}

/** The graphic on program, frozen at the moment it was taken. */
export interface ProgramGraphic extends GraphicSnapshot {
  id: string;
  name: string;
  /** The rundown item it was taken from, or '' for a one-off. */
  sourceId: string;
  takenAt: string;
}

export interface AdminState {
  station: { name: string; shortName: string; market: string };
  effective: {
    defaultLocation: { lat: number; lon: number; name: string };
    defaultRadarSite: string;
    coverageStates: string[];
    tickerMarkets: Array<{ name: string; lat: number; lon: number }>;
    sponsor: { name: string; tagline: string };
    liveStream: { url: string; type: string };
  };
  baseline: AdminState['effective'] & { station: AdminState['station'] };
  onAir: OnAirState;
  closings: SchoolClosing[];
  closingStatuses: Array<{ id: ClosingStatus; label: string }>;
  stationAlerts: StationAlert[];
  graphics: StationGraphic[];
  program: ProgramGraphic | null;
  overrides: Record<string, boolean>;
}

export interface SourceHealth {
  id: string;
  name: string;
  status: 'up' | 'slow' | 'down';
  ms: number;
  critical: boolean;
  error: string | null;
}

export interface AdminDiagnostics {
  uptimeSeconds: number;
  memoryMb: number;
  node: string;
  startedAt: string;
  cache: { entries: number; live: number; stale: number; inflight: number };
  errors: Array<{ at: string; method: string; url: string; status: number; message: string }>;
  sources: SourceHealth[];
  summary: { total: number; up: number; degraded: number; status: 'nominal' | 'degraded' | 'critical' };
  checkedAt: string;
}
