import { supabase } from './supabase';

// ───────────────────────────────────────────────────────────────────────────
// App-resume recovery
//
// THE BUG: when the OS suspends the app (member phone locked, admin/front-desk
// window sent to tray, browser tab backgrounded), three things silently rot
// while we're frozen:
//
//   1. The Supabase realtime websocket dies. iOS often delivers NO `close`
//      event on resume, leaving a "zombie" socket — `readyState` still reads
//      open but the TCP conn is dead, so live updates (notifications, reward
//      claims, challenges, DMs) never arrive again until a full app restart.
//   2. The access token expires. supabase-js pauses its auto-refresh timer
//      while hidden, so on resume the token can already be stale.
//   3. React Query has `refetchOnWindowFocus: false` (see main.jsx), so coming
//      back to the foreground does NOT refetch — every screen keeps painting
//      whatever it had before we were suspended. This is the "doesn't reload,
//      had to close and reopen the app" symptom.
//
// THE FIX: one resume handler that, after a meaningful time in the background,
// refreshes the token, wakes realtime WITHOUT tearing channels down, and marks
// all cached queries stale so the visible screens refetch.
//
// Why not just flip refetchOnWindowFocus to true? That refetches on every
// trivial focus and was deliberately disabled. Gating on "were we actually
// backgrounded long enough" keeps quick app-switches free.
// ───────────────────────────────────────────────────────────────────────────

// Don't bother healing for a quick app-switch / notification-shade peek — the
// socket and token are still fine. Only run the routine after a real absence.
const STALE_AFTER_MS = 10_000;

let backgroundedAt = null;
let installed = false;

/** Mark the moment we left the foreground. Idempotent across overlapping
 *  signals (visibilitychange + Capacitor appStateChange can both fire). */
export function notifyBackground() {
  if (backgroundedAt == null) backgroundedAt = Date.now();
}

/** Run the recovery routine if we were away long enough. Safe to call from
 *  multiple signals — only the first call after a real background does work;
 *  the rest see `backgroundedAt == null` and no-op. */
export async function notifyForeground(queryClient) {
  const awayFor = backgroundedAt == null ? 0 : Date.now() - backgroundedAt;
  backgroundedAt = null;
  if (awayFor < STALE_AFTER_MS) return;

  // 1. Refresh auth. getSession() transparently refreshes the access token
  //    when it's within the expiry margin, and emits TOKEN_REFRESHED — which
  //    makes supabase-js push the new JWT into the realtime client. If we're
  //    offline this throws/returns no session; leave auth alone and let the
  //    existing online/retry effects in AuthContext recover.
  let hasSession = true;
  try {
    const { data } = await supabase.auth.getSession();
    hasSession = !!data?.session;
  } catch {
    return;
  }
  // No live session (signed out elsewhere, or refresh token revoked). Don't
  // touch realtime/queries — AuthContext's onAuthStateChange + 401 guard own
  // the sign-out path.
  if (!hasSession) return;

  // 2. Wake realtime — NON-destructively. supabase.realtime.disconnect() would
  //    call channel.teardown() and wipe every channel's bindings, so the
  //    component-owned channels would rejoin deaf. Instead:
  //      • socket genuinely closed → connect() rejoins all existing channels
  //        (a natural close preserves bindings; only disconnect() clears them)
  //      • socket looks open but is a zombie → sendHeartbeat() sees the
  //        unanswered prior heartbeat and forces a clean reconnect.
  //    setAuth() makes sure the (re)joined channels carry the fresh JWT.
  try {
    supabase.realtime.setAuth();
    if (!supabase.realtime.isConnected()) {
      supabase.realtime.connect();
    } else {
      supabase.realtime.sendHeartbeat();
    }
  } catch { /* best-effort nudge */ }

  // 3. Reload data. invalidateQueries() marks everything stale → active
  //    (mounted) queries refetch in the background; inactive ones refetch on
  //    their next mount. placeholderData:prev (main.jsx) keeps the current UI
  //    painted during the refetch, so there's no spinner flash.
  try {
    queryClient.invalidateQueries();
  } catch { /* queryClient unavailable — nothing to refresh */ }
}

/**
 * Install the resume listeners once, at app bootstrap. Pass the app's
 * QueryClient so the handler can invalidate on resume.
 *
 * Covers every surface with one set of listeners:
 *   • Capacitor iOS/Android WebView and plain web → visibilitychange
 *   • Desktop / Tauri front-desk window (incl. restore-from-tray, where
 *     visibilitychange is unreliable) → window focus/blur
 * The Capacitor-native `appStateChange` signal also calls notifyBackground/
 * notifyForeground from main.jsx for belt-and-suspenders coverage.
 */
export function installAppResume(queryClient) {
  if (installed) return; // HMR / double-mount guard
  installed = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') notifyBackground();
    else notifyForeground(queryClient);
  });
  window.addEventListener('blur', notifyBackground);
  window.addEventListener('focus', () => notifyForeground(queryClient));
}
