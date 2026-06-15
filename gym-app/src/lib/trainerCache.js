// Lightweight per-session cache for trainer read pages so navigating back shows
// last data instantly instead of a spinner + full refetch. Pages hydrate their
// stable state from here (lazy useState init), then revalidate in the
// background and write through. Live/time-sensitive data (e.g. "training now")
// is deliberately NOT cached — pages keep fetching that fresh.
//
// sessionStorage (per tab/app run, cleared on close) keeps it simple and avoids
// stale data across days; TTL guards against mid-session staleness.

const PREFIX = 'tt_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 min

export function readTrainerCache(key, ttl = DEFAULT_TTL) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { t, d } = JSON.parse(raw);
    if (!t || Date.now() - t > ttl) return null;
    return d;
  } catch {
    return null;
  }
}

export function writeTrainerCache(key, data) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), d: data }));
  } catch {
    /* quota / private mode — caching is best-effort */
  }
}
