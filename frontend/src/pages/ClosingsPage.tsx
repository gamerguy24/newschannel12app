import { useMemo, useState } from 'react';
import { useResource } from '../hooks';
import { getClosings } from '../services/admin';
import { Chip, DataStamp, EmptyState, ErrorState, Panel, Skeleton } from '../components/ui/Primitives';
import { formatRelative } from '../utils/format';
import type { ClosingStatus } from '../api/types';
import './ClosingsPage.css';

/**
 * SCHOOL CLOSINGS
 *
 * The list the newsroom keys in by hand. There is no public feed for this -
 * districts phone and email a station - so what is here is what has been
 * confirmed, and the page says so plainly rather than implying completeness.
 */

const STATUS_COLOR: Record<ClosingStatus, string> = {
  closed: '#FF3D3D',
  delayed: '#FFB800',
  early: '#7B68EE',
  virtual: '#3FD8FF',
  open: '#22C55E',
};

export function ClosingsPage() {
  const [filter, setFilter] = useState<ClosingStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  const feed = useResource((signal) => getClosings(signal), [], { refreshMs: 60000 });

  const closings = feed.data?.closings ?? [];
  const statuses = feed.data?.statuses ?? [];
  const counts = feed.data?.counts;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return closings
      .filter((c) => filter === 'all' || c.status === filter)
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.county.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [closings, filter, query]);

  if (feed.error && !feed.data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">School Closings</h1>
        <ErrorState message={feed.error.friendly} onRetry={feed.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-closings">
      <header>
        <p className="nc-eyebrow">Storm 12 Weather</p>
        <h1 className="nc-page__title">School Closings &amp; Delays</h1>
        <p className="nc-closings__sub">
          Confirmed closings and delays reported to the Storm 12 weather desk. Districts are added as they call
          in, so a school missing from this list has not necessarily stayed open &mdash; check with your district.
        </p>
      </header>

      {feed.loading && !feed.data ? (
        <Panel title="Loading closings">
          <Skeleton height={180} />
        </Panel>
      ) : closings.length === 0 ? (
        <Panel eyebrow="Weather desk" title="No Closings Reported">
          <EmptyState
            title="Everything is open"
            message="No schools or districts have reported a closing or delay. This page updates the moment one comes in."
          />
        </Panel>
      ) : (
        <>
          <div className="nc-closings__summary">
            {statuses
              .filter((s) => (counts?.byStatus?.[s.id] ?? 0) > 0)
              .map((s) => (
                <div key={s.id} className="nc-closings__stat" style={{ '--c': STATUS_COLOR[s.id] } as React.CSSProperties}>
                  <span className="nc-closings__stat-value nc-readout">{counts?.byStatus?.[s.id] ?? 0}</span>
                  <span className="nc-closings__stat-label">{s.label}</span>
                </div>
              ))}
          </div>

          <Panel
            eyebrow={`${closings.length} reported`}
            title="Closings List"
            action={
              <input
                className="nc-closings__search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a school or county"
                aria-label="Search closings"
              />
            }
          >
            <div className="nc-closings__filters">
              <Chip active={filter === 'all'} onClick={() => setFilter('all')} count={closings.length}>
                All
              </Chip>
              {statuses
                .filter((s) => (counts?.byStatus?.[s.id] ?? 0) > 0)
                .map((s) => (
                  <Chip
                    key={s.id}
                    color={STATUS_COLOR[s.id]}
                    active={filter === s.id}
                    onClick={() => setFilter(s.id)}
                    count={counts?.byStatus?.[s.id]}
                  >
                    {s.label}
                  </Chip>
                ))}
            </div>

            {visible.length === 0 ? (
              <p className="nc-closings__none">Nothing matches that search.</p>
            ) : (
              <ul className="nc-closings__list">
                {visible.map((closing) => (
                  <li key={closing.id} style={{ '--c': STATUS_COLOR[closing.status] } as React.CSSProperties}>
                    <span className="nc-closings__name">{closing.name}</span>
                    <span className="nc-closings__status">
                      {statuses.find((s) => s.id === closing.status)?.label ?? closing.status}
                    </span>
                    {closing.detail && <span className="nc-closings__detail">{closing.detail}</span>}
                    <span className="nc-closings__meta">
                      {closing.county ? `${closing.county} County · ` : ''}
                      {formatRelative(closing.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      <DataStamp source="Reported to the Storm 12 weather desk" updatedAt={feed.updatedAt} />
    </div>
  );
}

export default ClosingsPage;
