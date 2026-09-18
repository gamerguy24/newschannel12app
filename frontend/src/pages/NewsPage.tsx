import { useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getNews } from '../services/weather';
import NewsCard from '../components/news/NewsCard';
import { Chip, DataStamp, EmptyState, ErrorState, Panel, Skeleton, Spinner } from '../components/ui/Primitives';
import './NewsPage.css';

/**
 * WEATHER NEWS
 *
 * Every story the weather desk is running, built from live NWS products and
 * NOAA imagery for the viewer's area. Nothing here is written ahead of time:
 * if a source has no story, its section simply does not appear.
 */
export function NewsPage() {
  const { location } = useLocation();
  const [category, setCategory] = useState<string>('all');

  // The whole rundown is fetched once and filtered here: asking the API per
  // section would re-run every source and would scope the section counts to
  // whichever filter was active.
  const news = useResource((signal) => getNews({ ...location, limit: 40 }, signal), [location.lat, location.lon], {
    refreshMs: 300000,
  });

  const all = news.data?.stories ?? [];
  const stories = category === 'all' ? all : all.filter((story) => story.category === category);
  const categories = news.data?.categories ?? [];
  const counts = news.data?.counts ?? {};
  const failures = news.data?.failures ?? [];

  if (news.error && !news.data) {
    return (
      <div className="nc-page">
        <h1 className="nc-page__title">Weather News</h1>
        <ErrorState message={news.error.friendly} onRetry={news.reload} />
      </div>
    );
  }

  const lead = stories[0];
  const rest = stories.slice(1);

  return (
    <div className="nc-page nc-newsroom">
      <header className="nc-newsroom__header">
        <div>
          <p className="nc-eyebrow">Storm 12 Weather</p>
          <h1 className="nc-page__title">Weather News</h1>
          <p className="nc-newsroom__sub">
            Live weather coverage for {location.label}, assembled from National Weather Service products, Storm
            Prediction Center outlooks and NOAA imagery.
          </p>
        </div>
        {news.refreshing && <Spinner size={16} />}
      </header>

      <div className="nc-newsroom__filters nc-scroll-x">
        <Chip active={category === 'all'} onClick={() => setCategory('all')} count={all.length}>
          All stories
        </Chip>
        {categories.map((item) => (
          <Chip
            key={item.id}
            color={item.accent}
            active={category === item.id}
            onClick={() => setCategory(item.id)}
            count={counts[item.id]}
          >
            {item.label}
          </Chip>
        ))}
      </div>

      {news.loading && !news.data ? (
        <Panel title="Loading the newsroom">
          <div className="nc-newsroom__skeletons">
            <Skeleton height={240} />
            <Skeleton height={240} />
            <Skeleton height={240} />
          </div>
        </Panel>
      ) : stories.length === 0 ? (
        <Panel eyebrow="Weather desk" title="No stories in this section">
          <EmptyState
            title="Nothing is running right now"
            message={
              category === 'all'
                ? 'The weather desk has no active stories for this area. Stories appear automatically when the National Weather Service issues a product.'
                : 'No stories in this category right now. Try another section or check back shortly.'
            }
          />
        </Panel>
      ) : (
        <>
          {lead && (
            <section className="nc-newsroom__lead" aria-label="Lead story">
              <NewsCard story={lead} layout="row" />
            </section>
          )}

          {rest.length > 0 && (
            <section className="nc-newsroom__grid" aria-label="More weather stories">
              {rest.map((story) => (
                <NewsCard key={story.id} story={story} layout="card" />
              ))}
            </section>
          )}
        </>
      )}

      {failures.length > 0 && (
        <Panel eyebrow="Newsroom status" title="Sources Not Reporting">
          <ul className="nc-newsroom__failures">
            {failures.map((failure) => (
              <li key={failure.source}>
                <strong>{failure.source}</strong>
                <span>{failure.error}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <DataStamp source="NOAA / National Weather Service" updatedAt={news.updatedAt} />
    </div>
  );
}

export default NewsPage;
