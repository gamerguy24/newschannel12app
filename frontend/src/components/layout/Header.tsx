import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import Logo from '../ui/Logo';
import WeatherIcon from '../ui/WeatherIcon';
import { LocationSearch } from './LocationSearch';
import { useLocation as useAppLocation } from '../../context/LocationContext';
import { useAlerts } from '../../context/AlertContext';
import { useClock, useDismissable, useIsMobile } from '../../hooks';
import { formatTemp } from '../../utils/format';
import type { CurrentConditions } from '../../api/types';
import './Header.css';

/** Primary navigation, shared by the desktop bar and the mobile drawer. */
export const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/radar', label: 'Radar' },
  { to: '/forecast', label: 'Forecast' },
  { to: '/severe', label: 'Severe Center' },
  { to: '/live', label: 'Live' },
  { to: '/map', label: 'Weather Map' },
  { to: '/counties', label: 'Counties' },
  { to: '/stations', label: 'Stations' },
  { to: '/tropics', label: 'Tropics' },
  { to: '/discussion', label: 'Discussion' },
  { to: '/news', label: 'News' },
  { to: '/closings', label: 'Closings' },
];

const SECONDARY_ITEMS = [
  { to: '/locations', label: 'My Locations' },
  { to: '/admin', label: 'Newsroom Admin' },
  { to: '/broadcast', label: 'Broadcast Mode' },
  { to: '/settings', label: 'Alerts & Settings' },
];

interface HeaderProps {
  current: CurrentConditions | null;
  loading: boolean;
}

export function Header({ current, loading }: HeaderProps) {
  const { location } = useAppLocation();
  const { alerts } = useAlerts();
  const navigate = useNavigate();
  const clock = useClock(1000);
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const menuRef = useDismissable<HTMLDivElement>(() => setMenuOpen(false), menuOpen);

  const warningCount = alerts.filter((a) => a.kind === 'warning').length;
  const watchCount = alerts.filter((a) => a.kind === 'watch').length;
  const topTier = alerts[0]?.tier ?? null;

  const observation = current?.observation;
  const timeZone = current?.location.timeZone ?? undefined;

  return (
    <header className="nc-header">
      <div className="nc-header__bar">
        <Link to="/" className="nc-header__brand" aria-label="Storm 12 Weather home">
          <Logo variant={isMobile ? 'compact' : 'full'} size={isMobile ? 34 : 36} />
        </Link>

        <button
          type="button"
          className="nc-header__place"
          onClick={() => setSearchOpen(true)}
          aria-label={`Change location. Currently ${location.label}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.9" />
          </svg>
          <span className="nc-header__place-name">{location.nickname ?? location.label}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="nc-header__now">
          {loading && !observation ? (
            <div className="nc-skeleton" style={{ width: 120, height: 34 }} />
          ) : (
            <>
              <WeatherIcon name={observation?.icon ?? 'cloudy'} size={38} />
              <div className="nc-header__now-text">
                <span className="nc-header__temp">{formatTemp(observation?.temperature)}</span>
                <span className="nc-header__condition">{observation?.condition ?? 'Conditions unavailable'}</span>
              </div>
            </>
          )}
        </div>

        <div className="nc-header__spacer" />

        {/* Weather alert indicator - the count of live products for this spot. */}
        <NavLink
          to="/severe"
          className={`nc-header__alerts${alerts.length ? ' is-active' : ''}${
            topTier === 'catastrophic' ? ' is-critical' : ''
          }`}
          aria-label={`${alerts.length} active weather alerts. Open the Severe Weather Center.`}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3 1.5 21h21L12 3Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
            <path d="M12 9.5v5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
            <circle cx="12" cy="17.6" r="1.15" fill="currentColor" />
          </svg>
          <span className="nc-header__alerts-label">
            {alerts.length === 0
              ? 'No alerts'
              : warningCount
                ? `${warningCount} warning${warningCount > 1 ? 's' : ''}`
                : `${watchCount || alerts.length} alert${(watchCount || alerts.length) > 1 ? 's' : ''}`}
          </span>
          {alerts.length > 0 && <span className="nc-header__alerts-dot" />}
        </NavLink>

        <div className="nc-header__actions">
          <button type="button" className="nc-header__action" onClick={() => navigate('/radar')}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="12" cy="12" r="4.6" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
              <path d="M12 12 12 3.2A8.8 8.8 0 0 1 19.6 8Z" fill="currentColor" opacity="0.55" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            </svg>
            <span>Radar</span>
          </button>
          <button type="button" className="nc-header__action" onClick={() => navigate('/forecast')}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="4.5" width="18" height="16" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
              <path d="M3 9.5h18M8 3v3.4M16 3v3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>Forecast</span>
          </button>
        </div>

        <time className="nc-header__clock nc-readout" dateTime={clock.toISOString()}>
          <span className="nc-header__clock-time">
            {clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })}
          </span>
          <span className="nc-header__clock-date">
            {clock.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone })}
          </span>
        </time>

        <div className="nc-header__menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`nc-header__menu-btn${menuOpen ? ' is-open' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-label="Open menu"
          >
            <span />
            <span />
            <span />
          </button>

          {menuOpen && (
            <nav className="nc-header__menu nc-enter" aria-label="All sections">
              <p className="nc-header__menu-heading">Weather</p>
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'is-active' : '')}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
              <p className="nc-header__menu-heading">Station</p>
              {SECONDARY_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'is-active' : '')}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </div>

      {/* Desktop section navigation */}
      <nav className="nc-header__nav" aria-label="Sections">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nc-header__nav-link${isActive ? ' is-active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {searchOpen && <LocationSearch onClose={() => setSearchOpen(false)} />}
    </header>
  );
}

export default Header;
