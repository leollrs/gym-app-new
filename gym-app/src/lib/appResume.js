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

// After this long away, a failed soft recovery earns a hard webview reload —
// the automated version of the manual kill-and-reopen the wedged network
// stack otherwise forces on the user.
const HARD_RELOAD_AFTER_MS = 3 * 60_000;

// invalidateQueries() only reaches React Query data — pages that fetch with
// their own useEffect/useState only load on MOUNT, so after a long absence
// they'd paint stale forever ("some pages aren't reloading"). After this long
// genuinely HIDDEN (not just window blur — a visible second-monitor tab must
// not lose form state), App.jsx remounts the routed page via the epoch event
// below, which re-runs every page's own load logic regardless of how it
// fetches. Threshold is generous so a half-filled admin form doesn't get
// wiped by a quick app-switch; drafts that matter (ActiveSession) persist by
// design and restore on remount.
const REMOUNT_AFTER_MS = 15 * 60_000;
let hiddenAt = null;

/** Non-destructive realtime nudge. disconnect() would tear down channel
 *  bindings (components would rejoin deaf); instead:
 *    • socket closed → connect() rejoins all existing channels
 *    • socket open-but-zombie → sendHeartbeat() notices the unanswered
 *      prior heartbeat and forces a clean reconnect. */
function wakeRealtime() {
  try {
    if (!supabase.realtime.isConnected()) {
      supabase.realtime.connect();
    } else {
      supabase.realtime.sendHeartbeat();
    }
  } catch { /* best-effort nudge */ }
}

/** Obtain a session whose access token is actually USABLE (≥15s of life),
 *  waiting out the post-resume hang in bounded steps.
 *
 *  Why a loop: after hours in background the token is expired and the first
 *  refresh fetch often hangs on a dead half-open connection (WKWebView can
 *  sit ~60s before timing out). getSession() joins that hung refresh, so a
 *  single race-with-timeout learns nothing. Re-checking on a cadence both
 *  joins the in-flight refresh (auth-js dedupes) and picks up the moment it
 *  lands. Returns:
 *    session     → usable token in hand
 *    'signed_out'→ clean "no session" (logout elsewhere) — caller bails
 *    null        → budget exhausted, network stack presumed wedged */
async function resolveFreshSession(budgetMs = 12_000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    let timedOut = false;
    const res = await Promise.race([
      supabase.auth.getSession(),
      new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, 4000)),
    ]).catch(() => null);

    if (!timedOut && res) {
      const s = res.data?.session;
      if (s && (!s.expires_at || s.expires_at * 1000 > Date.now() + 15_000)) return s;
      // Clean result, no session, no error → genuinely signed out. (With an
      // error it's a transient refresh failure — keep trying.)
      if (!s && !res.error) return 'signed_out';
      // Expired session / refresh error → explicit refresh attempt.
      const r2 = await Promise.race([
        supabase.auth.refreshSession(),
        new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
      ]).catch(() => null);
      const s2 = r2?.data?.session;
      if (s2 && (!s2.expires_at || s2.expires_at * 1000 > Date.now() + 15_000)) return s2;
    }

    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** Run the recovery routine if we were away long enough. Safe to call from
 *  multiple signals — only the first call after a real background does work;
 *  the rest see `backgroundedAt == null` and no-op.
 *
 *  ORDER MATTERS (the old version got it wrong): it pushed whatever token it
 *  had into realtime and refetched IMMEDIATELY, even when getSession() had
 *  timed out with the token already expired — so every refetch 401'd, the
 *  channels rejoined with a dead JWT, and when the hung refresh finally
 *  landed nothing re-ran. That's the "fine after killing the app, broken
 *  until then" bug. Now: nudge the socket, WAIT for a usable token (bounded),
 *  then sync auth + refetch — and if no token is obtainable after a long
 *  absence, hard-reload the webview, which is what the user would do by hand. */
export async function notifyForeground(queryClient) {
  const awayFor = backgroundedAt == null ? 0 : Date.now() - backgroundedAt;
  backgroundedAt = null;
  const hiddenFor = hiddenAt == null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  if (awayFor < STALE_AFTER_MS) return;

  // 1. Nudge the socket immediately — independent of auth, and the TCP
  //    round-trip doubles as a wake-up call for the dead connection pool.
  wakeRealtime();

  // 2. Get a token that will actually be accepted.
  const session = await resolveFreshSession();
  if (session === 'signed_out') return; // AuthContext owns the redirect

  if (session) {
    // 3. Push the fresh JWT to (re)joined channels, re-nudge, then refetch.
    try { supabase.realtime.setAuth(); } catch { /* best-effort */ }
    wakeRealtime();
    // 3b. Long hidden spell → remount the routed page (App.jsx listens and
    //     re-keys <Routes>) so non-React-Query pages reload too. Fired only
    //     with a fresh token in hand, so the remount's fetches succeed.
    if (hiddenFor >= REMOUNT_AFTER_MS) {
      try { window.dispatchEvent(new CustomEvent('tugympr:resume-remount')); } catch { /* ignore */ }
    }
  } else if (awayFor >= HARD_RELOAD_AFTER_MS && document.visibilityState === 'visible') {
    // Soft recovery failed after a real absence: the network stack is the
    // wedged kind that only a restart clears. Reload the webview — boot
    // restores cached state + drafts, and a loop guard keeps this to once
    // per 2 minutes.
    let lastReload = 0;
    try { lastReload = Number(sessionStorage.getItem('__resume_reload__') || 0); } catch { /* ignore */ }
    if (Date.now() - lastReload > 120_000) {
      try { sessionStorage.setItem('__resume_reload__', String(Date.now())); } catch { /* ignore */ }
      window.location.reload();
      return;
    }
  }
  // (Short absence with no token: fall through — refetches may 401 but the
  //  next resume or the auth listener picks it up; better than a reload.)

  // 4. Reload data. invalidateQueries() marks everything stale → active
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
    if (document.visibilityState === 'hidden') {
      // hiddenAt feeds the remount threshold — tracked ONLY from real
      // visibility loss, never from window blur (see REMOUNT_AFTER_MS note).
      if (hiddenAt == null) hiddenAt = Date.now();
      notifyBackground();
    } else {
      notifyForeground(queryClient);
    }
  });
  window.addEventListener('blur', notifyBackground);
  window.addEventListener('focus', () => notifyForeground(queryClient));
}
