import { useState } from 'react';
import NewsThumbnail from './NewsThumbnail';
import { Button } from '../ui/Primitives';
import { formatRelative, unwrapProductText } from '../../utils/format';
import type { NewsStory } from '../../api/types';
import './NewsCard.css';

const CATEGORY_ACCENT: Record<string, string> = {
  breaking: '#FF1B1B',
  severe: '#FFA200',
  local: '#00A3E0',
  tropical: '#B21E7B',
  forecast: '#22C55E',
  safety: '#7B68EE',
};

const CATEGORY_LABEL: Record<string, string> = {
  breaking: 'Breaking Weather',
  severe: 'Severe Weather',
  local: 'Local Weather',
  tropical: 'Tropical',
  forecast: 'Forecast',
  safety: 'Weather Safety',
};

/** A single Weather News story with an inline reader. */
export function NewsCard({ story, layout = 'card' }: { story: NewsStory; layout?: 'card' | 'rail' | 'row' }) {
  const [open, setOpen] = useState(false);
  const accent = CATEGORY_ACCENT[story.category] ?? '#00A3E0';
  const paragraphs = story.body ? unwrapProductText(story.body) : [];
  const hasImage = story.thumbnail.kind === 'image';

  return (
    <article
      className={`nc-news nc-news--${layout}${open ? ' is-open' : ''}${hasImage ? '' : ' is-text'}`}
      style={{ '--news-accent': accent } as React.CSSProperties}
    >
      {/* Only real imagery (NOAA satellite, radar) earns a thumbnail. */}
      {hasImage && <NewsThumbnail story={story} size={layout === 'rail' ? 'rail' : 'card'} />}

      <div className="nc-news__body">
        <div className="nc-news__meta">
          <span className="nc-news__category">{CATEGORY_LABEL[story.category] ?? story.category}</span>
          <time className="nc-news__time" dateTime={story.publishedAt}>
            {formatRelative(story.publishedAt)}
          </time>
        </div>

        <h3 className="nc-news__headline">{story.headline}</h3>
        <p className="nc-news__summary">{story.summary}</p>

        <div className="nc-news__actions">
          {(story.body || story.link) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => (story.body ? setOpen((o) => !o) : window.open(story.link!, '_blank', 'noopener'))}
            >
              {story.body ? (open ? 'Close' : 'Read') : 'Read at source'}
            </Button>
          )}
          {story.body && story.link && story.link.startsWith('http') && (
            <a className="nc-news__source-link" href={story.link} target="_blank" rel="noopener noreferrer">
              Official product
            </a>
          )}
          <span className="nc-news__source">{story.source}</span>
        </div>

        {open && paragraphs.length > 0 && (
          <div className="nc-news__reader nc-enter">
            {paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default NewsCard;
