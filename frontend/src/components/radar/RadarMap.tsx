import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useLeafletMap } from '../../hooks/useLeafletMap';
import { RadarAnimation } from './RadarAnimation';
import RadarControls from './RadarControls';
import RadarLegend from './RadarLegend';
import LayerPanel from './LayerPanel';
import {
  buildAlertLayer,
  buildLocationMarker,
  buildOutlookLayer,
  buildReportLayer,
  buildCountyLayer,
  buildPlaceLabels,
  buildRadarSiteLayer,
  buildStationLayer,
  buildStormTrackLayer,
} from '../maps/overlays';
import {
  getAlertGeoJson,
  getRadarFrames,
  getRadarProducts,
  getBroadcastPlaces,
  getCountyBoundaries,
  getNexradSweep,
  getRadarSites,
  getSpcOutlook,
  getStations,
  getStormReports,
  getStormTracks,
} from '../../services/weather';
import { useResource } from '../../hooks';
import { formatTime } from '../../utils/format';
import { useLocation as useAppConfig } from '../../context/LocationContext';
import type { NexradSweep } from '../../services/weather';
import type { LatLon, RadarFrame, RadarProduct, RadarSite } from '../../api/types';
import './RadarMap.css';

/**
 * THE RADAR
 *
 * A full interactive NEXRAD surface: an animated national mosaic, official
 * per-site NOAA products (reflectivity, velocity, hydrometeor class, storm
 * total precipitation), satellite, and every vector overlay a severe weather
 * broadcast needs stacked on top.
 */

export interface RadarMapProps {
  location: LatLon & { name?: string; label?: string };
  initialSite?: string;
  height?: string;
  compact?: boolean;
  focusStormId?: string | null;
}

const OVERLAY_DEFAULTS: Record<string, boolean> = {
  warnings: true,
  watches: true,
  advisories: false,
  tracks: true,
  spc: false,
  reports: false,
  stations: false,
  sites: true,
  counties: true,
  places: true,
};

const SPEEDS = [
  { label: '0.5×', value: 900 },
  { label: '1×', value: 450 },
  { label: '2×', value: 220 },
  { label: '4×', value: 110 },
];

