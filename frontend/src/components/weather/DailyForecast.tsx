import { useMemo, useState } from 'react';
import WeatherIcon from '../ui/WeatherIcon';
import { Panel, Skeleton } from '../ui/Primitives';
import {
  formatDate,
  formatDayName,
  formatPercent,
  formatTemp,
  formatTime,
  formatWind,
  isToday,
} from '../../utils/format';
import type { DailyEntry } from '../../api/types';
import './DailyForecast.css';

/**
 * 10-DAY FORECAST
 *
 * Each row carries the day, the date, an icon, the high and low, the rain
 * chance and the forecast wording. The high/low bar is scaled against the
 * whole period, so a cold front reads as a shape and not just numbers.
 * Selecting a day opens its full detail.
 */
export function DailyForecast({
  days,
  loading,
  timeZone,
}: {
  days: DailyEntry[] | undefined;
  loading?: boolean;
  timeZone?: string | null;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  const range = useMemo(() => {
    const lows = (days ?? []).map((d) => d.low).filter((v): v is number => v !== null);
    const highs = (days ?? []).map((d) => d.high).filter((v): v is number => v !== null);
    if (!lows.length || !highs.length) return { min: 0, max: 1 };
    return { min: Math.min(...lows), max: Math.max(...highs) };
  }, [days]);

  if (loading && !days) {
    return (
      <Panel eyebrow="Extended outlook" title="10-Day Forecast">
        <Skeleton height={420} />
      </Panel>
    );
  }

  if (!days?.length) return null;

  const span = Math.max(1, range.max - range.min);

  return (
    <Panel eyebrow="Extended outlook" title={`${days.length}-Day Forecast`} flush>
      <ul className="nc-daily">
        {days.map((day) => {
          const isOpen = openDate === day.date;
          const lowPct = day.low === null ? 0 : ((day.low - range.min) / span) * 100;
          const highPct = day.high === null ? 100 : ((day.high - range.min) / span) * 100;

          return (
            <li key={day.date} className={`nc-daily__item${isOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="nc-daily__row"
                onClick={() => setOpenDate(isOpen ? null : day.date)}
                aria-expanded={isOpen}
              >
                <span className="nc-daily__day">
                  <strong>{isToday(day.date) ? 'Today' : formatDayName(day.date)}</strong>
                  <em className="nc-readout">{formatDate(day.date)}</em>
                </span>

                <WeatherIcon name={day.icon} size={38} title={day.condition ?? undefined} animated={false} />

                <span className={`nc-daily__pop${(day.precipProbability ?? 0) >= 30 ? ' is-wet' : ''}`}>
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2.5s7 8.2 7 12.4a7 7 0 1 1-14 0C5 10.7 12 2.5 12 2.5Z" fill="currentColor" />
                  </svg>
                  <span className="nc-readout">{formatPercent(day.precipProbability ?? 0)}</span>
                </span>

                <span className="nc-daily__condition">{day.condition ?? '--'}</span>

                <span className="nc-daily__temps">
                  <span className="nc-daily__low nc-readout">{formatTemp(day.low, '')}</span>
                  <span className="nc-daily__bar" aria-hidden="true">
                    <span
                      className="nc-daily__bar-fill"
                      style={{ left: `${lowPct}%`, width: `${Math.max(6, highPct - lowPct)}%` }}
                    />
                  </span>
                  <span className="nc-daily__high nc-readout">{formatTemp(day.high, '')}</span>
                </span>

                <svg
                  className="nc-daily__chevron"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isOpen && (
                <div className="nc-daily__detail nc-enter">
                  <div className="nc-daily__detail-main">
                    <h4>{day.name ?? formatDayName(day.date, 'long')}</h4>
                    {day.detail ? <p>{day.detail}</p> : <p>{day.condition}</p>}
                    {day.nightDetail && (
                      <>
                        <h4 className="nc-daily__night-head">
                          <WeatherIcon name={day.nightIcon ?? 'clear-night'} size={20} animated={false} />
                          Overnight
                        </h4>
                        <p>{day.nightDetail}</p>
                      </>
                    )}
                  </div>

                  <dl className="nc-daily__detail-stats">
                    <div>
                      <dt>High / Low</dt>
                      <dd className="nc-readout">
                        {formatTemp(day.high)} / {formatTemp(day.low)}
                      </dd>
                    </div>
                    <div>
                      <dt>Rain chance</dt>
                      <dd className="nc-readout">{formatPercent(day.precipProbability ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Rain amount</dt>
                      <dd className="nc-readout">
                        {day.precipAmount === null ? '--' : `${day.precipAmount.toFixed(2)}"`}
                      </dd>
                    </div>
                    <div>
                      <dt>Wind</dt>
                      <dd className="nc-readout">{formatWind(day.windSpeed, day.windDirection, day.windGust)}</dd>
                    </div>
                    <div>
                      <dt>UV index</dt>
                      <dd className="nc-readout">{day.uvIndexMax === null ? '--' : day.uvIndexMax.toFixed(1)}</dd>
                    </div>
                    <div>
                      <dt>Sunrise / Sunset</dt>
                      <dd className="nc-readout">
                        {formatTime(day.sunrise, timeZone)} / {formatTime(day.sunset, timeZone)}
                      </dd>
                    </div>
                  </dl>

                  <p className="nc-daily__source">
                    {day.source === 'nws'
                      ? 'National Weather Service forecast'
                      : 'Extended model guidance beyond the NWS forecast period'}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export default DailyForecast;
