// Durable storage mirror for iOS/Android Capacitor builds.
//
// iOS WKWebView (and to a lesser extent Android WebView) can evict localStorage
// under memory pressure — quota is small (5–10 MB) and there's no warning. The
// React Query persisted cache + active workout drafts together can blow past
// that, triggering eviction that wipes:
//   - gym_session_<routineId>      → in-progress workout draft
//   - tugympr-query-cache          → React Query persisted cache (dashboard, etc.)
//   - offline_profile / offline_gym → cold-start hydration data
//   - offline_branding             → cached gym accent/surface colors
//
// Strategy: keep localStorage as the fast sync read cache, mirror critical keys
// to @capacitor/preferences (NSUserDefaults / SharedPreferences — never evicted).
// On boot, hydrate localStorage from preferences before React mounts. On
// background/pagehide, flush localStorage back to preferences so the latest
// state is durable.
//
// On web, every function is a no-op — localStorage is the source of truth and
// has its own (much larger) quota.

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const isNative = (() => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
})();

const TRACKED_PREFIXES = ['gym_session_', 'gym_rest_'];
// offline_branding holds the resolved gym accent/surface colors. It MUST be
// durable: without it, an iOS localStorage eviction while the app is backgrounded
// wipes the colors (but NOT offline_profile/offline_gym, which are restored from
// Preferences) — so the next resume boots on the default amber palette until the
// network round-trip lands, and only a full close+reopen fixes it. Tracking it
// here means the background flush mirrors it and the boot hydrate restores it,
// so the gym's colors paint on the very first frame after every resume.
const TRACKED_EXACT = new Set(['tugympr-query-cache', 'offline_profile', 'offline_gym', 'offline_branding']);

const isTracked = (key) => {
  if (!key) return false;
  if (TRACKED_EXACT.has(key)) return true;
  return TRACKED_PREFIXES.some((p) => key.startsWith(p));
};

// Cached promise so any async code can `await hydrationPromise` and trust that
// localStorage has been seeded before reading. Resolves to undefined.
let hydrationPromise = null;

// Copy any tracked keys from preferences (durable) into localStorage (sync read
// cache). Must complete before React mounts so first render of ActiveSession
// or the React Query persister sees the hydrated state. No-op on web.
// Idempotent — calling twice returns the same in-flight promise.
export function hydrateFromDurable() {
  if (!isNative) return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      const { keys } = await Preferences.keys();
      if (!Array.isArray(keys)) return;
      const tracked = keys.filter(isTracked);
      await Promise.all(
        tracked.map(async (key) => {
          try {
            const { value } = await Preferences.get({ key });
            if (typeof value === 'string') {
              try { window.localStorage.setItem(key, value); } catch { /* localStorage full — skip */ }
            }
          } catch { /* per-key failure — skip */ }
        }),
      );
    } catch { /* preferences plugin failure — silently fall back */ }
  })();
  return hydrationPromise;
}

// Await this anywhere that needs to read localStorage during cold boot. Returns
// a resolved promise on web (no hydration required).
export const whenHydrated = () => (isNative ? hydrateFromDurable() : Promise.resolve());

// Flush all tracked keys from localStorage back to preferences. Run on
// pagehide / visibilitychange:hidden / Capacitor appStateChange:!isActive so
// the OS can suspend the WebView without losing recent writes.
export async function flushToDurable() {
  if (!isNative) return;
  try {
    const localKeys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (isTracked(k)) localKeys.push(k);
    }
    await Promise.all(
      localKeys.map(async (key) => {
        try {
          const value = window.localStorage.getItem(key);
          if (value === null) {
            await Preferences.remove({ key });
          } else {
            await Preferences.set({ key, value });
          }
        } catch { /* per-key failure — skip */ }
      }),
    );
  } catch { /* plugin failure — silently fall back */ }
}

// Mirror a single write to durable storage. Fire-and-forget; preferences plugin
// is fast (NSUserDefaults / SharedPreferences are in-memory + lazy-disk). Use
// when a single hot-path write needs guaranteed durability before the next
// flush event (e.g. completed-set persistence).
export function mirrorToDurable(key, value) {
  if (!isNative || !isTracked(key)) return;
  Preferences.set({ key, value }).catch(() => {});
}

export function removeDurable(key) {
  if (!isNative || !isTracked(key)) return;
  Preferences.remove({ key }).catch(() => {});
}
