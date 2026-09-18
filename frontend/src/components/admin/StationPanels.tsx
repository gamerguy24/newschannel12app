import { useEffect, useState } from 'react';
import { Button } from '../ui/Primitives';
import { saveMarkets, saveStation } from '../../services/admin';
import type { AdminState } from '../../api/types';

/**
 * Station identity, coverage and the ticker market list.
 *
 * Every field starts from what the server reports as effective, so the form
 * always shows what is actually on air rather than a stale draft.
 */

export function AdminCard({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="nc-admin__card">
      <header className="nc-admin__card-head">
        <div>
          <h2 className="nc-admin__card-title">{title}</h2>
          {note && <p className="nc-admin__card-note">{note}</p>}
        </div>
        {action}
      </header>
      <div className="nc-admin__card-body">{children}</div>
    </section>
  );
}

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="nc-field">
      <span className="nc-field__label">{label}</span>
      {children}
      {help && <span className="nc-field__help">{help}</span>}
    </label>
  );
}

/** Save button plus the one line of feedback that tells an operator it landed. */
export function SaveBar({
  onSave,
  saving,
  status,
  children,
}: {
  onSave: () => void;
  saving: boolean;
  status: { kind: 'ok' | 'error'; message: string } | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="nc-admin__actions">
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? 'Saving' : 'Save changes'}
      </Button>
      {children}
      {status && (
        <span className={`nc-admin__status is-${status.kind === 'ok' ? 'ok' : 'error'}`}>{status.message}</span>
      )}
    </div>
  );
}

type Status = { kind: 'ok' | 'error'; message: string } | null;

/* ------------------------------------------------------ station settings */

export function StationPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const [name, setName] = useState(state.station.name);
  const [shortName, setShortName] = useState(state.station.shortName);
  const [market, setMarket] = useState(state.station.market);
  const [locName, setLocName] = useState(state.effective.defaultLocation.name);
  const [lat, setLat] = useState(String(state.effective.defaultLocation.lat));
  const [lon, setLon] = useState(String(state.effective.defaultLocation.lon));
  const [radarSite, setRadarSite] = useState(state.effective.defaultRadarSite);
  const [coverage, setCoverage] = useState(state.effective.coverageStates.join(', '));
  const [sponsorName, setSponsorName] = useState(state.effective.sponsor.name ?? '');
  const [sponsorTag, setSponsorTag] = useState(state.effective.sponsor.tagline ?? '');
  const [streamUrl, setStreamUrl] = useState(state.effective.liveStream.url ?? '');
  const [streamType, setStreamType] = useState(state.effective.liveStream.type ?? 'hls');

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveStation({
        station: { name, shortName, market },
        defaultLocation: { name: locName, lat: Number(lat), lon: Number(lon) },
        defaultRadarSite: radarSite,
        coverageStates: coverage.split(/[,\s]+/).filter(Boolean),
        sponsor: { name: sponsorName, tagline: sponsorTag },
        liveStream: { url: streamUrl, type: streamType },
      });
      setStatus({ kind: 'ok', message: 'Saved. Live on the next request — no restart needed.' });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AdminCard title="Station Identity" note="Shown in the header, Broadcast Mode and every alert this station issues.">
        <div className="nc-admin__grid">
          <Field label="Station name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Short name" help="Used on viewer alerts, e.g. Storm 12 Weather Alert.">
            <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={12} />
          </Field>
          <Field label="Market">
            <input value={market} onChange={(e) => setMarket(e.target.value)} maxLength={80} />
          </Field>
        </div>
      </AdminCard>

      <AdminCard
        title="Home Market & Radar"
        note="Where the app opens for a first-time viewer, and the NEXRAD it falls back to."
      >
        <div className="nc-admin__grid">
          <Field label="Location name">
            <input value={locName} onChange={(e) => setLocName(e.target.value)} />
          </Field>
          <Field label="Latitude">
            <input type="number" step="0.0001" value={lat} onChange={(e) => setLat(e.target.value)} />
          </Field>
          <Field label="Longitude">
            <input type="number" step="0.0001" value={lon} onChange={(e) => setLon(e.target.value)} />
          </Field>
          <Field label="Home radar site" help="3-4 letter NEXRAD id. KOHX is Nashville (Old Hickory).">
            <input value={radarSite} onChange={(e) => setRadarSite(e.target.value.toUpperCase())} maxLength={4} />
          </Field>
          <Field label="Coverage states" help="Two-letter codes, comma separated. Drives the alert sweep.">
            <input value={coverage} onChange={(e) => setCoverage(e.target.value.toUpperCase())} />
          </Field>
        </div>
      </AdminCard>

      <AdminCard title="Sponsor" note="Leave blank for no sponsor tag. Appears on Broadcast Mode.">
        <div className="nc-admin__grid">
          <Field label="Sponsor name">
            <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} />
          </Field>
          <Field label="Tagline">
            <input value={sponsorTag} onChange={(e) => setSponsorTag(e.target.value)} />
          </Field>
        </div>
      </AdminCard>

      <AdminCard
        title="Live Stream"
        note="When set, the Live page plays this instead of the automatic radar-loop fallback."
      >
        <div className="nc-admin__grid">
          <Field label="Stream URL" help="HLS (.m3u8) or a direct video URL. Blank falls back to the NWS radar loop.">
            <input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="Stream type">
            <select value={streamType} onChange={(e) => setStreamType(e.target.value)}>
              <option value="hls">HLS</option>
              <option value="mp4">MP4</option>
              <option value="youtube">YouTube</option>
            </select>
          </Field>
        </div>
        <SaveBar onSave={save} saving={saving} status={status} />
      </AdminCard>
    </>
  );
}

