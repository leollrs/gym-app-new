import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local');
}

// ---------------------------------------------------------------------------
// Capacitor-aware secure storage adapter for Supabase auth.
//
// On native platforms (iOS / Android), use @capacitor/preferences
// (NSUserDefaults / SharedPreferences). On web, fall through to localStorage.
// Memory map is the last-ditch fallback.
// ---------------------------------------------------------------------------

const memoryFallback = new Map();

function hasLocalStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

const isNative = (() => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
})();

const secureStorage = {
  async getItem(key) {
    if (isNative) {
      try {
        const { value } = await Preferences.get({ key });
        return value ?? null;
      } catch {
        // fall through to localStorage / memory
      }
    }
    if (hasLocalStorage()) {
      try {
        return window.localStorage.getItem(key);
      } catch { /* fall through */ }
    }
    return memoryFallback.has(key) ? memoryFallback.get(key) : null;
  },

  async setItem(key, value) {
    if (isNative) {
      try {
        await Preferences.set({ key, value });
        return;
      } catch { /* fall through */ }
    }
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch { /* fall through */ }
    }
    memoryFallback.set(key, value);
  },

  async removeItem(key) {
    if (isNative) {
      try {
        await Preferences.remove({ key });
        return;
      } catch { /* fall through */ }
    }
    if (hasLocalStorage()) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch { /* fall through */ }
    }
    memoryFallback.delete(key);
  },
};

// ---------------------------------------------------------------------------
// Auth lock — in-memory (per-tab) instead of supabase-js's default cross-tab
// Web Locks (navigator.locks).
//
// WHY: the default navigatorLock is held while our async storage adapter
// resolves the token. In React StrictMode (dev) the AuthProvider mounts →
// starts acquiring the lock → unmounts, ORPHANING it. The next acquire then
// blocks ~5s, gets force-"stolen", and throws
//   `AbortError: Lock was stolen by another request`
// which left the auth init hung and the whole app stuck on the black splash.
// (Multiple tabs amplify it, but StrictMode alone reproduces it.)
//
// A per-tab promise-chain lock serializes token refresh WITHIN the tab — which
// is all that matters for refresh races in practice (this was the supabase-js
// default for years before navigator.locks) — and can never be orphaned or
// stolen, eliminating the black-screen class of bug. Separate browser profiles
// (our admin/trainer/member test sessions) each have their own scope anyway.
const _authLocks = new Map();
async function inMemoryLock(name, _acquireTimeout, fn) {
  const prev = _authLocks.get(name) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // Next caller for this name awaits our `gate`, so calls run strictly serially.
  _authLocks.set(name, prev.then(() => gate));
  try {
    await prev;          // wait for the previous holder to release
    return await fn();
  } finally {
    release();           // hand off to the next waiter
  }
}

// Explicit auth config — these are the supabase-js defaults (except `lock`)
// pinned here so a future SDK upgrade can't silently change behavior.
//   • persistSession: keep the access + refresh tokens in storage so the user
//     stays logged in across cold-starts and offline launches.
//   • autoRefreshToken: refresh the access token in the background as it
//     nears expiry — only when online.
//   • detectSessionInUrl: false — Capacitor deep links must not be auto-parsed.
//     The password-reset email link DOES carry recovery tokens in its hash;
//     ResetPassword.jsx parses them itself and calls setSession().
//   • storage: secureStorage — Capacitor-aware adapter (native KV on device,
//     localStorage on web, in-memory as last-ditch fallback).
//   • lock: inMemoryLock — see above; avoids the navigator.locks orphan crash.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: secureStorage,
    lock: inMemoryLock,
    // NOTE: leaving storageKey as the supabase-js default so existing logged-in
    // users don't get silently signed out when this config rolls out.
  },
});

// ── Session guard for authenticated edge-function calls ──────────────────────
// Authenticated edge functions (analyze-body/food/menu-photo) validate the
// caller's JWT via supabase.auth.getUser(); an expired or missing token makes
// them return a raw 401 'Unauthorized'. Call ensureFreshSession() right before
// invoke() to proactively refresh a near-expiry token (self-heals the common
// case), and to surface a truly-dead session as a typed SESSION_EXPIRED error
// so the UI can prompt "please sign in again" instead of leaking 'Unauthorized'.
export async function ensureFreshSession() {
  let session = null;
  try {
    const { data } = await supabase.auth.getSession();
    session = data?.session ?? null;
  } catch { /* treat as no session below */ }

  // Refresh when there's no in-memory session OR the access token expires within
  // the next 60s, so the edge function never sees a missing/lapsing token. A
  // transiently-null getSession() (async native storage read, or an already-
  // expired access token) is usually salvageable via the still-valid refresh
  // token — so we attempt refreshSession() before giving up rather than throwing
  // immediately. Only a truly dead session (no refresh token) surfaces as
  // SESSION_EXPIRED.
  const expMs = (session?.expires_at || 0) * 1000;
  const needsRefresh = !session || (expMs && expMs - Date.now() < 60_000);
  if (needsRefresh) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data?.session) throw error || new Error('refresh failed');
      session = data.session;
    } catch {
      const e = new Error('SESSION_EXPIRED');
      e.code = 'SESSION_EXPIRED';
      throw e;
    }
  }

  return session;
}

// Build an `Authorization` header carrying a guaranteed-fresh access token, for
// edge functions deployed with verify_jwt=on (e.g. send-admin-email, send-sms).
// The Supabase gateway rejects a header-less request with an opaque
// `UNAUTHORIZED_NO_AUTH_HEADER` 401 *before* the function runs, so callers must
// never fall back to an empty `{}` header set. Throws SESSION_EXPIRED (see
// isSessionError) when there is no usable session, so the caller can prompt a
// re-login instead of firing a request the gateway will bounce.
export async function authHeader() {
  const session = await ensureFreshSession();
  return { Authorization: `Bearer ${session.access_token}` };
}

// supabase.functions.invoke throws a FunctionsHttpError on a non-2xx response
// but does not read the body — `.context` is the raw Response. Pull the edge
// function's `{ error }` / `{ message }` out of it so call sites can show the
// real reason (e.g. "testMode can only send to your own email address") instead
// of a generic failure. Returns null when there's no readable JSON body.
export async function readFunctionError(err) {
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      return body?.error || body?.message || null;
    }
  } catch { /* body absent, already consumed, or not JSON */ }
  return null;
}

// True when an error is an auth/session failure — either our typed
// SESSION_EXPIRED (from ensureFreshSession) or a raw 'Unauthorized' bubbled up
// from an edge-function 401. Lets call sites show one friendly re-login message.
export function isSessionError(err) {
  const m = err?.message;
  return err?.code === 'SESSION_EXPIRED' || m === 'SESSION_EXPIRED' || m === 'Unauthorized';
}
