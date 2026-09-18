import { useEffect, useRef } from 'react';
import type L from 'leaflet';
import { useLeafletMap } from '../../hooks/useLeafletMap';
import { buildLocationMarker, buildStationLayer } from './overlays';
import type { StationField } from './overlays';
import type { LatLon, StationObservation } from '../../api/types';

/** The plotted observation network used by the Weather Stations page. */
export function StationMap({
  stations,
  location,
  field,
  height = '480px',
}: {
  stations: StationObservation[];
  location: LatLon & { label?: string };
  field: StationField;
  height?: string;
}) {
  const { containerRef, map } = useLeafletMap({
    center: [location.lat, location.lon],
    zoom: 7,
    minZoom: 4,
    maxZoom: 11,
  });

  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    layerRef.current?.remove();
    if (!stations.length) return;
    const layer = buildStationLayer(stations, field);
    layer.addTo(map);
    layerRef.current = layer;
  }, [map, stations, field]);

  useEffect(() => {
    if (!map) return undefined;
    const marker = buildLocationMarker(location.lat, location.lon, location.label ?? 'Your location');
    marker.addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, location.lat, location.lon, location.label]);

  // Recentre when the viewer changes location.
  useEffect(() => {
    map?.setView([location.lat, location.lon], map.getZoom(), { animate: true });
  }, [map, location.lat, location.lon]);

  return <div ref={containerRef} style={{ height, width: '100%' }} role="application" aria-label="Weather station map" />;
}

export default StationMap;
