import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getCurrent, getDaily, getHourly } from '../services/weather';
import ConditionsHero from '../components/weather/ConditionsHero';
import HourlyForecast from '../components/weather/HourlyForecast';
import DailyForecast from '../components/weather/DailyForecast';
import { DataStamp, ErrorState, Panel } from '../components/ui/Primitives';
import { formatNumber, formatTemp } from '../utils/format';

/** FORECAST - the full hourly + extended outlook for the active location. */
export function ForecastPage() {
  const { location } = useLocation();

  const current = useResource((signal) => getCurrent(location, signal), [location.lat, location.lon], {
    refreshMs: 180000,
  });
  const hourly = useResource((signal) => getHourly(location, 120, signal), [location.lat, location.lon], {
    refreshMs: 600000,
  });
  const daily = useResource((signal) => getDaily(location, 10, signal), [location.lat, location.lon], {
    refreshMs: 900000,
  });

  const timeZone = current.data?.location.timeZone;
  const days = daily.data?.days ?? [];

  const warmest = days.reduce<{ date: string; high: number } | null>((best, day) => {
    if (day.high === null) return best;
    return !best || day.high > best.high ? { date: day.date, high: day.high } : best;
  }, null);
  const wettest = days.reduce<{ date: string; pop: number } | null>((best, day) => {
    const pop = day.precipProbability ?? 0;
    return !best || pop > best.pop ? { date: day.date, pop } : best;
  }, null);

  if (daily.error && !daily.data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">Forecast</h1>
        <ErrorState message={daily.error.friendly} onRetry={daily.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page">
      <header>
        <p className="nc-eyebrow">Forecast</p>
        <h1 className="nc-page__title">{location.label}</h1>
      </header>

      <ConditionsHero data={current.data} today={days[0]} loading={current.loading} />

      <HourlyForecast hours={hourly.data?.hours} loading={hourly.loading} timeZone={timeZone} defaultCount={48} />

      <DailyForecast days={days} loading={daily.loading} timeZone={timeZone} />

      {days.length > 0 && (
        <Panel eyebrow="At a glance" title="Period Summary">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            <Summary
              label="Warmest day"
              value={warmest ? formatTemp(warmest.high) : '--'}
              detail={warmest ? new Date(`${warmest.date}T12:00`).toLocaleDateString('en-US', { weekday: 'long' }) : ''}
            />
            <Summary
              label="Highest rain chance"
              value={wettest ? `${wettest.pop}%` : '--'}
              detail={wettest ? new Date(`${wettest.date}T12:00`).toLocaleDateString('en-US', { weekday: 'long' }) : ''}
            />
            <Summary
              label="Average high"
              value={formatTemp(average(days.map((d) => d.high)))}
              detail={`Over ${days.length} days`}
            />
            <Summary
              label="Average low"
              value={formatTemp(average(days.map((d) => d.low)))}
              detail={`Over ${days.length} days`}
            />
            <Summary
              label="Total rain"
              value={`${formatNumber(
                days.reduce((sum, d) => sum + (d.precipAmount ?? 0), 0),
                2,
              )}"`}
              detail="Model accumulation"
            />
          </div>
          <DataStamp source={daily.data?.source} updatedAt={daily.updatedAt} />
        </Panel>
      )}
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: 'var(--nc-text-faint)',
        }}
      >
        {label}
      </p>
      <p
        className="nc-readout"
        style={{ margin: '2px 0 0', fontSize: 24, fontWeight: 700 }}
      >
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--nc-text-dim)' }}>{detail}</p>
    </div>
  );
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((v): v is number => v !== null);
  if (!usable.length) return null;
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}

export default ForecastPage;
