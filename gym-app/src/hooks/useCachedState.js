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

// Keys we have already tried to read out of localStorage. Kept separate from
// `cache` because a MISS has to be remembered too — otherwise a key that was
// never persisted would re-hit localStorage on every render.
const hydrated = new Set();

/**
 * Lazily pull ONE key out of localStorage into the in-memory map.
 * Returns true when the key is present in `cache` after the call.
 *
 * WHY LAZY: this used to be a module-load IIFE that walked the WHOLE of
 * localStorage and `JSON.parse`d every `ucs:` entry before the first paint.
 * With ~20 pages × several keys each — most of them DB row ARRAYS — that is
 * hundreds of KB of synchronous parse on every cold start, for keys belonging
 * to pages the user may never open this session. Parsing inside the
 * `useState` initializer moves that cost to first use of each key and keeps
 * the exact same synchronous-read guarantee where it actually matters.
 */
function hydrate(key) {
  if (cache.has(key)) return true;
  if (hydrated.has(key)) return false; // already checked → known miss
  hydrated.add(key);
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    // Truthiness (not `!== null`) matches the old warm-up, which skipped ''.
    if (!raw) return false;
    cache.set(key, JSON.parse(raw));
    return true;
  } catch {
    // Corrupt entry, or localStorage unavailable — behave as a cache miss and
    // fall back to in-memory only.
    return false;
  }
}

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
    // First touch of this key parses it out of localStorage; every later
    // mount reads the already-revived value straight from the Map.
    if (hydrate(key)) return reviveFromStorage(cache.get(key));
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

/**
 * Check if a cache entry exists (useful to skip loading state on re-mount).
 *
 * ~10 pages call this DURING RENDER to decide whether to show a skeleton, so
 * it must stay synchronous and truthful without the eager warm-up. It answers
 * from the Map when the key is already hydrated and otherwise does a bare
 * `getItem` existence check — deliberately NOT parsing the value (the parse is
 * the expensive part) and deliberately NOT marking the key hydrated, so a
 * later `useCachedState` still does the real read.
 */
export function hasCachedState(key) {
  if (cache.has(key)) return true;
  if (hydrated.has(key)) return false; // already read → confirmed absent
  try { return !!localStorage.getItem(`${CACHE_PREFIX}${key}`); } catch { return false; }
}

/** Clear a specific cache entry or all entries */
export function clearCachedState(key) {
  if (key) {
    cache.delete(key);
    hydrated.delete(key);
    try { localStorage.removeItem(`${CACHE_PREFIX}${key}`); } catch {}
  } else {
    cache.clear();
    hydrated.clear();
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
  // Re-read from cache on mount — picks up changes from siblings. Goes
  // through `hydrate` (not a bare `cache.has`) so a key whose FIRST touch is
  // a late `key` change still gets read out of localStorage.
  useEffect(() => {
    if (hydrate(key)) {
      const cached = reviveFromStorage(cache.get(key));
      setState(cached);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [state, setState];
}
