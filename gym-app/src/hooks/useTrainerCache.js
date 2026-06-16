// Lightweight in-memory cache for trainer pages.
//
// Trainer pages fetch with raw useEffect + useState, so every time you navigate
// away and back they refetch from scratch and flash a spinner. This module
// keeps the last-fetched data in a process-level Map so a revisit can render
// INSTANTLY from cache, then refresh in the background (stale-while-revalidate).
//
// Usage in a page (keep loading bespoke per page):
//   import { cacheGet, cacheSet, cacheHas, trainerKey } from '../../hooks/useTrainerCache';
//   const CK = trainerKey('plans', profile?.id);
//   const [plans, setPlans]   = useState(() => cacheGet(CK) ?? []);
//   const [loading, setLoading] = useState(() => !cacheHas(CK));
//   ... after fetch:
//   setPlans(data); cacheSet(CK, data); setLoading(false);
//
// Keys MUST be scoped to the trainer (use trainerKey) so one account's data
// never bleeds into another within the same JS session.

const _store = new Map();

export const cacheGet = (key) => _store.get(key);
export const cacheSet = (key, val) => { if (key) _store.set(key, val); };
export const cacheHas = (key) => _store.has(key);
export const cacheClear = (key) => { if (key) _store.delete(key); else _store.clear(); };

// Build a stable, user-scoped cache key. `trainerKey('plans', uid)` →
// "trainer:plans:<uid>". Falls back to "anon" when no id is available yet.
export const trainerKey = (name, uid) => `trainer:${name}:${uid || 'anon'}`;
