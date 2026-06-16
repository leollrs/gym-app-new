// Lightweight per-session cache for trainer read pages so navigating back shows
// last data instantly instead of a spinner + full refetch. Pages hydrate their
// stable state from here (lazy useState init), then revalidate in the
// background and write through. Live/time-sensitive data (e.g. "training now")
// is deliberately NOT cached — pages keep fetching that fresh.
//
// sessionStorage (per tab/app run, cleared on close) keeps it simple and avoids
// stale data across days. We deliberately do NOT expire within a session:
// pages always re-fetch in the background on mount, so any cached value is only
// ever shown for the instant before fresh data lands. A TTL here only ever hurt
// — after it lapsed mid-session, a perfectly good cached page was thrown away
// and replaced with a spinner (the recurring "I go back and have to wait"). The
// `ttl` arg is kept for callers that want age-gating but defaults to no expiry.

const PREFIX = 'tt_cache_';

export function readTrainerCache(key, ttl = Infinity) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { t, d } = JSON.parse(raw);
    if (Number.isFinite(ttl) && (!t || Date.now() - t > ttl)) return null;
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
