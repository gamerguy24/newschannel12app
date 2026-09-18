import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useResource, useStoredState } from '../../hooks';
import { getClosings } from '../../services/admin';
import './ClosingsBar.css';

/**
 * The closings strip.
 *
 * A slim, dismissible bar that only exists when the newsroom has actually
 * entered closings - the rest of the year it renders nothing at all rather
 * than occupying the top of every page.
 */
export function ClosingsBar() {
  const feed = useResource((signal) => getClosings(signal), [], { refreshMs: 120000 });
  const [dismissed, setDismissed] = useStoredState<string | null>('nc12.closingsDismissed', null);
  const ref = useRef<HTMLDivElement>(null);

  const closings = feed.data?.closings ?? [];
  const signature = `${closings.length}:${feed.data?.updatedAt ?? ''}`;
  const visible = closings.length > 0 && dismissed !== signature;

  /**
   * Publish the strip's height so the full-height map pages can subtract it.
   * Without this the radar sizes itself against fixed chrome and runs on
   * underneath the ticker whenever closings are running.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.setProperty('--closings-h', '0px');
      return undefined;
    }
    const node = ref.current;
    const measure = () => root.style.setProperty('--closings-h', `${node?.offsetHeight ?? 0}px`);
    measure();
    const observer = new ResizeObserver(measure);
    if (node) observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.setProperty('--closings-h', '0px');
    };
  }, [visible]);

  if (!visible) return null;

  // Dismissal is keyed to the current list, so a new closing brings it back.
  const names = closings.slice(0, 4).map((c) => c.name);
  const extra = closings.length - names.length;

  return (
    <div className="nc-closings-bar" role="status" ref={ref}>
      <span className="nc-closings-bar__tag">
        {closings.length} CLOSING{closings.length === 1 ? '' : 'S'}
      </span>
      <p className="nc-closings-bar__text">
        {names.join(' · ')}
        {extra > 0 ? ` · and ${extra} more` : ''}
      </p>
      <Link className="nc-closings-bar__link" to="/closings">
        See all
      </Link>
      <button
        type="button"
        className="nc-closings-bar__close"
        onClick={() => setDismissed(signature)}
        aria-label="Dismiss the closings bar"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default ClosingsBar;
