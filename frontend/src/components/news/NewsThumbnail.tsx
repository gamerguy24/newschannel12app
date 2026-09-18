import WeatherIcon from '../ui/WeatherIcon';
import type { NewsStory } from '../../api/types';
import './NewsThumbnail.css';

/**
 * Original Storm 12 Weather story graphics.
 *
 * When a story has a real NOAA image (satellite, radar) we show it. Otherwise
 * we draw one of our own graphics — never stock photography, and never an
 * image we do not have the right to publish.
 */

const VARIANTS: Record<string, { label: string; from: string; to: string; motif: 'bolt' | 'funnel' | 'water' | 'sweep' | 'shield' | 'doc' }> = {
  tornado: { label: 'Tornado', from: '#8c0d14', to: '#ff3d3d', motif: 'funnel' },
  severe: { label: 'Severe', from: '#7a4a00', to: '#ffa200', motif: 'bolt' },
  flood: { label: 'Flood', from: '#0b5138', to: '#22b14c', motif: 'water' },
  radar: { label: 'Radar', from: '#062c44', to: '#00b4e6', motif: 'sweep' },
  reports: { label: 'Reports', from: '#3a1d54', to: '#7b68ee', motif: 'shield' },
  safety: { label: 'Safety', from: '#2a2170', to: '#7b68ee', motif: 'shield' },
  statement: { label: 'Statement', from: '#123a58', to: '#3fd8ff', motif: 'doc' },
};

function Motif({ kind }: { kind: string }) {
  switch (kind) {
    case 'funnel':
      return (
        <g opacity="0.9">
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={70 - (30 - i * 6)}
              y={22 + i * 13}
              width={(30 - i * 6) * 2}
              height="8"
              rx="4"
              fill="#fff"
              opacity={0.25 + i * 0.12}
            />
          ))}
        </g>
      );
    case 'bolt':
      return <path d="M78 16 52 62h20l-8 34 32-50H74l10-30Z" fill="#fff" opacity="0.92" />;
    case 'water':
      return (
        <g opacity="0.9" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round">
          <path d="M20 58c10-8 20-8 30 0s20 8 30 0 20-8 30 0" />
          <path d="M20 76c10-8 20-8 30 0s20 8 30 0 20-8 30 0" />
          <path d="M20 94c10-8 20-8 30 0s20 8 30 0 20-8 30 0" />
        </g>
      );
    case 'sweep':
      return (
        <g opacity="0.92">
          <circle cx="70" cy="60" r="42" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.5" />
          <circle cx="70" cy="60" r="26" fill="none" stroke="#fff" strokeWidth="2" opacity="0.35" />
          <path d="M70 60 70 18a42 42 0 0 1 36 21Z" fill="#fff" opacity="0.55" />
          <circle cx="70" cy="60" r="4" fill="#fff" />
        </g>
      );
    case 'shield':
      return (
        <path
          d="M70 16 34 30v28c0 20 15 34 36 42 21-8 36-22 36-42V30L70 16Z"
          fill="none"
          stroke="#fff"
          strokeWidth="5"
          strokeLinejoin="round"
          opacity="0.92"
        />
      );
    default:
      return (
        <g opacity="0.9" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round">
          <rect x="38" y="22" width="64" height="76" rx="6" />
          <path d="M52 44h36M52 60h36M52 76h22" />
        </g>
      );
  }
}

export function NewsThumbnail({ story, size = 'card' }: { story: NewsStory; size?: 'card' | 'rail' | 'wide' }) {
  if (story.thumbnail.kind === 'image') {
    return (
      <div className={`nc-thumb nc-thumb--${size} nc-thumb--photo`}>
        <img
          src={story.thumbnail.url}
          alt={story.thumbnail.alt}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            // A NOAA image can 404 between imagery cycles - fall back to the
            // brand graphic rather than showing a broken image icon.
            (e.currentTarget.parentElement as HTMLElement).dataset.failed = 'true';
          }}
        />
        <span className="nc-thumb__fallback">
          <WeatherIcon name="cloudy" size={44} animated={false} />
        </span>
      </div>
    );
  }

  const variant = VARIANTS[story.thumbnail.variant] ?? null;

  // Forecast stories use the matching weather icon on a brand ground.
  if (!variant) {
    return (
      <div className={`nc-thumb nc-thumb--${size} nc-thumb--icon`}>
        <WeatherIcon name={story.thumbnail.variant} size={size === 'rail' ? 52 : 68} />
      </div>
    );
  }

  return (
    <div className={`nc-thumb nc-thumb--${size}`}>
      <svg viewBox="0 0 140 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`thumb-${story.thumbnail.variant}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={variant.from} />
            <stop offset="100%" stopColor={variant.to} />
          </linearGradient>
        </defs>
        <rect width="140" height="120" fill={`url(#thumb-${story.thumbnail.variant})`} />
        {/* Broadcast scanline texture */}
        <g opacity="0.14">
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x="0" y={i * 10} width="140" height="4" fill="#fff" />
          ))}
        </g>
        <Motif kind={variant.motif} />
      </svg>
      <span className="nc-thumb__tag">{variant.label}</span>
    </div>
  );
}

export default NewsThumbnail;
