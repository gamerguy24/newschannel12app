import { getActiveAlerts } from './nws.js';
import { getOnAir, getStationIdentity, getStationWeatherAlerts } from './stationStore.js';
import {
  bearingDegrees,
  compassPoint,
  distanceMiles,
  distanceToGeometry,
  geometryCentroid,
  pointInGeometry,
  projectPoint,
} from '../lib/geo.js';

/**
 * STORM TRACKER
 *
 * Every NWS convective warning carries an `eventMotionDescription` parameter
 * with the storm's observed position, the direction it is coming from and its
 * speed in knots. That is a real, official storm vector - we turn it into the
 * track, the ETA to the viewer and the projected path drawn on the radar.
 */

/** How far ahead the projected path is drawn, in minutes. */
const TRACK_MINUTES = [0, 15, 30, 45, 60];

const THREAT_LABELS = {
  hail: (v) => (v ? `${v}" hail` : null),
  wind: (v) => (v ? `${v} wind` : null),
};

function buildPotential(alert) {
  const t = alert.threats ?? {};
  const potential = [];

  if (t.maxHailSize && Number.parseFloat(t.maxHailSize) > 0) {
    const size = Number.parseFloat(t.maxHailSize);
    potential.push({
      id: 'hail',
      label: size >= 2 ? 'Very Large Hail' : size >= 1 ? 'Large Hail' : 'Small Hail',
      detail: THREAT_LABELS.hail(t.maxHailSize),
      severity: size >= 2 ? 'high' : size >= 1 ? 'moderate' : 'low',
    });
  }
  if (t.maxWindGust) {
    const mph = Number.parseInt(String(t.maxWindGust).replace(/\D/g, ''), 10);
    if (Number.isFinite(mph)) {
      potential.push({
        id: 'wind',
        label: mph >= 80 ? 'Destructive Wind' : mph >= 60 ? 'Damaging Wind' : 'Gusty Wind',
        detail: THREAT_LABELS.wind(t.maxWindGust),
        severity: mph >= 80 ? 'high' : mph >= 60 ? 'moderate' : 'low',
      });
    }
  }
  if (t.tornadoDetection) {
    const observed = /observed/i.test(t.tornadoDetection);
    potential.push({
      id: 'tornado',
      label: observed ? 'Tornado Observed' : 'Tornado Possible',
      detail: t.tornadoDetection,
      severity: observed ? 'extreme' : 'high',
    });
  } else if (/tornado/i.test(alert.event)) {
    potential.push({ id: 'tornado', label: 'Tornado Possible', detail: 'Radar indicated', severity: 'high' });
  }
  if (t.waterspoutDetection) {
    potential.push({ id: 'waterspout', label: 'Waterspout', detail: t.waterspoutDetection, severity: 'high' });
  }
  if (t.flashFloodDetection || /flash flood/i.test(alert.event)) {
    potential.push({
      id: 'flood',
      label: 'Flash Flooding',
      detail: t.flashFloodDetection ?? 'Flash flooding expected',
      severity: t.flashFloodDamageThreat ? 'high' : 'moderate',
    });
  }
  // Any warned convective cell carries lightning; the NWS text says so
  // explicitly for severe thunderstorm and tornado warnings.
  if (/thunderstorm|tornado/i.test(alert.event)) {
    potential.push({ id: 'lightning', label: 'Frequent Lightning', detail: 'Cloud-to-ground strikes', severity: 'moderate' });
  }
  return potential;
}

/**
 * Project the storm forward along its motion vector and work out whether -
 * and when - it reaches the viewer.
 */
function buildTrack(origin, headingDeg, speedMph) {
  if (!origin || !Number.isFinite(headingDeg) || !Number.isFinite(speedMph) || speedMph <= 0) return [];
  return TRACK_MINUTES.map((minutes) => {
    const miles = (speedMph * minutes) / 60;
    const point = minutes === 0 ? origin : projectPoint(origin, headingDeg, miles);
    return { minutes, miles: Math.round(miles), ...point };
  });
}

