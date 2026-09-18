import WeatherIcon from '../ui/WeatherIcon';
import { DataStamp, Panel, Skeleton } from '../ui/Primitives';
import {
  formatNumber,
  formatPercent,
  formatPressure,
  formatTemp,
  formatTime,
  formatVisibility,
  formatWind,
} from '../../utils/format';
import type { CurrentConditions as Conditions } from '../../api/types';
import './CurrentConditions.css';

/**
 * CURRENT CONDITIONS
 *
 * The hero number plus the full observation panel. The temperature is set at
 * display scale so it reads across a room, which is the whole point of a
 * station weather app on a kitchen tablet.
 */

function SunArc({ sunrise, sunset, timeZone }: { sunrise: string | null; sunset: string | null; timeZone?: string | null }) {
  if (!sunrise || !sunset) return null;
  const up = new Date(sunrise).getTime();
  const down = new Date(sunset).getTime();
  const now = Date.now();
  const progress = Math.max(0, Math.min(1, (now - up) / (down - up)));
  const isDay = now >= up && now <= down;

  // Semi-circle from (10,60) to (170,60), radius 80.
  const angle = Math.PI * (1 - progress);
  const x = 90 + Math.cos(angle) * -80;
  const y = 60 - Math.sin(angle) * 46;

  return (
    <div className="nc-sun-arc">
      <svg viewBox="0 0 180 76" width="100%" height="76" aria-hidden="true">
        <path d="M10 60 A80 46 0 0 1 170 60" fill="none" stroke="var(--nc-line)" strokeWidth="2" strokeDasharray="3 4" />
        <path
          d="M10 60 A80 46 0 0 1 170 60"
          fill="none"
          stroke="var(--nc-gold)"
          strokeWidth="2.4"
          strokeDasharray="240"
          strokeDashoffset={240 - 240 * (isDay ? progress : 0)}
          strokeLinecap="round"
        />
        <line x1="6" y1="60" x2="174" y2="60" stroke="var(--nc-line)" strokeWidth="1" />
        {isDay && (
          <>
            <circle cx={x} cy={y} r="8" fill="var(--nc-gold)" opacity="0.25" />
            <circle cx={x} cy={y} r="4.5" fill="var(--nc-gold)" />
          </>
        )}
      </svg>
      <div className="nc-sun-arc__times">
        <span>
          <em>Sunrise</em>
          <strong className="nc-readout">{formatTime(sunrise, timeZone)}</strong>
        </span>
        <span>
          <em>Sunset</em>
          <strong className="nc-readout">{formatTime(sunset, timeZone)}</strong>
        </span>
      </div>
    </div>
  );
}

interface DetailProps {
  label: string;
  value: string;
  hint?: string | null;
  accent?: string;
}

function Detail({ label, value, hint, accent }: DetailProps) {
  // A station that does not report a field is normal. Dim the placeholder so
  // the readings that ARE live are what the eye lands on.
  const missing = value === '--' || value === '--°';

  return (
    <div className={`nc-cc__detail${missing ? ' is-missing' : ''}`}>
      <span className="nc-cc__detail-label">{label}</span>
      <span
        className="nc-cc__detail-value nc-readout"
        style={accent && !missing ? { color: accent } : undefined}
        title={missing ? `${label} is not reported by this station` : undefined}
      >
        {missing ? 'Not reported' : value}
      </span>
      {/* The hint line is always present so every cell is the same height. */}
      <span className="nc-cc__detail-hint">{missing ? '' : hint ?? ''}</span>
    </div>
  );
}

export function CurrentConditionsPanel({
  data,
  loading,
  updatedAt,
}: {
  data: Conditions | null | undefined;
  loading: boolean;
  updatedAt?: number | null;
}) {
  if (loading && !data) {
    return (
      <Panel eyebrow="Right now" title="Current Conditions">
        <div className="nc-cc__loading">
          <Skeleton height={130} width={220} />
          <Skeleton height={130} />
        </div>
      </Panel>
    );
  }

  if (!data) return null;

  const o = data.observation;
  const tz = data.location.timeZone;
  const gustHint = o.windGust && o.windSpeed && o.windGust > o.windSpeed + 3 ? `Gusting ${Math.round(o.windGust)} mph` : null;

  return (
    <Panel
      eyebrow="Right now"
      title="Current Conditions"
      action={
        o.stationId ? (
          <span className="nc-cc__station" title={o.stationName ?? undefined}>
            <em>Station</em>
            {o.stationId}
          </span>
        ) : undefined
      }
    >
      <div className="nc-cc">
        <div className="nc-cc__hero">
          <WeatherIcon name={o.icon} size={104} title={o.condition ?? 'Current conditions'} />
          <div className="nc-cc__hero-text">
            <p className="nc-cc__place">{data.location.name}</p>
            {/* The degree sign is part of the number. Rendered as a separate
                scaled span it floated off the digits like a stray dot. */}
            {/* No nc-readout here: tabular figures give the degree sign a full
                monospace cell, which pushes it away from the number. */}
            <p className="nc-cc__temp">{formatTemp(o.temperature)}</p>
            <p className="nc-cc__condition">{o.condition ?? 'Conditions unavailable'}</p>
            <p className="nc-cc__feels">
              Feels Like <strong>{formatTemp(o.feelsLike)}</strong>
            </p>
          </div>
        </div>

        <div className="nc-cc__details">
          <Detail label="Humidity" value={formatPercent(o.humidity)} />
          <Detail label="Dew Point" value={formatTemp(o.dewpoint)} hint={dewpointComfort(o.dewpoint)} />
          <Detail label="Wind" value={formatWind(o.windSpeed, o.windCompass)} hint={gustHint} />
          <Detail label="Wind Gusts" value={o.windGust ? `${Math.round(o.windGust)} mph` : 'None'} />
          <Detail label="Visibility" value={formatVisibility(o.visibility)} />
          <Detail
            label="Pressure"
            value={formatPressure(o.pressure, o.pressureTrend)}
            hint={o.pressureTrend ? `${o.pressureTrend.direction} ${Math.abs(o.pressureTrend.changeInHg).toFixed(2)} in/3hr` : null}
          />
          <Detail
            label="UV Index"
            value={data.uv.index === null ? '--' : formatNumber(data.uv.index, 1)}
            hint={data.uv.category?.label}
            accent={data.uv.category?.color}
          />
          <Detail
            label="Heat Index"
            value={o.heatIndex ? formatTemp(o.heatIndex) : o.windChill ? formatTemp(o.windChill) : '--'}
            hint={o.heatIndex ? 'Heat index' : o.windChill ? 'Wind chill' : 'Not applicable'}
          />
        </div>

        <SunArc sunrise={data.astronomy.sunrise} sunset={data.astronomy.sunset} timeZone={tz} />
      </div>

      <DataStamp
        source={o.source === 'model' ? 'Model estimate - no station reporting' : `NWS ${o.stationId ?? ''} observation`}
        updatedAt={o.observedAt ?? updatedAt}
        stale={data.degraded}
      />
    </Panel>
  );
}

/** Dew point comfort wording - the number alone means little to most viewers. */
function dewpointComfort(dewpoint: number | null): string | null {
  if (dewpoint === null) return null;
  if (dewpoint >= 75) return 'Oppressive';
  if (dewpoint >= 70) return 'Very humid';
  if (dewpoint >= 65) return 'Humid';
  if (dewpoint >= 60) return 'Sticky';
  if (dewpoint >= 50) return 'Comfortable';
  if (dewpoint >= 35) return 'Dry';
  return 'Very dry';
}

export default CurrentConditionsPanel;
