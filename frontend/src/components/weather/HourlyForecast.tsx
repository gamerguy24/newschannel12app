import { useMemo, useRef, useState } from 'react';
import WeatherIcon from '../ui/WeatherIcon';
import { Panel, SegmentedControl, Skeleton } from '../ui/Primitives';
import { formatHour, formatPercent, formatTemp, formatWind, isToday, parseLocalDate } from '../../utils/format';
import type { HourlyEntry } from '../../api/types';
import './HourlyForecast.css';

/**
 * HOURLY FORECAST
 *
 * A horizontal strip covering at least 48 hours: time, icon, temperature,
 * rain chance, wind and storm probability. A temperature trend line runs
 * behind the columns so the shape of the day is readable at a glance.
 */

type Metric = 'temp' | 'rain' | 'wind' | 'storm';

const METRICS: Array<{ value: Metric; label: string }> = [
  { value: 'temp', label: 'Temp' },
  { value: 'rain', label: 'Rain' },
  { value: 'wind', label: 'Wind' },
  { value: 'storm', label: 'Storms' },
];

function TrendLine({ hours, metric }: { hours: HourlyEntry[]; metric: Metric }) {
  const points = useMemo(() => {
    const values = hours.map((h) => {
      if (metric === 'rain') return h.precipProbability ?? 0;
      if (metric === 'wind') return h.windSpeed ?? 0;
      if (metric === 'storm') return h.stormProbability ?? 0;
      return h.temperature ?? 0;
    });
    if (!values.length) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = 100 / Math.max(1, values.length - 1);
    return values
      .map((v, i) => `${(i * step).toFixed(3)},${(38 - ((v - min) / span) * 32).toFixed(2)}`)
      .join(' ');
  }, [hours, metric]);

  if (!points) return null;

  const stroke =
    metric === 'rain' ? 'var(--nc-cyan)' : metric === 'storm' ? 'var(--nc-tier-severe)' : metric === 'wind' ? 'var(--nc-violet)' : 'var(--nc-gold)';

  return (
    <svg className="nc-hourly__trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="0.8" vectorEffect="non-scaling-stroke" opacity="0.85" />
    </svg>
  );
}

export function HourlyForecast({
  hours,
  loading,
  timeZone,
  defaultCount = 48,
}: {
  hours: HourlyEntry[] | undefined;
  loading?: boolean;
  timeZone?: string | null;
  defaultCount?: number;
}) {
  const [metric, setMetric] = useState<Metric>('temp');
  const [count, setCount] = useState(defaultCount);
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => (hours ?? []).slice(0, count), [hours, count]);

  const scrollBy = (direction: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: direction * 360, behavior: 'smooth' });
  };

  if (loading && !hours) {
    return (
      <Panel eyebrow="Next 48 hours" title="Hourly Forecast">
        <Skeleton height={168} />
      </Panel>
    );
  }

  if (!visible.length) return null;

  return (
    <Panel
      eyebrow={`Next ${visible.length} hours`}
      title="Hourly Forecast"
      action={
        <div className="nc-hourly__controls">
          <SegmentedControl options={METRICS} value={metric} onChange={setMetric} size="sm" />
          <div className="nc-hourly__arrows">
            <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll hourly forecast back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll hourly forecast forward">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      }
      flush
    >
      <div className="nc-hourly">
        <div className="nc-hourly__scroll nc-scroll-x" ref={scrollRef}>
          <div className="nc-hourly__track" style={{ '--hour-count': visible.length } as React.CSSProperties}>
            <TrendLine hours={visible} metric={metric} />
            {visible.map((hour, index) => {
              const showDay = index === 0 || !sameDay(visible[index - 1]?.time, hour.time);
              return (
                <div key={hour.time} className={`nc-hourly__col${hour.source === 'model' ? ' is-model' : ''}`}>
                  {showDay && <span className="nc-hourly__daymark">{dayLabel(hour.time)}</span>}
                  <span className="nc-hourly__time">{formatHour(hour.time, timeZone)}</span>
                  <WeatherIcon name={hour.icon} size={32} title={hour.condition ?? undefined} />
                  <span className="nc-hourly__temp nc-readout">{formatTemp(hour.temperature)}</span>

                  <span className={`nc-hourly__metric${(hour.precipProbability ?? 0) >= 30 ? ' is-wet' : ''}`}>
                    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2.5s7 8.2 7 12.4a7 7 0 1 1-14 0C5 10.7 12 2.5 12 2.5Z" fill="currentColor" />
                    </svg>
                    {formatPercent(hour.precipProbability ?? 0)}
                  </span>

                  <span className="nc-hourly__wind">{formatWind(hour.windSpeed, hour.windDirection)}</span>

                  {hour.stormProbability > 0 ? (
                    <span
                      className={`nc-hourly__storm${hour.stormProbability >= 40 ? ' is-high' : ''}`}
                      title={`${hour.stormProbability}% chance of thunderstorms`}
                    >
                      ⚡ {hour.stormProbability}%
                    </span>
                  ) : (
                    <span className="nc-hourly__storm is-none">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {hours && hours.length > count && (
          <button type="button" className="nc-hourly__more" onClick={() => setCount((c) => Math.min(hours.length, c + 48))}>
            Show {Math.min(48, hours.length - count)} more hours
          </button>
        )}
      </div>
    </Panel>
  );
}

function sameDay(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a.slice(0, 10) === b.slice(0, 10);
}

function dayLabel(iso: string): string {
  if (isToday(iso.slice(0, 10))) return 'Today';
  const date = parseLocalDate(iso.slice(0, 10));
  return date ? date.toLocaleDateString('en-US', { weekday: 'short' }) : '';
}

export default HourlyForecast;
