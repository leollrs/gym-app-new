/**
 * Universal blob-to-file helper. Works on web AND Capacitor native (iOS/Android).
 *
 * On Capacitor native:
 *   - converts the Blob to base64
 *   - writes to Directory.Cache with the requested filename
 *   - opens the native Share sheet so the user can save / send the file
 *     (Share preserves the on-disk filename — that's the only way to give
 *      the file a sensible name in the WebView, since Capacitor's WebView
 *      ignores the HTML <a download> attribute)
 *
 * On web:
 *   - standard Blob → object URL → invisible <a download> click pattern
 *   - defers URL.revokeObjectURL inside a setTimeout so the browser has
 *     time to start streaming the blob before we revoke it. Without the
 *     defer some Chromium versions cancel the download mid-fetch, leaving
 *     a partial / nameless file on disk — that's the bug that made earlier
 *     PDF/CSV downloads land with garbled names.
 *
 * MIME type drives the file extension on some platforms — pass an
 * accurate one (e.g. 'application/pdf', 'text/csv;charset=utf-8').
 */
import { Capacitor } from '@capacitor/core';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result looks like "data:<mime>;base64,<base64>"
      const s = reader.result;
      const i = typeof s === 'string' ? s.indexOf(',') : -1;
      resolve(i >= 0 ? s.substring(i + 1) : '');
    };
    reader.onerror = () => reject(reader.error || new Error('blob read failed'));
    reader.readAsDataURL(blob);
  });
}

export async function saveBlob(filename, blob) {
  if (!blob) throw new Error('saveBlob: blob is required');
  if (!filename) throw new Error('saveBlob: filename is required');

  if (Capacitor.isNativePlatform()) {
    // Dynamic import — keeps the @capacitor/filesystem and /share modules
    // out of the web bundle entirely.
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    const base64 = await blobToBase64(blob);
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      url: result.uri,
      // mimeType lets the share-sheet route to the right app (PDF reader,
      // spreadsheet app) on Android. iOS infers from the URL extension.
      ...(blob.type ? { dialogTitle: filename } : {}),
    });
    return;
  }

  // ── Web path ──
  // Blob → object URL → invisible <a download> click. The two non-obvious
  // pieces, both required to avoid the "6742950a-..." filename bug:
  //
  //   1. Set BOTH the .download property and the download attribute, and
  //      set them BEFORE assigning .href. The property is what file-saver
  //      uses and is the most reliable across Chromium versions; the
  //      attribute is belt-and-braces for older WebKit.
  //
  //   2. Defer the DOM removal AND the URL revoke together. `link.click()`
  //      dispatches the click event synchronously, but Chromium processes
  //      the click's default action (reading `download` to pick the
  //      filename, starting the actual download) on a later task. If we
  //      removeChild() synchronously, by the time Chrome runs the default
  //      action the anchor is detached, the download attribute is
  //      unreadable, and Chrome falls back to the blob URL's UUID as the
  //      filename — exact symptom: file lands as
  //      "6742950a-3beb-4a73-bdc3-4cf68af9f9f9" with no extension, but
  //      the bytes are intact (the blob URL holds the data alive until
  //      the in-flight download finishes). 1500ms is plenty for the
  //      download to start; both the link and the URL get cleaned up
  //      together after that.
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.setAttribute('download', filename);
  link.rel = 'noopener';
  link.href = url;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    try { document.body.removeChild(link); } catch { /* already detached */ }
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }, 1500);
}

/**
 * Convenience: save a UTF-8 text string as a file.
 */
export function saveText(filename, text, mimeType = 'text/plain;charset=utf-8') {
  return saveBlob(filename, new Blob([text], { type: mimeType }));
}
