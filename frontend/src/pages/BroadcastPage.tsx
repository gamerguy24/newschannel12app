import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from '../context/LocationContext';
import { useClock, useElementSize, useResource } from '../hooks';
import { getBroadcast } from '../services/weather';
import type { BroadcastPayload } from '../services/weather';
import Logo from '../components/ui/Logo';
import WeatherIcon from '../components/ui/WeatherIcon';
import { ErrorState, Spinner } from '../components/ui/Primitives';
import {
  formatDayName,
  formatExpiry,
  formatHour,
  formatPercent,
  formatPressure,
  formatTemp,
  formatVisibility,
  formatWind,
  minutesUntil,
} from '../utils/format';
import './BroadcastPage.css';

// Leaflet is never downloaded until Broadcast Mode is actually opened.
const RadarMap = lazy(() => import('../components/radar/RadarMap'));

/**
 * BROADCAST MODE
 *
 * A 1920x1080 on-air surface for a studio monitor, a lobby screen or a
 * second display. The stage is drawn at a fixed 16:9 size and scaled to fit
 * whatever it is shown on, so type and graphics keep their broadcast
 * proportions on a 4K wall and on a laptop alike.
 */

const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

export function BroadcastPage() {
  const { location } = useLocation();
  const clock = useClock(1000);
  const [frameRef, size] = useElementSize<HTMLDivElement>();
  const [chromeVisible, setChromeVisible] = useState(true);

  const broadcast = useResource((signal) => getBroadcast(location, signal), [location.lat, location.lon], {
    refreshMs: 60000,
  });

  // A first load that fails must not sit on a red card waiting for somebody to
  // notice and click. Once there is data a failed refresh keeps the last good
  // payload on screen, but until then this retries on its own. Every failure
  // hands back a new error object, so each one re-arms the timer.
  const stalled = Boolean(broadcast.error) && !broadcast.data;
  useEffect(() => {
    if (!stalled) return undefined;
    const timer = window.setTimeout(broadcast.reload, 5000);
    return () => window.clearTimeout(timer);
  }, [stalled, broadcast.error, broadcast.reload]);

  // The operator chrome fades out so the stage is clean on air.
  useEffect(() => {
    if (!chromeVisible) return undefined;
    const timer = window.setTimeout(() => setChromeVisible(false), 4000);
    return () => window.clearTimeout(timer);
  }, [chromeVisible]);

  useEffect(() => {
    const wake = () => setChromeVisible(true);
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  const data = broadcast.data;
  const scale = size.width && size.height ? Math.min(size.width / STAGE_WIDTH, size.height / STAGE_HEIGHT) : 0;

  if (broadcast.error && !data) {
    return (
      <div className="nc-broadcast nc-broadcast--message">
        <ErrorState
          title="Broadcast feed unavailable"
          message={`${broadcast.error.friendly} Retrying automatically.`}
          onRetry={broadcast.reload}
        />
        <Link className="nc-broadcast__exit-link" to="/">
          Leave Broadcast Mode
        </Link>
      </div>
    );
  }

  const current = data?.current ?? null;
  const observation = current?.observation;
  const timeZone = current?.location.timeZone ?? undefined;
  const breaking = data?.breaking;
  const takeover = Boolean(breaking?.active && breaking.takeover && breaking.alert);
  const hours = (data?.hourly.hours ?? []).slice(0, 10);
  const days = (data?.daily.days ?? []).slice(0, 7);
  const storm = data?.storms.storms?.[0] ?? null;

  return (
    <div className="nc-broadcast" ref={frameRef}>
      {!data && (
        <div className="nc-broadcast__loading">
          <Spinner size={44} label="Building the broadcast" />
        </div>
      )}

      {data && (
        <div
          className={`nc-broadcast__stage${takeover ? ' is-takeover' : ''}`}
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `translate(-50%, -50%) scale(${scale || 0.01})`,
          }}
        >
          {/* ------------------------------------------------------- header */}
          <header className="nc-bc__header">
            <div className="nc-bc__brand">
              {/* The lockup already carries the station name; only the market rides beside it. */}
              <Logo variant="broadcast" size={72} />
              <p className="nc-bc__market">{data.station.market} · First Alert Weather</p>
            </div>

            <div className="nc-bc__headline-place">
              <p className="nc-bc__place">{(location.nickname ?? location.label).toUpperCase()}</p>
              <p className="nc-bc__condition">{observation?.condition ?? 'Conditions unavailable'}</p>
            </div>

            <div className="nc-bc__clock">
              <p className="nc-bc__time nc-readout">
                {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })}
              </p>
              <p className="nc-bc__date">
                {clock
                  .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone })
                  .toUpperCase()}
              </p>
            </div>
          </header>

          {/* ---------------------------------------------------- takeover */}
          {takeover && breaking?.alert && (
            <div className="nc-bc__takeover" style={{ '--c': breaking.alert.color } as React.CSSProperties}>
              <span className="nc-bc__takeover-tag">
                {breaking.alert.isEmergency ? 'WEATHER EMERGENCY' : 'BREAKING WEATHER'}
              </span>
              <span className="nc-bc__takeover-event">{breaking.alert.event.toUpperCase()}</span>
              <span className="nc-bc__takeover-area">{breaking.alert.areaDesc}</span>
              <span className="nc-bc__takeover-until nc-readout">
                UNTIL {formatExpiry(breaking.alert.ends, timeZone).toUpperCase()}
              </span>
            </div>
          )}

          <div className="nc-bc__body">
            {/* ------------------------------------------------------ radar */}
            <section className="nc-bc__radar" aria-label="Live radar">
              <Suspense
                fallback={
                  <div className="nc-bc__radar-loading">
                    <Spinner size={34} label="Loading radar" />
                  </div>
                }
              >
                <RadarMap location={location} initialSite={data.radarSite} height="100%" compact />
              </Suspense>
            </section>

            {/* ------------------------------------------------- right rail */}
            <div className="nc-bc__rail">
              <section className="nc-bc__now" aria-label="Current conditions">
                <WeatherIcon name={observation?.icon ?? 'cloudy'} size={132} />
                <p className="nc-bc__temp nc-readout">{formatTemp(observation?.temperature)}</p>
                <p className="nc-bc__feels">
                  FEELS LIKE <strong className="nc-readout">{formatTemp(observation?.feelsLike)}</strong>
                </p>
                <dl className="nc-bc__stats">
                  <div>
                    <dt>Wind</dt>
                    <dd>{formatWind(observation?.windSpeed, observation?.windCompass, observation?.windGust)}</dd>
                  </div>
                  <div>
                    <dt>Humidity</dt>
                    <dd>{formatPercent(observation?.humidity)}</dd>
                  </div>
                  <div>
                    <dt>Dew Point</dt>
                    <dd>{formatTemp(observation?.dewpoint)}</dd>
                  </div>
                  <div>
                    <dt>Pressure</dt>
                    <dd>{formatPressure(observation?.pressure, observation?.pressureTrend)}</dd>
                  </div>
                  <div>
                    <dt>Visibility</dt>
                    <dd>{formatVisibility(observation?.visibility)}</dd>
                  </div>
                  <div>
                    <dt>Station</dt>
                    <dd>{observation?.stationId ?? '--'}</dd>
                  </div>
                </dl>
              </section>

              {storm ? (
                <section className="nc-bc__storm" style={{ '--c': storm.color } as React.CSSProperties}>
                  <p className="nc-bc__storm-kicker">STORM TRACKER</p>
                  <p className="nc-bc__storm-event">{storm.event.toUpperCase()}</p>
                  <p className="nc-bc__storm-move">
                    MOVING {storm.movement.text.toUpperCase()} · {storm.positionText ?? ''}
                  </p>
                  {storm.eta?.minutes !== null && storm.eta?.minutes !== undefined && (
                    <p className="nc-bc__storm-eta nc-readout">ARRIVES IN {storm.eta.minutes} MIN</p>
                  )}
                </section>
              ) : (
                <section className="nc-bc__hourly" aria-label="Next hours">
                  <p className="nc-bc__section-title">NEXT 10 HOURS</p>
                  <div className="nc-bc__hourly-strip">
                    {hours.map((hour) => (
                      <div key={hour.time} className="nc-bc__hour">
                        <span className="nc-bc__hour-time nc-readout">{formatHour(hour.time, timeZone)}</span>
                        <WeatherIcon name={hour.icon} size={36} animated={false} />
                        <span className="nc-bc__hour-temp nc-readout">{formatTemp(hour.temperature)}</span>
                        <span className="nc-bc__hour-pop nc-readout">{formatPercent(hour.precipProbability)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>

          {/* ------------------------------------------------- seven day */}
          <section className="nc-bc__seven" aria-label="Seven day forecast">
            <p className="nc-bc__seven-title">STORM 12 SEVEN DAY FORECAST</p>
            <div className="nc-bc__seven-strip">
              {days.map((day, index) => (
                <div key={day.date} className="nc-bc__day">
                  <span className="nc-bc__day-name">
                    {index === 0 ? 'TODAY' : formatDayName(day.date, 'short').toUpperCase()}
                  </span>
                  <WeatherIcon name={day.icon} size={62} />
                  <span className="nc-bc__day-high nc-readout">{formatTemp(day.high)}</span>
                  <span className="nc-bc__day-low nc-readout">{formatTemp(day.low)}</span>
                  <span className="nc-bc__day-pop nc-readout">{formatPercent(day.precipProbability)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ------------------------------------------------------ crawl */}
          <footer className="nc-bc__crawl">
            <span className="nc-bc__crawl-tag">
              {data.alerts.length > 0 ? `${data.alerts.length} ACTIVE ALERTS` : 'AREA TEMPERATURES'}
            </span>
            <div className="nc-bc__crawl-track">
              {/* Rendered twice so the -50% loop meets itself with no gap. */}
              <div className="nc-bc__crawl-run">
                <CrawlRun alerts={data.alerts} markets={data.markets} timeZone={timeZone} />
                <CrawlRun alerts={data.alerts} markets={data.markets} timeZone={timeZone} duplicate />
              </div>
            </div>
            {data.sponsor && (
              <span className="nc-bc__sponsor">
                <em>Weather brought to you by</em>
                <strong>{data.sponsor.name}</strong>
              </span>
            )}
          </footer>
        </div>
      )}

      {/* Operator chrome - never part of the stage itself. */}
      <div className={`nc-broadcast__chrome${chromeVisible ? ' is-visible' : ''}`}>
        <Link to="/" className="nc-broadcast__chrome-btn">
          Exit Broadcast Mode
        </Link>
        <button type="button" className="nc-broadcast__chrome-btn" onClick={toggleFullscreen}>
          Fullscreen
        </button>
        <span className="nc-broadcast__chrome-meta nc-readout">
          {broadcast.refreshing ? 'Refreshing' : 'Live'} ·{' '}
          {breaking?.active
            ? `${breaking.totalActive ?? 0} alerts · next expiry ${
                minutesUntil(breaking.alert?.ends) ?? '--'
              } min`
            : 'No active alerts'}
        </span>
      </div>
    </div>
  );
}

/** One pass of the bottom crawl: active alerts first, then market temperatures. */
function CrawlRun({
  alerts,
  markets,
  timeZone,
  duplicate,
}: {
  alerts: BroadcastPayload['alerts'];
  markets: BroadcastPayload['markets'];
  timeZone?: string | null;
  duplicate?: boolean;
}) {
  return (
    <>
      {alerts.slice(0, 8).map((alert) => (
        <span
          key={`${duplicate ? 'dup-' : ''}${alert.id}`}
          className="nc-bc__crawl-item is-alert"
          style={{ '--c': alert.color } as React.CSSProperties}
          aria-hidden={duplicate}
        >
          {alert.event.toUpperCase()} · {alert.areaDesc}
          {alert.ends ? ` · UNTIL ${formatExpiry(alert.ends, timeZone).toUpperCase()}` : ''}
        </span>
      ))}
      {markets.map((market) => (
        <span
          key={`${duplicate ? 'dup-' : ''}${market.name}`}
          className="nc-bc__crawl-item"
          aria-hidden={duplicate}
        >
          <WeatherIcon name={market.icon} size={22} animated={false} />
          {market.name} <strong className="nc-readout">{formatTemp(market.temperature)}</strong>
        </span>
      ))}
    </>
  );
}

export default BroadcastPage;
