import { useCallback, useEffect, useRef, useState } from 'react';
import { isAvailable as healthIsAvailable, getRecoveryMetrics } from '../lib/healthSync';
import { loadCachedRecoveryMetrics, saveCachedRecoveryMetrics } from '../lib/readinessEngine';

// Keeps the physiological recovery metrics (sleep / HRV / RHR) fresh on the
// surfaces that show the readiness score WITHOUT opening the Recovery modal —
// the Dashboard recovery chip and the WorkoutHeroCard pill.
//
// Before this hook those surfaces only read the localStorage cache
// (recovery_metrics_v1), which is written by ReadinessModal. So the home-screen
// score went stale until the user opened the modal — e.g. last night's sleep
// wouldn't show up in the morning until you tapped into Recovery. This hook
// fetches fresh metrics on mount and whenever the app returns to the foreground
// (visibilitychange — the same signal appResume uses on Capacitor + web),
// still respecting the 4h cache TTL so we don't hammer the health bridge.
//
// `refreshTrigger` (typically the Recovery modal's open state) makes the hook
// re-read the cache when it changes — so when the modal refreshes metrics and
// closes, the score picks it up without an extra fetch.
export function useRecoveryMetrics(refreshTrigger) {
  const [metrics, setMetrics] = useState(() => loadCachedRecoveryMetrics());
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const available = await healthIsAvailable();
      if (!available || !mountedRef.current) return;
      // loadCachedRecoveryMetrics() returns null once the 4h TTL lapses; a
      // cache that still holds at least one real reading short-circuits the
      // fetch (mirrors ReadinessModal's behaviour so the two can't drift).
      const cached = loadCachedRecoveryMetrics();
      const cacheHasData = cached && (
        cached.sleepHours != null || cached.hrv != null || cached.restingHR != null
      );
      if (cacheHasData) {
        if (mountedRef.current) setMetrics(cached);
        return;
      }
      const fresh = await getRecoveryMetrics();
      if (!mountedRef.current) return;
      setMetrics(fresh);
      saveCachedRecoveryMetrics(fresh);
    } catch {
      // Health bridge unavailable / denied — keep whatever we have; the score
      // gracefully falls back to training-load-only readiness.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Cheap cache re-read when the trigger flips (e.g. Recovery modal closed
  // after writing fresh metrics). Never downgrades to null — keeps last known.
  useEffect(() => {
    const cached = loadCachedRecoveryMetrics();
    if (cached) setMetrics(cached);
  }, [refreshTrigger]);

  return metrics;
}
