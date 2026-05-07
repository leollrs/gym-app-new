/**
 * Lightweight stale-while-revalidate cache used by legacy (non-TanStack) pages.
 *
 * Backed by localStorage (NOT sessionStorage) so the cache survives iOS
 * WebView force-quits / app restarts. sessionStorage is per-tab and is wiped
 * when the Capacitor app is killed — that caused a visible cold-start spinner
 * even though we had warm data available.
 *
 * TTL = 5 min. Data older than this still returns (stale: true) so pages can
 * paint instantly from cache while they revalidate in the background.
 */

const TTL = 5 * 60 * 1000; // 5 min — data older than this still shows but always revalidates
const PREFIX = 'qc:';

export function getCached(key) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, stale: Date.now() - ts > TTL };
  } catch {
    return null;
  }
}

export function setCache(key, data) {
  try {
    localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // quota exceeded — try to evict the oldest half of entries then retry once
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(PREFIX)) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          entries.push({ k, ts: parsed?.ts || 0 });
        } catch { entries.push({ k, ts: 0 }); }
      }
      entries.sort((a, b) => a.ts - b.ts);
      entries.slice(0, Math.ceil(entries.length / 2)).forEach(e => localStorage.removeItem(e.k));
      localStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* still full — give up */ }
  }
}

export function clearCache(key) {
  try { localStorage.removeItem(`${PREFIX}${key}`); } catch {}
}
