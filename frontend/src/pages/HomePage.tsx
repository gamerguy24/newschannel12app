import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getOverview, getStormTracks, getNews } from '../services/weather';
import BreakingBanner from '../components/alerts/BreakingBanner';
import StormTracker from '../components/alerts/StormTracker';
import ConditionsHero from '../components/weather/ConditionsHero';
import HourlyForecast from '../components/weather/HourlyForecast';
import DailyForecast from '../components/weather/DailyForecast';
import AlertStrip from '../components/alerts/AlertStrip';
import RadarPreview from '../components/radar/RadarPreview';
import NewsRail from '../components/news/NewsRail';
import { ErrorState } from '../components/ui/Primitives';
import './HomePage.css';

/**
 * HOME - the Storm 12 weather page.
 *
 * Laid out the way a station leads its weather page: any breaking coverage,
 * then conditions and radar side by side, then the hourly and 7-day
 * forecasts. Sections that have nothing to say are left out entirely - the
 * storm tracker appears when there are storms, not as an empty card.
 */
export function HomePage() {
  const { location } = useLocation();

  const overview = useResource((signal) => getOverview(location, signal), [location.lat, location.lon], {
    refreshMs: 180000,
  });

  const storms = useResource((signal) => getStormTracks(location, 200, signal), [location.lat, location.lon], {
    refreshMs: 60000,
  });

  const news = useResource((signal) => getNews({ ...location, limit: 8 }, signal), [location.lat, location.lon], {
    refreshMs: 600000,
  });

  const data = overview.data;
  const current = data?.current ?? null;
  const timeZone = current?.location.timeZone;
  const days = data?.daily.days;
  const tracked = storms.data?.storms ?? [];

  if (overview.error && !data) {
    return (
      <div className="nc-page">
        <ErrorState
          title="Weather data unavailable"
          message={`${overview.error.friendly} Storm 12 Weather pulls its data from the National Weather Service; if their service is down we will reconnect automatically.`}
          onRetry={overview.reload}
        />
      </div>
    );
  }

  return (
    <div className="nc-page nc-home">
      <BreakingBanner breaking={data?.breaking} />

      <AlertStrip alerts={data?.breaking?.others ?? []} primaryShown={Boolean(data?.breaking?.active)} />

      <div className="nc-home__lead">
        <ConditionsHero data={current} today={days?.[0]} loading={overview.loading} />
        <RadarPreview location={location} site={current?.location.radarStation} storms={tracked} />
      </div>

      {tracked.length > 0 && <StormTracker storms={tracked} compact />}

      <HourlyForecast hours={data?.hourly.hours} loading={overview.loading} timeZone={timeZone} />

      <DailyForecast days={days?.slice(0, 7)} loading={overview.loading} timeZone={timeZone} />

      <NewsRail stories={news.data?.stories} loading={news.loading} />

      {data?.errors && data.errors.length > 0 && (
        <p className="nc-home__degraded">
          Some sections are running on cached data: {data.errors.map((e) => e.section).join(', ')}. They will
          refresh automatically.
        </p>
      )}
    </div>
  );
}

export default HomePage;
