import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useLeafletMap } from '../hooks/useLeafletMap';
import { useResource, useStoredState } from '../hooks';
import { useLocation } from '../context/LocationContext';
import {
  getAlertGeoJson,
  getMapLayers,
  getBroadcastPlaces,
  getCountyBoundaries,
  getNexradSweep,
  getRadarSites,
  getRadarFrames,
  getSpcOutlook,
  getStations,
  getStormReports,
  getStormTracks,
} from '../services/weather';
import type { MapLayerDef } from '../services/weather';
import { RadarAnimation } from '../components/radar/RadarAnimation';
import {
  buildAlertLayer,
  buildCountyLayer,
  buildPlaceLabels,
  buildRadarSiteLayer,
  buildLocationMarker,
  buildOutlookLayer,
  buildReportLayer,
  buildStationLayer,
  buildStormTrackLayer,
} from '../components/maps/overlays';
import type { StationField } from '../components/maps/overlays';
import { Slider, Spinner } from '../components/ui/Primitives';
import './WeatherMapPage.css';

/**
 * WEATHER MAP
 *
 * Unlike the radar page, which is built around one product at a time, this is
 * a stacking surface: any number of layers can be on at once, each with its
 * own opacity. Layer state persists between visits.
 */

const CATEGORY_LABELS: Record<string, string> = {
  radar: 'Radar & Precipitation',
  satellite: 'Satellite',
  surface: 'Surface Observations',
  alerts: 'Watches & Warnings',
  outlook: 'SPC Outlooks',
  reports: 'Storm Reports & Tracks',
};

const DEFAULT_ACTIVE = ['N0B', 'counties', 'places', 'radar-sites', 'warnings', 'watches'];

/**
 * Layer ids that have been replaced. Saved selections outlive a rename, so a
 * viewer who had the old NCEP WMS layers switched on would otherwise come back
 * to a map with a layer count and nothing drawn.
 */
const RENAMED_LAYERS: Record<string, string> = {
  reflectivity: 'N0B',
  velocity: 'N0S',
  'precip-type': 'N0B',
};

