import { useEffect, useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getDiscussion, getProduct } from '../services/weather';
import ProductText from '../components/weather/ProductText';
import {
  Button,
  DataStamp,
  EmptyState,
  ErrorState,
  Panel,
  SegmentedControl,
  Skeleton,
  Spinner,
} from '../components/ui/Primitives';
import { formatRelative } from '../utils/format';
import './DiscussionPage.css';

/**
 * FORECAST DISCUSSION
 *
 * The reasoning behind the forecast, straight from the local National Weather
 * Service office: the Area Forecast Discussion, the Hazardous Weather Outlook
 * and any Special Weather Statements, plus the last few issuances of each so a
 * viewer can see how the thinking changed.
 */

type ProductType = 'AFD' | 'HWO' | 'SPS';

const PRODUCTS: Array<{ value: ProductType; label: string; title: string }> = [
  { value: 'AFD', label: 'Discussion', title: 'Area Forecast Discussion' },
  { value: 'HWO', label: 'Hazard Outlook', title: 'Hazardous Weather Outlook' },
  { value: 'SPS', label: 'Statements', title: 'Special Weather Statement' },
];

export function DiscussionPage() {
  const { location } = useLocation();
  const [type, setType] = useState<ProductType>('AFD');
  const [archivedId, setArchivedId] = useState<string | null>(null);

  const discussion = useResource(
    (signal) => getDiscussion({ ...location, type }, signal),
    [location.lat, location.lon, type],
    { refreshMs: 600000 },
  );

  const archived = useResource((signal) => getProduct(archivedId!, signal), [archivedId], {
    enabled: Boolean(archivedId),
  });

  // Switching product or location invalidates whichever archive entry is open.
  useEffect(() => {
    setArchivedId(null);
  }, [type, location.lat, location.lon]);

  const envelope = discussion.data;
  const product = archivedId ? archived.data : envelope?.data;
  const meta = PRODUCTS.find((p) => p.value === type)!;
  const office = envelope?.office ?? envelope?.data?.office;
  const recent = envelope?.data?.recent ?? [];

  const place = envelope?.city ? `${envelope.city}${envelope.state ? `, ${envelope.state}` : ''}` : location.label;

  return (
    <div className="nc-page nc-discussion">
      <header className="nc-discussion__header">
        <div>
          <p className="nc-eyebrow">National Weather Service{office ? ` · ${office}` : ''}</p>
          <h1 className="nc-page__title">Forecast Discussion</h1>
          <p className="nc-discussion__sub">
            The forecaster&rsquo;s own reasoning for {place}, published verbatim. These are the working notes behind
            every number on the forecast page.
          </p>
        </div>
        <SegmentedControl
          size="sm"
          value={type}
          onChange={setType}
          options={PRODUCTS.map((p) => ({ value: p.value, label: p.label }))}
        />
      </header>

      {discussion.loading && !envelope ? (
        <Panel eyebrow={meta.title} title="Loading discussion">
          <Skeleton height={320} />
        </Panel>
      ) : discussion.error && !envelope ? (
        <Panel eyebrow={meta.title} title={meta.title}>
          {discussion.error.status === 404 ? (
            <EmptyState
              title={`No ${meta.title.toLowerCase()} in effect`}
              message={`${
                office ? `NWS ${office}` : 'The local office'
              } has not issued this product recently. Area Forecast Discussions go out at least twice a day; statements only when conditions warrant.`}
              action={
                type !== 'AFD' ? (
                  <Button variant="outline" size="sm" onClick={() => setType('AFD')}>
                    Read the forecast discussion
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ErrorState message={discussion.error.friendly} onRetry={discussion.reload} />
          )}
        </Panel>
      ) : product ? (
        <ProductText
          product={product}
          title={meta.title}
          eyebrow={archivedId ? 'From the archive' : `Current issuance${office ? ` · NWS ${office}` : ''}`}
          action={
            archivedId ? (
              <Button size="sm" variant="outline" onClick={() => setArchivedId(null)}>
                Back to latest
              </Button>
            ) : discussion.refreshing ? (
              <Spinner size={15} />
            ) : undefined
          }
        />
      ) : null}

      {archivedId && archived.loading && !archived.data && (
        <Panel title="Loading archived issuance">
          <Skeleton height={220} />
        </Panel>
      )}

      {recent.length > 1 && (
        <Panel eyebrow="Previous issuances" title={`${meta.title} Archive`}>
          <ul className="nc-discussion__archive">
            {recent.map((item, index) => {
              const isLatest = index === 0;
              const active = archivedId ? archivedId === item.id : isLatest;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nc-discussion__archive-item${active ? ' is-active' : ''}`}
                    onClick={() => setArchivedId(isLatest ? null : item.id)}
                    aria-pressed={active}
                  >
                    <span className="nc-discussion__archive-time nc-readout">
                      {new Date(item.issuedAt).toLocaleString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="nc-discussion__archive-name">{item.name}</span>
                    <span className="nc-discussion__archive-meta">
                      {item.office} · {formatRelative(item.issuedAt)}
                      {isLatest ? ' · Latest' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <DataStamp
        source={`NOAA / NWS${office ? ` ${office}` : ''} text product`}
        updatedAt={envelope?.fetchedAt ?? discussion.updatedAt}
        stale={envelope?.stale}
      />
    </div>
  );
}

export default DiscussionPage;
