/**
 * Strip EXIF metadata from an image File by re-encoding through a canvas.
 *
 * Drawing an image onto a canvas and exporting via toBlob() produces a clean
 * image with zero metadata (no GPS coordinates, device info, timestamps, etc.).
 *
 * This is critical for user-uploaded photos (avatars, social posts, class images,
 * staff check-in reference photos) that are stored in public or semi-public buckets.
 *
 * Decoding goes through `createImageBitmap` first — unlike `<img>`, it can decode
 * HEIC/HEIF (the default iPhone camera format) inside iOS WKWebView, so this also
 * transcodes HEIC → JPEG. Falls back to the legacy `<img>` path on older engines.
 *
 * @param {File|Blob} file - The image file to strip metadata from.
 * @param {object} [options]
 * @param {number} [options.maxDimension=2048] - Max width/height (preserves aspect ratio).
 * @param {number} [options.quality=0.92] - JPEG quality (0-1).
 * @returns {Promise<Blob>} A clean JPEG blob with no EXIF metadata.
 */
export async function stripExif(file, { maxDimension = 2048, quality = 0.92 } = {}) {
  // Preferred path: createImageBitmap decodes HEIC in WKWebView where <img> cannot.
  if (typeof createImageBitmap === 'function') {
    try {
      let bitmap;
      try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        // Some engines don't support the options arg — retry bare.
        bitmap = await createImageBitmap(file);
      }
      let w = bitmap.width;
      let h = bitmap.height;
      if (w > maxDimension || h > maxDimension) {
        const scale = maxDimension / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { bitmap.close?.(); return file; }
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob) return blob;
    } catch {
      // fall through to the <img> path
    }
  }
  return stripExifViaImage(file, { maxDimension, quality });
}

/** Legacy fallback: decode via <img> (cannot decode HEIC in WKWebView). */
function stripExifViaImage(file, { maxDimension = 2048, quality = 0.92 } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let { naturalWidth: w, naturalHeight: h } = img;
      if (w > maxDimension || h > maxDimension) {
        const scale = maxDimension / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback: return original file rather than breaking the upload
      resolve(file);
    };

    img.src = url;
  });
}
