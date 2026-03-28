/**
 * takePhoto — opens the device camera via an HTML file input on all platforms.
 *
 * We do NOT use the Capacitor Camera plugin because on iOS it launches a
 * separate native camera process that triggers iOS memory pressure, killing
 * the WKWebView content process and reloading the entire app.
 *
 * The HTML file input with capture="environment" uses the same native camera
 * but through WKWebView's built-in file handling, which manages the lifecycle
 * correctly and does not crash.
 *
 * Returns a File object so callers don't need to branch.
 */

/** Maximum image file size in bytes (5 MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Compress an image File on-device using a canvas if it exceeds maxBytes.
 * Returns the original file if it's already small enough, or a compressed JPEG.
 */
async function compressIfNeeded(file, maxBytes = MAX_FILE_SIZE) {
  if (file.size <= maxBytes) return file;

  try {
    const bmp = await createImageBitmap(file);
    const maxDim = 1280;
    let { width, height } = bmp;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height);
    } else {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();

    for (const q of [0.7, 0.5, 0.3]) {
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: q })
        : await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
      if (blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
      }
    }
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.2 })
      : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.2));
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[takePhoto] Compression failed, returning original file:', err);
    return file;
  }
}

/**
 * Take a photo using the native file input with camera capture.
 * Works on iOS, Android, and web without triggering WebView crashes.
 * @returns {Promise<File|null>} The captured image as a File, or null if cancelled.
 */
export async function takePhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    // Input MUST be in the DOM — iOS and Android WebViews don't reliably
    // deliver the change event to detached input elements.
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);

    let resolved = false;
    const cleanup = () => {
      try { document.body.removeChild(input); } catch {}
    };
    const done = (val) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(val);
    };

    input.onchange = () => {
      const file = input.files?.[0] || null;
      if (file && file.size > 0) {
        compressIfNeeded(file).then(f => done(f)).catch(() => done(file));
      } else {
        done(null);
      }
    };

    // Detect cancel: when the user dismisses the camera/picker without
    // selecting a file, the window regains focus.
    const onWindowFocus = () => {
      window.removeEventListener('focus', onWindowFocus);
      setTimeout(() => {
        if (!input.files?.length) done(null);
      }, 500);
    };
    setTimeout(() => window.addEventListener('focus', onWindowFocus), 200);

    input.click();
  });
}