export function WeatherMapPage() {
  const { location, config } = useLocation();
  const { containerRef, map } = useLeafletMap({
    center: [location.lat, location.lon],
    // The default layer is now a single-site sweep with a ~460 km reach, so
    // the old continental framing left it a speck in the middle of the map.
    zoom: 7,
    minZoom: 3,
    maxZoom: 12,
    style: 'broadcast',
  });

  const [active, setActive] = useStoredState<string[]>('nc12.mapLayers', DEFAULT_ACTIVE);
  const [opacities, setOpacities] = useStoredState<Record<string, number>>('nc12.mapOpacity', {});
  // Closed by default so the map is the first thing you see - the panel is
  // an overlay, and opening it over the map on arrival read as broken.
  const [panelOpen, setPanelOpen] = useState(false);
  const [tuning, setTuning] = useState<string | null>(null);

  const layerRefs = useRef<Record<string, L.Layer | null>>({});
  const animationRef = useRef<RadarAnimation | null>(null);
  const satelliteRef = useRef<RadarAnimation | null>(null);

  const isOn = useCallback((id: string) => active.includes(id), [active]);
  const opacityFor = useCallback(
    (layer: MapLayerDef) => opacities[layer.id] ?? layer.defaultOpacity,
    [opacities],
  );

  /* --------------------------------------------------------------- data */

  const site = config?.defaultRadarSite ?? 'KOHX';
  const catalog = useResource((signal) => getMapLayers(site, signal), [site]);
  const frames = useResource((signal) => getRadarFrames(signal), [], { refreshMs: 120000 });
  const alerts = useResource((signal) => getAlertGeoJson({}, signal), [], {
    refreshMs: 60000,
    enabled: isOn('warnings') || isOn('watches') || isOn('advisories'),
  });
  const stations = useResource(
    (signal) => getStations({ ...location, radius: 260, limit: 250 }, signal),
    [location.lat, location.lon],
    {
      refreshMs: 300000,
      enabled: ['metar', 'wind', 'dewpoint', 'pressure', 'temperature'].some(isOn),
    },
  );
  const reports = useResource((signal) => getStormReports('today', signal), [], {
    refreshMs: 300000,
    enabled: isOn('reports'),
  });
  const storms = useResource((signal) => getStormTracks(location, 400, signal), [location.lat, location.lon], {
    refreshMs: 60000,
    enabled: isOn('tracks'),
  });
  const spcDay = active.find((id) => id.startsWith('spc-'))?.replace('spc-', '') ?? 'day1';
  const spc = useResource((signal) => getSpcOutlook(spcDay, 'cat', signal), [spcDay], {
    enabled: active.some((id) => id.startsWith('spc-')),
  });

  const layers = catalog.data?.layers ?? [];
  const grouped = useMemo(() => {
    const map_ = new Map<string, MapLayerDef[]>();
    for (const layer of layers) {
      if (!map_.has(layer.category)) map_.set(layer.category, []);
      map_.get(layer.category)!.push(layer);
    }
    return [...map_.entries()];
  }, [layers]);

  /* ------------------------------------------------------- layer syncing */

  const swap = useCallback(
    (id: string, layer: L.Layer | null) => {
      if (!map) return;
      const existing = layerRefs.current[id];
      if (existing) {
        map.removeLayer(existing);
        layerRefs.current[id] = null;
      }
      if (layer) {
        layer.addTo(map);
        layerRefs.current[id] = layer;
      }
    },
    [map],
  );

  // Animated radar mosaic.
  useEffect(() => {
    if (!map) return undefined;
    const animation = new RadarAnimation(map, { pane: 'nc-radar', opacity: opacities.composite ?? 0.8 });
    animationRef.current = animation;
    return () => {
      animation.destroy();
      animationRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const animation = animationRef.current;
    const source = frames.data?.data;
    if (!animation || !source) return;
    if (isOn('composite')) {
      animation.setFrames([...(source.radar?.past ?? []).slice(-4)], source, 'radar');
      animation.setOpacity(opacities.composite ?? 0.8);
    } else {
      animation.clear();
    }
  }, [frames.data, active, opacities.composite, isOn]);

  // Animated satellite.
  useEffect(() => {
    if (!map) return undefined;
    const animation = new RadarAnimation(map, { pane: 'nc-satellite', opacity: opacities.satellite ?? 0.7 });
    satelliteRef.current = animation;
    return () => {
      animation.destroy();
      satelliteRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const animation = satelliteRef.current;
    const source = frames.data?.data;
    if (!animation || !source) return;
    if (isOn('satellite')) {
      animation.setFrames((source.satellite ?? []).slice(-3), source, 'satellite');
      animation.setOpacity(opacities.satellite ?? 0.7);
    } else {
      animation.clear();
    }
  }, [frames.data, active, opacities.satellite, isOn]);

  // Reconcile a saved selection against the catalogue actually being served.
  useEffect(() => {
    if (!catalog.data?.layers?.length) return;
    const known = new Set(catalog.data.layers.map((l) => l.id));
    setActive((prev) => {
      const next = [...new Set(prev.map((id) => RENAMED_LAYERS[id] ?? id).filter((id) => known.has(id)))];
      const changed = next.length !== prev.length || next.some((id, i) => id !== prev[i]);
      // Never leave the map with no radar at all after a migration.
      if (!next.some((id) => known.has(id) && id.startsWith('N0'))) next.unshift('N0B');
      // Radar sites are new; turn them on for viewers with an older saved set.
      for (const added of ['radar-sites', 'counties', 'places']) {
        if (known.has(added) && !prev.includes(added) && !next.includes(added)) next.push(added);
      }
      return changed || next.length !== prev.length ? next : prev;
    });
  }, [catalog.data, setActive]);

  // The station's own Level III sweeps, decoded from AWS and placed as a
  // georeferenced image - the same pipeline the radar page uses.
  useEffect(() => {
    if (!map) return undefined;
    let cancelled = false;

    for (const layer of layers) {
      if (layer.type !== 'nexrad') continue;
      if (!isOn(layer.id) || !layer.available) {
        swap(layer.id, null);
        continue;
      }

      getNexradSweep(site, layer.id)
        .then((sweep) => {
          if (cancelled) return;
          const bounds = L.latLngBounds(
            [sweep.bounds.south, sweep.bounds.west],
            [sweep.bounds.north, sweep.bounds.east],
          );
          swap(
            layer.id,
            L.imageOverlay(`${sweep.imageUrl}?k=${encodeURIComponent(sweep.key)}`, bounds, {
              opacity: opacityFor(layer),
              pane: 'nc-radar',
              className: 'nc-radar-tiles',
              interactive: false,
            }),
          );
        })
        .catch(() => {
          if (!cancelled) swap(layer.id, null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [map, layers, active, opacities, isOn, opacityFor, swap, site]);

  // WMS-backed products (reflectivity, velocity, precipitation type).
  useEffect(() => {
    if (!map) return;
    for (const layer of layers) {
      if (layer.type !== 'wms') continue;
      if (!isOn(layer.id) || !layer.available || !layer.wms) {
        swap(layer.id, null);
        continue;
      }
      const tile = L.tileLayer.wms(layer.wms.url, {
        layers: layer.wms.layer,
        format: layer.wms.format ?? 'image/png',
        transparent: layer.wms.transparent ?? true,
        version: layer.wms.version ?? '1.1.1',
        pane: 'nc-radar',
        opacity: opacityFor(layer),
        tileSize: 512,
        crossOrigin: true,
        className: 'nc-radar-tiles',
      });
      swap(layer.id, tile);
    }
  }, [map, layers, active, opacities, isOn, opacityFor, swap]);

  // The WSR-88D network across the coverage area.
  const siteList = useResource((signal) => getRadarSites(location, 40, signal), [location.lat, location.lon]);

  useEffect(() => {
    if (!map) return;
    const sites = siteList.data?.sites ?? [];
    swap(
      'radar-sites',
      isOn('radar-sites') && sites.length ? buildRadarSiteLayer(sites, { activeId: site }) : null,
    );
  }, [map, siteList.data, active, isOn, swap, site, location.lat, location.lon]);

  // Broadcast furniture: county outlines and the station's city names.
  const counties = useResource((signal) => getCountyBoundaries(signal), []);
  const places = useResource((signal) => getBroadcastPlaces(signal), []);

  useEffect(() => {
    if (!map) return;
    swap(
      'counties',
      isOn('counties') && counties.data ? buildCountyLayer(counties.data, { broadcast: true }) : null,
    );
  }, [map, counties.data, active, isOn, swap]);

  useEffect(() => {
    if (!map) return undefined;
    const list = places.data?.places ?? [];
    const draw = () => swap('places', isOn('places') && list.length ? buildPlaceLabels(list, map) : null);
    draw();
    // Placement depends on where things land on screen, so a pan needs a
    // redraw just as much as a zoom does.
    map.on('zoomend moveend', draw);
    return () => {
      map.off('zoomend moveend', draw);
    };
  }, [map, places.data, active, isOn, swap]);

  // Alert polygons.
  useEffect(() => {
    if (!map) return;
    const kinds = new Set<string>();
    if (isOn('warnings')) kinds.add('warning');
    if (isOn('watches')) kinds.add('watch');
    if (isOn('advisories')) {
      kinds.add('advisory');
      kinds.add('statement');
    }
    swap('alerts', kinds.size && alerts.data ? buildAlertLayer(alerts.data, { kinds }) : null);
  }, [map, alerts.data, active, isOn, swap]);

  // Surface observation plots.
  useEffect(() => {
    if (!map) return;
    const list = stations.data?.stations ?? [];
    const fields: Array<[string, StationField]> = [
      ['temperature', 'temperature'],
      ['dewpoint', 'dewpoint'],
      ['wind', 'wind'],
      ['pressure', 'pressure'],
      ['metar', 'station'],
    ];
    for (const [id, field] of fields) {
      swap(id, isOn(id) && list.length ? buildStationLayer(list, field) : null);
    }
  }, [map, stations.data, active, isOn, swap]);

  useEffect(() => {
    if (!map) return;
    swap('reports', isOn('reports') && reports.data ? buildReportLayer(reports.data.reports) : null);
  }, [map, reports.data, active, isOn, swap]);

  useEffect(() => {
    if (!map) return;
    swap('tracks', isOn('tracks') && storms.data ? buildStormTrackLayer(storms.data.storms) : null);
  }, [map, storms.data, active, isOn, swap]);

  useEffect(() => {
    if (!map) return;
    const anySpc = active.some((id) => id.startsWith('spc-'));
    swap('spc', anySpc && spc.data ? buildOutlookLayer(spc.data) : null);
  }, [map, spc.data, active, swap]);

  // Viewer marker.
  useEffect(() => {
    if (!map) return undefined;
    const marker = buildLocationMarker(location.lat, location.lon, location.label);
    marker.addTo(map);
    return () => {
      marker.remove();
    };
  }, [map, location.lat, location.lon, location.label]);

  /* ------------------------------------------------------------ actions */

  const toggle = (layer: MapLayerDef) => {
    if (!layer.available) return;
    setActive((prev) => {
      if (prev.includes(layer.id)) return prev.filter((id) => id !== layer.id);
      // Only one SPC outlook day makes sense at a time.
      const cleaned = layer.id.startsWith('spc-') ? prev.filter((id) => !id.startsWith('spc-')) : prev;
      return [...cleaned, layer.id];
    });
  };

  const busy =
    frames.loading || alerts.refreshing || stations.refreshing || reports.refreshing || storms.refreshing;

  return (
    <div className="nc-map-page">
      <div className="nc-map-page__canvas" ref={containerRef} role="application" aria-label="Interactive weather map" />

      <div className="nc-map-page__caption nc-lower-third">
        <div>
          <span className="nc-lower-third__kicker">Storm 12 Weather</span>
          <span className="nc-lower-third__title">Interactive Weather Map</span>
        </div>
      </div>

      <button
        type="button"
        className={`nc-map-page__toggle${panelOpen ? ' is-open' : ''}`}
        onClick={() => setPanelOpen((o) => !o)}
        aria-expanded={panelOpen}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m3.5 12.5 8.5 4.7 8.5-4.7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        Layers
        <span className="nc-map-page__toggle-count">{active.length}</span>
      </button>

      {panelOpen && (
        <aside className="nc-map-page__panel nc-enter" aria-label="Map layers">
          <header>
            <h2>Map Layers</h2>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close layers panel">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="nc-map-page__panel-body">
            {catalog.loading && <Spinner size={22} label="Loading layers" />}

            {grouped.map(([category, items]) => (
              <section key={category}>
                <p className="nc-map-page__group">{CATEGORY_LABELS[category] ?? category}</p>
                <ul>
                  {items.map((layer) => {
                    const on = isOn(layer.id);
                    return (
                      <li key={layer.id}>
                        <button
                          type="button"
                          className={`nc-map-page__layer${on ? ' is-on' : ''}${layer.available ? '' : ' is-off'}`}
                          onClick={() => toggle(layer)}
                          disabled={!layer.available}
                          title={layer.available ? layer.name : layer.unavailableReason ?? undefined}
                        >
                          <span className="nc-map-page__check" aria-hidden="true">
                            {on && (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                                <path d="m5 12.5 5 5 9-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className="nc-map-page__layer-name">
                            {layer.name}
                            {layer.animated && <em>loop</em>}
                          </span>
                          {on && (
                            <span
                              className="nc-map-page__tune"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setTuning(tuning === layer.id ? null : layer.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  setTuning(tuning === layer.id ? null : layer.id);
                                }
                              }}
                              aria-label={`Adjust ${layer.name} opacity`}
                            >
                              {Math.round(opacityFor(layer) * 100)}%
                            </span>
                          )}
                        </button>

                        {!layer.available && layer.unavailableReason && (
                          <p className="nc-map-page__unavailable">{layer.unavailableReason}</p>
                        )}

                        {on && tuning === layer.id && (
                          <div className="nc-map-page__opacity">
                            <Slider
                              label="Opacity"
                              value={Math.round(opacityFor(layer) * 100)}
                              min={10}
                              max={100}
                              onChange={(value) =>
                                setOpacities((prev) => ({ ...prev, [layer.id]: value / 100 }))
                              }
                              format={(v) => `${v}%`}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <button type="button" className="nc-map-page__reset" onClick={() => setActive(DEFAULT_ACTIVE)}>
              Reset to default layers
            </button>
          </div>
        </aside>
      )}

      {busy && (
        <span className="nc-map-page__busy">
          <Spinner size={16} />
        </span>
      )}
    </div>
  );
}

export default WeatherMapPage;
