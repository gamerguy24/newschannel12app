import { useState } from 'react';
import { Button } from '../ui/Primitives';
import { AdminCard } from './StationPanels';
import { deleteReport, setReportStatus } from '../../services/admin';
import type { AdminState, StationReport } from '../../api/types';

/**
 * THE MODERATION QUEUE
 *
 * Everything a viewer sends lands here and stays here until somebody decides
 * otherwise. Approving is the only action that puts a photo on the public
 * site, and the whole reason this panel exists is that an anonymous upload
 * form publishing straight to air would be a liability.
 *
 * Contact details are shown to the newsroom and nowhere else - the public
 * API has no field to put them in.
 */

type Status = { kind: 'ok' | 'error'; message: string } | null;

const KIND_LABELS: Record<string, string> = {
  hail: 'Hail',
  wind: 'Wind damage',
  flood: 'Flooding',
  tornado: 'Tornado / funnel',
  winter: 'Snow or ice',
  other: 'Other',
};

export function ReportsPanel({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const reports = state.reports ?? [];
  const pending = reports.filter((r) => r.status === 'pending');
  const reviewed = reports.filter((r) => r.status !== 'pending');

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      setStatus({ kind: 'ok', message });
      onSaved();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ report }: { report: StationReport }) => (
    <div className="nc-report-row">
      {report.mediaId ? (
        <img className="nc-report-row__photo" src={`/api/media/${report.mediaId}`} alt="" />
      ) : (
        <div className="nc-report-row__photo nc-report-row__photo--none" aria-hidden="true" />
      )}

      <div className="nc-report-row__body">
        <div className="nc-report-row__meta">
          <span className="nc-report-row__kind">{KIND_LABELS[report.kind] ?? report.kind}</span>
          <strong>{report.where}</strong>
          <span className={`nc-report-row__state is-${report.status}`}>{report.status}</span>
        </div>
        <p className="nc-report-row__desc">{report.description}</p>
        <p className="nc-admin__card-note">
          {report.name} &middot; {report.contact} &middot; {new Date(report.submittedAt).toLocaleString()}
        </p>
        <p className="nc-admin__card-note">
          Contact details are newsroom only &mdash; approving publishes the name, not the number.
        </p>
      </div>

      <div className="nc-report-row__actions">
        {report.status !== 'approved' && (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void act(() => setReportStatus(report.id, 'approved'), `Published the report from ${report.where}.`)}
          >
            Approve
          </Button>
        )}
        {report.status !== 'rejected' && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => setReportStatus(report.id, 'rejected'), 'Rejected, and kept out of public view.')}
          >
            Reject
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void act(() => deleteReport(report.id), 'Deleted, photo and all.')}
        >
          Delete
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <AdminCard
        title="Waiting for review"
        note={
          pending.length
            ? `${pending.length} report${pending.length === 1 ? '' : 's'} from viewers. Nothing here is public yet.`
            : 'Nothing waiting. Viewer reports appear here before they can be published.'
        }
      >
        {pending.length === 0 ? (
          <p className="nc-admin__card-note">The queue is empty.</p>
        ) : (
          pending.map((report) => <Row key={report.id} report={report} />)
        )}
        {status && (
          <div className="nc-admin__actions">
            <span className={`nc-admin__status is-${status.kind === 'ok' ? 'ok' : 'error'}`}>{status.message}</span>
          </div>
        )}
      </AdminCard>

      <AdminCard
        title="Already reviewed"
        note={`${reviewed.length} report${reviewed.length === 1 ? '' : 's'}. Approved ones are live on the Storm Reports page.`}
      >
        {reviewed.length === 0 ? (
          <p className="nc-admin__card-note">Nothing reviewed yet.</p>
        ) : (
          reviewed.map((report) => <Row key={report.id} report={report} />)
        )}
      </AdminCard>
    </>
  );
}

export default ReportsPanel;