/* -------------------------------------------------------- ticker markets */

export function MarketsPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const [rows, setRows] = useState(state.effective.tickerMarkets.map((m) => ({ ...m })));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    setRows(state.effective.tickerMarkets.map((m) => ({ ...m })));
  }, [state.effective.tickerMarkets]);

  const update = (index: number, patch: Partial<{ name: string; lat: number; lon: number }>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const move = (index: number, delta: number) =>
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await saveMarkets(rows.map((r) => ({ name: r.name, lat: Number(r.lat), lon: Number(r.lon) })));
      setStatus({ kind: 'ok', message: 'Ticker updated.' });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard
      title="Ticker Markets"
      note="The temperatures that crawl across the bottom of the site and Broadcast Mode, in order."
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRows((prev) => [...prev, { name: '', lat: 36.1627, lon: -86.7816 }])}
          disabled={rows.length >= 16}
        >
          Add market
        </Button>
      }
    >
      <table className="nc-admin__table">
        <thead>
          <tr>
            <th style={{ width: '44%' }}>Market</th>
            <th style={{ width: '18%' }}>Latitude</th>
            <th style={{ width: '18%' }}>Longitude</th>
            <th className="is-actions">Order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <input
                  value={row.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  aria-label={`Market ${index + 1} name`}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    background: 'var(--nc-navy-900)',
                    border: '1px solid var(--nc-line)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--nc-text)',
                  }}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.0001"
                  value={row.lat}
                  onChange={(e) => update(index, { lat: Number(e.target.value) })}
                  aria-label={`Market ${index + 1} latitude`}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    background: 'var(--nc-navy-900)',
                    border: '1px solid var(--nc-line)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--nc-text)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.0001"
                  value={row.lon}
                  onChange={(e) => update(index, { lon: Number(e.target.value) })}
                  aria-label={`Market ${index + 1} longitude`}
                  style={{
                    width: '100%',
                    padding: '6px 9px',
                    background: 'var(--nc-navy-900)',
                    border: '1px solid var(--nc-line)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--nc-text)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </td>
              <td className="is-actions">
                <Button size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0}>
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(index, 1)}
                  disabled={index === rows.length - 1}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                  disabled={rows.length <= 1}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SaveBar onSave={save} saving={saving} status={status} />
    </AdminCard>
  );
}
