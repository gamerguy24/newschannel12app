import { useState } from 'react';
import { useResource } from '../hooks';
import { getVideoLibrary } from '../services/weather';
import { DataStamp, EmptyState, ErrorState, Panel, Skeleton } from '../components/ui/Primitives';
import { formatRelative } from '../utils/format';
import type { VideoCard } from '../api/types';
import './VideosPage.css';

/**
 * THE VIDEO PAGE
 *
 * The station's own clips. One plays at the top and the rest are a list
 * beside it, which is how a viewer expects to move through a set of videos
 * without losing the one they are watching.
 */

const clock = (seconds: number | null) => {
  if (seconds === null || seconds === undefined) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

function Thumb({ video }: { video: VideoCard }) {
  const length = clock(video.durationSeconds);
  return (
    <div className="nc-videos__thumb">
      {video.poster ? (
        <img src={video.poster} alt="" loading="lazy" />
      ) : (
        <div className="nc-videos__thumb-blank" aria-hidden="true" />
      )}
      {length && <span className="nc-videos__length">{length}</span>}
    </div>
  );
}

export function VideosPage() {
  const library = useResource((signal) => getVideoLibrary(signal), [], { refreshMs: 120000 });
  const [playingId, setPlayingId] = useState<string | null>(null);

  const videos = library.data?.videos ?? [];
  // Whatever the viewer picked, otherwise the newest clip.
  const playing = videos.find((v) => v.id === playingId) ?? videos[0] ?? null;

  if (library.error && !library.data) {
    return (
      <div className="nc-page">
        <ErrorState title="Video unavailable" message={library.error.friendly} onRetry={library.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-videos">
      <header className="nc-page__head">
        <div>
          <h1 className="nc-page__title">Weather Video</h1>
          <p className="nc-page__sub">Forecasts and coverage from the Storm 12 Weather team.</p>
        </div>
        {library.updatedAt && <DataStamp updatedAt={library.updatedAt} />}
      </header>

      {library.loading && !library.data ? (
        <Skeleton height={420} />
      ) : !playing ? (
        <EmptyState
          title="No video yet"
          message="Nothing has been published to the video library. Check back after the next forecast."
        />
      ) : (
        <div className="nc-videos__layout">
          <Panel className="nc-videos__stage">
            <video
              key={playing.id}
              className="nc-videos__player"
              src={playing.url}
              poster={playing.poster ?? undefined}
              controls
              playsInline
              preload="metadata"
            >
              Your browser cannot play this video.
            </video>
            <div className="nc-videos__meta">
              <h2 className="nc-videos__title">{playing.title}</h2>
              <p className="nc-videos__stamp">{new Date(playing.publishedAt).toLocaleString()}</p>
              {playing.description && <p className="nc-videos__desc">{playing.description}</p>}
            </div>
          </Panel>

          {videos.length > 1 && (
            <Panel title="More video" className="nc-videos__list">
              <ul>
                {videos.map((video) => (
                  <li key={video.id}>
                    <button
                      type="button"
                      className={`nc-videos__item${video.id === playing.id ? ' is-playing' : ''}`}
                      onClick={() => setPlayingId(video.id)}
                      aria-current={video.id === playing.id}
                    >
                      <Thumb video={video} />
                      <span className="nc-videos__item-text">
                        <strong>{video.title}</strong>
                        <span>{formatRelative(video.publishedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

export default VideosPage;
