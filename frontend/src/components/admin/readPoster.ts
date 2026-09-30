/**
 * A still and a duration, read out of a video file in the browser.
 *
 * Nothing on the server can decode video, but the browser about to preview
 * the file already has to - so the poster frame comes from there. Best
 * effort throughout: a file the browser cannot decode still uploads, it just
 * arrives without a thumbnail.
 */
export function readPoster(file: File): Promise<{ poster: Blob | null; durationSeconds: number | null }> {
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

export default readPoster;
