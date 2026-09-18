import { NavLink } from 'react-router-dom';
import { useAlerts } from '../../context/AlertContext';
import './MobileNav.css';

/** Thumb-reachable bottom navigation for phones. */
const ITEMS = [
  {
    to: '/',
    label: 'Home',
    end: true,
    icon: (
      <path d="M3 11 12 3l9 8v9a1.6 1.6 0 0 1-1.6 1.6h-4.2v-6.2H9.8V21.6H5.6A1.6 1.6 0 0 1 4 20v-9Z" />
    ),
  },
  {
    to: '/radar',
    label: 'Radar',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.6" />
        <circle cx="12" cy="12" r="4.2" opacity="0.55" />
        <circle cx="12" cy="12" r="1.4" />
      </>
    ),
  },
  {
    to: '/forecast',
    label: 'Forecast',
    icon: (
      <>
        <rect x="3.4" y="5" width="17.2" height="15.4" rx="2.2" />
        <path d="M3.4 9.6h17.2M8 3.2v3.4M16 3.2v3.4" />
      </>
    ),
  },
  {
    to: '/severe',
    label: 'Alerts',
    badge: true,
    icon: (
      <>
        <path d="M12 3.4 2.2 20.6h19.6L12 3.4Z" />
        <path d="M12 9.8v5" />
      </>
    ),
  },
  {
    to: '/news',
    label: 'News',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M7 9.4h6M7 13h10M7 16h7" />
      </>
    ),
  },
];

export function MobileNav() {
  const { alerts } = useAlerts();
  const warnings = alerts.filter((a) => a.kind === 'warning').length;

  return (
    <nav className="nc-mobile-nav" aria-label="Main">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nc-mobile-nav__item${isActive ? ' is-active' : ''}`}
        >
          <span className="nc-mobile-nav__icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {item.icon}
            </svg>
            {item.badge && alerts.length > 0 && (
              <span className={`nc-mobile-nav__badge${warnings ? ' is-warning' : ''}`}>
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            )}
          </span>
          <span className="nc-mobile-nav__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default MobileNav;
