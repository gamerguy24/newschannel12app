import { useEffect, useRef } from 'react';
import type LType from 'leaflet';
import { L, useLeafletMap } from '../../hooks/useLeafletMap';
import type { TropicalStorm, TropicalTrackPoint } from '../../api/types';

/**
 * NHC FORECAST TRACK
 *
 * The current centre of a tropical system plus the official advisory track:
 * a dashed forecast line, a position marker at every advisory hour coloured
 * by the intensity forecast for that hour, and a pulsing marker on the
 * system itself. The map fits itself to whatever the NHC has published.
 */

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatPosition = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

export function TropicalMap({
  storm,
  track,
  height = '460px',
}: {
  storm: TropicalStorm;
  track: TropicalTrackPoint[];
  height?: string;
}) {
  const { containerRef, map } = useLeafletMap({
    center: [storm.lat ?? 25, storm.lon ?? -60],
    zoom: 4,
    minZoom: 2,
    maxZoom: 9,
  });

  const layerRef = useRef<LType.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return undefined;

    const group = L.layerGroup([], { pane: 'nc-tracks' }).addTo(map);
    const points: Array<[number, number]> = [];

    if (storm.lat !== null && storm.lon !== null) {
      points.push([storm.lat, storm.lon]);
    }

    // The forecast track, drawn from the current centre outward.
    const forecast = track.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const line: Array<[number, number]> = [
      ...(storm.lat !== null && storm.lon !== null ? [[storm.lat, storm.lon] as [number, number]] : []),
      ...forecast.map((p) => [p.lat, p.lon] as [number, number]),
    ];

    if (line.length > 1) {
      L.polyline(line, {
        pane: 'nc-tracks',
        color: storm.color,
        weight: 3,
        opacity: 0.9,
        dashArray: '10 7',
        className: 'nc-storm-track',
      }).addTo(group);
    }

    for (const point of forecast) {
      points.push([point.lat, point.lon]);
      L.circleMarker([point.lat, point.lon], {
        pane: 'nc-tracks',
        radius: 6,
        color: '#04101c',
        weight: 1.6,
        fillColor: point.color,
        fillOpacity: 0.95,
      })
        .bindTooltip(`${point.day}/${point.timeZ}Z · ${point.categoryLabel ?? 'TD'}`, {
          direction: 'top',
          className: 'nc-map-tip',
        })
        .bindPopup(
          `<div class="nc-popup">
             <span class="nc-popup__tag" style="background:${escapeHtml(point.color)}">${escapeHtml(
               point.categoryLabel ?? 'Forecast',
             )}</span>
             <h4>Day ${escapeHtml(point.day)} · ${escapeHtml(point.timeZ)}Z</h4>
             <p>${escapeHtml(formatPosition(point.lat, point.lon))}</p>
             <p class="nc-popup__meta">Max winds ${escapeHtml(point.maxWindsMph ?? '--')} mph</p>
           </div>`,
          { maxWidth: 260 },
        )
        .addTo(group);
    }

    // The system itself sits above its own track.
    if (storm.lat !== null && storm.lon !== null) {
      L.marker([storm.lat, storm.lon], {
        pane: 'nc-points',
        icon: L.divIcon({
          className: 'nc-storm-marker-wrap',
          html: `<span class="nc-storm-marker" style="--c:${escapeHtml(storm.color)}">
                   <span class="nc-storm-marker__pulse"></span>
                   <span class="nc-storm-marker__arrow" style="transform:rotate(0deg)"></span>
                 </span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: 1000,
      })
        .bindPopup(
          `<div class="nc-popup">
             <span class="nc-popup__tag" style="background:${escapeHtml(storm.color)}">${escapeHtml(
               storm.classificationName,
             )}</span>
             <h4>${escapeHtml(storm.name)}</h4>
             <p>${escapeHtml(formatPosition(storm.lat, storm.lon))}</p>
             <p>Max winds ${escapeHtml(storm.maxWindsMph ?? '--')} mph · ${escapeHtml(
               storm.pressureMb ?? '--',
             )} mb</p>
             <p class="nc-popup__meta">${escapeHtml(
               storm.movement?.text ?? 'Stationary',
             )} · Advisory ${escapeHtml(storm.advisoryNumber ?? '--')}</p>
           </div>`,
          { maxWidth: 280 },
        )
        .addTo(group);
    }

    layerRef.current = group;

    // Frame the whole published track, not just the current centre.
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.35), { animate: false });
    } else if (points.length === 1) {
      map.setView(points[0], 5, { animate: false });
    }

    return () => {
      group.remove();
      layerRef.current = null;
    };
  }, [map, storm, track]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%' }}
      role="application"
      aria-label={`Forecast track for ${storm.classificationName} ${storm.name}`}
    />
  );
}

export default TropicalMap;
