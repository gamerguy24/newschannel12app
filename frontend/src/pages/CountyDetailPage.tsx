import { Suspense, lazy } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useResource, useStoredState } from '../hooks';
import { useLocation } from '../context/LocationContext';
import { getCountyDetail } from '../services/weather';
import CurrentConditionsPanel from '../components/weather/CurrentConditions';
import HourlyForecast from '../components/weather/HourlyForecast';
import DailyForecast from '../components/weather/DailyForecast';
import AlertStrip from '../components/alerts/AlertStrip';
import ProductText from '../components/weather/ProductText';
import StationTable from '../components/weather/StationTable';
import { Button, ErrorState, Panel, Spinner } from '../components/ui/Primitives';

const RadarMap = lazy(() => import('../components/radar/RadarMap'));

/**
 * A single county: conditions, hourly and extended forecasts, its own radar,
 * every active product for the zone, surface observations, and the responsible
 * office's forecast discussion.
 */
export function CountyDetailPage() {
  const { zoneId = '' } = useParams();
  const { setLocation } = useLocation();
  const [favorites, setFavorites] = useStoredState<string[]>('nc12.favoriteCounties', []);

  const detail = useResource((signal) => getCountyDetail(zoneId, signal), [zoneId], { refreshMs: 180000 });
  const data = detail.data;
  const isFavorite = favorites.includes(zoneId);

  if (detail.error && !data) {
    return (
      <div className="nc-page">
        <Link to="/counties">← All counties</Link>
        <ErrorState title={`Could not load ${zoneId}`} message={detail.error.friendly} onRetry={detail.reload} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="nc-page" style={{ alignItems: 'center', paddingTop: '14vh' }}>
        <Spinner size={32} label="Loading county" />
      </div>
    );
  }

  const county = data.county;
  const timeZone = data.current?.location.timeZone;
  const allAlerts = [...data.warnings, ...data.watches, ...data.advisories];

  return (
    <div className="nc-page">
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <Link to="/counties" className="nc-eyebrow" style={{ textDecoration: 'none' }}>
            ← County Weather
          </Link>
          <h1 className="nc-page__title">{county.label}</h1>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--nc-text-dim)' }}>
            Zone {county.id}
            {county.cwa?.[0] ? ` · NWS ${county.cwa[0]}` : ''}
            {county.radarStation ? ` · Radar ${county.radarStation}` : ''}
          </p>
        </div>

        <div className="nc-row">
          <Button
            variant={isFavorite ? 'primary' : 'outline'}
            size="sm"
            onClick={() =>
              setFavorites((prev) => (prev.includes(zoneId) ? prev.filter((f) => f !== zoneId) : [...prev, zoneId]))
            }
          >
            {isFavorite ? 'Saved' : 'Save county'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLocation({
                id: county.id,
                type: 'county',
                name: county.name,
                state: county.state,
                label: county.label,
                lat: county.lat,
                lon: county.lon,
                zoneId: county.id,
              })
            }
          >
            Set as my location
          </Button>
        </div>
      </header>

      {allAlerts.length > 0 && <AlertStrip alerts={allAlerts} title={`Active for ${county.name} County`} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-5)', alignItems: 'start' }} className="nc-county-detail__grid">
        <CurrentConditionsPanel data={data.current} loading={detail.loading} updatedAt={detail.updatedAt} />

        <Panel eyebrow="County radar" title={`${county.radarStation ?? 'Nearest'} Radar`} flush>
          <Suspense fallback={<div style={{ height: 380, display: 'grid', placeItems: 'center' }}><Spinner size={28} /></div>}>
            <RadarMap
              location={{ lat: county.lat, lon: county.lon, name: county.name, label: county.label }}
              initialSite={county.radarStation ?? data.radarSites[0]?.id}
              height="380px"
              compact
            />
          </Suspense>
        </Panel>
      </div>

      <HourlyForecast hours={data.hourly.hours} loading={detail.loading} timeZone={timeZone} />

      <DailyForecast days={data.daily.days} loading={detail.loading} timeZone={timeZone} />

      <StationTable stations={data.observations} title="Weather Observations" />

      {data.discussion ? (
        <ProductText
          product={data.discussion}
          title="NWS Forecast Discussion"
          eyebrow={`Office ${data.discussion.office}`}
        />
      ) : (
        <Panel eyebrow="Forecast discussion" title="NWS Forecast Discussion">
          <p style={{ margin: 0, color: 'var(--nc-text-dim)' }}>
            No forecast discussion is published for this office right now.
          </p>
        </Panel>
      )}
    </div>
  );
}

export default CountyDetailPage;
