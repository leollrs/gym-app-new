import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Persistent session cache that survives component unmount/remount AND app
 * restarts. Backed by an in-memory Map (hot reads) + localStorage (cold reads).
 *
 * Why not sessionStorage? On iOS Capacitor WebViews sessionStorage is cleared
 * when the OS kills the app, so users who force-quit and reopen still saw
 * skeleton loading states. localStorage survives the kill.
 *
 * Usage — swap `useState(null)` → `useCachedState('page-key', null)`:
 *   const [data, setData] = useCachedState('profile-sessions', null);
 *
 * On first EVER mount:  returns initialValue (cache miss → page fetches as normal).
 * On re-mount:          returns cached value instantly (no loader flash).
 * On app cold-start:    returns cached value from localStorage.
 * When setData is called: in-memory cache, localStorage, and React state update together.
 */

const CACHE_PREFIX = 'ucs:';
const cache = new Map();

// Warm the in-memory map from localStorage on module load so the first render
// of every `useCachedState(...)` call sees the persisted value synchronously.
(() => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (raw) cache.set(k.slice(CACHE_PREFIX.length), JSON.parse(raw));
      } catch { /* corrupt entry — skip */ }
    }
  } catch { /* localStorage unavailable — fall back to in-memory only */ }
})();

const persistToStorage = (key, value) => {
  try {
    // Handle Set/Map by falling back to array form — JSON can't represent them
    if (value instanceof Set) {
      localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({ __set: [...value] }));
      return;
    }
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch { /* quota exceeded — keep in-memory only */ }
};

const reviveFromStorage = (value) => {
  if (value && typeof value === 'object' && Array.isArray(value.__set)) return new Set(value.__set);
  return value;
};

export function useCachedState(key, initialValue) {
  const [state, setState] = useState(() => {
    if (cache.has(key)) return reviveFromStorage(cache.get(key));
    return initialValue;
  });

  // Stable reference to the key for the setter
  const keyRef = useRef(key);
  keyRef.current = key;

  const setCachedState = useCallback((value) => {
    setState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      cache.set(keyRef.current, next);
      persistToStorage(keyRef.current, next);
      return next;
    });
  }, []);

  return [state, setCachedState];
}

/** Check if a cache entry exists (useful to skip loading state on re-mount) */
export function hasCachedState(key) {
  return cache.has(key);
}

/** Clear a specific cache entry or all entries */
export function clearCachedState(key) {
  if (key) {
    cache.delete(key);
    try { localStorage.removeItem(`${CACHE_PREFIX}${key}`); } catch {}
  } else {
    cache.clear();
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(CACHE_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
  }
}

/**
 * Hook variant that re-syncs the in-memory map back into state on mount —
 * useful for components that mount after the cache was mutated by a different
 * component that used the same key.
 */
export function useSyncedCachedState(key, initialValue) {
  const [state, setState] = useCachedState(key, initialValue);
  // Re-read from cache on mount — picks up changes from siblings
  useEffect(() => {
    if (cache.has(key)) {
      const cached = reviveFromStorage(cache.get(key));
      setState(cached);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [state, setState];
}
