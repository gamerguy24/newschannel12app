/**
 * Prepare a viewer's photo for upload.
 *
 * Two things happen here, and the first matters more than the second.
 *
 * A photo straight off a phone carries EXIF: the camera, the time, and very
 * often the exact coordinates it was taken at. Somebody sending a picture of
 * hail in their garden does not mean to send their home address with it.
 * Redrawing the image through a canvas keeps only the pixels - every piece
 * of metadata is left behind.
 *
 * It is also downscaled. A modern phone photo is several thousand pixels
 * wide and a dozen megabytes; nothing on the site displays it larger than
 * about two thousand, so the rest is upload time on a bad connection in bad
 * weather, which is exactly when this form gets used.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.85;

export interface PreparedPhoto {
  /** Base64 JPEG, ready to post as JSON. */
  data: string;
  bytes: number;
  width: number;
  height: number;
}

export function preparePhoto(file: File): Promise<PreparedPhoto> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    const fail = (message: string) => {
      URL.revokeObjectURL(url);
      reject(new Error(message));
    };

    image.onerror = () => fail('That file could not be read as a photo.');

    image.onload = () => {
      try {
        const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return fail('This browser cannot prepare the photo.');

        ctx.drawImage(image, 0, 0, width, height);
        // toDataURL rather than toBlob: the result posts as JSON in the same
        // request as the rest of the form, so a half-sent report cannot leave
        // a photo in the bucket that nothing points at.
        const data = canvas.toDataURL('image/jpeg', QUALITY);
        URL.revokeObjectURL(url);

        const bytes = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
        resolve({ data, bytes, width, height });
      } catch {
        fail('That photo could not be prepared.');
      }
    };

    image.src = url;
  });
}
