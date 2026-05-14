// Stuck-loading recovery watcher.
//
// Some failure modes leave the app on an empty skeleton with no way to
// recover except deleting the app: a service worker stuck on an old
// chunk, a partial Capgo bundle, a corrupted persisted React Query
// cache, or WKWebView HTTP-cache staleness that survives a reinstall
// (the data container is NOT wiped by `devicectl install` — only by a
// full delete-and-reinstall).
//
// Behaviour:
//   1. After 10 s of the #root element being effectively empty, we
//      consider the app stuck.
//   2. FIRST time stuck → auto-recover: resetAppCaches() wipes every
//      cache layer (keeping auth) and hard-reloads with a
//      `?reset=<timestamp>` cache-buster.
//   3. If we come back and we're STILL stuck — detected via that recent
//      `?reset=` param in the URL — we do NOT auto-recover again (that
//      would loop). Instead we show a one-tap manual recovery banner.
//
// The `?reset=` param lives in the URL, so it survives resetAppCaches()
// clearing localStorage/sessionStorage — that's why it's a reliable
// loop guard.
//
// Detection is intentionally conservative: it only fires when #root has
// essentially no visible text, so a normal slow boot (auth resolve,
// splash → dashboard skeleton with stat cards) never trips it.

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, AlertTriangle, X } from 'lucide-react';
import { resetAppCaches } from '../lib/resetAppCaches';

const STUCK_THRESHOLD_MS = 10_000;
const POLL_INTERVAL_MS = 1_500;
// Anything below this many visible characters of text is considered
// "empty" — covers blank screen, lone "Loading..." spinner, etc.
const MIN_MEANINGFUL_TEXT = 60;
// If resetAppCaches reloaded us within this window and we're STILL stuck,
// a second auto-recovery would just loop — fall back to the manual banner.
const AUTO_RECOVERY_COOLDOWN_MS = 120_000;

function rootIsEmpty() {
  const root = document.getElementById('root');
  if (!root) return true;
  // Use innerText so hidden / collapsed nodes don't count.
  const text = (root.innerText || root.textContent || '').trim();
  if (text.length < MIN_MEANINGFUL_TEXT) return true;
  // Common loading-only signatures
  if (/^(loading|cargando|\.\.\.|\s)+$/i.test(text)) return true;
  return false;
}

// resetAppCaches() reloads with `?reset=<Date.now()>`. If that param is
// recent, we already auto-recovered once and it didn't take — so a second
// auto-reset would loop. Read from window.location (survives the storage
// wipe because it lives in the URL, not localStorage).
function alreadyAutoRecovered() {
  try {
    const v = new URL(window.location.href).searchParams.get('reset');
    if (!v) return false;
    const ts = parseInt(v, 10);
    return Number.isFinite(ts) && (Date.now() - ts) < AUTO_RECOVERY_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export default function StuckLoadingRecovery() {
  const [stuck, setStuck] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [autoRecovering, setAutoRecovering] = useState(false);
  const handledRef = useRef(false);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await resetAppCaches();
    } catch {
      // resetAppCaches always reloads internally; if we get here it failed
      // before reload — force a hard reload anyway.
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    let pollTimer = null;
    let detected = false;

    const onStuck = () => {
      if (handledRef.current) return;
      handledRef.current = true;
      if (pollTimer) clearInterval(pollTimer);

      if (alreadyAutoRecovered()) {
        // Auto-reset already ran and we're still on an empty screen —
        // don't loop. Surface the manual one-tap banner instead.
        setStuck(true);
      } else {
        // First detection — wipe caches and hard-reload automatically.
        // resetAppCaches() reloads with a `?reset=<ts>` cache-buster, which
        // is also our loop guard on the next pass.
        setAutoRecovering(true);
        resetAppCaches().catch(() => { window.location.reload(); });
      }
    };

    const checkOnce = () => {
      if (detected) return;
      if (rootIsEmpty()) {
        detected = true;
        onStuck();
      }
    };

    // First check after the threshold; then keep polling slowly in case the
    // app rendered a partial UI that crashed mid-render shortly after.
    const initial = setTimeout(() => {
      checkOnce();
      if (!detected) {
        pollTimer = setInterval(checkOnce, POLL_INTERVAL_MS);
      }
    }, STUCK_THRESHOLD_MS);

    return () => {
      clearTimeout(initial);
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  // Brief full-screen overlay while the auto-recovery reload is in flight,
  // so the user sees "we're fixing it" instead of a blank screen.
  if (autoRecovering) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999999,
          background: '#05070B',
          color: '#E5E7EB',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          fontFamily: "'Archivo','Familjen Grotesk',system-ui,sans-serif",
          padding: 24,
          textAlign: 'center',
        }}
      >
        <RefreshCw size={28} className="animate-spin" style={{ color: '#D4AF37' }} />
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#FFFFFF' }}>
          Reiniciando la app…
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF', maxWidth: 280, lineHeight: 1.4 }}>
          Limpiando la caché y volviendo a cargar. Tu sesión se mantiene.
        </p>
      </div>
    );
  }

  if (!stuck || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        zIndex: 999999,
        display: 'flex',
        justifyContent: 'center',
        padding: '0 16px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          maxWidth: 420,
          width: '100%',
          background: '#0F172A',
          color: '#E5E7EB',
          border: '1px solid rgba(212,175,55,0.35)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          borderRadius: 16,
          padding: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontFamily: "'Archivo','Familjen Grotesk',system-ui,sans-serif",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'rgba(245,158,11,0.15)',
            color: '#F59E0B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#FFFFFF' }}>
            ¿La app se quedó cargando?
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#9CA3AF', lineHeight: 1.35 }}>
            Limpia la caché y vuelve a cargar. Tu sesión se mantiene.
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          style={{
            background: '#D4AF37',
            color: '#000',
            border: 'none',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: resetting ? 0.6 : 1,
            flexShrink: 0,
          }}
        >
          <RefreshCw size={13} className={resetting ? 'animate-spin' : ''} />
          {resetting ? 'Limpiando…' : 'Restablecer'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Cerrar"
          style={{
            background: 'transparent',
            color: '#9CA3AF',
            border: 'none',
            borderRadius: 8,
            padding: 6,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