/**
 * Time until the storm's path passes closest to `target`, using the
 * cross-track/along-track decomposition of the motion vector.
 */
function computeEta(origin, headingDeg, speedMph, target) {
  if (!origin || !target || !Number.isFinite(speedMph) || speedMph <= 0) return null;
  const distance = distanceMiles(origin, target);
  const bearingToTarget = bearingDegrees(origin, target);
  const angle = (((bearingToTarget - headingDeg) % 360) + 540) % 360 - 180;
  const alongTrack = distance * Math.cos((angle * Math.PI) / 180);
  const crossTrack = Math.abs(distance * Math.sin((angle * Math.PI) / 180));

  if (alongTrack <= 0) {
    return { minutes: null, distance: Math.round(distance), crossTrack: Math.round(crossTrack), status: 'departing' };
  }
  return {
    minutes: Math.round((alongTrack / speedMph) * 60),
    distance: Math.round(distance),
    alongTrack: Math.round(alongTrack),
    crossTrack: Math.round(crossTrack),
    // A storm passing more than 25 miles to the side is not a direct hit.
    status: crossTrack <= 25 ? 'approaching' : 'passing',
  };
}

/** "10 miles SW of Atlanta" - a broadcast-style relative position. */
function describePosition(stormPoint, reference) {
  if (!stormPoint || !reference?.lat) return null;
  const distance = Math.round(distanceMiles(reference, stormPoint));
  const bearing = bearingDegrees(reference, stormPoint);
  const dir = compassPoint(bearing);
  if (distance <= 3) return `over ${reference.name}`;
  return `${distance} miles ${dir} of ${reference.name}`;
}

/**
 * Build the storm tracker for a viewer location.
 *
 * @param {{lat:number, lon:number, name?:string}} location viewer position
 * @param {object} options
 */
export async function getStormTracks(location, { radiusMiles = 200, includeStatements = false } = {}) {
  // Pull the whole active set once, then filter locally: one upstream call
  // covers the tracker, the banner and the map overlay.
  const { alerts, updatedAt } = await getActiveAlerts({});

  const reference = { lat: location.lat, lon: location.lon, name: location.name ?? 'your location' };

  const tracked = alerts
    .filter((a) => {
      if (!a.storm || !a.storm.positions?.length) return false;
      if (!includeStatements && a.kind === 'statement') return false;
      return true;
    })
    .map((alert) => {
      const position = alert.storm.positions[alert.storm.positions.length - 1];
      const centroid = alert.centroid ?? geometryCentroid(alert.geometry);
      const origin = Number.isFinite(position?.lat) ? position : centroid;
      const { headingDeg, speedMph } = alert.storm;
      const track = buildTrack(origin, headingDeg, speedMph);
      const eta = computeEta(origin, headingDeg, speedMph, reference);
      const distanceToPolygon = alert.geometry ? distanceToGeometry(reference, alert.geometry) : null;

      return {
        id: alert.id,
        event: alert.event,
        kind: alert.kind,
        tier: alert.tier,
        color: alert.color,
        isEmergency: alert.isEmergency,
        headline: alert.headline,
        areas: alert.areas,
        areaDesc: alert.areaDesc,
        expires: alert.ends,
        office: alert.office,
        position: origin,
        positionText: describePosition(origin, reference),
        movement: {
          headingDeg,
          heading: alert.storm.heading,
          directionFrom: alert.storm.directionFrom,
          speedMph,
          speedKt: alert.storm.speedKt,
          text: `${alert.storm.heading} at ${speedMph} MPH`,
        },
        observedAt: alert.storm.observedAt,
        track,
        eta,
        distance: eta?.distance ?? (origin ? Math.round(distanceMiles(reference, origin)) : null),
        distanceToWarning: distanceToPolygon === null ? null : Math.round(distanceToPolygon),
        insideWarning: alert.geometry ? pointInGeometry(reference, alert.geometry) : false,
        potential: buildPotential(alert),
        geometry: alert.geometry,
        threats: alert.threats,
      };
    })
    .filter((s) => s.distance === null || s.distance <= radiusMiles)
    .sort((a, b) => {
      // Storms already over the viewer first, then by arrival time.
      if (a.insideWarning !== b.insideWarning) return a.insideWarning ? -1 : 1;
      const am = a.eta?.minutes ?? Infinity;
      const bm = b.eta?.minutes ?? Infinity;
      return am - bm || (a.distance ?? 0) - (b.distance ?? 0);
    });

  return {
    storms: tracked,
    reference,
    radiusMiles,
    updatedAt,
    count: tracked.length,
    source: 'NWS warning storm motion vectors',
  };
}

