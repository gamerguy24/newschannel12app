import { useMemo, useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getSevereCenter, getStormTracks } from '../services/weather';
import StormTracker from '../components/alerts/StormTracker';
import { Button, Chip, EmptyState, ErrorState, Panel, Spinner, TierBadge } from '../components/ui/Primitives';
import { formatExpiry, formatRelative } from '../utils/format';
import type { WeatherAlert } from '../api/types';
import './SevereWeatherPage.css';

/**
 * SEVERE WEATHER CENTER
 *
 * Every active NWS product across the coverage area, split into warnings,
 * watches and advisories, filterable by county, alert type and severity.
 */

const RISK_ORDER = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'];

function AlertRow({ alert }: { alert: WeatherAlert }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`nc-swc__alert${open ? ' is-open' : ''}`} style={{ '--c': alert.color } as React.CSSProperties}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="nc-swc__alert-bar" aria-hidden="true" />
        <span className="nc-swc__alert-main">
          <span className="nc-swc__alert-top">
            <strong>{alert.event}</strong>
            {alert.isEmergency && <TierBadge tier="catastrophic">Emergency</TierBadge>}
            <span className="nc-swc__alert-office">NWS {alert.office}</span>
          </span>
          <span className="nc-swc__alert-areas">{alert.areaDesc}</span>
        </span>
        <span className="nc-swc__alert-times">
          <span className="nc-readout">until {formatExpiry(alert.ends)}</span>
          <em>issued {formatRelative(alert.sent)}</em>
        </span>
      </button>

      {open && (
        <div className="nc-swc__alert-detail nc-enter">
          {alert.headline && <p className="is-headline">{alert.headline}</p>}
          {alert.storm && (
            <p className="is-storm">
              Storm motion: {alert.storm.heading} at {alert.storm.speedMph} mph
              {alert.threats.maxHailSize ? ` · Hail to ${alert.threats.maxHailSize}"` : ''}
              {alert.threats.maxWindGust ? ` · Wind to ${alert.threats.maxWindGust}` : ''}
            </p>
          )}
          {alert.description && <p>{alert.description}</p>}
          {alert.instruction && (
            <p className="is-instruction">
              <strong>What to do: </strong>
              {alert.instruction}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function SevereWeatherPage() {
  const { location, config } = useLocation();
  const [group, setGroup] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [countyQuery, setCountyQuery] = useState('');

  const center = useResource((signal) => getSevereCenter(undefined, signal), [], { refreshMs: 60000 });
  const storms = useResource((signal) => getStormTracks(location, 300, signal), [location.lat, location.lon], {
    refreshMs: 60000,
  });

  const apply = useMemo(
    () => (list: WeatherAlert[]) =>
      list.filter((alert) => {
        if (group && alert.group !== group) return false;
        if (tier && alert.tier !== tier) return false;
        if (countyQuery && !alert.areaDesc.toLowerCase().includes(countyQuery.toLowerCase())) return false;
        return true;
      }),
    [group, tier, countyQuery],
  );

  const data = center.data;
  const warnings = apply(data?.warnings ?? []);
  const watches = apply(data?.watches ?? []);
  const advisories = apply(data?.advisories ?? []);
  const activeFilters = Boolean(group || tier || countyQuery);

  if (center.error && !data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">Severe Weather Center</h1>
        <ErrorState message={center.error.friendly} onRetry={center.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-swc">
      <header className="nc-swc__header">
        <div>
          <p className="nc-eyebrow">Storm 12 Weather</p>
          <h1 className="nc-page__title">Severe Weather Center</h1>
          <p className="nc-swc__coverage">
            Coverage area: {(data?.coverage ?? config?.coverageStates ?? []).join(' · ')}
            {center.refreshing && <Spinner size={13} />}
          </p>
        </div>

        <div className="nc-swc__counts">
          <Count label="Warnings" value={data?.counts.warnings ?? 0} tone="warning" />
          <Count label="Watches" value={data?.counts.watches ?? 0} tone="watch" />
          <Count label="Advisories" value={data?.counts.advisories ?? 0} tone="advisory" />
          <Count label="Tornado" value={data?.counts.tornadoWarnings ?? 0} tone="tornado" />
        </div>
      </header>

      {/* SPC convective outlook summary */}
      {data?.outlooks?.length ? (
        <Panel eyebrow="Storm Prediction Center" title="Convective Outlook">
          <div className="nc-swc__outlooks">
            {data.outlooks.map((outlook) => {
              const label = outlook.maxRisk?.LABEL2 ?? outlook.maxRisk?.label ?? 'No severe risk';
              const level = outlook.maxRisk?.level ?? -1;
              return (
                <a
                  key={outlook.day}
                  className="nc-swc__outlook"
                  href={outlook.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ '--risk': outlook.maxRisk?.color ?? '#2F5A7E' } as React.CSSProperties}
                >
                  <span className="nc-swc__outlook-day">Day {outlook.day.replace('day', '')}</span>
                  <span className="nc-swc__outlook-risk">{label}</span>
                  <span className="nc-swc__outlook-scale" aria-hidden="true">
                    {RISK_ORDER.map((code, i) => (
                      <span key={code} className={i <= level ? 'is-on' : ''} />
                    ))}
                  </span>
                </a>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <StormTracker storms={storms.data?.storms} loading={storms.loading} />

      {/* Filters */}
      <Panel eyebrow="Filter" title="Narrow The List">
        <div className="nc-swc__filters">
          <input
            type="search"
            className="nc-swc__county"
            value={countyQuery}
            onChange={(e) => setCountyQuery(e.target.value)}
            placeholder="Filter by county or area name"
            aria-label="Filter alerts by county or area"
          />

          <div className="nc-row nc-wrap">
            {(data?.filters.groups ?? []).map((option) => (
              <Chip
                key={option.id}
                active={group === option.id}
                onClick={() => setGroup(group === option.id ? null : option.id)}
                count={(data?.warnings ?? []).concat(data?.watches ?? [], data?.advisories ?? []).filter((a) => a.group === option.id).length}
              >
                {option.label}
              </Chip>
            ))}
          </div>

          <div className="nc-row nc-wrap">
            {(data?.filters.tiers ?? []).map((option) => (
              <Chip
                key={option.id}
                active={tier === option.id}
                color={
                  option.id === 'catastrophic'
                    ? 'var(--nc-tier-catastrophic)'
                    : option.id === 'severe'
                      ? 'var(--nc-tier-severe)'
                      : option.id === 'moderate'
                        ? 'var(--nc-tier-moderate)'
                        : 'var(--nc-tier-minor)'
                }
                onClick={() => setTier(tier === option.id ? null : option.id)}
              >
                {option.label}
              </Chip>
            ))}
            {activeFilters && (
              <Button
                size="sm"
                variant="subtle"
                onClick={() => {
                  setGroup(null);
                  setTier(null);
                  setCountyQuery('');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <Section title="Active Warnings" eyebrow="Take action now" alerts={warnings} loading={center.loading} />
      <Section title="Watches" eyebrow="Be prepared" alerts={watches} loading={center.loading} />
      <Section title="Advisories & Statements" eyebrow="Be aware" alerts={advisories} loading={center.loading} />
    </div>
  );
}

function Section({
  title,
  eyebrow,
  alerts,
  loading,
}: {
  title: string;
  eyebrow: string;
  alerts: WeatherAlert[];
  loading: boolean;
}) {
  return (
    <Panel eyebrow={eyebrow} title={title} action={<span className="nc-swc__section-count">{alerts.length}</span>} flush>
      {loading && alerts.length === 0 ? (
        <div style={{ padding: 'var(--space-4)' }}>
          <div className="nc-skeleton" style={{ height: 64 }} />
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          title={`No ${title.toLowerCase()} in effect`}
          message="Nothing matching your filters is active in the coverage area right now."
        />
      ) : (
        <ul className="nc-swc__alerts">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`nc-swc__count is-${tone}${value > 0 ? ' is-live' : ''}`}>
      <span className="nc-swc__count-value nc-readout">{value}</span>
      <span className="nc-swc__count-label">{label}</span>
    </div>
  );
}

export default SevereWeatherPage;
