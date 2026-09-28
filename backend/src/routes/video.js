import { Router } from '../../../worker/router.js';
import { asyncRoute, cacheFor, envelope, HttpError } from './helpers.js';
import { getVideos } from '../services/stationStore.js';
import { readObject, videoStorageReady } from '../services/videoLibrary.js';

/**
 * THE VIDEO LIBRARY, AS VIEWERS SEE IT
 *
 * The bytes live in R2 and the cards live in the newsroom store. Nothing here
 * writes: uploading is behind the admin door.
 *
 * Storage keys never leave the building. A card carries a URL through this
 * route instead, so the bucket's layout stays an implementation detail and a
 * file cannot be reached by guessing at it.
 */

const router = Router();

const card = (video) => ({
  id: video.id,
  title: video.title,
  description: video.description,
  durationSeconds: video.durationSeconds,
  size: video.size,
  publishedAt: video.publishedAt,
  url: `/api/videos/${video.id}/file`,
  poster: video.posterKey ? `/api/videos/${video.id}/poster` : null,
});

router.get('/videos', (req, res) => {
  const videos = getVideos();
  cacheFor(res, 30).json(
    envelope({
      videos: videos.map(card),
      latest: videos.length ? card(videos[0]) : null,
      storageConfigured: videoStorageReady(req.env),
    }),
  );
});

/** Find a clip, or say so in the same voice for both file and poster. */
function findVideo(id) {
  const video = getVideos().find((v) => v.id === id);
  if (!video) throw new HttpError(404, 'That video is not in the library.');
  return video;
}

/**
 * The file itself.
 *
 * A <video> element does not fetch a file and play it - it asks for byte
 * ranges, and every scrub is a jump to a new one. So this answers 206 with a
 * Content-Range whenever a range is asked for, and advertises Accept-Ranges
 * either way. Answering the whole file every time would still play, but
 * seeking would not work and the browser would re-download from the start.
 */
router.get(
  '/videos/:id/file',
  asyncRoute(async (req, res) => {
    const video = findVideo(req.params.id);
    const { status, body, headers } = await readObject(req.env, video.key, req.headers.range);
    res
      .status(status)
      .set(headers)
      // The bytes of a given clip never change, so this is worth keeping.
      .set('Cache-Control', 'public, max-age=3600')
      .send(body);
  }),
);

router.get(
  '/videos/:id/poster',
  asyncRoute(async (req, res) => {
    const video = findVideo(req.params.id);
    if (!video.posterKey) throw new HttpError(404, 'That video has no poster frame.');
    const { status, body, headers } = await readObject(req.env, video.posterKey, req.headers.range);
    res.status(status).set(headers).set('Cache-Control', 'public, max-age=3600').send(body);
  }),
);

export default router;
