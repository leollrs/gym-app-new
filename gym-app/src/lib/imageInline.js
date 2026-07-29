// imageInline.js
// -----------------------------------------------------------------------------
// Fetch a remote image and return it as a data URL, or null if it cannot be
// retrieved. Lives in lib/ rather than in a share component so BOTH the export
// pipeline and the individual card components can use it without importing each
// other (GymLockup ← ShareSheet ← templates ← GymLockup would be a cycle).
// -----------------------------------------------------------------------------

export async function urlToDataUrl(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || null;
  // 1) fetch → blob → data URL. Works when connect-src + CORS allow it.
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      const d = await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result));
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
      if (d) return d;
    }
  } catch { /* fall through to the <img> path */ }
  // 2) Fallback: load via a crossOrigin <img> and read it back off a canvas.
  // Supabase signed URLs display fine as an <img> (the preview proves it) but
  // their fetch() can be blocked by a cross-host redirect / CSP — the image
  // path isn't, and a CORS-clean image draws to canvas without tainting it.
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 256;
          c.height = img.naturalHeight || 256;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } catch {
    return null;
  }
}
