// PreviewOverlay.jsx
// -----------------------------------------------------------------------------
// Fullscreen "real" preview for a share card — a larger, fit-to-screen look at
// exactly what will be exported.
//
// NOTE: this used to support one-finger pan + two-finger pinch-zoom. That was
// removed: the gesture only moved the *preview*, never the exported PNG (the
// share always ships the fixed-size card), so dragging/zooming gave users the
// false impression they were composing/positioning the post. It's now a static
// fit-to-screen preview — what you see is what gets shared.
// -----------------------------------------------------------------------------

import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';

export default function PreviewOverlay({
  open,
  onClose,
  // The rendered card. PreviewOverlay just shows it larger.
  children,
  // Intrinsic card dimensions — used to compute the fit-to-screen scale.
  w,
  h,
}) {
  useScrollLock(open);

  if (!open) return null;

  // Fit the card to the viewport (with margins for the close button / safe area).
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 390;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const fitScale = Math.min((vw - 32) / w, (vh - 140) / h);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(10,13,16,0.92)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {/* Card — fit to screen, static. Tapping the backdrop closes; the card
          itself swallows the tap so a mis-tap on it doesn't dismiss. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: w * fitScale, height: h * fitScale,
          position: 'relative', borderRadius: 24, overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
        }}
      >
        <div style={{ transform: `scale(${fitScale})`, transformOrigin: 'top left', width: w, height: h }}>
          {children}
        </div>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 'max(env(safe-area-inset-top, 0px), 44px)',
          right: 16,
          width: 40, height: 40, borderRadius: 20, border: 'none',
          background: 'rgba(255,255,255,0.14)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 18,
          zIndex: 2,
        }}
      >
        <X size={18} color="#fff" />
      </button>
    </div>,
    document.body,
  );
}
