import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation as useRouterLocation } from 'react-router-dom';
import { LocationProvider } from './context/LocationContext';
import { AlertProvider } from './context/AlertContext';
import AppShell from './components/layout/AppShell';
import { Spinner } from './components/ui/Primitives';
import HomePage from './pages/HomePage';

/**
 * Route table. Everything past the home screen is code-split, so first paint
 * only downloads the dashboard - Leaflet in particular never loads until the
 * viewer opens a map surface.
 */
const RadarPage = lazy(() => import('./pages/RadarPage'));
const ForecastPage = lazy(() => import('./pages/ForecastPage'));
const SevereWeatherPage = lazy(() => import('./pages/SevereWeatherPage'));
const LivePage = lazy(() => import('./pages/LivePage'));
const WeatherMapPage = lazy(() => import('./pages/WeatherMapPage'));
const CountiesPage = lazy(() => import('./pages/CountiesPage'));
const CountyDetailPage = lazy(() => import('./pages/CountyDetailPage'));
const StationsPage = lazy(() => import('./pages/StationsPage'));
const TropicsPage = lazy(() => import('./pages/TropicsPage'));
const DiscussionPage = lazy(() => import('./pages/DiscussionPage'));
const NewsPage = lazy(() => import('./pages/NewsPage'));
const LocationsPage = lazy(() => import('./pages/LocationsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const BroadcastPage = lazy(() => import('./pages/BroadcastPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const ClosingsPage = lazy(() => import('./pages/ClosingsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const GraphicsOutputPage = lazy(() => import('./pages/GraphicsOutputPage'));

function PageFallback() {
  return (
    <div className="nc-page" style={{ alignItems: 'center', paddingTop: '18vh' }}>
      <Spinner size={34} label="Loading" />
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/radar" element={<RadarPage />} />
        <Route path="/forecast" element={<ForecastPage />} />
        <Route path="/severe" element={<SevereWeatherPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/map" element={<WeatherMapPage />} />
        <Route path="/counties" element={<CountiesPage />} />
        <Route path="/counties/:zoneId" element={<CountyDetailPage />} />
        <Route path="/stations" element={<StationsPage />} />
        <Route path="/tropics" element={<TropicsPage />} />
        <Route path="/discussion" element={<DiscussionPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/closings" element={<ClosingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  const router = useRouterLocation();

  // Program output is a transparent browser source for the vision mixer:
  // nothing but the graphic may ever render on it - not even a spinner.
  if (router.pathname === '/output') {
    return (
      <Suspense fallback={null}>
        <GraphicsOutputPage />
      </Suspense>
    );
  }

  // The newsroom admin is a tool, not a page of the weather site: it renders
  // outside the viewer shell, with its own navigation.
  if (router.pathname === '/admin') {
    return (
      <LocationProvider>
        <Suspense fallback={<PageFallback />}>
          <AdminPage />
        </Suspense>
      </LocationProvider>
    );
  }

  // Broadcast Mode is a full-bleed 1920x1080 surface with no app chrome:
  // it renders outside the shell so nothing overlaps the output.
  if (router.pathname === '/broadcast') {
    return (
      <LocationProvider>
        <AlertProvider>
          <Suspense fallback={<PageFallback />}>
            <BroadcastPage />
          </Suspense>
        </AlertProvider>
      </LocationProvider>
    );
  }

  return (
    <LocationProvider>
      <AlertProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </AlertProvider>
    </LocationProvider>
  );
}

export default App;
