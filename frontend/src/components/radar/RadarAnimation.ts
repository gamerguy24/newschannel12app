import L from 'leaflet';
import type { RadarFrame, RadarFrames } from '../../api/types';

/**
 * RADAR ANIMATION ENGINE
 *
 * Smooth playback comes from building one tile layer per frame up front, all
 * added to the map at zero opacity, then cross-fading between them. Tiles are
 * therefore fetched once and cached by the browser; stepping or scrubbing is
 * a style change, not a network request.
 *
 * Frames are loaded lazily around the playhead so opening the radar does not
 * fire 15 simultaneous tile storms on a phone.
 */

/**
 * RainViewer publishes its mosaic only to z7 - past that every tile comes back
 * as a grey "Zoom Level Not Supported" placeholder (true of the 256px and the
 * 512px endpoints alike). Capping maxNativeZoom here makes Leaflet upscale the
 * z7 imagery instead, which is how a mosaic is meant to overzoom.
 */
export const RAINVIEWER_MAX_NATIVE_ZOOM = 7;

export interface FrameHandle {
  frame: RadarFrame;
  layer: L.TileLayer;
  loaded: boolean;
  requested: boolean;
}

export interface RadarAnimationOptions {
  pane?: string;
  opacity?: number;
  palette?: number;
  smooth?: boolean;
  snow?: boolean;
  tileSize?: number;
  onFrameChange?: (index: number, frame: RadarFrame) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export class RadarAnimation {
  private map: L.Map;
  private handles: FrameHandle[] = [];
  private index = 0;
  private opacity: number;
  private options: RadarAnimationOptions;
  private destroyed = false;

  constructor(map: L.Map, options: RadarAnimationOptions = {}) {
    this.map = map;
    this.options = options;
    this.opacity = options.opacity ?? 0.82;
  }

  /** Rebuild the layer set for a new frame list. */
  setFrames(frames: RadarFrame[], source: RadarFrames, kind: 'radar' | 'satellite' = 'radar') {
    this.clear();
    if (!frames.length) return;

    const template = kind === 'satellite' ? source.satelliteTemplate : source.tileTemplate;
    if (!template) return;

    const size = this.options.tileSize ?? 256;
    const palette = kind === 'satellite' ? 0 : this.options.palette ?? 4;
    const flags = kind === 'satellite' ? '0_0' : `${this.options.smooth === false ? 0 : 1}_${this.options.snow === false ? 0 : 1}`;

    this.handles = frames.map((frame) => {
      const url = template
        .replace('{path}', frame.path)
        .replace('/512/', `/${size}/`)
        .replace('{color}', String(palette))
        .replace(/\/1_1\.png$/, `/${flags}.png`)
        .replace(/\/0_0\.png$/, `/${flags}.png`);

      const layer = L.tileLayer(url, {
        pane: this.options.pane ?? 'nc-radar',
        opacity: 0,
        tileSize: size,
        maxNativeZoom: RAINVIEWER_MAX_NATIVE_ZOOM,
        maxZoom: 14,
        crossOrigin: true,
        keepBuffer: 1,
        updateWhenIdle: true,
        className: 'nc-radar-tiles',
      });

      const handle: FrameHandle = { frame, layer, loaded: false, requested: false };
      layer.on('load', () => {
        handle.loaded = true;
        this.reportLoading();
      });
      return handle;
    });

    this.index = Math.max(0, this.handles.length - 1);
    this.ensureLoaded(this.index);
    this.show(this.index, true);
  }

  /** Add a frame's layer to the map so its tiles start downloading. */
  private ensureLoaded(index: number) {
    const window_ = 2;
    for (let offset = -window_; offset <= window_; offset += 1) {
      const i = index + offset;
      const handle = this.handles[i];
      if (!handle || handle.requested) continue;
      handle.requested = true;
      handle.layer.addTo(this.map);
      handle.layer.setOpacity(0);
    }
    this.reportLoading();
  }

  /** Warm every frame - used when the viewer presses play. */
  preloadAll() {
    for (const handle of this.handles) {
      if (handle.requested) continue;
      handle.requested = true;
      handle.layer.addTo(this.map);
      handle.layer.setOpacity(0);
    }
    this.reportLoading();
  }

  private reportLoading() {
    if (this.destroyed) return;
    const pending = this.handles.some((h) => h.requested && !h.loaded);
    this.options.onLoadingChange?.(pending);
  }

  private show(index: number, immediate = false) {
    const target = this.handles[index];
    if (!target) return;

    for (let i = 0; i < this.handles.length; i += 1) {
      const handle = this.handles[i];
      if (!handle.requested) continue;
      const isTarget = i === index;
      const element = handle.layer.getContainer();
      if (element) {
        // A short fade hides the seam between sweeps without smearing motion.
        element.style.transition = immediate ? 'none' : 'opacity 140ms linear';
      }
      handle.layer.setOpacity(isTarget ? this.opacity : 0);
    }

    this.index = index;
    this.options.onFrameChange?.(index, target.frame);
  }

  goTo(index: number) {
    const clamped = Math.max(0, Math.min(this.handles.length - 1, index));
    this.ensureLoaded(clamped);
    this.show(clamped);
  }

  next() {
    this.goTo((this.index + 1) % Math.max(1, this.handles.length));
  }

  previous() {
    this.goTo((this.index - 1 + this.handles.length) % Math.max(1, this.handles.length));
  }

  /** Advance, wrapping to the start. Returns true when the loop restarted. */
  advance(): boolean {
    const next = this.index + 1;
    if (next >= this.handles.length) {
      this.goTo(0);
      return true;
    }
    this.goTo(next);
    return false;
  }

  setOpacity(value: number) {
    this.opacity = value;
    const current = this.handles[this.index];
    current?.layer.setOpacity(value);
  }

  get currentIndex() {
    return this.index;
  }

  get frameCount() {
    return this.handles.length;
  }

  get currentFrame(): RadarFrame | null {
    return this.handles[this.index]?.frame ?? null;
  }

  get frames(): RadarFrame[] {
    return this.handles.map((h) => h.frame);
  }

  /** True once the frame at `index` has finished downloading its tiles. */
  isFrameReady(index: number): boolean {
    return Boolean(this.handles[index]?.loaded);
  }

  clear() {
    for (const handle of this.handles) {
      handle.layer.off();
      if (this.map.hasLayer(handle.layer)) this.map.removeLayer(handle.layer);
    }
    this.handles = [];
    this.index = 0;
  }

  destroy() {
    this.destroyed = true;
    this.clear();
  }
}
