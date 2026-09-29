import { Link, useParams } from 'react-router-dom';
import { useResource } from '../hooks';
import { getPost } from '../services/weather';
import { ErrorState, Panel, Skeleton } from '../components/ui/Primitives';
import type { PostBlock } from '../api/types';
import './BlogPage.css';

/**
 * ONE POST
 *
 * The body arrives as ordered blocks and each becomes its own element. There
 * is no markup in the data and none is constructed here, so nothing typed
 * into the editor can end up as live HTML on this page.
 */

function Block({ block }: { block: PostBlock }) {
  if (block.type === 'heading') return <h2 className="nc-post__heading">{block.value}</h2>;

  if (block.type === 'text') {
    // A blank line is a paragraph break, which is how anyone types prose.
    return (
      <>
        {block.value
          .split(/\n{2,}/)
          .map((para) => para.trim())
          .filter(Boolean)
          .map((para, i) => (
            <p key={i} className="nc-post__para">
              {para}
            </p>
          ))}
      </>
    );
  }

  if (block.type === 'image') {
    return (
      <figure className="nc-post__figure">
        <img src={block.url} alt={block.caption || ''} loading="lazy" />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure className="nc-post__figure">
      <video src={block.url} poster={block.poster ?? undefined} controls playsInline preload="metadata">
        Your browser cannot play this video.
      </video>
      <figcaption>{block.caption || block.title}</figcaption>
    </figure>
  );
}

export function PostPage() {
  const { slug = '' } = useParams();
  const resource = useResource((signal) => getPost(slug, signal), [slug], {});
  const post = resource.data?.post;

  if (resource.error && !post) {
    return (
      <div className="nc-page">
        <ErrorState
          title={resource.error.status === 404 ? 'No such post' : 'The post could not be loaded'}
          message={resource.error.friendly}
          onRetry={resource.reload}
        />
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/blog">Back to the blog</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="nc-page nc-post">
      {!post ? (
        <Skeleton height={420} />
      ) : (
        <>
          <p className="nc-post__back">
            <Link to="/blog">← Weather Blog</Link>
          </p>
          <article>
            <header className="nc-post__head">
              <h1 className="nc-page__title">{post.title}</h1>
              {post.publishedAt && (
                <p className="nc-post__stamp">{new Date(post.publishedAt).toLocaleString()}</p>
              )}
              {post.summary && <p className="nc-post__summary">{post.summary}</p>}
            </header>

            {post.hero && <img className="nc-post__lead" src={post.hero} alt="" />}

            <Panel flush className="nc-post__body">
              {post.blocks.map((block) => (
                <Block key={block.id} block={block} />
              ))}
            </Panel>
          </article>
        </>
      )}
    </div>
  );
}

export default PostPage;
