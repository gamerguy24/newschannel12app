import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAlerts } from '../../context/AlertContext';
import { useClock } from '../../hooks';
import { formatDistance, formatDuration, formatExpiry, minutesUntil } from '../../utils/format';
import type { BreakingWeather } from '../../api/types';
import './BreakingBanner.css';

/**
 * BREAKING WEATHER
 *
 * Takes over the top of the screen whenever an NWS warning covers the viewer's
 * location. It shows the affected areas, the expiration, the storm's motion
 * and how far the cell is from them - the four things a viewer needs first.
 *
 * Watches and advisories deliberately do not take over; they ride in the
 * quieter strip so a true warning still means something.
 */
export function BreakingBanner({ breaking }: { breaking: BreakingWeather | null | undefined }) {
  const { dismissed, dismiss } = useAlerts();
  const clock = useClock(30000);
  const [expanded, setExpanded] = useState(false);

  if (!breaking?.active || !breaking.alert) return null;

  const alert = breaking.alert;
  if (dismissed.includes(alert.id)) return null;

  const storm = breaking.storm;
  const remaining = minutesUntil(alert.ends, clock.getTime());
  const takeover = Boolean(breaking.takeover);
  const critical = alert.isEmergency || alert.tier === 'catastrophic';
  // A station bulletin must never read as a National Weather Service product.
  const fromStation = alert.source === 'station';

  return (
    <section
      className={`nc-breaking${takeover ? ' is-takeover' : ' is-standard'}${critical ? ' is-critical' : ''}`}
      style={{ '--alert-color': alert.color } as React.CSSProperties}
      role="alert"
      aria-live="assertive"
    >
      <div className="nc-breaking__flag">
        <span className="nc-live-dot" aria-hidden="true" />
        <span className="nc-breaking__flag-text">
          {critical ? 'BREAKING WEATHER' : takeover ? 'BREAKING WEATHER' : 'WEATHER ALERT'}
        </span>
      </div>

      <div className="nc-breaking__body">
        <div className="nc-breaking__headline-row">
          <h2 className="nc-breaking__event">{alert.event.toUpperCase()}</h2>
          {alert.isEmergency && <span className="nc-breaking__emergency">EMERGENCY</span>}
          <span className={`nc-breaking__source${fromStation ? ' is-station' : ''}`}>
            {fromStation ? `From the ${alert.senderName} weather desk` : `National Weather Service · ${alert.office}`}
          </span>
          <span className="nc-breaking__until">
            Until <strong className="nc-readout">{formatExpiry(alert.ends)}</strong>
            {remaining !== null && remaining < 120 && (
              <em className="nc-breaking__countdown"> · {formatDuration(remaining)} left</em>
            )}
          </span>
        </div>

        {/* The headline is the whole message on a station takeover, and the
            NWS's own one-line summary is more useful than its long form. */}
        {(fromStation ? alert.headline : alert.nwsHeadline) && (
          <p className="nc-breaking__headline">{fromStation ? alert.headline : alert.nwsHeadline}</p>
        )}

        <p className="nc-breaking__areas">
          <span className="nc-breaking__label">Affected areas</span>
          {alert.areas.slice(0, 6).join(' · ')}
          {alert.areas.length > 6 && ` and ${alert.areas.length - 6} more`}
        </p>

        {storm && (
          <div className="nc-breaking__storm">
            <span className="nc-breaking__stat">
              <span className="nc-breaking__label">Storm movement</span>
              <strong>{storm.movement}</strong>
            </span>
            {storm.positionText && (
              <span className="nc-breaking__stat">
                <span className="nc-breaking__label">Location</span>
                <strong>{storm.positionText}</strong>
              </span>
            )}
            <span className="nc-breaking__stat">
              <span className="nc-breaking__label">Distance from you</span>
              <strong>{formatDistance(storm.distance)}</strong>
            </span>
            {storm.eta?.minutes !== null && storm.eta?.status === 'approaching' && (
              <span className="nc-breaking__stat is-eta">
                <span className="nc-breaking__label">Arrives in</span>
                <strong>{formatDuration(storm.eta.minutes)}</strong>
              </span>
            )}
          </div>
        )}

        {breaking.potential && breaking.potential.length > 0 && (
          <ul className="nc-breaking__potential">
            {breaking.potential.map((threat) => (
              <li key={threat.id} className={`is-${threat.severity}`}>
                {threat.label}
                {threat.detail && <em> {threat.detail}</em>}
              </li>
            ))}
          </ul>
        )}

        {expanded && (
          <div className="nc-breaking__detail nc-enter">
            {alert.description && <p>{alert.description}</p>}
            {alert.instruction && (
              <p className="nc-breaking__instruction">
                <strong>What to do: </strong>
                {alert.instruction}
              </p>
            )}
            <p className="nc-breaking__source">
              Issued by NWS {alert.office} · {alert.senderName}
            </p>
          </div>
        )}

        <div className="nc-breaking__actions">
          <button type="button" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Hide details' : 'Full warning text'}
          </button>
          <Link to="/radar">View on radar</Link>
          <Link to="/severe">Severe Weather Center</Link>
          {breaking.totalActive && breaking.totalActive > 1 ? (
            <span className="nc-breaking__more">+{breaking.totalActive - 1} more active</span>
          ) : null}
        </div>
      </div>

      {/* Dismissal is per-alert-id and never offered for a life-threatening
          product, which must stay on screen until it expires. */}
      {!critical && (
        <button
          type="button"
          className="nc-breaking__dismiss"
          onClick={() => dismiss(alert.id)}
          aria-label="Dismiss this alert banner"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </section>
  );
}

export default BreakingBanner;
