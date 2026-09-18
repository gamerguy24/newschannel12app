import L from 'leaflet';
import './overlays.css';
import { formatExpiry, formatTemp, formatTime, formatWind } from '../../utils/format';
import type { StationObservation, TrackedStorm } from '../../api/types';
import type { StormReport } from '../../services/weather';

/**
 * Vector overlay builders shared by the Radar page, the Weather Map and the
 * Broadcast Mode radar. Each returns a Leaflet layer group the caller adds,
 * removes or swaps without knowing anything about the underlying data shape.
 */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ----------------------------------------------------------------- alerts */

export interface AlertFeatureProps {
  id: string;
  event: string;
  kind: string;
  tier: string;
  color: string;
  headline: string;
  areaDesc: string;
  expires: string;
  isEmergency: boolean;
  office: string;
}

/** Warning / watch / advisory polygons, styled by product colour. */
export function buildAlertLayer(
  collection: GeoJSON.FeatureCollection,
  { kinds, onSelect }: { kinds?: Set<string>; onSelect?: (id: string) => void } = {},
): L.GeoJSON {
  return L.geoJSON(collection, {
    pane: 'nc-alerts',
    filter: (feature) => {
      const props = feature.properties as unknown as AlertFeatureProps;
      return !kinds || kinds.has(props.kind);
    },
    style: (feature) => {
      const props = feature?.properties as unknown as AlertFeatureProps;
      const warning = props?.kind === 'warning';
      return {
        color: props?.color ?? '#8FA3BF',
        weight: warning ? 2.6 : 1.8,
        opacity: 0.95,
        fillColor: props?.color ?? '#8FA3BF',
        fillOpacity: warning ? 0.22 : 0.1,
        // Watches read as a hatched boundary rather than a solid product.
        dashArray: props?.kind === 'watch' ? '7 5' : undefined,
        className: props?.isEmergency ? 'nc-alert-poly is-emergency' : 'nc-alert-poly',
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties as unknown as AlertFeatureProps;
      layer.bindPopup(
        `<div class="nc-popup">
           <span class="nc-popup__tag" style="background:${escapeHtml(p.color)}">${escapeHtml(p.kind)}</span>
           <h4>${escapeHtml(p.event)}</h4>
           <p>${escapeHtml(p.areaDesc)}</p>
           <p class="nc-popup__meta">Until ${escapeHtml(formatExpiry(p.expires))} · NWS ${escapeHtml(p.office)}</p>
         </div>`,
        { maxWidth: 300 },
      );
      if (onSelect) layer.on('click', () => onSelect(p.id));
    },
  });
}

/* ------------------------------------------------------------ storm tracks */

/**
 * The projected path of every tracked storm: current position, a leader line
 * along the motion vector, and time ticks at 15-minute intervals.
 */
export function buildStormTrackLayer(storms: TrackedStorm[]): L.LayerGroup {
  const group = L.layerGroup([], { pane: 'nc-tracks' });

  for (const storm of storms) {
    if (!storm.track?.length) continue;
    const points = storm.track.map((p) => [p.lat, p.lon] as [number, number]);

    L.polyline(points, {
      pane: 'nc-tracks',
      color: storm.color,
      weight: 3,
      opacity: 0.9,
      dashArray: '9 6',
      className: 'nc-storm-track',
    }).addTo(group);

    // Time ticks along the projected path.
    storm.track.slice(1).forEach((point) => {
      L.circleMarker([point.lat, point.lon], {
        pane: 'nc-tracks',
        radius: 4,
        color: storm.color,
        weight: 2,
        fillColor: '#04101c',
        fillOpacity: 1,
      })
        .bindTooltip(`+${point.minutes} min`, { direction: 'top', className: 'nc-map-tip' })
        .addTo(group);
    });

    // The storm itself.
    const head = storm.track[0];
    L.marker([head.lat, head.lon], {
      pane: 'nc-tracks',
      icon: L.divIcon({
        className: 'nc-storm-marker-wrap',
        html: `<span class="nc-storm-marker" style="--c:${escapeHtml(storm.color)}">
                 <span class="nc-storm-marker__pulse"></span>
                 <span class="nc-storm-marker__arrow" style="transform:rotate(${storm.movement.headingDeg}deg)"></span>
               </span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    })
      .bindPopup(
        `<div class="nc-popup">
           <span class="nc-popup__tag" style="background:${escapeHtml(storm.color)}">Storm</span>
           <h4>${escapeHtml(storm.event)}</h4>
           <p>Moving ${escapeHtml(storm.movement.text)}</p>
           <p>${escapeHtml(storm.positionText ?? '')}</p>
           <p class="nc-popup__meta">${escapeHtml(storm.potential.map((t) => t.label).join(' · '))}</p>
         </div>`,
        { maxWidth: 280 },
      )
      .addTo(group);
  }

  return group;
}

/* ------------------------------------------------------------ SPC outlooks */

export function buildOutlookLayer(collection: GeoJSON.FeatureCollection): L.GeoJSON {
  return L.geoJSON(collection, {
    pane: 'nc-outlook',
    style: (feature) => {
      const p = feature?.properties as { color?: string; stroke?: string } | undefined;
      return {
        color: p?.stroke ?? p?.color ?? '#8FA3BF',
        weight: 1.6,
        opacity: 0.9,
        fillColor: p?.color ?? '#8FA3BF',
        fillOpacity: 0.28,
      };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties as { label?: string; LABEL2?: string; code?: string };
      layer.bindPopup(
        `<div class="nc-popup">
           <span class="nc-popup__tag">SPC Outlook</span>
           <h4>${escapeHtml(p.LABEL2 ?? p.label ?? p.code ?? 'Risk area')}</h4>
           <p class="nc-popup__meta">Storm Prediction Center convective outlook</p>
         </div>`,
      );
    },
  });
}

/* ------------------------------------------------------------ storm reports */

const REPORT_STYLE: Record<string, { color: string; label: string }> = {
  tornado: { color: '#FF1B1B', label: 'Tornado' },
  wind: { color: '#3FD8FF', label: 'Wind' },
  hail: { color: '#22C55E', label: 'Hail' },
};

export function buildReportLayer(reports: StormReport[]): L.LayerGroup {
  const group = L.layerGroup([], { pane: 'nc-points' });
  for (const report of reports) {
    const style = REPORT_STYLE[report.type] ?? { color: '#FFB800', label: report.type };
    L.circleMarker([report.lat, report.lon], {
      pane: 'nc-points',
      radius: report.type === 'tornado' ? 7 : 5,
      color: '#04101c',
      weight: 1.4,
      fillColor: style.color,
      fillOpacity: 0.95,
    })
      .bindPopup(
        `<div class="nc-popup">
           <span class="nc-popup__tag" style="background:${style.color}">${style.label}</span>
           <h4>${escapeHtml(report.magnitudeLabel)}</h4>
           <p>${escapeHtml(report.location)}, ${escapeHtml(report.county)} County, ${escapeHtml(report.state)}</p>
           ${report.comments ? `<p>${escapeHtml(report.comments)}</p>` : ''}
           <p class="nc-popup__meta">Reported ${escapeHtml(report.time)}Z · SPC local storm report</p>
         </div>`,
        { maxWidth: 300 },
      )
      .addTo(group);
  }
  return group;
}

/* ---------------------------------------------------------------- stations */

export type StationField = 'temperature' | 'dewpoint' | 'wind' | 'pressure' | 'station';

/** Colour ramp for plotted surface temperatures / dew points. */
export function temperatureColor(value: number | null): string {
  if (value === null) return '#6C8299';
  const stops: Array<[number, string]> = [
    [-20, '#B57BFF'], [0, '#7B68EE'], [20, '#3FD8FF'], [32, '#00B4E6'],
    [45, '#22C55E'], [60, '#9ACD32'], [72, '#FFD400'], [85, '#FF8A1F'],
    [95, '#FF3D3D'], [110, '#B21E7B'],
  ];
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) return stops[i][1];
  }
  return stops[stops.length - 1][1];
}

/**
 * WEATHER STATIONS. `field` picks what the plot shows: a temperature value,
 * a dew point, a wind barb-style arrow, a pressure reading or the full
 * station dot coloured by flight category.
 */
export function buildStationLayer(stations: StationObservation[], field: StationField = 'temperature'): L.LayerGroup {
  const group = L.layerGroup([], { pane: 'nc-points' });

  for (const station of stations) {
    let html = '';

    if (field === 'temperature' || field === 'dewpoint') {
      const value = field === 'temperature' ? station.temperature : station.dewpoint;
      if (value === null) continue;
      html = `<span class="nc-obs nc-obs--value" style="--c:${temperatureColor(value)}">${Math.round(value)}</span>`;
    } else if (field === 'wind') {
      if (station.windSpeed === null) continue;
      const rotation = station.windDirection ?? 0;
      html = `<span class="nc-obs nc-obs--wind">
                <span class="nc-obs__arrow" style="transform:rotate(${rotation + 180}deg)"></span>
                <span class="nc-obs__wind-value">${Math.round(station.windSpeed)}</span>
              </span>`;
    } else if (field === 'pressure') {
      if (station.altimeter === null) continue;
      html = `<span class="nc-obs nc-obs--value" style="--c:#9DB3C9">${station.altimeter.toFixed(2)}</span>`;
    } else {
      html = `<span class="nc-obs nc-obs--dot" style="--c:${station.flightCategory.color}"></span>`;
    }

    L.marker([station.lat, station.lon], {
      pane: 'nc-points',
      icon: L.divIcon({ className: 'nc-obs-wrap', html, iconSize: [34, 22], iconAnchor: [17, 11] }),
      riseOnHover: true,
    })
      .bindPopup(stationPopup(station), { maxWidth: 320 })
      .addTo(group);
  }

  return group;
}

export function stationPopup(station: StationObservation): string {
  const row = (label: string, value: string) =>
    `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  return `<div class="nc-popup nc-popup--station">
      <span class="nc-popup__tag" style="background:${station.flightCategory.color}">${station.flightCategory.code}</span>
      <h4>${escapeHtml(station.id)}</h4>
      <p>${escapeHtml(station.name)}</p>
      <table class="nc-popup__table">
        ${row('Temperature', formatTemp(station.temperature))}
        ${row('Dew point', formatTemp(station.dewpoint))}
        ${row('Wind', formatWind(station.windSpeed, station.windCompass, station.windGust))}
        ${row('Gust', station.windGust ? `${station.windGust} mph` : 'None')}
        ${row('Pressure', station.altimeter ? `${station.altimeter.toFixed(2)} in` : '--')}
        ${row('Visibility', station.visibility === null ? '--' : `${station.visibility}${station.visibilityPlus ? '+' : ''} mi`)}
        ${row('Ceiling', station.ceiling === null ? 'Unlimited' : `${station.ceiling} ft`)}
        ${row('Weather', station.presentWeather ?? station.sky)}
        ${row('Observed', formatTime(station.observedAt))}
      </table>
      ${station.raw ? `<p class="nc-popup__raw">${escapeHtml(station.raw)}</p>` : ''}
    </div>`;
}

/* ------------------------------------------------------------ my location */

export function buildLocationMarker(lat: number, lon: number, label: string): L.Marker {
  return L.marker([lat, lon], {
    pane: 'nc-points',
    icon: L.divIcon({
      className: 'nc-here-wrap',
      html: `<span class="nc-here"><span class="nc-here__ring"></span><span class="nc-here__dot"></span></span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
    zIndexOffset: 1000,
  }).bindTooltip(label, { direction: 'top', offset: [0, -10], className: 'nc-map-tip' });
}

/**
 * County boundaries.
 *
 * On the broadcast basemap these are the thin dark lines that make a radar
 * return locatable - "the cell is over Rutherford County" only means something
 * if you can see the county. Drawn above the radar, since a boundary hidden
 * under reflectivity does not do its job.
 */
export function buildCountyLayer(
  collection: GeoJSON.FeatureCollection,
  { broadcast = false }: { broadcast?: boolean } = {},
): L.GeoJSON {
  return L.geoJSON(collection, {
    pane: broadcast ? 'nc-labels' : 'nc-outlook',
    interactive: false,
    style: broadcast
      ? // County lines are the primary linework on a broadcast map, so they
        // are drawn to be read at a glance: a bright red that separates from
        // both the grey ground and the muted road layer, at a weight that
        // survives being scaled down. A thin dark crimson disappeared.
        { color: '#f03028', weight: 1.7, opacity: 1, fill: false }
      : { color: '#2F5A7E', weight: 0.8, opacity: 0.65, fill: false },
  });
}

/* ------------------------------------------------------- broadcast places */

export interface BroadcastPlace {
  name: string;
  state: string;
  tier: number;
  lat: number;
  lon: number;
  minZoom: number;
}

/**
 * City names, drawn the way a weather map draws them: white, bold, heavily
 * haloed, and with no marker dot - the name IS the mark.
 *
 * Labels are placed in importance order and any that would collide with one
 * already on the map is dropped. Without that, a wide view turns the dense
 * middle of the market into "Clarks Springfield" and "Shell Manchester"; with
 * it, the map thins out on its own at every zoom instead of relying on a
 * hand-tuned threshold per town.
 */
export function buildPlaceLabels(places: BroadcastPlace[], map: L.Map): L.LayerGroup {
  const group = L.layerGroup([], { pane: 'nc-points' });
  const zoom = map.getZoom();

  const FONT_PX: Record<number, number> = { 1: 19, 2: 16, 3: 14, 4: 12 };
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];

  const candidates = places
    .filter((place) => zoom >= place.minZoom)
    .sort((a, b) => a.tier - b.tier);

  for (const place of candidates) {
    const point = map.latLngToContainerPoint([place.lat, place.lon]);
    const size = FONT_PX[place.tier] ?? 11;
    // Rough text metrics are enough here: the box only has to approximate the
    // glyph run closely enough to keep two names from touching.
    // Caps and letter-spacing run wider than mixed case: budget for it or
    // the collision test passes and the rendered names still touch.
    const halfWidth = (place.name.length * size * 0.68) / 2 + 8;
    const halfHeight = size * 0.85;

    const box = {
      left: point.x - halfWidth,
      right: point.x + halfWidth,
      top: point.y - halfHeight,
      bottom: point.y + halfHeight,
    };

    const collides = placed.some(
      (other) =>
        box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top,
    );
    if (collides) continue;
    placed.push(box);

    L.marker([place.lat, place.lon], {
      pane: 'nc-points',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'nc-place-wrap',
        html: `<span class="nc-place nc-place--t${place.tier}">${escapeHtml(place.name)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    }).addTo(group);
  }

  return group;
}

/* ----------------------------------------------------------- radar sites */

export interface RadarSiteMarker {
  id: string;
  name: string;
  lat: number;
  lon: number;
  state?: string;
  status?: string | null;
  distance?: number;
}

/**
 * The WSR-88D network across the coverage area.
 *
 * Plotting the sites is what makes a single-site product legible: a viewer can
 * see which radar is painting the storm they are looking at, and how far from
 * it they are. The site currently on screen is marked distinctly, and any
 * radar the NWS reports as down is flagged rather than quietly drawn as normal.
 */
export function buildRadarSiteLayer(
  sites: RadarSiteMarker[],
  { activeId, onSelect }: { activeId?: string; onSelect?: (id: string) => void } = {},
): L.LayerGroup {
  const group = L.layerGroup([], { pane: 'nc-points' });

  for (const site of sites) {
    if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon)) continue;

    const active = site.id === activeId;
    // The NWS reports status as "RDA - On-line" / "RDA - Maintenance Action
    // Required", so match the phrase rather than anchoring at the start.
    const offline = Boolean(site.status && !/on-?line/i.test(site.status));
    const classes = `nc-site${active ? ' is-active' : ''}${offline ? ' is-offline' : ''}`;

    const marker = L.marker([site.lat, site.lon], {
      pane: 'nc-points',
      icon: L.divIcon({
        className: 'nc-site-wrap',
        html: `<span class="${classes}">
                 <span class="nc-site__dot"></span>
                 <span class="nc-site__id">${escapeHtml(site.id)}</span>
               </span>`,
        iconSize: [58, 18],
        iconAnchor: [29, 9],
      }),
      riseOnHover: true,
      keyboard: false,
    });

    marker.bindTooltip(
      `${escapeHtml(site.id)} · ${escapeHtml(site.name)}${site.state ? `, ${escapeHtml(site.state)}` : ''}` +
        `${site.distance !== undefined ? ` · ${Math.round(site.distance)} mi` : ''}` +
        `${offline ? ' · OFFLINE' : ''}`,
      { direction: 'top', offset: [0, -10], className: 'nc-map-tip' },
    );

    if (onSelect) marker.on('click', () => onSelect(site.id));
    marker.addTo(group);
  }

  return group;
}
