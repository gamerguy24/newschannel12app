import { Router } from '../../../worker/router.js';
import { asyncRoute, cacheFor, envelope, HttpError } from './helpers.js';
import { REPORT_KINDS, getApprovedReports, reportThrottled } from '../services/stationStore.js';
import { imageKey, putObject, videoStorageReady } from '../services/videoLibrary.js';
import { runStore } from '../../../worker/store-bridge.js';

/**
 * VIEWER STORM REPORTS
 *
 * The one place on this site anybody at all can write to, which is the whole
 * reason it is written the way it is.
 *
 * Nothing submitted here is visible to anybody but the newsroom until a
 * person approves it. An anonymous photo form on a station's own domain,
 * publishing straight to air, is a liability rather than a feature.
 *
 * Contact details are taken because the newsroom needs to reach a sender for
 * permission or to check a doubtful report, and they never leave this
 * building: the public shape below has no contact field to populate.
 */

const router = Router();

/** Eight megabytes of actual image, after the base64 wrapper comes off. */
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * What a file really is, rather than what it claims.
 *
 * The declared type is whatever the sender typed; the first few bytes are
 * the file. Anything that does not look like an image we can display is
 * refused rather than stored and served back to viewers later.
 */
function sniffImage(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';

  const tag = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (tag(0, 4) === 'RIFF' && tag(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function decodeBase64(value) {
  const cleaned = String(value ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!cleaned) return null;
  // Reject early rather than decoding megabytes of junk to find out.
  if (cleaned.length > PHOTO_MAX_BYTES * 1.4) return 'too-large';
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * A sender, counted without being identified.
 *
 * The address is hashed so the throttle can tell two submissions apart
 * without the newsroom holding anybody's IP.
 */
async function senderKey(req) {
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`storm12:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a viewer is allowed to see. Note the absence of a contact field. */
const publicShape = (report) => ({
  id: report.id,
  kind: report.kind,
  kindLabel: REPORT_KINDS.find((k) => k.id === report.kind)?.label ?? 'Report',
  where: report.where,
  description: report.description,
  credit: report.name,
  photo: report.mediaId ? `/api/media/${report.mediaId}` : null,
  submittedAt: report.submittedAt,
});

router.get('/reports', (req, res) => {
  const reports = getApprovedReports();
  cacheFor(res, 60).json(
    envelope({
      reports: reports.map(publicShape),
      kinds: REPORT_KINDS,
      photosAccepted: videoStorageReady(req.env),
    }),
  );
});

router.post(
  '/reports',
  asyncRoute(async (req, res) => {
    const key = await senderKey(req);
    if (reportThrottled(key)) {
      throw new HttpError(429, 'That is several reports in a short time. Please try again a little later.');
    }

    // Counted here, before any of the work below. Recording it after the
    // photo was decoded would leave the expensive path - megabytes of base64
    // per request - unthrottled for anyone sending deliberate rubbish.
    await runStore(req.env, 'recordReportAttempt', key);

    let mediaId = null;
    if (req.body?.photo) {
      if (!videoStorageReady(req.env)) throw new HttpError(503, 'Photos cannot be received right now.');

      const bytes = decodeBase64(req.body.photo);
      if (bytes === 'too-large') throw new HttpError(413, 'That photo is too large. Keep it under 8 MB.');
      if (!bytes) throw new HttpError(400, 'That photo could not be read.');
      if (bytes.length > PHOTO_MAX_BYTES) throw new HttpError(413, 'That photo is too large. Keep it under 8 MB.');

      const contentType = sniffImage(bytes);
      if (!contentType) throw new HttpError(415, 'That file is not a photo this site can show.');

      const stored = await putObject(req.env, imageKey(contentType), bytes, contentType);
      const media = await runStore(req.env, 'saveMedia', {
        key: stored,
        contentType,
        size: bytes.length,
      });
      if (!media.ok) throw new HttpError(400, media.errors.join(' '));
      mediaId = media.media.id;
    }

    const outcome = await runStore(req.env, 'saveReport', { ...req.body, photo: undefined, mediaId });
    if (!outcome.ok) throw new HttpError(400, outcome.errors.join(' '));

    res.json(
      envelope({
        ok: true,
        // Deliberately not the report: nothing is public until it is reviewed,
        // including back to the person who sent it.
        message: 'Thank you. Your report has gone to the Storm 12 weather centre for review.',
      }),
    );
  }),
);

export default router;
