// cardioLedger.js
// -----------------------------------------------------------------------------
// Append-only record of cardio sessions the user has logged. Survives session
// delete, app restart, and bundle updates. Used purely as a tombstone signal:
// if a logged-event timestamp is newer than the live-cardio draft's startedAt,
// the draft is dead — even if its localStorage entry hasn't been scrubbed yet
// (offline-path leak, OS-killed WebView, old-bundle write, etc).
//
// Schema (per-user array):
//   [{ id, cardioType, startedAt, loggedAt, name }]
// Entries older than 7 days are pruned on read so the list can't grow
// unbounded. The list is intentionally NOT keyed by session id — even if the
// DB row is deleted, the tombstone here stays as a "this was completed"
// witness. Clearing the live ghost is the whole point.

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ledgerKey = (uid) => `tugympr_cardio_ledger_${uid || 'anon'}`;

function readRaw(uid) {
  try {
    const raw = localStorage.getItem(ledgerKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(uid, list) {
  try {
    localStorage.setItem(ledgerKey(uid), JSON.stringify(list));
  } catch {}
}

/** Append a "session was logged" record. Idempotent on session id. */
export function recordCardioLogged(uid, payload) {
  if (!uid) return;
  const list = readRaw(uid);
  const id = payload?.id || `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  // Replace any matching id (re-saves shouldn't duplicate); otherwise append.
  const next = list.filter((row) => row.id !== id);
  next.push({
    id,
    cardioType: payload?.cardioType || 'unknown',
    startedAt: payload?.startedAt || null,
    loggedAt: payload?.loggedAt || new Date().toISOString(),
    name: payload?.name || null,
  });
  // Prune old entries.
  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = next.filter((row) => {
    const ts = row.loggedAt ? new Date(row.loggedAt).getTime() : 0;
    return ts >= cutoff;
  });
  writeRaw(uid, fresh);
}

/** Read all ledger entries (already pruned on next write). */
export function readCardioLedger(uid) {
  return readRaw(uid);
}

/** True when the ledger has any entry newer than the given timestamp. */
export function hasCardioLoggedAfter(uid, isoOrMs) {
  if (!uid || !isoOrMs) return false;
  const cutoff = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  if (!Number.isFinite(cutoff)) return false;
  return readRaw(uid).some((row) => {
    const ts = row.loggedAt ? new Date(row.loggedAt).getTime() : 0;
    return ts > cutoff;
  });
}

/** True when any ledger entry was written in the last `windowMs`. */
export function hasRecentCardioLog(uid, windowMs = 24 * 60 * 60 * 1000) {
  if (!uid) return false;
  const cutoff = Date.now() - windowMs;
  return readRaw(uid).some((row) => {
    const ts = row.loggedAt ? new Date(row.loggedAt).getTime() : 0;
    return ts > cutoff;
  });
}
