import { Suspense, lazy, useState } from 'react';
import { useResource } from '../hooks';
import { getTropicalStorm, getTropics } from '../services/weather';
import { DataStamp, EmptyState, ErrorState, Panel, SegmentedControl, Spinner } from '../components/ui/Primitives';
import { formatNumber, formatRelative, unwrapProductText } from '../utils/format';
import type { TropicalStorm } from '../api/types';
import './TropicsPage.css';

const TropicalMap = lazy(() => import('../components/maps/TropicalMap'));

/**
 * STORM 12 WEATHER TROPICS
 *
 * Every system the National Hurricane Center is tracking, with intensity,
 * pressure, movement, the official forecast track and the outlook discussions.
 */
export function TropicsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [basin, setBasin] = useState<'all' | 'Atlantic' | 'Eastern Pacific' | 'Central Pacific'>('all');

  const tropics = useResource((signal) => getTropics(signal), [], { refreshMs: 300000 });
  const detail = useResource((signal) => getTropicalStorm(selectedId!, signal), [selectedId], {
    enabled: Boolean(selectedId),
  });

  const storms = (tropics.data?.storms ?? []).filter((s) => basin === 'all' || s.basinName === basin);
  const selected = storms.find((s) => s.id === selectedId) ?? storms[0] ?? null;

  if (tropics.error && !tropics.data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">Storm 12 Tropics</h1>
        <ErrorState message={tropics.error.friendly} onRetry={tropics.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-tropics">
      <header className="nc-tropics__header">
        <div>
          <p className="nc-eyebrow">Storm 12 Weather</p>
          <h1 className="nc-page__title">Tropical Weather Center</h1>
        </div>
        <SegmentedControl
          size="sm"
          value={basin}
          onChange={setBasin}
          options={[
            { value: 'all', label: 'All basins' },
            { value: 'Atlantic', label: 'Atlantic' },
            { value: 'Eastern Pacific', label: 'E. Pacific' },
            { value: 'Central Pacific', label: 'C. Pacific' },
          ]}
        />
      </header>

      {tropics.loading && !tropics.data ? (
        <Panel title="Active Systems">
          <div className="nc-skeleton" style={{ height: 160 }} />
        </Panel>
      ) : storms.length === 0 ? (
        <Panel eyebrow="National Hurricane Center" title="Active Tropical Systems">
          <EmptyState
            title="No active tropical systems"
            message={
              basin === 'all'
                ? 'The National Hurricane Center is not tracking any active tropical cyclones right now. This page updates automatically when a system forms.'
                : `No active systems in the ${basin} basin.`
            }
            icon={
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 4c4 0 7 1.9 7 4.4 0 1.8-1.8 2.9-4.4 2.9 2.2 1.1 3.3 2.6 3.3 4.4 0 2.5-3 4.3-7 4.3s-7-1.8-7-4.3c0-1.8 1.8-2.9 4.4-2.9C6.1 11.7 5 10.2 5 8.4 5 5.9 8 4 12 4Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="nc-tropics__cards">
            {storms.map((storm) => (
              <StormCard
                key={storm.id}
                storm={storm}
                active={selected?.id === storm.id}
                onSelect={() => setSelectedId(storm.id)}
              />
            ))}
          </div>

          {selected && (
            <Panel
              eyebrow={`${selected.basinName} basin`}
              title={`${selected.classificationName} ${selected.name} — Forecast Track`}
              action={detail.loading ? <Spinner size={15} /> : undefined}
              flush
            >
              <Suspense
                fallback={
                  <div style={{ height: 460, display: 'grid', placeItems: 'center', background: '#04101c' }}>
                    <Spinner size={30} label="Loading track" />
                  </div>
                }
              >
                <TropicalMap storm={selected} track={detail.data?.track ?? []} height="460px" />
              </Suspense>

              <div className="nc-tropics__track-list">
                {(detail.data?.track ?? []).map((point, i) => (
                  <div key={`${point.day}-${point.timeZ}-${i}`} className="nc-tropics__track-point" style={{ '--c': point.color } as React.CSSProperties}>
                    <span className="nc-tropics__track-time nc-readout">
                      {point.day}/{point.timeZ}Z
                    </span>
                    <span className="nc-tropics__track-cat">{point.categoryLabel ?? '--'}</span>
                    <span className="nc-tropics__track-wind nc-readout">{point.maxWindsMph ?? '--'} mph</span>
                  </div>
                ))}
                {detail.data && detail.data.track.length === 0 && (
                  <p className="nc-tropics__no-track">
                    No forecast advisory positions are published for this system yet.
                  </p>
                )}
              </div>
            </Panel>
          )}
        </>
      )}

      {tropics.data?.imagery?.images?.length ? (
        <Panel eyebrow="NOAA NESDIS / GOES" title="Tropical Satellite" flush>
          <div className="nc-tropics__satellite">
            {tropics.data.imagery.images.map((image) => (
              <figure key={image.id}>
                <img src={image.url} alt={`${image.label} satellite imagery of the tropical Atlantic`} loading="lazy" />
                <figcaption>{image.label}</figcaption>
              </figure>
            ))}
          </div>
        </Panel>
      ) : null}

      {(tropics.data?.outlooks ?? []).map((outlook) => (
        <Panel key={outlook.basin} eyebrow="National Hurricane Center" title={`${outlook.basin} Tropical Outlook`}>
          {outlook.items.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--nc-text-dim)' }}>No outlook products published right now.</p>
          ) : (
            <div className="nc-tropics__outlook">
              {/* The NHC publishes several outlook products under one link,
                  so position is what actually distinguishes them. */}
              {outlook.items.slice(0, 3).map((item, index) => (
                <article key={`${item.link ?? item.title}-${index}`}>
                  <h3>{item.title}</h3>
                  <p className="nc-tropics__outlook-time">{formatRelative(item.publishedAt)}</p>
                  {unwrapProductText(item.summary)
                    .slice(0, 4)
                    .map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  {item.link && (
                    <a href={item.link} target="_blank" rel="noopener noreferrer">
                      Read the full product at the NHC →
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}
        </Panel>
      ))}

      <DataStamp source="NOAA National Hurricane Center" updatedAt={tropics.data?.updatedAt ?? tropics.updatedAt} />
    </div>
  );
}

function StormCard({ storm, active, onSelect }: { storm: TropicalStorm; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`nc-tropics__card${active ? ' is-active' : ''}`}
      style={{ '--c': storm.color } as React.CSSProperties}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className="nc-tropics__card-head">
        <span className="nc-tropics__card-class">{storm.classificationName}</span>
        <span className="nc-tropics__card-basin">{storm.basinName}</span>
      </span>
      <span className="nc-tropics__card-name">{storm.name}</span>

      <span className="nc-tropics__card-stats">
        <span>
          <em>Max winds</em>
          <strong className="nc-readout">{storm.maxWindsMph ?? '--'} mph</strong>
        </span>
        <span>
          <em>Min pressure</em>
          <strong className="nc-readout">{formatNumber(storm.pressureMb, 0)} mb</strong>
        </span>
        <span>
          <em>Movement</em>
          <strong>{storm.movement?.text ?? 'Stationary'}</strong>
        </span>
        <span>
          <em>Position</em>
          <strong className="nc-readout">
            {storm.lat?.toFixed(1)}°{(storm.lat ?? 0) >= 0 ? 'N' : 'S'} {Math.abs(storm.lon ?? 0).toFixed(1)}°
            {(storm.lon ?? 0) >= 0 ? 'E' : 'W'}
          </strong>
        </span>
      </span>

      {storm.category !== null && storm.category >= 1 && (
        <span className="nc-tropics__card-cat">CAT {storm.category}</span>
      )}
      <span className="nc-tropics__card-updated">Advisory {storm.advisoryNumber ?? '--'} · {formatRelative(storm.lastUpdate)}</span>
    </button>
  );
}

export default TropicsPage;
