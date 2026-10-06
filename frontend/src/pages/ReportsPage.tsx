import { useState } from 'react';
import { useResource } from '../hooks';
import { getStormReportFeed, submitStormReport } from '../services/weather';
import { preparePhoto } from '../utils/photo';
import { Button, DataStamp, EmptyState, ErrorState, Panel, Skeleton } from '../components/ui/Primitives';
import { formatRelative } from '../utils/format';
import './ReportsPage.css';

/**
 * VIEWER STORM REPORTS
 *
 * What people send in, once the weather centre has looked at it. Nothing
 * reaches this page unreviewed, and the page says so - a viewer deciding
 * whether to trust a photo of hail deserves to know a person checked it.
 *
 * Contact details are collected by the form and never displayed here. The
 * API does not even return them.
 */

const EMPTY = {
  kind: '',
  where: '',
  description: '',
  name: '',
  contact: '',
  permission: false,
};

export function ReportsPage() {
  const feed = useResource((signal) => getStormReportFeed(signal), [], { refreshMs: 180000 });
  const [form, setForm] = useState({ ...EMPTY });
  const [photo, setPhoto] = useState<{ data: string; bytes: number } | null>(null);
  const [photoName, setPhotoName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const kinds = feed.data?.kinds ?? [];
  const reports = feed.data?.reports ?? [];
  const photosAccepted = feed.data?.photosAccepted ?? false;

  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  const choosePhoto = async (file: File | null) => {
    setPhoto(null);
    setPhotoName('');
    if (!file) return;
    setBusy(true);
    setNote(null);
    try {
      const prepared = await preparePhoto(file);
      setPhoto({ data: prepared.data, bytes: prepared.bytes });
      setPhotoName(file.name);
    } catch (err) {
      setNote({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await submitStormReport({
        ...form,
        photo: photo?.data,
      });
      setNote({ kind: 'ok', text: result.message });
      setForm({ ...EMPTY });
      setPhoto(null);
      setPhotoName('');
    } catch (err) {
      setNote({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (feed.error && !feed.data) {
    return (
      <div className="nc-page">
        <ErrorState title="Reports unavailable" message={feed.error.friendly} onRetry={feed.reload} />
      </div>
    );
  }

  return (
    <div className="nc-page nc-reports">
      <header className="nc-page__head">
        <div>
          <h1 className="nc-page__title">Storm Reports</h1>
          <p className="nc-page__sub">
            Sent in by viewers across Middle Tennessee and southern Kentucky, and checked by the Storm 12 weather
            centre before they appear here.
          </p>
        </div>
        {feed.updatedAt && <DataStamp updatedAt={feed.updatedAt} />}
      </header>

      <div className="nc-reports__layout">
        <section className="nc-reports__list">
          {feed.loading && !feed.data ? (
            <Skeleton height={320} />
          ) : reports.length === 0 ? (
            <EmptyState
              title="No reports yet"
              message="Nothing has been published yet. If you have seen storm damage, send it in and we will take a look."
            />
          ) : (
            reports.map((report) => (
              <Panel key={report.id} flush className="nc-reports__card">
                {report.photo && <img className="nc-reports__photo" src={report.photo} alt="" loading="lazy" />}
                <div className="nc-reports__body">
                  <div className="nc-reports__meta">
                    <span className="nc-reports__kind">{report.kindLabel}</span>
                    <span className="nc-reports__where">{report.where}</span>
                  </div>
                  <p className="nc-reports__desc">{report.description}</p>
                  <p className="nc-reports__credit">
                    {report.credit} &middot; {formatRelative(report.submittedAt)}
                  </p>
                </div>
              </Panel>
            ))
          )}
        </section>

        {/* ------------------------------------------------------- the form */}
        <Panel
          className="nc-reports__form"
          eyebrow="Seen something?"
          title="Send us a report"
        >
          <p className="nc-reports__note">
            Only send a report if you are somewhere safe. Never go out in severe weather to take a photograph.
          </p>

          <label className="nc-field">
            <span className="nc-field__label">What are you reporting?</span>
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Report type">
              <option value="">Choose one</option>
              {kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>

          <label className="nc-field">
            <span className="nc-field__label">Where</span>
            <input
              value={form.where}
              onChange={(e) => set({ where: e.target.value })}
              placeholder="Road, town or county"
              aria-label="Where it happened"
            />
          </label>

          <label className="nc-field">
            <span className="nc-field__label">What you saw</span>
            <textarea
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              rows={4}
              placeholder="Quarter-sized hail for about ten minutes, covering the lawn."
              aria-label="What you saw"
            />
          </label>

          {photosAccepted && (
            <label className="nc-field">
              <span className="nc-field__label">Photo (optional)</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                aria-label="Photo"
                onChange={(e) => void choosePhoto(e.target.files?.[0] ?? null)}
              />
              <span className="nc-field__help">
                {photo
                  ? `${photoName} ready (${Math.max(1, Math.round(photo.bytes / 1024))} KB). Location data is removed before it is sent.`
                  : 'Resized and stripped of location data in your browser before it is sent.'}
              </span>
            </label>
          )}

          <div className="nc-reports__pair">
            <label className="nc-field">
              <span className="nc-field__label">Your name</span>
              <input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                aria-label="Your name"
              />
            </label>
            <label className="nc-field">
              <span className="nc-field__label">Phone or email</span>
              <input
                value={form.contact}
                onChange={(e) => set({ contact: e.target.value })}
                aria-label="Phone or email"
              />
            </label>
          </div>

          <label className="nc-reports__permission">
            <input
              type="checkbox"
              checked={form.permission}
              onChange={(e) => set({ permission: e.target.checked })}
              aria-label="Permission to use this report"
            />
            <span>
              Storm 12 Weather may use this report and photo on air and online, with my name. My contact details stay
              in the newsroom and are never published.
            </span>
          </label>

          <div className="nc-reports__actions">
            <Button variant="primary" onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending' : 'Send report'}
            </Button>
            {note && (
              <span className={`nc-reports__status is-${note.kind}`} role="status">
                {note.text}
              </span>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default ReportsPage;
