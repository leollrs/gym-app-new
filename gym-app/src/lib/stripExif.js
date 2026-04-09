/**
 * Strip EXIF metadata from an image File by re-encoding through a canvas.
 *
 * Drawing an image onto a canvas and exporting via toBlob() produces a clean
 * image with zero metadata (no GPS coordinates, device info, timestamps, etc.).
 *
 * This is critical for user-uploaded photos (avatars, social posts, class images)
 * that are stored in public or semi-public buckets.
 *
 * @param {File|Blob} file - The image file to strip metadata from.
 * @param {object} [options]
 * @param {number} [options.maxDimension=2048] - Max width/height (preserves aspect ratio).
 * @param {number} [options.quality=0.92] - JPEG quality (0-1).
 * @returns {Promise<Blob>} A clean JPEG blob with no EXIF metadata.
 */
export async function stripExif(file, { maxDimension = 2048, quality = 0.92 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { naturalWidth: w, naturalHeight: h } = img;

      // Scale down if exceeding maxDimension (preserving aspect ratio)
      if (w > maxDimension || h > maxDimension) {
        const scale = maxDimension / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            // Fallback: return original file if canvas export fails
            resolve(file);
          }
        },
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