/**
 * The single alert that owns the BREAKING WEATHER banner, plus the storm
 * detail that goes with it.
 */
/**
 * The newsroom's manual takeover, shaped like an NWS product so every surface
 * that renders a breaking alert can render this one too.
 */
function takeoverAlert() {
  const { takeover } = getOnAir();
  if (!takeover) return null;
  const identity = getStationIdentity();
  const ends = takeover.expiresAt ?? new Date(Date.now() + 3600000).toISOString();
  return {
    id: takeover.id,
    event: `${identity.shortName} Breaking Weather`,
    headline: takeover.headline,
    description: takeover.detail || null,
    instruction: null,
    areaDesc: identity.market,
    areas: [],
    severity: 'Severe',
    certainty: 'Observed',
    urgency: 'Immediate',
    status: 'Actual',
    messageType: 'Alert',
    response: 'Monitor',
    category: 'Met',
    sent: takeover.startedAt,
    effective: takeover.startedAt,
    onset: takeover.startedAt,
    expires: ends,
    ends,
    senderName: identity.name,
    office: identity.shortName,
    kind: 'warning',
    group: 'other',
    tier: takeover.tier,
    rank: 0,
    color: takeover.tier === 'catastrophic' ? '#FF1B1B' : '#E01B24',
    isEmergency: takeover.tier === 'catastrophic',
    ugc: [],
    same: [],
    nwsHeadline: null,
    threats: {},
    storm: null,
    geometry: null,
    centroid: null,
    bounds: null,
    vtec: null,
    source: 'station',
  };
}

export async function getBreakingWeather(location) {
  const { alerts: nwsAlerts, updatedAt } = await getActiveAlerts({ point: `${location.lat},${location.lon}` });

  // Anything the newsroom has put on air leads, ahead of the automatic NWS
  // pick. This lives here rather than in a route so that every consumer -
  // the overview payload, Broadcast Mode, the banner - agrees on what is
  // breaking right now.
  const manual = takeoverAlert();
  const stationLead = manual ?? getStationWeatherAlerts().find((a) => a.kind === 'warning') ?? null;
  const alerts = stationLead ? [stationLead, ...nwsAlerts] : nwsAlerts;

  if (!alerts.length) return { active: false, updatedAt };

  const primary = alerts[0];
  const reference = { lat: location.lat, lon: location.lon, name: location.name ?? 'your location' };
  let storm = null;

  if (primary.storm?.positions?.length) {
    const position = primary.storm.positions[primary.storm.positions.length - 1];
    const { headingDeg, speedMph } = primary.storm;
    storm = {
      position,
      positionText: describePosition(position, reference),
      movement: `${primary.storm.heading} at ${speedMph} MPH`,
      heading: primary.storm.heading,
      speedMph,
      track: buildTrack(position, headingDeg, speedMph),
      eta: computeEta(position, headingDeg, speedMph, reference),
      distance: Math.round(distanceMiles(reference, position)),
    };
  }

  return {
    active: true,
    // Only warnings and emergencies take over the screen; watches and
    // advisories ride in the standard alert strip.
    takeover: primary.kind === 'warning',
    // A station-issued lead is flagged so the UI can label it honestly.
    fromStation: primary.source === 'station',
    alert: primary,
    storm,
    potential: buildPotential(primary),
    others: alerts.slice(1, 6),
    totalActive: alerts.length,
    updatedAt,
  };
}
