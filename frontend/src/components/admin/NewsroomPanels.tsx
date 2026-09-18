import { useState } from 'react';
import { AdminCard, Field, SaveBar } from './StationPanels';
import { Button } from '../ui/Primitives';
import {
  clearClosings,
  deleteClosing,
  deleteStationAlert,
  expireStationAlert,
  issueStationAlert,
  saveClosing,
  saveOnAir,
} from '../../services/admin';
import { formatRelative } from '../../utils/format';
import type { AdminState, ClosingStatus } from '../../api/types';

type Status = { kind: 'ok' | 'error'; message: string } | null;

const STATUS_COLOR: Record<string, string> = {
  closed: 'var(--nc-red-bright)',
  delayed: 'var(--nc-gold)',
  early: 'var(--nc-violet)',
  virtual: 'var(--nc-cyan-bright)',
  open: 'var(--nc-green)',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--nc-red-bright)',
  important: 'var(--nc-gold)',
  info: 'var(--nc-cyan-bright)',
};

/* ---------------------------------------------------------- on-air control */

/**
 * The manual takeover. This is the newsroom deliberately claiming the screen,
 * so it outranks the automatic NWS selection everywhere it appears.
 */
export function OnAirPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const live = state.onAir.takeover;
  const [headline, setHeadline] = useState(live?.headline ?? '');
  const [detail, setDetail] = useState(live?.detail ?? '');
  const [tier, setTier] = useState(live?.tier ?? 'severe');
  const [minutes, setMinutes] = useState('60');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: 'ok', message });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const goLive = () =>
    run(
      () =>
        saveOnAir({
          takeover: {
            headline,
            detail,
            tier,
            expiresAt: new Date(Date.now() + Number(minutes || 60) * 60000).toISOString(),
          },
        } as never),
      'On air. Viewers see this banner now.',
    );

  return (
    <>
      {live && (
        <div className="nc-admin__onair">
          <span className="nc-admin__onair-tag">● ON AIR</span>
          <span className="nc-admin__onair-text">
            <strong>{live.headline}</strong>
            {live.expiresAt ? ` — clears ${formatRelative(live.expiresAt)}` : ''}
          </span>
          <Button size="sm" variant="danger" onClick={() => run(() => saveOnAir({ takeover: null }), 'Takeover cleared.')}>
            Take it down
          </Button>
        </div>
      )}

      <AdminCard
        title="Breaking Weather Takeover"
        note="Puts a full-width banner across the site and Broadcast Mode. Use it when the newsroom is leading coverage."
      >
        <div className="nc-admin__grid">
          <Field label="Headline" help="Shown in the banner. Keep it to one readable line.">
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={120}
              placeholder="Team coverage: line of storms entering Middle Tennessee"
            />
          </Field>
          <Field label="Severity">
            <select value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
              <option value="moderate">Moderate — advisory tone</option>
              <option value="severe">Severe — red banner</option>
              <option value="catastrophic">Catastrophic — maximum urgency</option>
            </select>
          </Field>
          <Field label="Clears after (minutes)" help="The takeover comes down by itself, so it cannot be left up.">
            <input type="number" min="5" max="480" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Field label="Supporting detail">
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={400} />
          </Field>
        </div>
        <div className="nc-admin__actions">
          <Button variant="danger" onClick={goLive} disabled={saving || !headline.trim()}>
            {saving ? 'Working' : live ? 'Update takeover' : 'Put on air'}
          </Button>
          {live && (
            <Button variant="outline" onClick={() => run(() => saveOnAir({ takeover: null }), 'Takeover cleared.')}>
              Clear
            </Button>
          )}
          {status && <span className={`nc-admin__status is-${status.kind}`}>{status.message}</span>}
        </div>
      </AdminCard>
    </>
  );
}

/* -------------------------------------------------------- school closings */

