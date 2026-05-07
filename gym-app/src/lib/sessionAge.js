// Session age tracking — used to enforce a hard maximum session lifetime
// regardless of supabase token refresh behavior. If the user's session
// timestamp exceeds the configured max, we force a sign-out + re-auth.
//
// Storage: localStorage key `tugympr_session_created_at` holds a numeric
// millisecond timestamp set on SIGNED_IN.

const KEY = 'tugympr_session_created_at';

export function getSessionCreatedAt() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function setSessionCreatedAt(ts = Date.now()) {
  try {
    localStorage.setItem(KEY, String(ts));
  } catch { /* quota / private mode */ }
}

export function clearSessionCreatedAt() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* noop */ }
}

export function isSessionExpired(maxMs) {
  const createdAt = getSessionCreatedAt();
  if (!createdAt) return false; // unknown — don't force expiry
  return (Date.now() - createdAt) > maxMs;
}
