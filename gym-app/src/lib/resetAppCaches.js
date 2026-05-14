// Nuclear cache reset — called from the stuck-loading recovery banner and
// from any future "settings → reset cache" surface. Wipes every layer that
// could be holding stale state, then hard-reloads the app.
//
// Auth tokens are PRESERVED so the user stays logged in (a logout would
// turn a frustrating-but-recoverable bug into a worse one). Everything
// else — React Query persisted cache, durable mirror, service worker
// caches, IndexedDB — gets cleared.

import { Capacitor } from '@capacitor/core';

const isNative = (() => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
})();

const isAuthKey = (k) => typeof k === 'string' && k.startsWith('sb-') && k.endsWith('-auth-token');

export async function resetAppCaches({ keepAuth = true, reload = true } = {}) {
  // 1. localStorage — preserve auth tokens, clear everything else.
  try {
    const preserved = [];
    if (keepAuth) {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const k = window.localStorage.key(i);
        if (isAuthKey(k)) {
          preserved.push([k, window.localStorage.getItem(k)]);
        }
      }
    }
    window.localStorage.clear();
    preserved.forEach(([k, v]) => {
      if (v != null) {
        try { window.localStorage.setItem(k, v); } catch { /* quota — skip */ }
      }
    });
  } catch { /* localStorage unavailable — skip */ }

  // 2. sessionStorage — full wipe (no auth here).
  try { window.sessionStorage?.clear(); } catch { /* skip */ }

  // 3. Native @capacitor/preferences — preserve auth keys (supabase mirrors
  //    its session there too via the durableStorage path).
  if (isNative) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { keys } = await Preferences.keys();
      const toRemove = (keys || []).filter((k) => !(keepAuth && isAuthKey(k)));
      await Promise.all(toRemove.map((k) => Preferences.remove({ key: k }).catch(() => {})));
    } catch { /* plugin unavailable — skip */ }
  }

  // 4. Service worker runtime caches (api-cache, storage-cache, font-files…).
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* skip */ }

  // 5. Unregister service workers — forces the next load to re-register and
  //    pick up the latest worker, in case a stale one was holding old chunks.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
  } catch { /* skip */ }

  // 6. IndexedDB databases — wipe any (used by some Supabase plugins, idb).
  try {
    if (typeof indexedDB?.databases === 'function') {
      const dbs = await indexedDB.databases();
      await Promise.all(
        (dbs || []).map((db) => new Promise((resolve) => {
          if (!db?.name) return resolve();
          const req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        })),
      );
    }
  } catch { /* skip */ }

  if (reload) {
    // Cache-bust the URL so the WebView ignores its own HTTP cache too.
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('reset', String(Date.now()));
      window.location.replace(u.toString());
    } catch {
      window.location.reload();
    }
  }
}
