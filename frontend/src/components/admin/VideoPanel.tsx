import { useRef, useState } from 'react';
import { Button } from '../ui/Primitives';
import { AdminCard, Field } from './StationPanels';
import { attachVideoPoster, deleteVideo, updateVideo, uploadVideo } from '../../services/admin';
import type { AdminState, StationVideo } from '../../api/types';

/**
 * THE VIDEO LIBRARY
 *
 * Upload a finished clip, give it a title, and it appears on the Videos page
 * with the newest one featured on Live Weather.
 *
 * The file goes up in slices rather than in one request, because a Worker
 * will not take a body much past 100 MB. That is also why there is a real
 * progress bar here instead of a spinner: the operator can see a 300 MB
 * upload actually moving.
 */

type Status = { kind: 'ok' | 'error'; message: string } | null;

const megabytes = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

const clock = (seconds: number | null) => {
  if (!seconds && seconds !== 0) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

/**
 * A still and a duration, read out of the file in the browser.
 *
 * Nothing on the server can decode video, but the browser about to preview
 * the file already has to - so the poster frame comes from there. Best
 * effort throughout: a file the browser cannot decode still uploads, it just
 * arrives without a thumbnail.
 */
function readPoster(file: File): Promise<{ poster: Blob | null; durationSeconds: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const done = (result: { poster: Blob | null; durationSeconds: number | null }) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };

    // A codec the browser cannot read must never hang the upload behind it.
    const timer = window.setTimeout(() => done({ poster: null, durationSeconds: null }), 15000);
    video.onerror = () => {
      window.clearTimeout(timer);
      done({ poster: null, durationSeconds: null });
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
      const durationSeconds = Number.isFinite(video.duration) ? Math.round(video.duration) : null;
      // A second in, so the poster is not the black frame most edits open on.
      video.currentTime = Math.min(1, (video.duration || 2) / 2);

      video.onseeked = () => {
        window.clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width) return done({ poster: null, durationSeconds });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => done({ poster: blob, durationSeconds }), 'image/jpeg', 0.82);
        } catch {
          done({ poster: null, durationSeconds });
        }
      };
    };

    video.src = url;
  });
}

