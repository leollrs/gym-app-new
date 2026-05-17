// PreviewOverlay.jsx
// -----------------------------------------------------------------------------
// Fullscreen "real" preview for a share card. One finger pans, two fingers
// pinch-zoom the card so the user can inspect detail. Native touch listeners
// with `passive: false` — React's synthetic touch events are passive on iOS
// WebKit, so preventDefault is a no-op there and the page bounces instead
// of the card following the fingers.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function PreviewOverlay({
  open,
  onClose,
  // The rendered card. PreviewOverlay just wraps it in a manipulable surface.
  children,
  // Intrinsic card dimensions — used to compute the initial fit-to-screen scale.
  w,
  h,
}) {
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [zoom, setZoom] = useState(1);

  // Refs so native listeners read the latest state without re-binding.
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const zoomRef = useRef(1);
  useEffect(() => { panXRef.current = panX; }, [panX]);
  useEffect(() => { panYRef.current = panY; }, [panY]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const surfaceRef = useRef(null);
  const gesture = useRef(null);

  // Reset when reopened so the next preview lands centred at 1×.
  useEffect(() => {
    if (open) {
      setPanX(0); setPanY(0); setZoom(1);
      panXRef.current = 0; panYRef.current = 0; zoomRef.current = 1;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const el = surfaceRef.current;
    if (!el) return undefined;

    const handleStart = (e) => {
      if (e.touches.length === 1) {
        gesture.current = {
          mode: 'pan',
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startPanX: panXRef.current,
          startPanY: panYRef.current,
        };
      } else if (e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        gesture.current = {
          mode: 'pinch',
          startDist: Math.hypot(dx, dy) || 1,
          startZoom: zoomRef.current,
          startMidX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          startMidY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
          startPanX: panXRef.current,
          startPanY: panYRef.current,
        };
      }
    };

    const handleMove = (e) => {
      if (!gesture.current) return;
      e.preventDefault();
      if (gesture.current.mode === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - gesture.current.startX;
        const dy = e.touches[0].clientY - gesture.current.startY;
        setPanX(gesture.current.startPanX + dx);
        setPanY(gesture.current.startPanY + dy);
      } else if (gesture.current.mode === 'pinch' && e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy) || 1;
        const newZoom = clamp(gesture.current.startZoom * (dist / gesture.current.startDist), 0.4, 4);
        setZoom(newZoom);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setPanX(gesture.current.startPanX + (midX - gesture.current.startMidX));
        setPanY(gesture.current.startPanY + (midY - gesture.current.startMidY));
      }
    };

    const handleEnd = () => { gesture.current = null; };

    el.addEventListener('touchstart', handleStart, { passive: false });
    el.addEventListener('touchmove', handleMove, { passive: false });
    el.addEventListener('touchend', handleEnd, { passive: false });
    el.addEventListener('touchcancel', handleEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchmove', handleMove);
      el.removeEventListener('touchend', handleEnd);
      el.removeEventListener('touchcancel', handleEnd);
    };
  }, [open]);

  if (!open) return null;

  // Compute initial fit-to-screen scale. The user's zoom multiplies this.
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 390;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const fitScale = Math.min((vw - 32) / w, (vh - 140) / h);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(10,13,16,0.92)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        overflow: 'hidden',
      }}
    >
      {/* Manipulable surface — entire viewport, captures pan/pinch. */}
      <div
        ref={surfaceRef}
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            width: w * fitScale, height: h * fitScale,
            position: 'relative', borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          <div style={{ transform: `scale(${fitScale})`, transformOrigin: 'top left', width: w, height: h }}>
            {children}
          </div>
        </div>
      </div>

      {/* Close button — sits above the surface so taps reach it. */}
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

      {/* Hint */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
          left: 0, right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          pointerEvents: 'none',
        }}
      >
        DRAG TO MOVE · PINCH TO ZOOM
      </div>
    </div>,
    document.body,
  );
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
