import { useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Primitives';
import { AdminCard, Field } from './StationPanels';
import { attachVideoPoster, deletePost, savePost, uploadPostImage, uploadVideo } from '../../services/admin';
import { readPoster } from './readPoster';
import type { AdminState, StationPost, StationPostBlock } from '../../api/types';

/**
 * THE BLOG EDITOR
 *
 * Posting is behind the newsroom password, the same door as everything else
 * here, so the blog is the station's alone to write in.
 *
 * A body is a list of blocks rather than a box of markup. Text, a heading, a
 * still, or a clip out of the video library - each one renders as its own
 * element on the public page, which means there is no HTML to sanitise and
 * no way for something typed in here to become live markup out there.
 */

type Status = { kind: 'ok' | 'error'; message: string } | null;

const blank = (): Draft => ({
  id: undefined,
  title: '',
  slug: '',
  summary: '',
  heroMediaId: null,
  heroUrl: null,
  blocks: [],
  status: 'draft',
});

interface Draft {
  id?: string;
  title: string;
  slug: string;
  summary: string;
  heroMediaId: string | null;
  heroUrl: string | null;
  blocks: StationPostBlock[];
  status: 'draft' | 'published';
}

const newId = () => `blk-${Math.random().toString(36).slice(2, 10)}`;

export function BlogPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  // Which block is uploading a clip, and how far along.
  const [clipUp, setClipUp] = useState<{ block: string; ratio: number } | null>(null);
  const heroInput = useRef<HTMLInputElement>(null);

  const storageReady = state.video.storageConfigured;
  const accept = useMemo(() => state.blog.imageTypes.join(','), [state.blog.imageTypes]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const editBlock = (id: string, patch: Partial<StationPostBlock>) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));

  const addBlock = (type: StationPostBlock['type']) =>
    setDraft((d) => ({ ...d, blocks: [...d.blocks, { id: newId(), type, value: '', caption: '' }] }));

  const removeBlock = (id: string) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }));

  const moveBlock = (id: string, by: number) =>
    setDraft((d) => {
      const at = d.blocks.findIndex((b) => b.id === id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= d.blocks.length) return d;
      const blocks = [...d.blocks];
      const [row] = blocks.splice(at, 1);
      blocks.splice(to, 0, row);
      return { ...d, blocks };
    });

  const pickImage = async (file: File | null, forBlock: string | null) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const { media } = await uploadPostImage(file);
      if (forBlock) editBlock(forBlock, { mediaId: media.id });
      else set({ heroMediaId: media.id, heroUrl: media.url });
      setStatus({ kind: 'ok', message: 'Image uploaded.' });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
      if (heroInput.current) heroInput.current.value = '';
    }
  };

  /**
   * Put a clip straight into the post.
   *
   * Making somebody leave the editor, upload in the Video Library, come back
   * and find their draft again is the kind of round trip that stops a post
   * from having video in it at all. The clip lands in the library too, so it
   * is still there to reuse.
   */
  const pickClip = async (file: File | null, blockId: string) => {
    if (!file) return;
    setStatus(null);
    setClipUp({ block: blockId, ratio: 0 });
    try {
      const read = await readPoster(file);
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120) || 'Untitled clip';
      const video = await uploadVideo(file, { title, durationSeconds: read.durationSeconds }, (p) =>
        setClipUp({ block: blockId, ratio: p.ratio }),
      );
      if (read.poster) await attachVideoPoster(video.id, read.poster).catch(() => undefined);
      editBlock(blockId, { videoId: video.id });
      setStatus({ kind: 'ok', message: `"${video.title}" uploaded and added to this post.` });
      // The library gained a clip, so the picker beside this needs to know.
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setClipUp(null);
    }
  };

  const store = async (status_: 'draft' | 'published') => {
    if (!draft.title.trim()) {
      setStatus({ kind: 'error', message: 'Give the post a title.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const { post } = await savePost({
        id: draft.id,
        title: draft.title.trim(),
        slug: draft.slug.trim() || undefined,
        summary: draft.summary.trim(),
        heroMediaId: draft.heroMediaId,
        blocks: draft.blocks,
        status: status_,
      });
      setStatus({
        kind: 'ok',
        message: status_ === 'published' ? `Published at /blog/${post.slug}` : `Saved "${post.title}" as a draft.`,
      });
      setDraft(blank());
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const edit = (post: StationPost) => {
    setDraft({
      id: post.id,
      title: post.title,
      slug: post.slug,
      summary: post.summary,
      heroMediaId: post.heroMediaId,
      heroUrl: post.heroMediaId ? `/api/media/${post.heroMediaId}` : null,
      blocks: post.blocks.map((b) => ({ ...b })),
      status: post.status,
    });
    setStatus(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (post: StationPost) => {
    setBusy(true);
    try {
      await deletePost(post.id);
      if (draft.id === post.id) setDraft(blank());
      setStatus({ kind: 'ok', message: `Deleted "${post.title}".` });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AdminCard
        title={draft.id ? 'Edit post' : 'Write a post'}
        note="Only the newsroom can post here. Readers can read, and that is all."
        action={
          draft.id ? (
            <Button variant="ghost" onClick={() => setDraft(blank())}>
              New post
            </Button>
          ) : undefined
        }
      >
        <div className="nc-admin__grid">
          <Field label="Title">
            <input
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="A wet week ahead"
              aria-label="Post title"
            />
          </Field>
          <Field label="Address" help="Left blank, this is made from the title.">
            <input
              value={draft.slug}
              onChange={(e) => set({ slug: e.target.value })}
              placeholder="a-wet-week-ahead"
              aria-label="Post slug"
            />
          </Field>
        </div>

        <Field label="Summary" help="The line under the headline on the blog index.">
          <textarea
            value={draft.summary}
            onChange={(e) => set({ summary: e.target.value })}
            rows={2}
            aria-label="Post summary"
          />
        </Field>

        <Field label="Lead image" help={storageReady ? 'Shown at the top of the post and on the index.' : 'Needs the media bucket.'}>
          <div className="nc-blog-admin__hero">
            {draft.heroUrl && <img src={draft.heroUrl} alt="" className="nc-blog-admin__hero-img" />}
            <input
              ref={heroInput}
              type="file"
              accept={accept}
              disabled={!storageReady || busy}
              aria-label="Lead image"
              onChange={(e) => void pickImage(e.target.files?.[0] ?? null, null)}
            />
            {draft.heroMediaId && (
              <Button variant="ghost" onClick={() => set({ heroMediaId: null, heroUrl: null })}>
                Remove
              </Button>
            )}
          </div>
        </Field>

        <div className="nc-blog-admin__blocks">
          <h3 className="nc-admin__card-title">Body</h3>
          {draft.blocks.length === 0 && (
            <p className="nc-admin__card-note">Nothing in the body yet. Add a paragraph below.</p>
          )}

          {draft.blocks.map((block, index) => (
            <div key={block.id} className="nc-blog-admin__block">
              <div className="nc-blog-admin__block-bar">
                <span className="nc-blog-admin__block-type">{block.type}</span>
                <div>
                  <Button variant="ghost" onClick={() => moveBlock(block.id, -1)} disabled={index === 0}>
                    Up
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => moveBlock(block.id, 1)}
                    disabled={index === draft.blocks.length - 1}
                  >
                    Down
                  </Button>
                  <Button variant="ghost" onClick={() => removeBlock(block.id)}>
                    Remove
                  </Button>
                </div>
              </div>

              {block.type === 'heading' && (
                <input
                  value={block.value ?? ''}
                  onChange={(e) => editBlock(block.id, { value: e.target.value })}
                  placeholder="Section heading"
                  aria-label={`Heading ${index + 1}`}
                />
              )}

              {block.type === 'text' && (
                <textarea
                  value={block.value ?? ''}
                  onChange={(e) => editBlock(block.id, { value: e.target.value })}
                  rows={5}
                  placeholder="Write the paragraph."
                  aria-label={`Paragraph ${index + 1}`}
                />
              )}

              {block.type === 'image' && (
                <div className="nc-blog-admin__hero">
                  {block.mediaId && (
                    <img src={`/api/media/${block.mediaId}`} alt="" className="nc-blog-admin__hero-img" />
                  )}
                  <input
                    type="file"
                    accept={accept}
                    disabled={!storageReady || busy}
                    aria-label={`Image ${index + 1}`}
                    onChange={(e) => void pickImage(e.target.files?.[0] ?? null, block.id)}
                  />
                  <input
                    value={block.caption ?? ''}
                    onChange={(e) => editBlock(block.id, { caption: e.target.value })}
                    placeholder="Caption"
                    aria-label={`Image ${index + 1} caption`}
                  />
                </div>
              )}

              {block.type === 'video' && (
                <div className="nc-blog-admin__video">
                  {state.videos.length > 0 && (
                    <select
                      value={block.videoId ?? ''}
                      onChange={(e) => editBlock(block.id, { videoId: e.target.value })}
                      aria-label={`Video ${index + 1}`}
                    >
                      <option value="">Pick a clip already in the library</option>
                      {state.videos.map((video) => (
                        <option key={video.id} value={video.id}>
                          {video.title}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="nc-blog-admin__hero">
                    <span className="nc-admin__card-note">
                      {state.videos.length ? 'or upload a new one' : 'Upload a clip'}
                    </span>
                    <input
                      type="file"
                      accept={state.video.types.join(',')}
                      disabled={!storageReady || Boolean(clipUp)}
                      aria-label={`Upload video ${index + 1}`}
                      onChange={(e) => void pickClip(e.target.files?.[0] ?? null, block.id)}
                    />
                  </div>

                  {clipUp?.block === block.id && (
                    <div className="nc-video-admin__progress" role="status" aria-live="polite">
                      <div className="nc-video-admin__bar">
                        <span style={{ width: `${Math.round(clipUp.ratio * 100)}%` }} />
                      </div>
                      <span>{Math.round(clipUp.ratio * 100)}% uploaded</span>
                    </div>
                  )}

                  {!storageReady && (
                    <p className="nc-admin__card-note">Video needs the media bucket before it can be uploaded.</p>
                  )}

                  <input
                    value={block.caption ?? ''}
                    onChange={(e) => editBlock(block.id, { caption: e.target.value })}
                    placeholder="Caption"
                    aria-label={`Video ${index + 1} caption`}
                  />
                </div>
              )}
            </div>
          ))}

          <div className="nc-admin__actions">
            <Button variant="ghost" onClick={() => addBlock('text')}>
              Add paragraph
            </Button>
            <Button variant="ghost" onClick={() => addBlock('heading')}>
              Add heading
            </Button>
            <Button variant="ghost" onClick={() => addBlock('image')} disabled={!storageReady}>
              Add image
            </Button>
            {/* Never disabled for an empty library: the block itself can
                upload one, and a greyed-out button explains nothing. */}
            <Button variant="ghost" onClick={() => addBlock('video')} disabled={!storageReady}>
              Add video
            </Button>
          </div>
        </div>

        <div className="nc-admin__actions">
          <Button variant="primary" onClick={() => void store('published')} disabled={busy}>
            {busy ? 'Working' : 'Publish'}
          </Button>
          <Button variant="ghost" onClick={() => void store('draft')} disabled={busy}>
            Save draft
          </Button>
          {status && (
            <span className={`nc-admin__status is-${status.kind === 'ok' ? 'ok' : 'error'}`}>{status.message}</span>
          )}
        </div>
      </AdminCard>

      <AdminCard title="Posts" note={`${state.posts.length} post${state.posts.length === 1 ? '' : 's'}, drafts included.`}>
        {state.posts.length === 0 ? (
          <p className="nc-admin__card-note">Nothing written yet.</p>
        ) : (
          <table className="nc-admin__table">
            <thead>
              <tr>
                <th style={{ width: '54%' }}>Title</th>
                <th style={{ width: '16%' }}>State</th>
                <th style={{ width: '16%' }}>Updated</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <strong>{post.title}</strong>
                    <span className="nc-admin__card-note">/blog/{post.slug}</span>
                  </td>
                  <td>
                    <span className={`nc-blog-admin__state is-${post.status}`}>{post.status}</span>
                  </td>
                  <td>{new Date(post.updatedAt).toLocaleDateString()}</td>
                  <td className="is-actions">
                    <Button variant="ghost" onClick={() => edit(post)} disabled={busy}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(post)} disabled={busy}>
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

export default BlogPanel;
