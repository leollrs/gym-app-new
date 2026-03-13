/**
 * Lightweight stale-while-revalidate cache using sessionStorage.
 * Shows cached data instantly on mount, then refreshes in background.
 */

const TTL = 5 * 60 * 1000; // 5 min — data older than this still shows but always revalidates

export function getCached(key) {
  try {
    const raw = sessionStorage.getItem(`qc:${key}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, stale: Date.now() - ts > TTL };
  } catch {
    return null;
  }
}

export function setCache(key, data) {
  try {
    sessionStorage.setItem(`qc:${key}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

export function clearCache(key) {
  try { sessionStorage.removeItem(`qc:${key}`); } catch {}
}
