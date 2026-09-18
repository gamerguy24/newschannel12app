import { useEffect, useRef, useState } from 'react';
import { GraphicSvg, isOverlay } from '../components/graphics/templates';
import type { ProgramGraphic } from '../api/types';
import './GraphicsOutputPage.css';

/**
 * PLAYOUT OUTPUT
 *
 * The page a vision mixer (vMix, OBS, TriCaster, CasparCG) loads as a
 * 1920x1080 browser source. It shows only what the studio has taken to
 * program, on a transparent page so lower thirds key cleanly over video.
 *
 * It polls rather than holding a socket open: a browser source that loses a
 * connection must recover on its own, mid-show, with nobody at the machine.
 * Append ?bg=black (or any CSS colour) to see it on a solid ground.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '/api';
const POLL_MS = 1000;
const OUT_MS = 450;

export function GraphicsOutputPage() {
  const [live, setLive] = useState<ProgramGraphic | null>(null);
  const [leaving, setLeaving] = useState<ProgramGraphic | null>(null);
  const liveRef = useRef<ProgramGraphic | null>(null);

  useEffect(() => {
    const bg = new URLSearchParams(window.location.search).get('bg') || 'transparent';
    const root = document.documentElement;
    const previous = [root.style.background, document.body.style.background];
    root.style.background = bg;
    document.body.style.background = bg;
    document.title = 'Storm 12 Weather - Program Output';
    return () => {
      root.style.background = previous[0];
      document.body.style.background = previous[1];
    };
  }, []);

  useEffect(() => {
    let timer = 0;
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`${BASE}/graphics/program`, { cache: 'no-store' });
        if (res.ok) {
          const next = ((await res.json()).data?.program ?? null) as ProgramGraphic | null;
          const current = liveRef.current;
          if ((next?.id ?? null) !== (current?.id ?? null)) {
            // The outgoing graphic animates off while the next one comes in.
            if (current) {
              setLeaving(current);
              window.setTimeout(() => setLeaving(null), OUT_MS);
            }
            liveRef.current = next;
            setLive(next);
          }
        }
      } catch {
        // A network blip keeps the last frame on air rather than dropping it.
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };

    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  const kind = (graphic: ProgramGraphic) => (isOverlay(graphic.template) ? 'is-lower' : 'is-full');

  return (
    <div className="nc-out">
      {leaving && (
        <div key={`out-${leaving.id}`} className={`nc-out__layer is-out ${kind(leaving)}`}>
          <GraphicSvg data={leaving} className="nc-out__svg" />
        </div>
      )}
      {live && (
        <div key={live.id} className={`nc-out__layer is-in ${kind(live)}`}>
          <GraphicSvg data={live} className="nc-out__svg" />
        </div>
      )}
    </div>
  );
}

export default GraphicsOutputPage;
