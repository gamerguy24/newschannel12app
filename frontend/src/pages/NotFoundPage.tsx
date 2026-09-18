import { Link, useLocation as useRouterLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../components/layout/Header';
import { Panel } from '../components/ui/Primitives';

/** A wrong turn still lands the viewer somewhere useful. */
export function NotFoundPage() {
  const router = useRouterLocation();

  return (
    <div className="nc-page">
      <header>
        <p className="nc-eyebrow">Page not found</p>
        <h1 className="nc-page__title">That page is off the air</h1>
        <p style={{ margin: '6px 0 0', maxWidth: '68ch', fontSize: 'var(--text-sm)', color: 'var(--nc-text-dim)' }}>
          Nothing is published at <code className="nc-readout">{router.pathname}</code>. Everything the weather
          department puts out is one link away below.
        </p>
      </header>

      <Panel eyebrow="Storm 12 Weather" title="Weather Sections">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              style={{
                padding: '8px 14px',
                border: '1px solid var(--nc-line)',
                borderRadius: 'var(--radius)',
                background: 'rgba(6, 18, 31, 0.55)',
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-sm)',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default NotFoundPage;
