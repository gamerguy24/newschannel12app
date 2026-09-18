import { Link } from 'react-router-dom';
import { Panel, EmptyState, Chip } from '../ui/Primitives';
import { useClock } from '../../hooks';
import { formatDistance, formatDuration, formatExpiry, minutesUntil } from '../../utils/format';
import type { TrackedStorm } from '../../api/types';
import './StormTracker.css';

/**
 * STORM TRACKER
 *
 * One card per warned cell within range: what it is, where it is relative to
 * the viewer, how fast and which way it is moving, when it arrives, and what
 * it is capable of. Every value comes from the storm motion vector the NWS
 * publishes with the warning - nothing here is estimated by us except the
 * along-track arrival time, which is derived from that vector.
 */

function CompassRose({ headingDeg, speedMph }: { headingDeg: number; speedMph: number }) {
  return (
    <div className="nc-storm__rose" title={`Moving toward ${Math.round(headingDeg)}°`}>
      <svg viewBox="0 0 60 60" width="58" height="58" aria-hidden="true">
        <circle cx="30" cy="30" r="26" fill="rgba(4,16,28,0.6)" stroke="var(--nc-line)" strokeWidth="1.4" />
        {['N', 'E', 'S', 'W'].map((label, i) => {
          const angle = (i * 90 - 90) * (Math.PI / 180);
          return (
            <text
              key={label}
              x={30 + Math.cos(angle) * 20.5}
              y={30 + Math.sin(angle) * 20.5 + 3.2}
              textAnchor="middle"
              fontSize="8"
              fontFamily="var(--font-display)"
              fontWeight="700"
              fill="var(--nc-text-faint)"
            >
              {label}
            </text>
          );
        })}
        <g transform={`rotate(${headingDeg} 30 30)`} className="nc-storm__rose-arrow">
          <path d="M30 11 L36 33 L30 28.5 L24 33 Z" fill="var(--nc-cyan-bright)" />
        </g>
        <circle cx="30" cy="30" r="2.6" fill="var(--nc-cyan)" />
      </svg>
      <span className="nc-readout">{speedMph} mph</span>
    </div>
  );
}

function StormCard({ storm, now }: { storm: TrackedStorm; now: number }) {
  const remaining = minutesUntil(storm.expires, now);
  const approaching = storm.eta?.status === 'approaching';

  return (
    <article
      className={`nc-storm${storm.insideWarning ? ' is-overhead' : ''}${
        storm.tier === 'catastrophic' ? ' is-critical' : ''
      }`}
      style={{ '--storm-color': storm.color } as React.CSSProperties}
    >
      <header className="nc-storm__head">
        <div>
          <p className="nc-storm__kicker">
            {storm.insideWarning ? 'OVER YOUR LOCATION' : approaching ? 'APPROACHING' : 'IN THE AREA'}
          </p>
          <h3 className="nc-storm__event">{storm.event}</h3>
        </div>
        {storm.isEmergency && <span className="nc-storm__emergency">EMERGENCY</span>}
      </header>

      <div className="nc-storm__grid">
        <CompassRose headingDeg={storm.movement.headingDeg} speedMph={storm.movement.speedMph} />

        <dl className="nc-storm__facts">
          <div>
            <dt>Moving</dt>
            <dd className="is-strong">{storm.movement.text}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{storm.positionText ?? storm.areas[0] ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>{storm.insideWarning ? 'Status' : approaching ? 'ETA' : 'Distance'}</dt>
            <dd className={approaching ? 'is-eta' : ''}>
              {storm.insideWarning
                ? 'Warning includes you'
                : approaching && storm.eta?.minutes !== null
                  ? formatDuration(storm.eta?.minutes ?? null)
                  : storm.eta?.status === 'departing'
                    ? `Moving away · ${formatDistance(storm.distance)}`
                    : formatDistance(storm.distance)}
            </dd>
          </div>
          <div>
            <dt>Warning ends</dt>
            <dd className="nc-readout">
              {formatExpiry(storm.expires)}
              {remaining !== null && remaining < 90 ? ` · ${formatDuration(remaining)}` : ''}
            </dd>
          </div>
        </dl>
      </div>

      {storm.potential.length > 0 && (
        <div className="nc-storm__potential">
          <p className="nc-storm__potential-label">Potential</p>
          <div className="nc-row nc-wrap">
            {storm.potential.map((threat) => (
              <Chip
                key={threat.id}
                active
                color={
                  threat.severity === 'extreme'
                    ? 'var(--nc-red-bright)'
                    : threat.severity === 'high'
                      ? 'var(--nc-tier-severe)'
                      : 'var(--nc-cyan)'
                }
                title={threat.detail ?? undefined}
              >
                {threat.label}
                {threat.detail ? ` · ${threat.detail}` : ''}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <footer className="nc-storm__foot">
        <span>
          {storm.areas.slice(0, 3).join(', ')}
          {storm.areas.length > 3 && ` +${storm.areas.length - 3}`}
        </span>
        <Link to={`/radar?storm=${encodeURIComponent(storm.id)}`}>Track on radar</Link>
      </footer>
    </article>
  );
}

export function StormTracker({
  storms,
  loading,
  compact,
}: {
  storms: TrackedStorm[] | undefined;
  loading?: boolean;
  compact?: boolean;
}) {
  const clock = useClock(30000);

  return (
    <Panel
      eyebrow="Live tracking"
      title="Storm Tracker"
      action={
        storms && storms.length > 0 ? (
          <span className="nc-storm__count nc-readout">{storms.length} tracked</span>
        ) : undefined
      }
    >
      {loading && !storms ? (
        <div className="nc-storm__list">
          <div className="nc-skeleton" style={{ height: 168 }} />
        </div>
      ) : !storms || storms.length === 0 ? (
        <EmptyState
          title="No tracked storms"
          message="No warned storm cells are within range of your location. The tracker updates automatically as the National Weather Service issues new warnings."
          icon={
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
            </svg>
          }
        />
      ) : (
        <div className="nc-storm__list">
          {(compact ? storms.slice(0, 2) : storms).map((storm) => (
            <StormCard key={storm.id} storm={storm} now={clock.getTime()} />
          ))}
          {compact && storms.length > 2 && (
            <Link className="nc-storm__more" to="/severe">
              View all {storms.length} tracked storms
            </Link>
          )}
        </div>
      )}
    </Panel>
  );
}

export default StormTracker;
