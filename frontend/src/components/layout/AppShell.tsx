import { useEffect } from 'react';
import { useLocation as useRouterLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Header from './Header';
import Ticker from './Ticker';
import MobileNav from './MobileNav';
import ClosingsBar from './ClosingsBar';
import { useLocation } from '../../context/LocationContext';
import { useResource } from '../../hooks';
import { getCurrent } from '../../services/weather';
import './AppShell.css';

/**
 * The persistent frame around every screen: header, ticker and mobile nav.
 *
 * Current conditions are fetched once here and passed down, so the header,
 * the ticker and the page below share a single request instead of three.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { location } = useLocation();
  const router = useRouterLocation();

  const { data: current, loading } = useResource(
    (signal) => getCurrent(location, signal),
    [location.lat, location.lon],
    { refreshMs: 180000 },
  );

  // Route changes return the viewer to the top of the new screen.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [router.pathname]);

  // Keep the document title useful when a tab is one of many.
  useEffect(() => {
    const temp = current?.observation.temperature;
    document.title =
      temp === null || temp === undefined
        ? 'Storm 12 Weather'
        : `${Math.round(temp)}° ${location.name} · Storm 12 Weather`;
  }, [current, location.name]);

  return (
    <div className="nc-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Header current={current} loading={loading} />
      <ClosingsBar />
      <main id="main" className="nc-shell__main">
        {children}
      </main>
      <Ticker />
      <MobileNav />
    </div>
  );
}

export default AppShell;
