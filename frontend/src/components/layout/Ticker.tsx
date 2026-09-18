import { useEffect, useMemo, useRef, useState } from 'react';
import { useResource } from '../../hooks';
import { useLocation } from '../../context/LocationContext';
import { getTicker } from '../../services/weather';
import type { TickerItem } from '../../services/weather';
import './Ticker.css';

/**
 * WEATHER TICKER
 *
 * The scrolling crawl along the bottom of the screen. Alerts lead, then live
 * market temperatures. The strip refreshes on its own every two minutes and
 * restarts the marquee only when the content actually changed, so the crawl
 * never jumps mid-sentence on a routine refresh.
 */
export function Ticker() {
  const { location } = useLocation();
  const [paused, setPaused] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(60);

  const { data } = useResource((signal) => getTicker(location, signal), [location.lat, location.lon], {
    refreshMs: 120000,
  });

  const items = useMemo<TickerItem[]>(() => data?.items ?? [], [data]);
  const hasAlerts = items.some((i) => i.type === 'alert');

  // Scroll speed follows content length so a long crawl is not unreadably fast.
  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const width = node.scrollWidth / 2;
    setDuration(Math.max(28, Math.min(140, width / 62)));
  }, [items]);

  if (!items.length) return null;

  // Duplicated once so the marquee can loop seamlessly.
  const loop = [...items, ...items];

  return (
    <div
      className={`nc-ticker${hasAlerts ? ' has-alerts' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="marquee"
      aria-label="Weather ticker"
    >
      <div className="nc-ticker__brand">
        <span className="nc-ticker__brand-num">12</span>
        <span className="nc-ticker__brand-text">
          {hasAlerts ? 'WEATHER ALERT' : 'WEATHER'}
        </span>
      </div>

      <div className="nc-ticker__viewport">
        <div
          ref={trackRef}
          className="nc-ticker__track"
          style={{ animationDuration: `${duration}s`, animationPlayState: paused ? 'paused' : 'running' }}
        >
          {loop.map((item, index) => (
            <span
              key={`${item.text}-${index}`}
              className={`nc-ticker__item nc-ticker__item--${item.type}${
                item.tier === 'catastrophic' ? ' is-critical' : ''
              }`}
              style={item.color ? ({ '--item-color': item.color } as React.CSSProperties) : undefined}
              aria-hidden={index >= items.length}
            >
              {item.type === 'alert' && <span className="nc-ticker__flag">STORM 12 WEATHER ALERT:</span>}
              {item.text}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="nc-ticker__pause"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? 'Resume the weather ticker' : 'Pause the weather ticker'}
        title={paused ? 'Resume ticker' : 'Pause ticker'}
      >
        {paused ? (
          <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8V4Z" fill="currentColor" /></svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" /></svg>
        )}
      </button>
    </div>
  );
}

export default Ticker;
