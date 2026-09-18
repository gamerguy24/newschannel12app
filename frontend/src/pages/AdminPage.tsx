import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/ui/Logo';
import { Button, ErrorState, Spinner } from '../components/ui/Primitives';
import { MarketsPanel, StationPanel } from '../components/admin/StationPanels';
import { ClosingsPanel, OnAirPanel, ViewerAlertsPanel } from '../components/admin/NewsroomPanels';
import { GraphicsStudio } from '../components/admin/GraphicsStudio';
import { OpsPanel } from '../components/admin/OpsPanel';
import { getAdminState, getSession, login, logout, readToken } from '../services/admin';
import { formatRelative } from '../utils/format';
import type { AdminState } from '../api/types';
import '../components/admin/admin.css';

/**
 * NEWSROOM ADMIN
 *
 * One door into everything the station controls: identity and coverage, the
 * ticker, what is on air right now, school closings, alerts the newsroom
 * sends to viewers, the graphics bench, and the health of every upstream.
 *
 * The panel renders outside the viewer-facing shell - it is a tool for the
 * newsroom, not another page of the weather site.
 */

type SectionId = 'ops' | 'onair' | 'alerts' | 'closings' | 'graphics' | 'station' | 'markets';

const SECTIONS: Array<{ id: SectionId; label: string; group: string; title: string; blurb: string }> = [
  {
    id: 'ops',
    label: 'Operations',
    group: 'Newsroom',
    title: 'Operations',
    blurb: 'Upstream health, cache pressure and everything that has failed recently.',
  },
  {
    id: 'onair',
    label: 'On Air',
    group: 'Newsroom',
    title: 'On Air Control',
    blurb: 'Claim the screen when the station is leading weather coverage.',
  },
  {
    id: 'alerts',
    label: 'Viewer Alerts',
    group: 'Newsroom',
    title: 'Viewer Alerts',
    blurb: 'Alerts the station writes and sends directly to viewers, signed with your own call sign.',
  },
  {
    id: 'closings',
    label: 'School Closings',
    group: 'Newsroom',
    title: 'School Closings',
    blurb: 'Closings and delays, typed in as they come and published immediately.',
  },
  {
    id: 'graphics',
    label: 'Graphics Studio',
    group: 'Newsroom',
    title: 'Graphics Studio',
    blurb: 'Build graphics from live weather, cue them in preview and take them to air.',
  },
  {
    id: 'station',
    label: 'Station Settings',
    group: 'Configuration',
    title: 'Station Settings',
    blurb: 'Identity, home market, coverage area, sponsor and live stream.',
  },
  {
    id: 'markets',
    label: 'Ticker & Markets',
    group: 'Configuration',
    title: 'Ticker & Markets',
    blurb: 'The temperatures that crawl along the bottom of the site and Broadcast Mode.',
  },
];

/* ------------------------------------------------------------------ login */

