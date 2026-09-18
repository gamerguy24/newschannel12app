import WeatherIcon from '../ui/WeatherIcon';
import { Skeleton } from '../ui/Primitives';
import {
  formatNumber,
  formatPercent,
  formatPressure,
  formatTemp,
  formatTime,
  formatVisibility,
  formatWind,
} from '../../utils/format';
import type { CurrentConditions, DailyEntry } from '../../api/types';
import './ConditionsHero.css';

/**
 * CONDITIONS HERO
 *
 * The lead of the home page, laid out the way a station weather page leads:
 * where you are, the temperature at a size you can read across a room, the
 * sky, today's high and low, then the handful of readings that matter.
 *
 * Readings a station does not report are left out rather than shown as
 * "Not reported" - an empty field tells a viewer nothing they need.
 */
export function ConditionsHero({
  data,
  today,
  loading,
}: {
  data: CurrentConditions | null | undefined;
  today?: DailyEntry;
  loading: boolean;
}) {
  if (loading && !data) {
    return (
      <section className="nc-hero" aria-busy="true">
        <Skeleton height={28} width={220} />
        <Skeleton height={110} width={320} />
        <Skeleton height={170} />
      </section>
    );
  }

  if (!data) return null;

  const o = data.observation;
  const tz = data.location.timeZone;

  const uv =
    data.uv.index === null
      ? '--'
      : `${formatNumber(data.uv.index, 0)}${data.uv.category ? ` · ${data.uv.category.label}` : ''}`;

  const stats: Array<[string, string]> = [
    ['Wind', formatWind(o.windSpeed, o.windCompass, o.windGust)],
    ['Humidity', formatPercent(o.humidity)],
    ['Dew point', formatTemp(o.dewpoint)],
    ['Pressure', formatPressure(o.pressure, o.pressureTrend)],
    ['UV index', uv],
    ['Visibility', formatVisibility(o.visibility)],
    ['Sunrise', formatTime(data.astronomy.sunrise, tz)],
    ['Sunset', formatTime(data.astronomy.sunset, tz)],
  ];
  const reported = stats.filter(([, value]) => value && !value.startsWith('--'));

  const observed = o.observedAt ? formatTime(o.observedAt, tz) : null;
  const station = o.source === 'model' ? 'model estimate' : o.stationId ? `NWS ${o.stationId}` : null;
  const hasRange = today && (today.high !== null || today.low !== null);

  return (
    <section className="nc-hero" aria-labelledby="nc-hero-place">
      <header className="nc-hero__head">
        <h1 id="nc-hero-place" className="nc-hero__place">
          {data.location.name}
        </h1>
        {(observed || station) && (
          <p className="nc-hero__meta">
            {observed && <>Updated {observed}</>}
            {observed && station && ' · '}
            {station}
          </p>
        )}
      </header>

      <div className="nc-hero__now">
        <WeatherIcon name={o.icon} size={92} title={o.condition ?? 'Current conditions'} />
        <p className="nc-hero__temp">{formatTemp(o.temperature)}</p>
        <div className="nc-hero__summary">
          <p className="nc-hero__condition">{o.condition ?? 'Conditions unavailable'}</p>
          {hasRange && (
            <p className="nc-hero__range">
              <span>
                High <strong>{formatTemp(today.high)}</strong>
              </span>
              <span>
                Low <strong>{formatTemp(today.low)}</strong>
              </span>
            </p>
          )}
          <p className="nc-hero__feels">Feels like {formatTemp(o.feelsLike)}</p>
        </div>
      </div>

      {/* Today's written forecast: what a station page runs under the current
          conditions, and real content where the card would otherwise sit
          empty beside a taller radar. */}
      {today?.detail && (
        <div className="nc-hero__today">
          <h2 className="nc-hero__today-title">{today.name ?? 'Today'}</h2>
          <p className="nc-hero__today-text">{today.detail}</p>
        </div>
      )}

      {reported.length > 0 && (
        <dl className="nc-hero__stats">
          {reported.map(([label, value]) => (
            <div key={label} className="nc-hero__stat">
              <dt>{label}</dt>
              <dd className="nc-readout">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export default ConditionsHero;
