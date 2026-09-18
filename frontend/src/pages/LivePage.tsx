import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getLive, getNews } from '../services/weather';
import BreakingBanner from '../components/alerts/BreakingBanner';
import NewsCard from '../components/news/NewsCard';
import WeatherIcon from '../components/ui/WeatherIcon';
import Logo from '../components/ui/Logo';
import { DataStamp, ErrorState, Panel } from '../components/ui/Primitives';
import { formatTemp, formatDayName, isToday } from '../utils/format';
import './LivePage.css';

/**
 * LIVE WEATHER
 *
 * The station's stream, or an honest off-air slate.
 *
 * This page used to fill the player with an animated NWS radar loop whenever
 * the stream was dark, captioned "latest weather video". That tells a viewer
 * the station is on air when it is not. Now it either plays the broadcast or
 * says NOT LIVE and points at the pages that do have live data.
 */
export function LivePage() {
  const { location } = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);

  const live = useResource((signal) => getLive(location, signal), [location.lat, location.lon], {
    refreshMs: 120000,
  });
  const news = useResource(
    (signal) => getNews({ ...location, category: 'breaking', limit: 4 }, signal),
    [location.lat, location.lon],
    { refreshMs: 300000 },
  );

  const data = live.data;
  const stream = data?.stream;
  const coverage = data?.coverage;
  const onAir = Boolean(stream?.available && stream.url);

  // Attach an HLS stream natively where the browser supports it (Safari, iOS).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onAir || stream?.type !== 'hls' || !stream.url) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = stream.url;
  }, [onAir, stream]);

  if (live.error && !data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">Live Weather</h1>
        <ErrorState message={live.error.friendly} onRetry={live.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-live">
      <BreakingBanner breaking={data?.breaking} />

      <header className="nc-live__header">
        <div>
          <p className={`nc-live__flag${onAir ? '' : ' is-off'}`}>
            {onAir && <span className="nc-live-dot" aria-hidden="true" />}
            {onAir ? 'Live weather' : 'Off air'}
          </p>
          <h1 className="nc-page__title">{location.label}</h1>
        </div>

        <div className={`nc-live__status is-${coverage?.status ?? 'normal'}`}>
          <span className="nc-live__status-label">{coverage?.label ?? 'Regular coverage'}</span>
          {coverage?.alertCount ? (
            <span className="nc-live__status-count">
              {coverage.alertCount} active alert{coverage.alertCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="nc-live__status-count">No active alerts for this location</span>
          )}
        </div>
      </header>

      <Panel
        eyebrow={onAir ? 'On air now' : 'Stream status'}
        title={onAir ? stream?.title ?? 'Storm 12 Weather Live' : 'Not Live'}
        flush
      >
        <div className="nc-live__stage">
          {onAir ? (
            <>
              <video ref={videoRef} className="nc-live__video" controls autoPlay muted playsInline>
                <source
                  src={stream?.url}
                  type={stream?.type === 'hls' ? 'application/vnd.apple.mpegurl' : 'video/mp4'}
                />
                Your browser cannot play this stream.
              </video>
              <div className="nc-live__overlay nc-lower-third">
                <div>
                  <span className="nc-lower-third__kicker">LIVE</span>
                  <span className="nc-lower-third__title">Storm 12 Weather</span>
                </div>
              </div>
            </>
          ) : (
            <div className="nc-live__offair">
              <Logo variant="stacked" size={64} sweep={false} />
              <p className="nc-live__offair-tag">Not Live</p>
              <p className="nc-live__offair-copy">
                Storm 12 Weather is not streaming right now. Live coverage starts automatically when the weather
                warrants it, and this page will switch over on its own.
              </p>
              <div className="nc-live__offair-links">
                <Link to="/radar">Live radar</Link>
                <Link to="/severe">Severe Weather Center</Link>
                <Link to="/forecast">Full forecast</Link>
              </div>
            </div>
          )}
        </div>

        <div className="nc-live__stage-foot">
          <span>
            {onAir
              ? 'Streaming live from the Storm 12 weather center.'
              : `${stream?.reason ?? 'Nothing is being streamed right now.'} The radar and forecast pages are live regardless.`}
          </span>
        </div>
      </Panel>

      <div className="nc-live__grid">
        <Panel eyebrow="Right now" title="Current Conditions">
          {data?.current ? (
            <div className="nc-live__now">
              <WeatherIcon name={data.current.observation.icon} size={78} />
              <div>
                <p className="nc-live__now-temp">{formatTemp(data.current.observation.temperature)}</p>
                <p className="nc-live__now-cond">{data.current.observation.condition}</p>
                <p className="nc-live__now-feels">
                  Feels like {formatTemp(data.current.observation.feelsLike)} · Wind{' '}
                  {data.current.observation.windCompass ?? ''} {Math.round(data.current.observation.windSpeed ?? 0)} mph
                </p>
              </div>
            </div>
          ) : (
            <div className="nc-skeleton" style={{ height: 90 }} />
          )}
          <DataStamp
            source={
              data?.current?.observation.stationId ? `NWS ${data.current.observation.stationId}` : undefined
            }
            updatedAt={live.updatedAt}
          />
        </Panel>

        <Panel eyebrow="Next five days" title="Latest Forecast" flush>
          <ul className="nc-live__forecast">
            {(data?.forecast.days ?? []).slice(0, 5).map((day) => (
              <li key={day.date}>
                <span className="nc-live__forecast-day">{isToday(day.date) ? 'Today' : formatDayName(day.date)}</span>
                <WeatherIcon name={day.icon} size={30} animated={false} />
                <span className="nc-live__forecast-temps nc-readout">
                  <strong>{formatTemp(day.high, '')}</strong>
                  <em>{formatTemp(day.low, '')}</em>
                </span>
                <span className="nc-live__forecast-cond">{day.condition}</span>
              </li>
            ))}
          </ul>
          <Link className="nc-live__more" to="/forecast">
            Full 10-day forecast →
          </Link>
        </Panel>
      </div>

      {news.data?.stories && news.data.stories.length > 0 && (
        <Panel eyebrow="Severe weather coverage" title="Breaking Weather Coverage">
          <div className="nc-live__coverage">
            {news.data.stories.map((story) => (
              <NewsCard key={story.id} story={story} layout="row" />
            ))}
          </div>
        </Panel>
      )}

      {news.data?.stories.length === 0 && (
        <Panel eyebrow="Severe weather coverage" title="Breaking Weather Coverage">
          <p style={{ color: 'var(--nc-text-dim)', margin: 0 }}>
            No active severe weather coverage in the Storm 12 Weather viewing area. Live coverage begins automatically
            when the National Weather Service issues a warning.
          </p>
        </Panel>
      )}
    </div>
  );
}

export default LivePage;
