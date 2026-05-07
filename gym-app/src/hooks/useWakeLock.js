import { useEffect, useRef } from 'react';

// Keep the screen awake while a workout / cardio session is active.
//
// Uses the Web Screen Wake Lock API (navigator.wakeLock). Supported on:
//   • iOS 16.4+ (WKWebView, our deployment target is iOS 16.2+ so most users covered)
//   • Android Chrome 84+ (Capacitor uses system WebView on API 26+)
//   • Modern desktop browsers
//
// The browser auto-releases the lock when the page is hidden (tab switch,
// app background). We re-acquire on visibilitychange when `enabled` is still
// true, so screen-off won't kick in mid-set if the user briefly checks
// notifications and comes back.
//
// On unsupported platforms this hook is a no-op — the workout still tracks
// fine, the screen just dims as usual.
export function useWakeLock(enabled) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;

    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        sentinelRef.current = lock;
        // The browser may release the lock at any time (low battery, etc.) —
        // null out our ref so visibilitychange can re-acquire.
        lock.addEventListener('release', () => {
          if (sentinelRef.current === lock) sentinelRef.current = null;
        });
      } catch {
        // User gesture not yet provided, doc not visible, or denied — silent.
      }
    };

    const onVisibility = () => {
      if (!enabled || cancelled) return;
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        acquire();
      }
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
      }
    };
  }, [enabled]);
}
