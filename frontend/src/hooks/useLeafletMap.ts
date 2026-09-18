import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

export interface MapOptions {
  center: [number, number];
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  zoomControl?: boolean;
  attributionControl?: boolean;
  interactive?: boolean;
  basemap?: string;
  labels?: boolean;
  /**
   * 'broadcast' is the on-air look: satellite landcover with terrain showing
   * through, plus highways and shields. 'dark' is the flat studio basemap.
   */
  style?: 'broadcast' | 'dark';
}

/**
 * Esri's Dark Gray Canvas, which still serves tiles without an API key and
 * ships as a label-free ground plus a separate reference layer - the split
 * the radar sandwich below depends on. (CARTO's dark basemap now stamps
 * "API KEY REQUIRED" across every unauthenticated tile; swapping providers
 * keeps this app key-free, the same way its NOAA data sources are.)
 */
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services';
const DARK_BASE = `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const DARK_LABELS = `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;

/**
 * The broadcast basemap.
 *
 * Satellite imagery carries the landcover and terrain a weather map is read
 * against - the Highland Rim and the Cumberland Plateau show up as themselves
 * rather than as flat polygons. The transportation reference adds interstates
 * and their shields on top. Both are key-free.
 *
 * The imagery is colour graded in CSS (.nc-basemap--broadcast) toward the
 * green of an on-air map: raw satellite is too dark and too brown to read
 * reflectivity against.
 */
const BROADCAST_IMAGERY = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const BROADCAST_ROADS = `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`;
const ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const BROADCAST_ATTRIBUTION =
  'Imagery &copy; Esri, Maxar, Earthstar Geographics &mdash; Roads &copy; Esri, HERE, Garmin &mdash; Counties: US Census TIGER';
// The canvas basemap is published to z16; past that Leaflet upscales rather
// than requesting tiles that do not exist.
const MAX_NATIVE_ZOOM = 16;

/**
 * Creates and owns one Leaflet map instance.
 *
 * The basemap is split into a label-free ground layer and a separate label
 * layer, so radar can be sandwiched between them - place names stay readable
 * on top of heavy reflectivity, exactly the way a station map is built.
 */
export function useLeafletMap(options: MapOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return undefined;

    const opts = optionsRef.current;
    const instance = L.map(container, {
      center: opts.center,
      zoom: opts.zoom,
      minZoom: opts.minZoom ?? 3,
      maxZoom: opts.maxZoom ?? 12,
      zoomControl: false,
      attributionControl: opts.attributionControl !== false,
      preferCanvas: true,
      // Panes below give us deterministic stacking for every overlay type.
      zoomSnap: 0.5,
      wheelPxPerZoomLevel: 120,
      dragging: opts.interactive !== false,
      scrollWheelZoom: opts.interactive !== false,
      doubleClickZoom: opts.interactive !== false,
      touchZoom: opts.interactive !== false,
      keyboard: opts.interactive !== false,
      worldCopyJump: true,
    });

    // Stacking order, bottom to top.
    const panes: Array<[string, number]> = [
      ['nc-base', 200],
      ['nc-radar', 350],
      ['nc-satellite', 340],
      ['nc-outlook', 400],
      ['nc-alerts', 420],
      ['nc-labels', 450],
      ['nc-tracks', 480],
      ['nc-points', 520],
    ];
    for (const [name, zIndex] of panes) {
      const pane = instance.createPane(name);
      pane.style.zIndex = String(zIndex);
      if (name !== 'nc-points' && name !== 'nc-tracks' && name !== 'nc-alerts') {
        pane.style.pointerEvents = 'none';
      }
    }

    const broadcast = opts.style === 'broadcast';

    L.tileLayer(opts.basemap ?? (broadcast ? BROADCAST_IMAGERY : DARK_BASE), {
      attribution: broadcast ? BROADCAST_ATTRIBUTION : ATTRIBUTION,
      maxZoom: 19,
      maxNativeZoom: broadcast ? 17 : MAX_NATIVE_ZOOM,
      pane: 'nc-base',
      className: broadcast ? 'nc-basemap--broadcast' : undefined,
      crossOrigin: true,
    }).addTo(instance);

    if (broadcast) {
      // Highways and interstate shields ride above the radar, the way they do
      // on air - a road you cannot see through the rain is no use.
      L.tileLayer(BROADCAST_ROADS, {
        attribution: '',
        maxZoom: 19,
        maxNativeZoom: 17,
        pane: 'nc-labels',
        className: 'nc-basemap--roads',
        // Held back deliberately: at this zoom the reference layer draws every
        // highway, and at full strength that web of red reads as the county
        // grid. The interstates still come through; the clutter does not.
        opacity: 0.5,
        crossOrigin: true,
      }).addTo(instance);
    } else if (opts.labels !== false) {
      L.tileLayer(DARK_LABELS, {
        attribution: '',
        maxZoom: 19,
        maxNativeZoom: MAX_NATIVE_ZOOM,
        pane: 'nc-labels',
        crossOrigin: true,
      }).addTo(instance);
    }

    if (opts.zoomControl !== false) {
      L.control.zoom({ position: 'bottomright' }).addTo(instance);
    }

    mapRef.current = instance;
    setMap(instance);

    // Leaflet needs a nudge when it is created inside a panel that is still
    // being laid out (common on first paint and on orientation change).
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container);
    const settle = window.setTimeout(() => instance.invalidateSize(), 120);

    return () => {
      window.clearTimeout(settle);
      resize.disconnect();
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  return { containerRef, map };
}

export { L };
