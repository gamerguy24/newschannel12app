import { Link } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Panel, Spinner } from '../ui/Primitives';
import type { LatLon, TrackedStorm } from '../../api/types';
import './RadarPreview.css';

// Leaflet only downloads once the dashboard actually renders the preview.
const RadarMap = lazy(() => import('./RadarMap'));

/**
 * The dashboard's radar window: a live, playable loop with the same engine as
 * the full radar page, plus a summary of what is being tracked.
 */
export function RadarPreview({
  location,
  site,
  storms,
}: {
  location: LatLon & { name?: string; label?: string };
  site?: string;
  storms: TrackedStorm[];
}) {
  const warned = storms.filter((s) => s.kind === 'warning').length;

  return (
    <Panel
      title="Live Radar"
      action={
        <Link className="nc-radar-preview__full" to="/radar">
          Open full radar
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-8.5 8.5M10 4H5.6A1.6 1.6 0 0 0 4 5.6V18.4A1.6 1.6 0 0 0 5.6 20h12.8a1.6 1.6 0 0 0 1.6-1.6V14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      }
      flush
    >
      <div className="nc-radar-preview">
        <Suspense
          fallback={
            <div className="nc-radar-preview__loading">
              <Spinner size={30} label="Loading radar" />
            </div>
          }
        >
          <RadarMap location={location} initialSite={site} height="390px" compact />
        </Suspense>
      </div>

      <div className="nc-radar-preview__foot">
        <span>
          {storms.length === 0
            ? 'No warned storms in range'
            : `${storms.length} storm${storms.length === 1 ? '' : 's'} tracked${warned ? ` · ${warned} warned` : ''}`}
        </span>
      </div>
    </Panel>
  );
}

export default RadarPreview;
