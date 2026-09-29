/**
 * VIDEO LIBRARY STORAGE
 *
 * The station's own clips, kept in an R2 bucket bound as VIDEO. R2 rather
 * than Stream: there is no per-minute charge and no egress bill, and a
 * finished H.264 file is already the thing a viewer needs. The trade is that
 * nothing here transcodes - whatever is uploaded is what plays.
 *
 * Uploads arrive in parts. A Worker will not accept a request body of more
 * than about 100 MB, which most of a broadcast would exceed, so the browser
 * slices the file and each slice becomes one R2 multipart part. R2 requires
 * every part except the last to be the same size and at least 5 MiB, so the
 * part size is fixed here and shared with the client rather than guessed at
 * both ends.
 *
 * The bucket binding is optional on purpose. Without it the rest of the app
 * runs exactly as before and the video routes say plainly that storage is not
 * configured, which is what lets this ship before the bucket exists.
 */

/** One part per slice. Above R2's 5 MiB floor, below the Worker body ceiling. */
export const VIDEO_PART_SIZE = 10 * 1024 * 1024;

/** A ceiling, so a mis-drop of a 40 GB master cannot fill the bucket. */
export const VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;

/** What a browser can actually play back, mapped to the extension we store. */
const EXTENSIONS = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

export const VIDEO_TYPES = Object.keys(EXTENSIONS);

const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

/** The bucket, or null when the binding was never added. */
export const videoBucket = (env) => env?.VIDEO ?? null;

export const videoStorageReady = (env) => Boolean(videoBucket(env));

function requireBucket(env) {
  const bucket = videoBucket(env);
  if (!bucket) {
    throw fail(503, 'Media storage is not configured. Create the R2 bucket and bind it as VIDEO.');
  }
  return bucket;
}

/**
 * Where a file lives in the bucket.
 *
 * Keys are generated, never taken from the upload: a filename off a desktop
 * can carry slashes, unicode and other people's paths, and none of that
 * belongs in a key that later appears in a URL.
 */
export function videoKey(contentType) {
  const extension = EXTENSIONS[contentType] ?? 'mp4';
  return `videos/${crypto.randomUUID()}.${extension}`;
}

export const posterKey = () => `posters/${crypto.randomUUID()}.jpg`;

/** Stills for the blog. Same bucket, same reasoning, different prefix. */
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const IMAGE_TYPES = Object.keys(IMAGE_EXTENSIONS);

/** A still small enough to go up in one request, unlike a video. */
export const IMAGE_MAX_BYTES = 12 * 1024 * 1024;

export const imageKey = (contentType) =>
  `images/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[contentType] ?? 'jpg'}`;

/* ------------------------------------------------------------- uploading */

export async function startUpload(env, { contentType }) {
  const bucket = requireBucket(env);
  if (!VIDEO_TYPES.includes(contentType)) {
    throw fail(415, `That is not a video this player can read. Use one of: ${VIDEO_TYPES.join(', ')}.`);
  }

  const key = videoKey(contentType);
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
  return { key, uploadId: upload.uploadId, partSize: VIDEO_PART_SIZE };
}

export async function uploadPart(env, { key, uploadId, partNumber, body }) {
  const bucket = requireBucket(env);
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, body);
  return { partNumber: part.partNumber, etag: part.etag };
}

export async function completeUpload(env, { key, uploadId, parts }) {
  const bucket = requireBucket(env);
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  const ordered = [...parts]
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
    .sort((a, b) => a.partNumber - b.partNumber);
  const object = await upload.complete(ordered);
  return { key, size: object.size };
}

export async function abortUpload(env, { key, uploadId }) {
  const bucket = videoBucket(env);
  if (!bucket) return;
  try {
    await bucket.resumeMultipartUpload(key, uploadId).abort();
  } catch {
    // An upload that was never started, or already finished, is not a failure
    // worth surfacing - the caller is cleaning up either way.
  }
}

/** Small objects - a poster frame - go up whole. */
export async function putObject(env, key, body, contentType) {
  const bucket = requireBucket(env);
  await bucket.put(key, body, { httpMetadata: { contentType } });
  return key;
}

export async function deleteObjects(env, keys) {
  const bucket = videoBucket(env);
  if (!bucket) return;
  for (const key of keys.filter(Boolean)) {
    try {
      await bucket.delete(key);
    } catch {
      // A missing object is the state we wanted anyway.
    }
  }
}

/* --------------------------------------------------------------- serving */

/**
 * Parse a Range header against a known size.
 *
 * A <video> element does not download a file and play it; it asks for byte
 * ranges and expects 206 answers, and scrubbing is nothing but a jump to a
 * new range. Answering every request with the whole file technically plays,
 * but seeking breaks and the browser re-downloads from the start.
 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // "bytes=-500" means the last 500 bytes, not a range starting at zero.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Fetch an object for playback, honouring a Range request.
 *
 * Returns what the route needs to answer with, rather than a Response, so the
 * router shim stays the only thing that knows how a response is built.
 */
export async function readObject(env, key, rangeHeader) {
  const bucket = requireBucket(env);
  const head = await bucket.head(key);
  if (!head) throw fail(404, 'That video is no longer stored.');

  const size = head.size;
  const contentType = head.httpMetadata?.contentType ?? 'video/mp4';
  const range = parseRange(rangeHeader, size);

  if (!range) {
    const object = await bucket.get(key);
    if (!object) throw fail(404, 'That video is no longer stored.');
    return {
      status: 200,
      body: object.body,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        ETag: head.httpEtag,
      },
    };
  }

  const length = range.end - range.start + 1;
  const object = await bucket.get(key, { range: { offset: range.start, length } });
  if (!object) throw fail(404, 'That video is no longer stored.');

  return {
    status: 206,
    body: object.body,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(length),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      ETag: head.httpEtag,
    },
  };
}
