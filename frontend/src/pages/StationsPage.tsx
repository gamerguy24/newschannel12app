import { Suspense, lazy, useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getStations } from '../services/weather';
import StationTable from '../components/weather/StationTable';
import { Chip, DataStamp, ErrorState, Panel, SegmentedControl, Spinner } from '../components/ui/Primitives';

const StationMap = lazy(() => import('../components/maps/StationMap'));

/**
 * WEATHER STATIONS
 *
 * The live observation network around the viewer, plotted on a map and listed
 * in a sortable table. The plotted field switches between temperature, dew
 * point, wind, pressure and flight category.
 */
export function StationsPage() {
  const { location } = useLocation();
  const [radius, setRadius] = useState(120);
  const [field, setField] = useState<'temperature' | 'dewpoint' | 'wind' | 'pressure' | 'station'>('temperature');

  const stations = useResource(
    (signal) => getStations({ ...location, radius, limit: 250 }, signal),
    [location.lat, location.lon, radius],
    { refreshMs: 300000 },
  );

  if (stations.error && !stations.data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">Weather Stations</h1>
        <ErrorState message={stations.error.friendly} onRetry={stations.reload} />
      </div>
    );
  }

  const list = stations.data?.stations ?? [];

  return (
    <div className="nc-page">
      <header>
        <p className="nc-eyebrow">Live observations</p>
        <h1 className="nc-page__title">Weather Stations</h1>
        <p style={{ margin: '6px 0 0', maxWidth: '72ch', fontSize: 'var(--text-sm)', color: 'var(--nc-text-dim)' }}>
          Surface observations from reporting METAR and ASOS sites near {location.label}, direct from the NOAA
          Aviation Weather Center.
        </p>
      </header>

      <Panel
        eyebrow="Observation map"
        title={`${list.length} Reporting Stations`}
        action={
          <div className="nc-row">
            {stations.refreshing && <Spinner size={15} />}
            <SegmentedControl
              size="sm"
              value={field}
              onChange={setField}
              options={[
                { value: 'temperature', label: 'Temp' },
                { value: 'dewpoint', label: 'Dew Pt' },
                { value: 'wind', label: 'Wind' },
                { value: 'pressure', label: 'Press' },
                { value: 'station', label: 'Sites' },
              ]}
            />
          </div>
        }
        flush
      >
        <Suspense
          fallback={
            <div style={{ height: 480, display: 'grid', placeItems: 'center', background: '#04101c' }}>
              <Spinner size={30} label="Loading map" />
            </div>
          }
        >
          <StationMap stations={list} location={location} field={field} height="480px" />
        </Suspense>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--nc-line-soft)',
            flexWrap: 'wrap',
          }}
        >
          <span className="nc-eyebrow">Search radius</span>
          {[60, 120, 200, 300].map((miles) => (
            <Chip key={miles} active={radius === miles} onClick={() => setRadius(miles)}>
              {miles} mi
            </Chip>
          ))}
          <DataStamp source="NOAA Aviation Weather Center METAR" updatedAt={stations.updatedAt} />
        </div>
      </Panel>

      <StationTable stations={list} title="Observation Detail" />
    </div>
  );
}

export default StationsPage;
