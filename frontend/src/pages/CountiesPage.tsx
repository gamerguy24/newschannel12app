import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource, useStoredState } from '../hooks';
import { getCounties, getSevereCenter } from '../services/weather';
import { Chip, EmptyState, ErrorState, Panel, Spinner } from '../components/ui/Primitives';
import './CountiesPage.css';

/**
 * LOCAL COUNTY WEATHER
 *
 * Every county in the station's coverage area, searchable, with live alert
 * counts, and favourites that persist on the device.
 */
export function CountiesPage() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [favorites, setFavorites] = useStoredState<string[]>('nc12.favoriteCounties', []);

  const counties = useResource((signal) => getCounties(undefined, signal), []);
  const center = useResource((signal) => getSevereCenter(undefined, signal), [], { refreshMs: 60000 });

  /** How many live products name each county, so the list flags hot spots. */
  const alertCounts = useMemo(() => {
    const counts = new Map<string, { warnings: number; watches: number }>();
    const all = [
      ...(center.data?.warnings ?? []).map((a) => ({ a, kind: 'warnings' as const })),
      ...(center.data?.watches ?? []).map((a) => ({ a, kind: 'watches' as const })),
    ];
    for (const { a, kind } of all) {
      for (const ugc of a.ugc) {
        const entry = counts.get(ugc) ?? { warnings: 0, watches: 0 };
        entry[kind] += 1;
        counts.set(ugc, entry);
      }
    }
    return counts;
  }, [center.data]);

  const all = counties.data?.counties ?? [];
  const states = counties.data?.states ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((county) => {
      if (state && county.state !== state) return false;
      if (!q) return true;
      return county.name.toLowerCase().includes(q) || county.id.toLowerCase().includes(q);
    });
  }, [all, query, state]);

  const favoriteCounties = all.filter((c) => favorites.includes(c.id));

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));

  if (counties.error && !counties.data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">County Weather</h1>
        <ErrorState message={counties.error.friendly} onRetry={counties.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-counties">
      <header>
        <p className="nc-eyebrow">Storm 12 Weather</p>
        <h1 className="nc-page__title">Local County Weather</h1>
        <p className="nc-counties__sub">
          {all.length} counties across the coverage area. Open any county for its conditions, forecast, radar,
          warnings and forecast discussion.
        </p>
      </header>

      {favoriteCounties.length > 0 && (
        <Panel eyebrow="Saved" title="Favorite Counties" flush>
          <ul className="nc-counties__grid">
            {favoriteCounties.map((county) => (
              <CountyTile
                key={county.id}
                id={county.id}
                name={county.name}
                state={county.state}
                office={county.cwa?.[0]}
                alerts={alertCounts.get(county.id)}
                favorite
                onFavorite={() => toggleFavorite(county.id)}
              />
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        eyebrow="Search"
        title="All Counties"
        action={counties.loading ? <Spinner size={17} /> : <span className="nc-counties__count">{filtered.length}</span>}
      >
        <div className="nc-counties__controls">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search counties by name or zone code"
            aria-label="Search counties"
          />
          <div className="nc-row nc-wrap">
            <Chip active={state === null} onClick={() => setState(null)}>
              All states
            </Chip>
            {states.map((code) => (
              <Chip
                key={code}
                active={state === code}
                onClick={() => setState(state === code ? null : code)}
                count={all.filter((c) => c.state === code).length}
              >
                {code}
              </Chip>
            ))}
          </div>
        </div>
      </Panel>

      {filtered.length === 0 && !counties.loading ? (
        <EmptyState
          title="No counties match"
          message={`Nothing in the coverage area matches “${query}”. Try a different name or clear the state filter.`}
        />
      ) : (
        <ul className="nc-counties__grid nc-counties__grid--page">
          {filtered.map((county) => (
            <CountyTile
              key={county.id}
              id={county.id}
              name={county.name}
              state={county.state}
              office={county.cwa?.[0]}
              alerts={alertCounts.get(county.id)}
              favorite={favorites.includes(county.id)}
              onFavorite={() => toggleFavorite(county.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CountyTile({
  id,
  name,
  state,
  office,
  alerts,
  favorite,
  onFavorite,
}: {
  id: string;
  name: string;
  state: string;
  office?: string;
  alerts?: { warnings: number; watches: number };
  favorite: boolean;
  onFavorite: () => void;
}) {
  const hot = (alerts?.warnings ?? 0) > 0;
  const watching = !hot && (alerts?.watches ?? 0) > 0;

  return (
    <li className={`nc-county${hot ? ' is-warned' : watching ? ' is-watched' : ''}`}>
      <Link to={`/counties/${id}`}>
        <span className="nc-county__name">{name}</span>
        <span className="nc-county__meta">
          {state}
          {office ? ` · NWS ${office}` : ''} · {id}
        </span>
        {(hot || watching) && (
          <span className="nc-county__flag">
            {hot ? `${alerts?.warnings} warning${alerts?.warnings === 1 ? '' : 's'}` : `${alerts?.watches} watch${alerts?.watches === 1 ? '' : 'es'}`}
          </span>
        )}
      </Link>
      <button
        type="button"
        className={`nc-county__fav${favorite ? ' is-on' : ''}`}
        onClick={onFavorite}
        aria-label={favorite ? `Remove ${name} County from favorites` : `Save ${name} County to favorites`}
        aria-pressed={favorite}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} aria-hidden="true">
          <path
            d="m12 3.6 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.6Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </li>
  );
}

export default CountiesPage;
