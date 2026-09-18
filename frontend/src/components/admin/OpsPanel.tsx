import { useState } from 'react';
import { AdminCard } from './StationPanels';
import { Button, Spinner } from '../ui/Primitives';
import { useResource } from '../../hooks';
import { clearErrorLog, getDiagnostics, purgeCache } from '../../services/admin';
import { formatRelative } from '../../utils/format';

/**
 * OPS
 *
 * The "is the weather wall about to go dark" screen: which upstreams are
 * answering and how fast, what the cache is absorbing, and what has been
 * failing. Everything here is measured on request, never guessed.
 */

const STATUS_COLOR: Record<string, string> = {
  up: 'var(--nc-green)',
  slow: 'var(--nc-gold)',
  down: 'var(--nc-red-bright)',
};

const SUMMARY_COPY: Record<string, string> = {
  nominal: 'All sources answering',
  degraded: 'A non-critical source is struggling',
  critical: 'A source the broadcast depends on is down',
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function OpsPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const diagnostics = useResource(() => getDiagnostics(), [], { refreshMs: 30000 });
  const data = diagnostics.data;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      diagnostics.reload();
    } finally {
      setBusy(null);
    }
  };

  // The slowest source sets the scale, so the bars stay comparable.
  const slowest = Math.max(1, ...(data?.sources ?? []).map((s) => s.ms));

  return (
    <>
      <AdminCard
        title="Source Health"
        note="Probed live, with a short timeout and no retries — a slow answer is itself the finding."
        action={
          <div className="nc-row">
            {diagnostics.refreshing && <Spinner size={14} />}
            <Button size="sm" variant="outline" onClick={diagnostics.reload}>
              Re-check
            </Button>
          </div>
        }
      >
        {!data ? (
          <p className="nc-admin__empty">
            {diagnostics.error ? diagnostics.error.friendly : 'Probing every upstream…'}
          </p>
        ) : (
          <>
            <div
              className="nc-pill"
              style={
                {
                  '--pill':
                    data.summary.status === 'nominal'
                      ? 'var(--nc-green)'
                      : data.summary.status === 'degraded'
                        ? 'var(--nc-gold)'
                        : 'var(--nc-red-bright)',
                  marginBottom: 'var(--space-3)',
                } as React.CSSProperties
              }
            >
              <i className="nc-dot" />
              {SUMMARY_COPY[data.summary.status]} · {data.summary.up}/{data.summary.total}
            </div>

            <table className="nc-admin__table">
              <thead>
                <tr>
                  <th style={{ width: '26%' }}>Source</th>
                  <th style={{ width: '12%' }}>State</th>
                  <th>Response</th>
                  <th style={{ width: '10%' }}>Role</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.id}>
                    <td>{source.name}</td>
                    <td>
                      <span className="nc-pill" style={{ '--pill': STATUS_COLOR[source.status] } as React.CSSProperties}>
                        <i className="nc-dot" />
                        {source.status}
                      </span>
                    </td>
                    <td>
                      <div className="nc-ops__source">
                        <span className="nc-ops__bar">
                          <span
                            style={{
                              width: `${Math.max(3, (source.ms / slowest) * 100)}%`,
                              background: STATUS_COLOR[source.status],
                            }}
                          />
                        </span>
                        <span className="nc-readout" style={{ minWidth: 64, textAlign: 'right' }}>
                          {source.ms} ms
                        </span>
                      </div>
                      {source.error && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--nc-red-bright)' }}>{source.error}</div>
                      )}
                    </td>
                    <td style={{ color: 'var(--nc-text-faint)', fontSize: 'var(--text-xs)' }}>
                      {source.critical ? 'Critical' : 'Optional'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </AdminCard>

      <AdminCard
        title="Server & Cache"
        note="The cache is what keeps NOAA from rate-limiting the station. Purge it only if data looks stuck."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => run('purge', purgeCache)}
            disabled={busy === 'purge'}
          >
            {busy === 'purge' ? 'Purging' : 'Purge cache'}
          </Button>
        }
      >
        <div className="nc-ops__grid">
          {[
            ['Uptime', data ? formatUptime(data.uptimeSeconds) : '--'],
            ['Memory', data ? `${data.memoryMb} MB` : '--'],
            ['Node', data?.node ?? '--'],
            ['Cache entries', data?.cache.entries ?? '--'],
            ['Fresh', data?.cache.live ?? '--'],
            ['Stale', data?.cache.stale ?? '--'],
            ['In flight', data?.cache.inflight ?? '--'],
          ].map(([label, value]) => (
            <dl className="nc-ops__stat" key={String(label)}>
              <dt>{label}</dt>
              <dd className="nc-readout">{value}</dd>
            </dl>
          ))}
        </div>
      </AdminCard>

      <AdminCard
        title={`Recent Failures (${data?.errors.length ?? 0})`}
        note="Every failed request, newest first — 4xx included, because a wave of them is the story."
        action={
          data?.errors.length ? (
            <Button size="sm" variant="ghost" onClick={() => run('errors', clearErrorLog)} disabled={busy === 'errors'}>
              Clear log
            </Button>
          ) : undefined
        }
      >
        {!data?.errors.length ? (
          <p className="nc-admin__empty">No failures recorded since the last restart.</p>
        ) : (
          <div className="nc-ops__log">
            {data.errors.map((error, i) => (
              <div key={`${error.at}-${i}`}>
                <span style={{ color: 'var(--nc-text-faint)' }}>{formatRelative(error.at)}</span>
                <b>{error.status}</b>
                <span>{error.method}</span>
                <span style={{ color: 'var(--nc-text)' }}>{error.url}</span>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </>
  );
}

export default OpsPanel;