function AdminLogin({ onDone, configured }: { onDone: () => void; configured: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nc-admin-login">
      <div className="nc-admin-login__card">
        <header className="nc-admin-login__head">
          <Logo variant="compact" size={40} />
          <div>
            <h1 className="nc-admin-login__title">Newsroom Admin</h1>
            <p className="nc-admin-login__sub">Staff access only</p>
          </div>
        </header>

        {!configured ? (
          <>
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--nc-text-dim)' }}>
              The admin panel is switched off. Set <code className="nc-readout">ADMIN_PASSWORD</code> in the
              project&rsquo;s <code className="nc-readout">.env</code> file and restart the server to enable it.
            </p>
            <p className="nc-admin-login__foot">
              It stays disabled rather than open by default, so an unconfigured deployment never ships an unlocked back
              office.
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="nc-field">
              <span className="nc-field__label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                aria-label="Admin password"
              />
            </label>
            {error && <p className="nc-admin-login__error">{error}</p>}
            <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)' }}>
              <Button type="submit" variant="primary" disabled={busy || !password} block>
                {busy ? 'Checking' : 'Sign in'}
              </Button>
            </div>
          </form>
        )}

        <p className="nc-admin-login__foot">
          <Link to="/">← Back to the weather site</Link>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState(Boolean(readToken()));
  const [configured, setConfigured] = useState(true);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState<SectionId>('ops');
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((session) => {
        setConfigured(session.configured);
        setAuthenticated(session.authenticated);
      })
      .catch(() => setConfigured(false))
      .finally(() => setChecking(false));
  }, []);

  const refresh = useCallback(() => {
    if (!authenticated) return;
    getAdminState()
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((err) => {
        // A dead session drops the operator back to the sign-in card.
        if ((err as { status?: number }).status === 401) setAuthenticated(false);
        else setError((err as Error).message);
      });
  }, [authenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (checking) {
    return (
      <div className="nc-admin-login">
        <Spinner size={34} label="Checking session" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <AdminLogin
        configured={configured}
        onDone={() => {
          setAuthenticated(true);
        }}
      />
    );
  }

  const meta = SECTIONS.find((s) => s.id === section)!;
  const liveTakeover = state?.onAir.takeover ?? null;
  const liveAlerts = (state?.stationAlerts ?? []).filter((a) => new Date(a.expiresAt).getTime() > Date.now()).length;

  const counts: Partial<Record<SectionId, { value: number; hot?: boolean }>> = {
    alerts: { value: liveAlerts, hot: liveAlerts > 0 },
    closings: { value: state?.closings.length ?? 0 },
    graphics: { value: state?.graphics.length ?? 0 },
    markets: { value: state?.effective.tickerMarkets.length ?? 0 },
  };

  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <div className="nc-admin">
      <aside className="nc-admin__rail">
        <div className="nc-admin__brand">
          <Logo variant="compact" size={34} />
          <span className="nc-admin__brand-text">
            <span className="nc-admin__brand-name">{state?.station.shortName ?? 'Storm 12'} Newsroom</span>
            <span className="nc-admin__brand-role">Admin</span>
          </span>
        </div>

        {groups.map((group) => (
          <nav className="nc-admin__nav" key={group} aria-label={group}>
            <p className="nc-admin__nav-heading">{group}</p>
            {SECTIONS.filter((s) => s.group === group).map((item) => {
              const count = counts[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`nc-admin__nav-item${section === item.id ? ' is-active' : ''}`}
                  onClick={() => setSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                >
                  <span>{item.label}</span>
                  {count !== undefined && count.value > 0 && (
                    <span className={`nc-admin__nav-count${count.hot ? ' is-hot' : ''}`}>{count.value}</span>
                  )}
                </button>
              );
            })}
          </nav>
        ))}

        <div className="nc-admin__rail-foot">
          {liveTakeover && (
            <span className="nc-pill" style={{ '--pill': 'var(--nc-red-bright)' } as React.CSSProperties}>
              <i className="nc-dot" /> On air
            </span>
          )}
          <Link
            to="/"
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            View the site →
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              logout();
              setAuthenticated(false);
              setState(null);
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <main className="nc-admin__main">
        <header className="nc-admin__head">
          <div>
            <h1 className="nc-admin__title">{meta.title}</h1>
            <p className="nc-admin__subtitle">{meta.blurb}</p>
          </div>
          {state && (
            <p className="nc-admin__card-note">
              {state.station.name} · {state.station.market}
            </p>
          )}
        </header>

        {liveTakeover && section !== 'onair' && (
          <div className="nc-admin__onair">
            <span className="nc-admin__onair-tag">● ON AIR</span>
            <span className="nc-admin__onair-text">
              <strong>{liveTakeover.headline}</strong>
              {liveTakeover.expiresAt ? ` — clears ${formatRelative(liveTakeover.expiresAt)}` : ''}
            </span>
            <Button size="sm" variant="outline" onClick={() => setSection('onair')}>
              Manage
            </Button>
          </div>
        )}

        {error && <ErrorState message={error} onRetry={refresh} />}

        {!state && !error ? (
          <div style={{ padding: 'var(--space-6)', display: 'grid', placeItems: 'center' }}>
            <Spinner size={30} label="Loading newsroom settings" />
          </div>
        ) : state ? (
          <>
            {section === 'ops' && <OpsPanel />}
            {section === 'onair' && <OnAirPanel state={state} onSaved={refresh} />}
            {section === 'alerts' && <ViewerAlertsPanel state={state} onSaved={refresh} />}
            {section === 'closings' && <ClosingsPanel state={state} onSaved={refresh} />}
            {section === 'graphics' && <GraphicsStudio state={state} onSaved={refresh} />}
            {section === 'station' && <StationPanel key={state.station.name} state={state} onSaved={refresh} />}
            {section === 'markets' && <MarketsPanel state={state} onSaved={refresh} />}
          </>
        ) : null}
      </main>
    </div>
  );
}

export default AdminPage;
