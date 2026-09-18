import { useSearchParams } from 'react-router-dom';
import RadarMap from '../components/radar/RadarMap';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getCurrent } from '../services/weather';
import './RadarPage.css';

/**
 * RADAR - the full-screen interactive surface.
 *
 * The map fills everything below the header so the radar is the product, not
 * a widget inside a page.
 */
export function RadarPage() {
  const { location } = useLocation();
  const [params] = useSearchParams();
  const focusStormId = params.get('storm');

  const { data: current } = useResource((signal) => getCurrent(location, signal), [location.lat, location.lon]);

  return (
    <div className="nc-radar-page">
      <RadarMap
        location={location}
        initialSite={current?.location.radarStation}
        height="100%"
        focusStormId={focusStormId}
      />
    </div>
  );
}

export default RadarPage;