export function VideoPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const storage = state.video;
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [poster, setPoster] = useState<Blob | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [ratio, setRatio] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setTitle('');
    setDescription('');
    setPoster(null);
    setPosterUrl(null);
    setDuration(null);
    setRatio(0);
    if (input.current) input.current.value = '';
  };

  const choose = async (picked: File | null) => {
    setPoster(null);
    setPosterUrl(null);
    setDuration(null);
    setFile(picked);
    if (!picked) return;

    setStatus(null);
    // Name the clip after the file, which is right often enough to save typing.
    if (!title) setTitle(picked.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120));

    const read = await readPoster(picked);
    setPoster(read.poster);
    setDuration(read.durationSeconds);
    if (read.poster) setPosterUrl(URL.createObjectURL(read.poster));
  };

  const send = async () => {
    if (!file || !title.trim()) {
      setStatus({ kind: 'error', message: 'Pick a file and give it a title.' });
      return;
    }
    if (file.size > storage.maxBytes) {
      setStatus({ kind: 'error', message: `That file is larger than the ${megabytes(storage.maxBytes)} ceiling.` });
      return;
    }

    setBusy(true);
    setRatio(0);
    setStatus(null);
    try {
      const video = await uploadVideo(
        file,
        { title: title.trim(), description: description.trim(), durationSeconds: duration },
        (progress) => setRatio(progress.ratio),
      );
      // Best effort: a clip with no thumbnail is still a published clip.
      if (poster) await attachVideoPoster(video.id, poster).catch(() => undefined);
      setStatus({ kind: 'ok', message: `"${video.title}" is in the library.` });
      reset();
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (video: StationVideo) => {
    setBusy(true);
    try {
      await deleteVideo(video.id);
      setStatus({ kind: 'ok', message: `Removed "${video.title}".` });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (video: StationVideo, next: string) => {
    if (!next.trim() || next === video.title) return;
    try {
      await updateVideo(video.id, { title: next.trim() });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

  if (!storage.storageConfigured) {
    return (
      <AdminCard
        title="Video library"
        note="Storage is not configured yet, so there is nowhere to put a file."
      >
        <p className="nc-admin__card-note" style={{ marginBottom: 'var(--space-3)' }}>
          Videos are kept in a Cloudflare R2 bucket. Create one called{' '}
          <code className="nc-readout">storm12-video</code> in the Cloudflare dashboard under R2, or run{' '}
          <code className="nc-readout">npx wrangler r2 bucket create storm12-video</code>. The Worker is already
          bound to it as <code className="nc-readout">VIDEO</code> — nothing else needs changing, and uploading
          turns itself on as soon as the bucket exists.
        </p>
      </AdminCard>
    );
  }

  return (
    <>
      <AdminCard
        title="Upload a video"
        note={`Up to ${megabytes(storage.maxBytes)}. Sent in ${megabytes(storage.partSize)} slices, so a large file will not time out.`}
      >
        <div className="nc-admin__grid">
          <Field label="Video file" help={storage.types.join(', ')}>
            <input
              ref={input}
              type="file"
              accept={storage.types.join(',')}
              aria-label="Video file"
              onChange={(e) => void choose(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Thursday Evening Forecast"
              aria-label="Video title"
            />
          </Field>
        </div>

        <Field label="Description" help="Shown under the video on the Videos page. Optional.">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What this clip covers."
            aria-label="Video description"
          />
        </Field>

        {file && (
          <div className="nc-video-admin__pending">
            {posterUrl ? (
              <img className="nc-video-admin__thumb" src={posterUrl} alt="" />
            ) : (
              <div className="nc-video-admin__thumb nc-video-admin__thumb--blank" aria-hidden="true" />
            )}
            <div>
              <strong>{file.name}</strong>
              <p className="nc-admin__card-note">
                {megabytes(file.size)} · {clock(duration)} ·{' '}
                {Math.max(1, Math.ceil(file.size / storage.partSize))} slice
                {file.size > storage.partSize ? 's' : ''}
                {!posterUrl && ' · no thumbnail could be read from this file'}
              </p>
            </div>
          </div>
        )}

        {busy && (
          <div className="nc-video-admin__progress" role="status" aria-live="polite">
            <div className="nc-video-admin__bar">
              <span style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            <span>{Math.round(ratio * 100)}% uploaded</span>
          </div>
        )}

        <div className="nc-admin__actions">
          <Button variant="primary" onClick={() => void send()} disabled={busy || !file}>
            {busy ? 'Uploading' : 'Upload video'}
          </Button>
          {file && !busy && (
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
          )}
          {status && (
            <span className={`nc-admin__status is-${status.kind === 'ok' ? 'ok' : 'error'}`}>{status.message}</span>
          )}
        </div>
      </AdminCard>

      <AdminCard title="Library" note={`${state.videos.length} clip${state.videos.length === 1 ? '' : 's'}, newest first.`}>
        {state.videos.length === 0 ? (
          <p className="nc-admin__card-note">Nothing uploaded yet.</p>
        ) : (
          <table className="nc-admin__table">
            <thead>
              <tr>
                <th style={{ width: '58%' }}>Title</th>
                <th style={{ width: '14%' }}>Length</th>
                <th style={{ width: '14%' }}>Size</th>
                <th className="is-actions">Remove</th>
              </tr>
            </thead>
            <tbody>
              {state.videos.map((video) => (
                <tr key={video.id}>
                  <td>
                    <input
                      defaultValue={video.title}
                      aria-label={`Title of ${video.title}`}
                      onBlur={(e) => void rename(video, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 9px',
                        background: 'var(--nc-navy-900)',
                        border: '1px solid var(--nc-line)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--nc-text)',
                      }}
                    />
                    <span className="nc-admin__card-note">
                      {new Date(video.publishedAt).toLocaleString()}
                    </span>
                  </td>
                  <td>{clock(video.durationSeconds)}</td>
                  <td>{megabytes(video.size)}</td>
                  <td className="is-actions">
                    <Button variant="ghost" onClick={() => void remove(video)} disabled={busy}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AdminCard>
    </>
  );
}

export default VideoPanel;
