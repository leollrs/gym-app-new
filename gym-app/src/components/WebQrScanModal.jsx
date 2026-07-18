import { useEffect, useRef, useState } from 'react';
import { X, Camera } from 'lucide-react';

// Web / desktop QR scanner (html5-qrcode → getUserMedia). Native platforms use
// the MLKit scanner elsewhere; this is the fallback so the app works in any
// browser with a camera (laptop, desktop, mobile web) — not just the installed app.
//
// onDecode(rawValue) MUST return true when it consumed the code (the modal then
// closes) or false when the code isn't recognized (a transient notice shows and
// scanning continues so the user can try another tag).
export default function WebQrScanModal({ open, onClose, onDecode, spanish = false, title }) {
  const [error, setError] = useState('');    // fatal (permission / no camera)
  const [notice, setNotice] = useState('');   // transient (unrecognized code)
  const [starting, setStarting] = useState(true);
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

  const start = async () => {
    setError('');
    setNotice('');
    setStarting(true);
    doneRef.current = false;
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      // Let the #reader div mount first.
      await new Promise((r) => setTimeout(r, 80));
      if (!document.getElementById('equip-qr-reader')) return;
      const inst = new Html5Qrcode('equip-qr-reader', { verbose: false });
      qrRef.current = inst;
      const box = Math.min(Math.round(window.innerWidth * 0.62), 300);
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
    } catch (err) {
      setStarting(false);
      const msg = String(err?.message || err || '');
      if (/permission|denied|NotAllowed/i.test(msg)) {
        setError(spanish ? 'Permiso de cámara denegado. Actívalo en tu navegador e inténtalo de nuevo.' : 'Camera permission denied. Allow it in your browser and try again.');
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

  return (
    <div className="fixed inset-0 z-[120] flex flex-col" style={{ background: '#05070B' }}>
      {/* Header */}
      <div className="relative flex items-center justify-center py-4 px-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={close}
          aria-label={spanish ? 'Cerrar' : 'Close'}
          className="absolute left-4 w-11 h-11 flex items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.06)', color: '#9CA3AF' }}
        >
          <X size={18} />
        </button>
        <div className="flex items-center gap-2">
          <Camera size={16} style={{ color: 'var(--color-accent, #D4AF37)' }} />
          <span className="text-[15px] font-bold text-white">{title || (spanish ? 'Escanear QR de máquina' : 'Scan machine QR')}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {error ? (
          <>
            <Camera size={40} style={{ color: '#6B7280' }} className="mb-4" />
            <p className="text-[14px] text-center mb-6" style={{ color: '#EF4444', maxWidth: 320 }}>{error}</p>
            <button
              onClick={start}
              className="px-6 py-2.5 rounded-xl text-[13px] font-semibold active:scale-[0.97] transition-transform"
              style={{ background: 'var(--color-accent, #D4AF37)', color: '#000' }}
            >
              {spanish ? 'Reintentar' : 'Try again'}
            </button>
          </>
        ) : (
          <div className="w-full max-w-sm rounded-2xl overflow-hidden">
            <div id="equip-qr-reader" style={{ width: '100%', minHeight: 300 }} />
            <style>{`
              #equip-qr-reader video { width: 100% !important; height: auto !important; border: none !important; border-radius: 16px; }
              #equip-qr-reader { border: none !important; padding: 0 !important; }
              #equip-qr-reader__dashboard { display: none !important; }
            `}</style>
            <p className="text-[13px] text-center mt-4" style={{ color: notice ? '#F59E0B' : '#9CA3AF' }}>
              {notice
                || (starting
                  ? (spanish ? 'Iniciando cámara…' : 'Starting camera…')
                  : (spanish ? 'Apunta la cámara al código QR de la máquina' : 'Point your camera at the machine QR code'))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
