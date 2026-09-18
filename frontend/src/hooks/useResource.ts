import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface ResourceState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True while refreshing but still showing the previous payload. */
  refreshing: boolean;
  updatedAt: number | null;
  reload: () => void;
}

interface Options {
  /** Poll interval in ms. 0 disables polling. */
  refreshMs?: number;
  /** Skip fetching entirely (e.g. waiting on a location). */
  enabled?: boolean;
  /** Pause polling while the tab is hidden. Saves API budget on mobile. */
  pauseWhenHidden?: boolean;
}

/**
 * Fetch-with-lifecycle for a single resource.
 *
 * Keeps the last good payload visible while a refresh is in flight, so a radar
 * outage or a slow NWS response never blanks a panel that already has data.
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
  { refreshMs = 0, enabled = true, pauseWhenHidden = true }: Options = {},
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasData = useRef(false);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async (isRefresh: boolean) => {
      if (cancelled) return;
      if (isRefresh) setRefreshing(true);
      else if (!hasData.current) setLoading(true);

      try {
        const result = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        setData(result);
        hasData.current = true;
        setError(null);
        setUpdatedAt(Date.now());
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        // An abort is somebody's cancellation, never a weather outage - it
        // must not replace good data on screen with an error panel.
        if ((err as Error)?.name === 'AbortError') return;
        // A failed refresh must not throw away data already on screen.
        setError(err instanceof ApiError ? err : new ApiError((err as Error).message, 0));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    run(false);

    let timer: number | undefined;
    if (refreshMs > 0) {
      timer = window.setInterval(() => {
        if (pauseWhenHidden && document.visibilityState === 'hidden') return;
        run(true);
      }, refreshMs);
    }

    // Catch up immediately when the viewer returns to a backgrounded tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && refreshMs > 0) run(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, refreshMs, nonce]);

  return { data, error, loading, refreshing, updatedAt, reload };
}