export function RadarMap({ location, initialSite, height = '100%', compact, focusStormId }: RadarMapProps) {
  const { containerRef, map } = useLeafletMap({
    center: [location.lat, location.lon],
    zoom: compact ? 7 : 8,
    interactive: true,
    zoomControl: !compact,
    style: 'broadcast',
  });

  // The station's own Level III radar is what leads; the national mosaic
  // stays available as a separate product.
  const [productId, setProductId] = useState('N0B');
  const { config } = useAppConfig();
  const homeSite = config?.defaultRadarSite ?? 'KOHX';
  const [site, setSite] = useState(initialSite ?? homeSite);
  const [palette, setPalette] = useState(4);
  const [opacity, setOpacity] = useState(0.82);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(450);
  const [frameIndex, setFrameIndex] = useState(0);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [overlays, setOverlays] = useState<Record<string, boolean>>(() => ({ ...OVERLAY_DEFAULTS }));
  const [panelOpen, setPanelOpen] = useState(false);
  const [spcDay, setSpcDay] = useState<'day1' | 'day2' | 'day3'>('day1');
  const [sweepInfo, setSweepInfo] = useState<NexradSweep | null>(null);
  // Volume scans land every 4-6 minutes; this nudge re-fetches the newest.
  const [sweepNonce, setSweepNonce] = useState(0);

  const animationRef = useRef<RadarAnimation | null>(null);
  const staticLayerRef = useRef<L.Layer | null>(null);
  const overlayRefs = useRef<Record<string, L.Layer | null>>({});
  const markerRef = useRef<L.Marker | null>(null);

  /* ------------------------------------------------------------- data */

  const framesResource = useResource((signal) => getRadarFrames(signal), [], { refreshMs: 120000 });
  const productsResource = useResource((signal) => getRadarProducts(site, signal), [site]);
  const sitesResource = useResource((signal) => getRadarSites(location, 40, signal), [location.lat, location.lon]);
  const alertsResource = useResource((signal) => getAlertGeoJson({}, signal), [], { refreshMs: 60000 });
  const countiesResource = useResource((signal) => getCountyBoundaries(signal), []);
  const placesResource = useResource((signal) => getBroadcastPlaces(signal), []);
  const stormsResource = useResource((signal) => getStormTracks(location, 300, signal), [location.lat, location.lon], {
    refreshMs: 60000,
  });
  const spcResource = useResource((signal) => getSpcOutlook(spcDay, 'cat', signal), [spcDay], {
    enabled: overlays.spc,
  });
  const reportsResource = useResource((signal) => getStormReports('today', signal), [], {
    enabled: overlays.reports,
    refreshMs: 300000,
  });
  const stationsResource = useResource(
    (signal) => getStations({ ...location, radius: 150, limit: 120 }, signal),
    [location.lat, location.lon],
    { enabled: overlays.stations, refreshMs: 300000 },
  );

  const frames = framesResource.data?.data;
  const usingFallback = Boolean(framesResource.data?.fallback);
  const products = productsResource.data?.products ?? [];
  const product = useMemo<RadarProduct | undefined>(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  const activeFrames: RadarFrame[] = useMemo(() => {
    if (!frames) return [];
    if (productId === 'satellite') return frames.satellite ?? [];
    return [...(frames.radar?.past ?? []), ...(frames.radar?.nowcast ?? [])];
  }, [frames, productId]);

  const isAnimated = product?.animated ?? false;

  /* -------------------------------------------------- animated products */

  useEffect(() => {
    if (!map) return undefined;
    const animation = new RadarAnimation(map, {
      pane: productId === 'satellite' ? 'nc-satellite' : 'nc-radar',
      opacity,
      palette,
      onFrameChange: (index) => setFrameIndex(index),
      onLoadingChange: setTilesLoading,
    });
    animationRef.current = animation;
    return () => {
      animation.destroy();
      animationRef.current = null;
    };
    // A palette or pane change means a whole new layer set.
  }, [map, palette, productId === 'satellite']);

  useEffect(() => {
    const animation = animationRef.current;
    if (!animation || !frames || !isAnimated) return;
    animation.setFrames(activeFrames, frames, productId === 'satellite' ? 'satellite' : 'radar');
    setFrameIndex(animation.currentIndex);
  }, [activeFrames, frames, isAnimated, productId]);

  useEffect(() => {
    animationRef.current?.setOpacity(opacity);
  }, [opacity]);

  /* ---------------------------------------------------- static products */

  useEffect(() => {
    if (!map) return undefined;

    // Tear down whatever static layer was showing.
    if (staticLayerRef.current) {
      map.removeLayer(staticLayerRef.current);
      staticLayerRef.current = null;
    }

    if (!product || product.animated || !product.available) return undefined;

    if (product.type === 'wms' && product.wms) {
      // Leaflet builds the GetMap request (bbox, size, CRS) from this
      // descriptor, so nothing here has to know the WMS wire format.
      const layer = L.tileLayer.wms(product.wms.url, {
        layers: product.wms.layer,
        format: product.wms.format ?? 'image/png',
        transparent: product.wms.transparent ?? true,
        version: product.wms.version ?? '1.1.1',
        pane: 'nc-radar',
        opacity,
        tileSize: 512,
        crossOrigin: true,
        maxZoom: 14,
        className: 'nc-radar-tiles',
      });
      layer.addTo(map);
      staticLayerRef.current = layer;
    } else if (product.type === 'nexrad') {
      // A finished, georeferenced PNG: the browser never decodes radar data.
      let cancelled = false;
      getNexradSweep(site, product.id)
        .then((sweep) => {
          if (cancelled || !map) return;
          const bounds = L.latLngBounds(
            [sweep.bounds.south, sweep.bounds.west],
            [sweep.bounds.north, sweep.bounds.east],
          );
          // Cache-bust on the scan key so a new volume scan actually repaints.
          const overlay = L.imageOverlay(`${sweep.imageUrl}?k=${encodeURIComponent(sweep.key)}`, bounds, {
            opacity,
            pane: 'nc-radar',
            className: 'nc-radar-tiles',
            interactive: false,
          });
          overlay.addTo(map);
          staticLayerRef.current = overlay;
          setSweepInfo(sweep);
        })
        .catch(() => {
          if (!cancelled) setSweepInfo(null);
        });
      return () => {
        cancelled = true;
        if (staticLayerRef.current) {
          map.removeLayer(staticLayerRef.current);
          staticLayerRef.current = null;
        }
      };
    } else if (product.type === 'xyz' && product.url) {
      const layer = L.tileLayer(product.url, { pane: 'nc-radar', opacity, crossOrigin: true });
      layer.addTo(map);
      staticLayerRef.current = layer;
    } else if (product.type === 'observations') {
      const stations = stationsResource.data?.stations ?? [];
      const layer = buildStationLayer(stations, 'temperature');
      layer.addTo(map);
      staticLayerRef.current = layer;
    }

    return () => {
      if (staticLayerRef.current) {
        map.removeLayer(staticLayerRef.current);
        staticLayerRef.current = null;
      }
    };
  }, [map, product, opacity, stationsResource.data, site, sweepNonce]);

  // The surface temperature product needs station data even when the
  // stations overlay is off, so request it when that product is selected.
  useEffect(() => {
    if (productId === 'temperature' && !overlays.stations) {
      setOverlays((prev) => ({ ...prev, stations: prev.stations }));
    }
  }, [productId, overlays.stations]);

  /* -------------------------------------------------------- playback */

  useEffect(() => {
    if (!playing || !isAnimated) return undefined;
    animationRef.current?.preloadAll();
    const timer = window.setInterval(() => {
      const animation = animationRef.current;
      if (!animation) return;
      const wrapped = animation.advance();
      // Hold on the newest sweep for a beat before looping, the way an
      // on-air loop pauses on "now".
      if (wrapped) window.setTimeout(() => undefined, 0);
    }, speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, isAnimated]);

  /* --------------------------------------------------------- overlays */

  const syncOverlay = useCallback(
    (id: string, layer: L.Layer | null) => {
      if (!map) return;
      const existing = overlayRefs.current[id];
      if (existing) {
        map.removeLayer(existing);
        overlayRefs.current[id] = null;
      }
      if (layer && overlays[id]) {
        layer.addTo(map);
        overlayRefs.current[id] = layer;
      }
    },
    [map, overlays],
  );

  useEffect(() => {
    if (!map || !alertsResource.data) return;
    const warnings = overlays.warnings ? ['warning'] : [];
    const watches = overlays.watches ? ['watch'] : [];
    const advisories = overlays.advisories ? ['advisory', 'statement'] : [];
    const kinds = new Set([...warnings, ...watches, ...advisories]);
    const layer = kinds.size ? buildAlertLayer(alertsResource.data, { kinds }) : null;
    syncOverlay('alerts', kinds.size ? layer : null);
  }, [map, alertsResource.data, overlays.warnings, overlays.watches, overlays.advisories, syncOverlay]);

  useEffect(() => {
    if (!map) return;
    const storms = stormsResource.data?.storms ?? [];
    syncOverlay('tracks', overlays.tracks && storms.length ? buildStormTrackLayer(storms) : null);
  }, [map, stormsResource.data, overlays.tracks, syncOverlay]);

  useEffect(() => {
    if (!map) return;
    syncOverlay('spc', overlays.spc && spcResource.data ? buildOutlookLayer(spcResource.data) : null);
  }, [map, spcResource.data, overlays.spc, syncOverlay]);

  useEffect(() => {
    if (!map) return;
    const reports = reportsResource.data?.reports ?? [];
    syncOverlay('reports', overlays.reports && reports.length ? buildReportLayer(reports) : null);
  }, [map, reportsResource.data, overlays.reports, syncOverlay]);

  useEffect(() => {
    if (!map) return;
    const stations = stationsResource.data?.stations ?? [];
    syncOverlay('stations', overlays.stations && stations.length ? buildStationLayer(stations, 'station') : null);
  }, [map, stationsResource.data, overlays.stations, syncOverlay]);

  useEffect(() => {
    if (!map) return;
    const sites = sitesResource.data?.sites ?? [];
    syncOverlay(
      'sites',
      overlays.sites && sites.length
        ? buildRadarSiteLayer(sites, { activeId: site, onSelect: (id) => setSite(id) })
        : null,
    );
  }, [map, sitesResource.data, overlays.sites, site, syncOverlay]);

  useEffect(() => {
    if (!map) return;
    syncOverlay(
      'counties',
      overlays.counties && countiesResource.data
        ? buildCountyLayer(countiesResource.data, { broadcast: true })
        : null,
    );
  }, [map, countiesResource.data, overlays.counties, syncOverlay]);

  // Place names are rebuilt on zoom so smaller towns appear and disappear at
  // the right scale instead of all 48 stacking on top of each other.
  useEffect(() => {
    if (!map) return undefined;
    const places = placesResource.data?.places ?? [];
    const draw = () =>
      syncOverlay(
        'places',
        overlays.places && places.length ? buildPlaceLabels(places, map) : null,
      );
    draw();
    // Placement depends on where things land on screen, so a pan needs a
    // redraw just as much as a zoom does.
    map.on('zoomend moveend', draw);
    return () => {
      map.off('zoomend moveend', draw);
    };
  }, [map, placesResource.data, overlays.places, syncOverlay]);

  /* --------------------------------------------------- viewer marker */

  useEffect(() => {
    if (!map) return undefined;
    markerRef.current?.remove();
    const marker = buildLocationMarker(location.lat, location.lon, location.label ?? location.name ?? 'Your location');
    marker.addTo(map);
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, location.lat, location.lon, location.label, location.name]);

  /* --------------------------------------------- next volume scan */

  useEffect(() => {
    if (product?.type !== 'nexrad') return undefined;
    // The WSR-88D completes a volume scan every 4-6 minutes; checking every
    // 90 seconds picks up a new one shortly after it lands in the bucket.
    const timer = window.setInterval(() => setSweepNonce((n) => n + 1), 90000);
    return () => window.clearInterval(timer);
  }, [product?.type]);

  /* ------------------------------------------------ site auto-select */

  useEffect(() => {
    const nearest = sitesResource.data?.nearest;
    if (!initialSite && nearest && site === homeSite) setSite(nearest.id);
  }, [sitesResource.data, initialSite, site, homeSite]);

  /* -------------------------------------------- storm deep-link focus */

  useEffect(() => {
    if (!map || !focusStormId) return;
    const storm = stormsResource.data?.storms.find((s) => s.id === focusStormId);
    if (storm?.position) {
      map.flyTo([storm.position.lat, storm.position.lon], 9, { duration: 0.9 });
    }
  }, [map, focusStormId, stormsResource.data]);

  /* --------------------------------------------------------- actions */

  const recenter = useCallback(() => {
    map?.flyTo([location.lat, location.lon], Math.max(map.getZoom(), 8), { duration: 0.8 });
  }, [map, location.lat, location.lon]);

  const jumpToSite = useCallback(
    (nextSite: RadarSite) => {
      setSite(nextSite.id);
      map?.flyTo([nextSite.lat, nextSite.lon], 8, { duration: 0.9 });
    },
    [map],
  );

  const currentFrame = activeFrames[frameIndex] ?? null;

  return (
    <div className="nc-radar" style={{ height }}>
      <div className="nc-radar__canvas" ref={containerRef} role="application" aria-label="Interactive weather radar" />

      <div className="nc-radar__topleft">
        <div className="nc-radar__caption nc-lower-third">
          <div>
            <span className="nc-lower-third__kicker">
              {product?.type === 'nexrad'
                ? `${site} · Level III · ${sweepInfo?.elevationAngle ?? 0.5}° tilt`
                : product?.scope === 'site'
                  ? `${site} · Single Site`
                  : 'National Mosaic'}
            </span>
            <span className="nc-lower-third__title">{product?.name ?? 'NEXRAD Radar'}</span>
            {sweepInfo && product?.type === 'nexrad' && (
              <span className="nc-radar__scan nc-readout">
                Scan {formatTime(sweepInfo.timestamp)} · {sweepInfo.source}
              </span>
            )}
          </div>
        </div>

        {!compact && (
          <button
            type="button"
            className={`nc-radar__layers-btn${panelOpen ? ' is-open' : ''}`}
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="m3.5 12.5 8.5 4.7 8.5-4.7M3.5 16.6l8.5 4.7 8.5-4.7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            Layers
          </button>
        )}
      </div>

      {panelOpen && (
        <LayerPanel
          products={products}
          productId={productId}
          onProduct={setProductId}
          overlays={overlays}
          onToggleOverlay={(id) => setOverlays((prev) => ({ ...prev, [id]: !prev[id] }))}
          palettes={productsResource.data?.palettes ?? []}
          palette={palette}
          onPalette={setPalette}
          opacity={opacity}
          onOpacity={setOpacity}
          sites={sitesResource.data?.sites ?? []}
          site={site}
          onSite={jumpToSite}
          spcDay={spcDay}
          onSpcDay={setSpcDay}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <RadarLegend product={product} palette={palette} compact={compact} />

      <RadarControls
        playing={playing}
        onPlay={() => setPlaying((p) => !p)}
        onStep={(direction) => {
          setPlaying(false);
          if (direction > 0) animationRef.current?.next();
          else animationRef.current?.previous();
        }}
        onScrub={(index) => {
          setPlaying(false);
          animationRef.current?.goTo(index);
        }}
        frameIndex={frameIndex}
        frames={activeFrames}
        currentFrame={currentFrame}
        speed={speed}
        speeds={SPEEDS}
        onSpeed={setSpeed}
        onRecenter={recenter}
        onZoom={(delta) => map?.setZoom(map.getZoom() + delta)}
        loading={tilesLoading || framesResource.loading}
        animated={isAnimated}
        staticTimestamp={product?.type === 'nexrad' ? sweepInfo?.timestamp ?? null : null}
        compact={compact}
        fallback={usingFallback}
        unavailable={product && !product.available ? product.unavailableReason ?? 'This product has no configured source.' : null}
      />
    </div>
  );
}

export default RadarMap;