export function ClosingsPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [county, setCounty] = useState('');
  const [statusValue, setStatusValue] = useState<ClosingStatus>('closed');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Status>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ kind: 'ok', message });
      onSaved();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await saveClosing({ name, county, status: statusValue, detail });
      setName('');
      setCounty('');
      setDetail('');
    }, 'Added to the closings list.');

  return (
    <>
      <AdminCard
        title="Add a Closing"
        note="Entered by the newsroom — there is no public feed for school closings, so these are typed in as they come."
      >
        <div className="nc-admin__grid">
          <Field label="School or district">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Metro Nashville Public Schools"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) add();
              }}
            />
          </Field>
          <Field label="Status">
            <select value={statusValue} onChange={(e) => setStatusValue(e.target.value as ClosingStatus)}>
              {state.closingStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="County">
            <input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="Davidson" />
          </Field>
          <Field label="Detail" help="Optional — e.g. 2-hour delay, no morning pre-K.">
            <input value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Field>
        </div>
        <div className="nc-admin__actions">
          <Button variant="primary" onClick={add} disabled={busy || !name.trim()}>
            Add closing
          </Button>
          {feedback && <span className={`nc-admin__status is-${feedback.kind}`}>{feedback.message}</span>}
        </div>
      </AdminCard>

      <AdminCard
        title={`On the Air Now (${state.closings.length})`}
        note="Live on the closings page and in the ticker the moment they are added."
        action={
          state.closings.length > 0 ? (
            <Button size="sm" variant="danger" onClick={() => run(clearClosings, 'Closings cleared.')}>
              Clear all
            </Button>
          ) : undefined
        }
      >
        {state.closings.length === 0 ? (
          <p className="nc-admin__empty">
            No closings are running. Anything added here appears on the public closings page immediately.
          </p>
        ) : (
          <table className="nc-admin__table">
            <thead>
              <tr>
                <th>School or district</th>
                <th>Status</th>
                <th>County</th>
                <th>Detail</th>
                <th className="is-actions">Remove</th>
              </tr>
            </thead>
            <tbody>
              {state.closings.map((closing) => (
                <tr key={closing.id}>
                  <td>{closing.name}</td>
                  <td>
                    <span className="nc-pill" style={{ '--pill': STATUS_COLOR[closing.status] } as React.CSSProperties}>
                      {state.closingStatuses.find((s) => s.id === closing.status)?.label ?? closing.status}
                    </span>
                  </td>
                  <td>{closing.county || '—'}</td>
                  <td style={{ color: 'var(--nc-text-dim)' }}>{closing.detail || '—'}</td>
                  <td className="is-actions">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => run(() => deleteClosing(closing.id), 'Removed.')}
                    >
                      Remove
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

/* ---------------------------------------------------------- viewer alerts */

/**
 * Alerts the station writes itself. These reach viewers through the same
 * banner, ticker and push notification path as an NWS product, but they are
 * always labelled with the station's own call sign so the two can never be
 * confused.
 */
export function ViewerAlertsPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('important');
  const [areas, setAreas] = useState('');
  const [duration, setDuration] = useState('120');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Status>(null);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ kind: 'ok', message });
      onSaved();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const issue = () =>
    run(async () => {
      await issueStationAlert({
        headline,
        body,
        severity,
        areas,
        durationMinutes: Number(duration || 120),
      });
      setHeadline('');
      setBody('');
      setAreas('');
    }, 'Sent. Viewers with notifications on are being alerted now.');

  const now = Date.now();

  return (
    <>
      <AdminCard
        title="Send a Viewer Alert"
        note="Goes out as a push notification, the breaking banner and the ticker — signed with the station's name, never as an NWS product."
      >
        <div className="nc-admin__grid">
          <Field label="Headline" help="What the viewer reads first. Say the thing itself.">
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={140}
              placeholder="Flooding on Briley Parkway near Opryland"
            />
          </Field>
          <Field
            label="Severity"
            help="Critical leads the breaking banner. Station alerts never override a viewer's quiet hours — only life-threatening NWS warnings do that."
          >
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="critical">Critical — leads the banner</option>
              <option value="important">Important — alert strip and ticker</option>
              <option value="info">Info — ticker only</option>
            </select>
          </Field>
          <Field label="Areas" help="Free text, e.g. Davidson County; Rutherford County.">
            <input value={areas} onChange={(e) => setAreas(e.target.value)} />
          </Field>
          <Field label="Expires after (minutes)" help="Alerts expire on their own; nothing stays up indefinitely.">
            <input type="number" min="5" max="1440" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Field label="Body">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={800}
              placeholder="Avoid Briley Parkway between exits 12 and 14. Water is over the roadway and crews are on scene."
            />
          </Field>
        </div>
        <div className="nc-admin__actions">
          <Button variant="danger" onClick={issue} disabled={busy || !headline.trim()}>
            {busy ? 'Sending' : 'Send to viewers'}
          </Button>
          {feedback && <span className={`nc-admin__status is-${feedback.kind}`}>{feedback.message}</span>}
        </div>
      </AdminCard>

      <AdminCard title="Issued Alerts" note="Everything this station has sent recently, live first.">
        {state.stationAlerts.length === 0 ? (
          <p className="nc-admin__empty">Nothing issued yet.</p>
        ) : (
          <table className="nc-admin__table">
            <thead>
              <tr>
                <th>Headline</th>
                <th>Severity</th>
                <th>Issued</th>
                <th>State</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.stationAlerts.map((alert) => {
                const live = new Date(alert.expiresAt).getTime() > now;
                return (
                  <tr key={alert.id}>
                    <td>
                      <div>{alert.headline}</div>
                      {alert.areas && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--nc-text-faint)' }}>{alert.areas}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className="nc-pill"
                        style={{ '--pill': SEVERITY_COLOR[alert.severity] } as React.CSSProperties}
                      >
                        {alert.severity}
                      </span>
                    </td>
                    <td style={{ color: 'var(--nc-text-dim)' }}>{formatRelative(alert.issuedAt)}</td>
                    <td>
                      {live ? (
                        <span className="nc-pill" style={{ '--pill': 'var(--nc-green)' } as React.CSSProperties}>
                          <i className="nc-dot" /> Live
                        </span>
                      ) : (
                        <span className="nc-pill">Expired</span>
                      )}
                    </td>
                    <td className="is-actions">
                      {live && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => run(() => expireStationAlert(alert.id), 'Alert pulled.')}
                        >
                          Pull
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => run(() => deleteStationAlert(alert.id), 'Deleted.')}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </AdminCard>
    </>
  );
}

export { SaveBar };
