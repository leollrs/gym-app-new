import { useEffect, useRef, useState } from 'react';
import { X, Camera, Flashlight, FlashlightOff, Dumbbell } from 'lucide-react';

// The machine-QR scanner screen — html5-qrcode → getUserMedia, running inside
// the WebView on EVERY platform (web, desktop, and native via Capacitor).
//
// Native could use @capacitor-mlkit's `scan()` instead, but that hides the
// WebView and renders an unstyleable system viewfinder: a bare square and a
// torch button, with nothing telling you what you're pointing at or why. Doing
// it in the WebView costs us nothing (MLKit still raises the OS permission
// prompt beforehand) and buys a screen that explains itself.
//
// onDecode(rawValue) MUST return true when it consumed the code (the modal then
// closes) or false when the code isn't recognized (a transient notice shows and
// scanning continues so the user can try another tag).

const ACCENT = 'var(--color-accent, #D4AF37)';

// Viewfinder edge, in px. Derived from the viewport so it stays proportional on
// a small phone, and reused as the html5-qrcode decode box so the region we
// draw is the region that actually decodes.
function frameSize() {
  if (typeof window === 'undefined') return 264;
  const minEdge = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(180, Math.min(264, Math.round(minEdge * 0.68)));
}

// Four corner brackets + a sweeping laser. Purely decorative — never eats taps.
function Viewfinder({ size }) {
  const arm = Math.round(size * 0.22);
  const corner = (pos) => {
    const isTop = pos.includes('t');
    const isLeft = pos.includes('l');
    return (
      <span
        key={pos}
        style={{
          position: 'absolute',
          [isTop ? 'top' : 'bottom']: -2,
          [isLeft ? 'left' : 'right']: -2,
          width: arm, height: arm,
          borderColor: ACCENT,
          borderStyle: 'solid',
          borderWidth: 0,
          [isTop ? 'borderTopWidth' : 'borderBottomWidth']: 3,
          [isLeft ? 'borderLeftWidth' : 'borderRightWidth']: 3,
          [`border${isTop ? 'Top' : 'Bottom'}${isLeft ? 'Left' : 'Right'}Radius`]: 18,
        }}
      />
    );
  };
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* Cut-out: everything outside the frame is dimmed by a huge shadow. */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 20, boxShadow: '0 0 0 100vmax rgba(4,6,10,0.62)' }} />
      {['tl', 'tr', 'bl', 'br'].map(corner)}
      <div className="tt-qr-laser" style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)` }} />
    </div>
  );
}

export default function WebQrScanModal({ open, onClose, onDecode, spanish = false, title }) {
  const [error, setError] = useState('');       // fatal (permission / no camera)
  const [notice, setNotice] = useState('');     // transient (unrecognized code)
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchable, setTorchable] = useState(false);
  const [size, setSize] = useState(frameSize);
  const qrRef = useRef(null);
  const doneRef = useRef(false);
  const noticeTimer = useRef(null);

  const stop = () => {
    const inst = qrRef.current;
    qrRef.current = null;
    if (inst) {
      try {
        const p = inst.stop();
        if (p && p.then) p.then(() => { try { inst.clear(); } catch { /* noop */ } }).catch(() => {});
      } catch { /* already stopped */ }
    }
  };

  const close = () => { stop(); onClose?.(); };

  // Torch is only offered when the running video track actually reports the
  // capability — older iOS WebViews don't expose it, and a dead button is worse
  // than no button.
  const toggleTorch = async () => {
    const inst = qrRef.current;
    if (!inst) return;
    const next = !torchOn;
    try {
      await inst.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchable(false);
    }
  };

  const start = async () => {
    setError('');
    setNotice('');
    setStarting(true);
    setTorchOn(false);
    setTorchable(false);
    doneRef.current = false;
    const box = frameSize();
    setSize(box);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      // Let the #reader div mount first.
      await new Promise((r) => setTimeout(r, 80));
      if (!document.getElementById('equip-qr-reader')) return;
      const inst = new Html5Qrcode('equip-qr-reader', { verbose: false });
      qrRef.current = inst;
      await inst.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: box, height: box } },
        (decodedText) => {
          if (doneRef.current) return; // ignore rapid repeat callbacks after a hit
          const handled = onDecode?.(decodedText);
          if (handled) {
            doneRef.current = true;
            close();
          } else {
            setNotice(spanish ? 'Ese código no corresponde a una máquina.' : "That code isn't a recognized machine tag.");
            clearTimeout(noticeTimer.current);
            noticeTimer.current = setTimeout(() => setNotice(''), 2500);
          }
        },
        () => { /* per-frame decode failures are normal — ignore */ },
      );
      setStarting(false);
      try { setTorchable(!!inst.getRunningTrackCapabilities?.()?.torch); } catch { /* not supported */ }
    } catch (err) {
      setStarting(false);
      const msg = String(err?.message || err || '');
      if (/permission|denied|NotAllowed/i.test(msg)) {
        setError(spanish ? 'Permiso de cámara denegado. Actívalo en Ajustes e inténtalo de nuevo.' : 'Camera permission denied. Allow it in Settings and try again.');
      } else if (/NotFound|no camera|Requested device|NotReadable|in use/i.test(msg)) {
        setError(spanish ? 'No se encontró una cámara disponible en este dispositivo.' : 'No available camera found on this device.');
      } else if (/secure|https/i.test(msg)) {
        setError(spanish ? 'La cámara requiere una conexión segura (https).' : 'Camera access requires a secure (https) connection.');
      } else {
        setError(spanish ? 'No se pudo iniciar la cámara.' : "Couldn't start the camera.");
      }
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    start();
    return () => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(noticeTimer.current);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const heading = title || (spanish ? 'Escanear máquina' : 'Scan a machine');
  const topPad = 'max(18px, env(safe-area-inset-top, 18px))';

  return (
    <div className="fixed inset-0 z-[120]" style={{ background: '#05070B', overflow: 'hidden' }}>
      {/* Live camera — fills the screen behind everything. */}
      {!error && <div id="equip-qr-reader" />}

      {/* Viewfinder + its surrounding dim. Sits above the camera, below the UI. */}
      {!error && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <Viewfinder size={size} />
        </div>
      )}

      {/* Top bar — close · what-this-is pill · torch */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: `${topPad} 14px 0`,
      }}>
        <button
          onClick={close}
          aria-label={spanish ? 'Cerrar' : 'Close'}
          className="w-11 h-11 flex items-center justify-center rounded-full active:scale-90 transition-transform"
          style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', backdropFilter: 'blur(8px)', flexShrink: 0 }}
        >
          <X size={18} />
        </button>
        <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-full"
          style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(8px)' }}>
          <Dumbbell size={13} strokeWidth={2.6} style={{ color: ACCENT }} />
          {/* NOT `text-white`: index.css:737 force-overrides that class to dark
              text in LIGHT mode for anything inside .app-wrapper (with
              !important). This overlay is always dark — a live camera feed — so
              the class turned the labels dark-on-dark. Inline colour sidesteps
              the rule entirely because the selector no longer matches. */}
          <span className="text-[12.5px] font-extrabold" style={{ color: '#fff', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{heading}</span>
        </div>
        {torchable ? (
          <button
            onClick={toggleTorch}
            aria-label={spanish ? 'Linterna' : 'Flashlight'}
            aria-pressed={torchOn}
            className="w-11 h-11 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            style={{
              background: torchOn ? ACCENT : 'rgba(255,255,255,0.10)',
              border: `1px solid ${torchOn ? ACCENT : 'rgba(255,255,255,0.14)'}`,
              color: torchOn ? 'var(--color-text-on-accent, #000)' : '#fff',
              backdropFilter: 'blur(8px)', flexShrink: 0,
            }}
          >
            {torchOn ? <Flashlight size={18} /> : <FlashlightOff size={18} />}
          </button>
        ) : <span className="w-11 h-11" style={{ flexShrink: 0 }} />}
      </div>

      {/* Error state replaces the whole camera surface. */}
      {error ? (
        <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center px-8">
          <Camera size={40} style={{ color: '#6B7280' }} className="mb-4" />
          <p className="text-[14px] text-center mb-6" style={{ color: '#EF4444', maxWidth: 320 }}>{error}</p>
          <button
            onClick={start}
            className="px-6 py-2.5 rounded-xl text-[13px] font-bold active:scale-[0.97] transition-transform"
            style={{ background: ACCENT, color: 'var(--color-text-on-accent, #000)', border: 'none' }}
          >
            {spanish ? 'Reintentar' : 'Try again'}
          </button>
        </div>
      ) : (
        /* Below the frame: say what this does and what you get out of it. The
           old screen showed a bare square with no context at all. */
        <div style={{
          position: 'absolute', left: 0, right: 0, zIndex: 4,
          top: `calc(50% + ${Math.round(size / 2)}px + 34px)`,
          padding: '0 32px', textAlign: 'center', pointerEvents: 'none',
        }}>
          <p className="text-[16px] font-extrabold" style={{ color: '#fff', letterSpacing: '-0.02em' }}>
            {starting
              ? (spanish ? 'Iniciando cámara…' : 'Starting camera…')
              : (spanish ? 'Apunta al código de la máquina' : 'Point at the machine’s code')}
          </p>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(255,255,255,0.62)', lineHeight: 1.45 }}>
            {spanish
              ? 'Te llevamos directo a todos los ejercicios que puedes hacer en ella.'
              : 'We’ll take you straight to every exercise you can do on it.'}
          </p>
          {notice && (
            <div className="inline-flex items-center mt-4 px-3.5 py-2 rounded-full"
              style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.45)' }}>
              <span className="text-[12.5px] font-bold" style={{ color: '#FBBF24' }}>{notice}</span>
            </div>
          )}
        </div>
      )}

      {/* Scoped CSS. html5-qrcode injects <video>, <canvas id="qr-canvas"> and
          <div id="qr-shaded-region"> as children of #equip-qr-reader; we force
          the video to fill and hide the library's own chrome because we draw our
          own brackets + laser above it. Selectors stay strictly under the reader
          id so nothing bleeds onto the overlay siblings. */}
      <style>{`
        #equip-qr-reader {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          padding: 0 !important;
          border: 0 !important;
          overflow: hidden !important;
          background: #05070B !important;
          z-index: 1;
        }
        #equip-qr-reader > video {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          max-width: none !important;
          max-height: none !important;
          object-fit: cover !important;
          display: block !important;
          border: none !important;
          border-radius: 0 !important;
        }
        #equip-qr-reader > canvas,
        #equip-qr-reader > #qr-canvas { display: none !important; }
        #equip-qr-reader > #qr-shaded-region,
        #equip-qr-reader #qr-shaded-region,
        #equip-qr-reader__dashboard,
        #equip-qr-reader img[alt="Info icon"] { display: none !important; }

        .tt-qr-laser {
          position: absolute;
          left: 8%;
          right: 8%;
          height: 2px;
          border-radius: 2px;
          animation: ttQrLaser 2.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        }
        @keyframes ttQrLaser {
          0%, 100% { top: 8%;  opacity: 0.15; }
          50%      { top: 92%; opacity: 0.95; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tt-qr-laser { animation: none; top: 50%; opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
