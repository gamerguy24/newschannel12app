import { Router } from '../../../worker/router.js';
import { asyncRoute, cacheFor, envelope, HttpError } from './helpers.js';
import { findMedia, findPost, getPublishedPosts, getVideos } from '../services/stationStore.js';
import { readObject } from '../services/videoLibrary.js';

/**
 * THE BLOG, AS VIEWERS SEE IT
 *
 * Only published posts leave here - a draft is not a thing a viewer can
 * reach by guessing a URL. Nothing on this router writes; posting is behind
 * the newsroom door.
 *
 * Blocks come out as data, never as markup. The page builds a React element
 * per block, so there is nothing to sanitise and no way for what somebody
 * typed into the editor to become live HTML on the public site.
 */

const router = Router();

/** A block with its bytes addressed by URL instead of by bucket key. */
function publicBlock(block) {
  if (block.type === 'image') {
    return { id: block.id, type: 'image', caption: block.caption, url: `/api/media/${block.mediaId}` };
  }

  if (block.type === 'video') {
    // A post can outlive the clip it embedded; a missing one is dropped
    // rather than rendered as a broken player.
    const video = getVideos().find((v) => v.id === block.videoId);
    if (!video) return null;
    return {
      id: block.id,
      type: 'video',
      caption: block.caption,
      title: video.title,
      url: `/api/videos/${video.id}/file`,
      poster: video.posterKey ? `/api/videos/${video.id}/poster` : null,
    };
  }

  return { id: block.id, type: block.type, value: block.value };
}

const card = (post) => ({
  id: post.id,
  slug: post.slug,
  title: post.title,
  summary: post.summary,
  publishedAt: post.publishedAt,
  hero: post.heroMediaId ? `/api/media/${post.heroMediaId}` : null,
});

const full = (post) => ({
  ...card(post),
  blocks: post.blocks.map(publicBlock).filter(Boolean),
});

router.get('/blog', (req, res) => {
  const posts = getPublishedPosts();
  cacheFor(res, 60).json(envelope({ posts: posts.map(card), total: posts.length }));
});

router.get('/blog/:slug', (req, res) => {
  const post = findPost(req.params.slug);
  if (!post) throw new HttpError(404, 'There is no post at that address.');
  cacheFor(res, 60).json(envelope({ post: full(post) }));
});

/**
 * An uploaded still.
 *
 * Addressed by its media id rather than its key, so the bucket's layout
 * stays private and an image cannot be reached by guessing at a filename.
 */
router.get(
  '/media/:id',
  asyncRoute(async (req, res) => {
    const media = findMedia(req.params.id);
    if (!media) throw new HttpError(404, 'That image is no longer stored.');
    const { status, body, headers } = await readObject(req.env, media.key, req.headers.range);
    res.status(status).set(headers).set('Cache-Control', 'public, max-age=86400').send(body);
  }),
);

export default router;
