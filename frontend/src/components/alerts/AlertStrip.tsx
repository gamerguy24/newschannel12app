import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatExpiry } from '../../utils/format';
import type { WeatherAlert } from '../../api/types';
import './AlertStrip.css';

/**
 * The quieter alert row that sits under BREAKING WEATHER: watches, advisories
 * and any additional warnings beyond the one taking over the screen.
 */
export function AlertStrip({
  alerts,
  primaryShown,
  title,
}: {
  alerts: WeatherAlert[];
  primaryShown?: boolean;
  title?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!alerts.length) return null;

  return (
    <section className="nc-strip" aria-label={title ?? 'Additional weather alerts'}>
      <header className="nc-strip__head">
        <span className="nc-eyebrow">{title ?? (primaryShown ? 'Also in effect' : 'Active alerts')}</span>
        <Link to="/severe">All alerts →</Link>
      </header>

      <ul className="nc-strip__list">
        {alerts.map((alert) => {
          const open = openId === alert.id;
          return (
            <li key={alert.id} style={{ '--alert-color': alert.color } as React.CSSProperties}>
              <button type="button" onClick={() => setOpenId(open ? null : alert.id)} aria-expanded={open}>
                <span className="nc-strip__kind">{alert.kind}</span>
                <span className="nc-strip__event">{alert.event}</span>
                <span className="nc-strip__areas">{alert.areas.slice(0, 3).join(', ')}</span>
                <span className="nc-strip__until nc-readout">until {formatExpiry(alert.ends)}</span>
              </button>
              {open && (
                <div className="nc-strip__detail nc-enter">
                  {alert.headline && <p className="nc-strip__headline">{alert.headline}</p>}
                  {alert.description && <p>{alert.description}</p>}
                  {alert.instruction && (
                    <p className="nc-strip__instruction">
                      <strong>What to do: </strong>
                      {alert.instruction}
                    </p>
                  )}
                  <p className="nc-strip__source">Issued by NWS {alert.office}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default AlertStrip;
