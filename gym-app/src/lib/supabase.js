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
//   • detectSessionInUrl: false — we don't use OAuth magic-link redirects.
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
