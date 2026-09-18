import { useEffect } from 'react';
import type { RadarFrame } from '../../api/types';
import './RadarControls.css';

/**
 * Radar transport: play/pause, frame stepping, a scrubbable timeline, speed,
 * zoom and recentre. Keyboard shortcuts mirror the buttons so the radar can be
 * driven hands-free during live coverage.
 */

interface RadarControlsProps {
  playing: boolean;
  onPlay: () => void;
  onStep: (direction: 1 | -1) => void;
  onScrub: (index: number) => void;
  frameIndex: number;
  frames: RadarFrame[];
  currentFrame: RadarFrame | null;
  speed: number;
  speeds: Array<{ label: string; value: number }>;
  onSpeed: (value: number) => void;
  onRecenter: () => void;
  onZoom: (delta: number) => void;
  loading?: boolean;
  animated: boolean;
  compact?: boolean;
  fallback?: boolean;
  unavailable?: string | null;
  /** For a still product, the time of the sweep actually on screen. */
  staticTimestamp?: string | null;
}

export function RadarControls({
  playing,
  onPlay,
  onStep,
  onScrub,
  frameIndex,
  frames,
  currentFrame,
  speed,
  speeds,
  onSpeed,
  onRecenter,
  onZoom,
  loading,
  animated,
  compact,
  fallback,
  unavailable,
  staticTimestamp,
}: RadarControlsProps) {
  // Space plays, arrows step, +/- zoom. Ignored while typing in a field.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        onPlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onStep(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onStep(1);
      } else if (e.key === '+' || e.key === '=') {
        onZoom(1);
      } else if (e.key === '-') {
        onZoom(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onPlay, onStep, onZoom]);

  // A still product has no frame list, so the displayed time has to come from
  // the sweep itself - otherwise the scrubber shows the mosaic's clock while
  // the map shows a different scan.
  const shownTime = animated ? currentFrame?.timestamp : staticTimestamp ?? currentFrame?.timestamp;
  const time = shownTime
    ? new Date(shownTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '--:--';
  const isForecast = currentFrame?.kind === 'forecast';

  return (
    <div className={`nc-rc${compact ? ' nc-rc--compact' : ''}`}>
      {unavailable && (
        <p className="nc-rc__notice">
          <strong>Layer unavailable.</strong> {unavailable}
        </p>
      )}
      {fallback && (
        <p className="nc-rc__notice is-warning">
          Primary radar mosaic is unreachable — showing the NOAA/Iowa State composite fallback.
        </p>
      )}

      <div className="nc-rc__bar">
        <div className="nc-rc__transport">
          <button type="button" onClick={() => onStep(-1)} disabled={!animated} aria-label="Previous frame" title="Previous frame (←)">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 5v14l-11-7 11-7ZM6 5h2.4v14H6z" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            className="nc-rc__play"
            onClick={onPlay}
            disabled={!animated}
            aria-label={playing ? 'Pause radar animation' : 'Play radar animation'}
            title={playing ? 'Pause (space)' : 'Play (space)'}
          >
            {playing ? (
              <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 4l13 8-13 8V4Z" fill="currentColor" />
              </svg>
            )}
          </button>

          <button type="button" onClick={() => onStep(1)} disabled={!animated} aria-label="Next frame" title="Next frame (→)">
            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 5v14l11-7L6 5ZM15.6 5H18v14h-2.4z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div className="nc-rc__timeline">
          <div className="nc-rc__timestamp">
            <span className={`nc-rc__time nc-readout${isForecast ? ' is-forecast' : ''}`}>{time}</span>
            <span className="nc-rc__label">
              {!animated
                ? 'Latest scan'
                : isForecast
                  ? 'Forecast'
                  : frameIndex === frames.length - 1 || currentFrame?.kind === 'past'
                    ? 'Observed'
                    : 'Observed'}
            </span>
          </div>

          <div className="nc-rc__track">
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={frameIndex}
              step={1}
              onChange={(e) => onScrub(Number(e.target.value))}
              disabled={!animated || frames.length < 2}
              aria-label="Radar timeline"
              aria-valuetext={time}
            />
            <div className="nc-rc__ticks" aria-hidden="true">
              {frames.map((frame, index) => (
                <span
                  key={frame.timestamp}
                  className={`nc-rc__tick${frame.kind === 'forecast' ? ' is-forecast' : ''}${
                    index === frameIndex ? ' is-current' : ''
                  }`}
                />
              ))}
            </div>
          </div>

          {loading && <span className="nc-rc__loading" title="Loading radar tiles" />}
        </div>

        <div className="nc-rc__speed" role="group" aria-label="Playback speed">
          {speeds.map((option) => (
            <button
              key={option.value}
              type="button"
              className={speed === option.value ? 'is-active' : ''}
              onClick={() => onSpeed(option.value)}
              disabled={!animated}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="nc-rc__map-tools">
          <button type="button" onClick={() => onZoom(1)} aria-label="Zoom in" title="Zoom in (+)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="2" />
              <path d="M11 8.4v5.2M8.4 11h5.2M16 16l4.4 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={() => onZoom(-1)} aria-label="Zoom out" title="Zoom out (−)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="2" />
              <path d="M8.4 11h5.2M16 16l4.4 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={onRecenter} aria-label="Center on my location" title="Center on my location">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="7.6" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
              <path d="M12 1.8v3.2M12 19v3.2M22.2 12H19M5 12H1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default RadarControls;
