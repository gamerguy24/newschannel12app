import { Link } from 'react-router-dom';
import { useResource } from '../hooks';
import { getBlog } from '../services/weather';
import { DataStamp, EmptyState, ErrorState, Panel, Skeleton } from '../components/ui/Primitives';
import { formatRelative } from '../utils/format';
import './BlogPage.css';

/**
 * THE BLOG INDEX
 *
 * Posts the newsroom has written, newest first. Drafts never reach here -
 * the API only hands out what has been published.
 */
export function BlogPage() {
  const blog = useResource((signal) => getBlog(signal), [], { refreshMs: 300000 });
  const posts = blog.data?.posts ?? [];

  if (blog.error && !blog.data) {
    return (
      <div className="nc-page">
        <ErrorState title="The blog is unavailable" message={blog.error.friendly} onRetry={blog.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-blog">
      <header className="nc-page__head">
        <div>
          <h1 className="nc-page__title">Weather Blog</h1>
          <p className="nc-page__sub">Notes and forecasts from the Storm 12 Weather team.</p>
        </div>
        {blog.updatedAt && <DataStamp updatedAt={blog.updatedAt} />}
      </header>

      {blog.loading && !blog.data ? (
        <Skeleton height={300} />
      ) : posts.length === 0 ? (
        <EmptyState title="Nothing posted yet" message="The first post will appear here when it goes up." />
      ) : (
        <div className="nc-blog__list">
          {posts.map((post) => (
            <Panel key={post.id} flush className="nc-blog__card">
              <Link to={`/blog/${post.slug}`} className="nc-blog__link">
                {post.hero ? (
                  <img className="nc-blog__hero" src={post.hero} alt="" loading="lazy" />
                ) : (
                  <div className="nc-blog__hero nc-blog__hero--blank" aria-hidden="true" />
                )}
                <div className="nc-blog__body">
                  <h2 className="nc-blog__title">{post.title}</h2>
                  {post.publishedAt && <p className="nc-blog__stamp">{formatRelative(post.publishedAt)}</p>}
                  {post.summary && <p className="nc-blog__summary">{post.summary}</p>}
                </div>
              </Link>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

export default BlogPage;
