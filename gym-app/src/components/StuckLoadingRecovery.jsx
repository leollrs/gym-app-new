// Stuck-loading recovery banner.
//
// Some failure modes (corrupted persisted cache, partial Capgo bundle,
// service worker stuck on an old chunk) leave the app on an empty
// skeleton with no way to recover except deleting the app. This watcher
// gives the user a one-tap escape: after 10 s of the root element being
// effectively empty, a small floating banner appears at the bottom of
// the screen offering "Restablecer caché y recargar".
//
// It is intentionally conservative — only fires when the root element's
// visible text content is essentially empty, so a normal slow boot
// (auth resolve, splash → dashboard skeleton with stat cards) doesn't
// trigger a false positive.

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertTriangle, X } from 'lucide-react';
import { resetAppCaches } from '../lib/resetAppCaches';

const STUCK_THRESHOLD_MS = 10_000;
const POLL_INTERVAL_MS = 1_500;
// Anything below this many visible characters of text is considered
// "empty" — covers blank screen, lone "Loading..." spinner, etc.
const MIN_MEANINGFUL_TEXT = 60;

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

export default function StuckLoadingRecovery() {
  const [stuck, setStuck] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let pollTimer = null;
    let detected = false;

    const checkOnce = () => {
      if (detected) return;
      if (rootIsEmpty()) {
        detected = true;
        setStuck(true);
        if (pollTimer) clearInterval(pollTimer);
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
