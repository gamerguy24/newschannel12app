import { Link } from 'react-router-dom';
import NewsCard from './NewsCard';
import { Panel, Skeleton } from '../ui/Primitives';
import type { NewsStory } from '../../api/types';

/** The dashboard's horizontal Weather News rail. */
export function NewsRail({ stories, loading }: { stories: NewsStory[] | undefined; loading?: boolean }) {
  if (loading && !stories) {
    return (
      <Panel eyebrow="Storm 12 Weather" title="Weather News">
        <Skeleton height={230} />
      </Panel>
    );
  }

  if (!stories?.length) return null;

  return (
    <Panel
      eyebrow="Storm 12 Weather"
      title="Weather News"
      action={
        <Link
          to="/news"
          style={{
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          All stories →
        </Link>
      }
      flush
    >
      <div
        className="nc-scroll-x"
        style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-4)' }}
      >
        {stories.slice(0, 8).map((story) => (
          <NewsCard key={story.id} story={story} layout="rail" />
        ))}
      </div>
    </Panel>
  );
}

export default NewsRail;
