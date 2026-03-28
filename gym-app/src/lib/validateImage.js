/**
 * Validates an image file by checking magic bytes (file signature),
 * not just the MIME type which can be spoofed.
 */

const SIGNATURES = [
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
];

export async function validateImageFile(file, { maxSizeMB = 5, allowedTypes = ['image/png', 'image/jpeg', 'image/webp'] } = {}) {
  if (file.size > maxSizeMB * 1024 * 1024) {
    return { valid: false, error: `Image must be under ${maxSizeMB} MB` };
  }

  // Read first 12 bytes to check magic bytes
  const header = await file.slice(0, 12).arrayBuffer();
  const arr = new Uint8Array(header);

  const matched = SIGNATURES.find(sig =>
    allowedTypes.includes(sig.mime) &&
    sig.bytes.every((b, i) => arr[i] === b)
  );

  // Extra check for WebP: bytes 8-11 must be "WEBP"
  if (matched?.mime === 'image/webp') {
    const webpTag = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    if (!webpTag.every((b, i) => arr[i + 8] === b)) {
      return { valid: false, error: 'Invalid WebP file' };
    }
  }

  if (!matched) {
    return { valid: false, error: 'Invalid image file. Only PNG, JPEG, and WebP are allowed' };
  }

  // ── Max dimension check (prevents decompression bomb attacks) ──
  const MAX_DIMENSION = 4096;
  try {
    const dimensions = await getImageDimensions(file);
    if (dimensions && (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION)) {
      return { valid: false, error: `Image dimensions must not exceed ${MAX_DIMENSION}x${MAX_DIMENSION} pixels` };
    }
  } catch {
    // NOTE: If dimension check fails client-side (e.g. in a Worker context
    // where Image/createImageBitmap is unavailable), server-side validation
    // should enforce the same max dimension limit as a fallback.
  }

  return { valid: true, mime: matched.mime };
}

/**
 * Loads the image to read its natural dimensions.
 * Returns { width, height } or null if not possible in this environment.
 */
function getImageDimensions(file) {
  // Prefer createImageBitmap (works in workers and main thread)
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then(bmp => {
      const { width, height } = bmp;
      bmp.close();
      return { width, height };
    });
  }
  // Fallback: HTMLImageElement (main thread only)
  if (typeof Image !== 'undefined') {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }
  return Promise.resolve(null);
}
