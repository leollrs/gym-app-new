// mapImageCache.js
// -----------------------------------------------------------------------------
// Tiny IndexedDB wrapper for caching pre-rendered cardio share-card maps.
// Keyed by session id (UUID from log_cardio_session) or a fallback hash for
// queued-offline sessions. Stores PNG blobs, max ~500 KB each, capped at 100
// entries (oldest evicted on overflow) so we never bloat past ~50 MB.
//
// Why IndexedDB instead of localStorage:
//   - localStorage caps at 5 MB total; one PNG eats most of that
//   - localStorage stores strings only (data URLs are base64, ~33% bigger)
//   - IndexedDB stores Blobs natively + scales to hundreds of MB
//
// Why not the Cache API: Cache API keys are URLs, awkward for "session id →
// blob" semantics. IndexedDB is the right tool here.
// -----------------------------------------------------------------------------

const DB_NAME = 'tugympr-cardio-maps';
const STORE = 'maps';
const VERSION = 1;
const MAX_ENTRIES = 100;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheMapImage(sessionId, blob) {
  if (!sessionId || !blob) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id: sessionId, blob, savedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    // Evict oldest if we're over the cap. Done outside the put tx so the
    // primary write is never blocked by GC.
    evictIfNeeded(db).catch(() => {});
  } catch (err) {
    console.warn('[mapImageCache] put failed:', err?.message);
  }
}

export async function getCachedMapImage(sessionId) {
  if (!sessionId) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(sessionId);
      req.onsuccess = () => resolve(req.result?.blob || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function getCachedMapImageDataUrl(sessionId) {
  const blob = await getCachedMapImage(sessionId);
  if (!blob) return null;
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function evictIfNeeded(db) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const countReq = store.count();
    countReq.onsuccess = () => {
      const count = countReq.result;
      if (count <= MAX_ENTRIES) return resolve();
      // Oldest first via savedAt index, delete the overflow
      const idx = store.index('savedAt');
      const cursorReq = idx.openCursor();
      let toDelete = count - MAX_ENTRIES;
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || toDelete <= 0) return resolve();
        store.delete(cursor.primaryKey);
        toDelete -= 1;
        cursor.continue();
      };
    };
    countReq.onerror = () => resolve();
  });
}

export async function clearCachedMapImage(sessionId) {
  if (!sessionId) return;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(sessionId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// Helper: convert a data URL back to a Blob so the caller can pass either
// to cacheMapImage without thinking about it.
//
// Decodes the data URL MANUALLY rather than `fetch(dataUrl)` — the app's CSP
// `connect-src` deliberately doesn't allow `data:`, so fetching a data URL is
// refused in the iOS WebView ("Refused to connect to data:image/png…"). atob →
// bytes → Blob has no such restriction and is faster anyway.
export async function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  try {
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return null;
    const header = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    const mime = (header.match(/data:([^;,]+)/i) || [])[1] || 'image/png';
    let bytes;
    if (/;base64/i.test(header)) {
      const bin = atob(body);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      // URL-encoded (e.g. SVG) data URL
      const decoded = decodeURIComponent(body);
      bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}
