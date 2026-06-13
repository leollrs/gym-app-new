// StickerComposer.jsx
// -----------------------------------------------------------------------------
// Fullscreen editor for composing a transparent share-card "sticker" onto a
// user-supplied photo. Skips the IG double-sticker workflow (photo sticker +
// card sticker) by producing a single composite PNG in-app.
//
// Inputs:
//   stickerSrc    : data URL of the transparent share card (PNG with alpha)
//   onDone(blob)  : called with the final composite Blob (PNG, photo + sticker)
//
// Gestures (touch):
//   • 1 finger drag       → pan the sticker
//   • 2 finger pinch      → resize the sticker (kept centred on the midpoint
//                           between fingers so it feels like direct manipulation)
//
// Output dimensions match the IG Story canvas (1080×1920). The photo is drawn
// "cover" fit so the user's framing is preserved.
// -----------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Image as ImageIcon, Camera as CameraIcon } from 'lucide-react';

const OUTPUT_W = 1080;
const OUTPUT_H = 1920;

export default function StickerComposer({
  open,
  onClose,
  onDone,             // (blob: Blob) => void
  stickerSrc,         // data URL of the transparent card
  initialPhotoSrc,    // optional starting background
}) {
  const { t } = useTranslation('pages');
  const [photoSrc, setPhotoSrc] = useState(initialPhotoSrc || null);
  // sticker transform in unit space (0..1 across the canvas).
  // cx, cy = center as a fraction of canvas width/height.
  const [cx, setCx] = useState(0.5);
  const [cy, setCy] = useState(0.5);
  // Sticker width as a fraction of canvas width. 0.6 = sits comfortably.
  const [wFrac, setWFrac] = useState(0.65);
  const [busy, setBusy] = useState(false);

  // Natural sticker aspect (h / w). Default to 9:16 story until the image
  // loads — recomputed after onLoad so the rendered box matches the PNG.
  const [stickerAspect, setStickerAspect] = useState(16 / 9);

  // Gesture refs so handlers don't trigger re-renders on every move.
  const editorRef = useRef(null);
  const gesture = useRef(null);

  useEffect(() => {
    if (!stickerSrc) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.width > 0) setStickerAspect(img.height / img.width);
    };
    img.src = stickerSrc;
    return () => { cancelled = true; };
  }, [stickerSrc]);

  // Seed the background from the caller's initial photo each time the composer
  // opens. The useState initializer above ran at first mount (when this prop
  // was still null), so without this sync the Photo template's already-picked
  // photo would be ignored and the user would land on the empty "add a photo"
  // state instead of their photo with the draggable overlay on top.
  useEffect(() => {
    if (open && initialPhotoSrc) setPhotoSrc(initialPhotoSrc);
  }, [open, initialPhotoSrc]);

  const pickPhoto = useCallback(async () => {
    try {
      const mod = await import('@capacitor/camera');
      const { Camera, CameraSource, CameraResultType } = mod;
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        resultType: CameraResultType.DataUrl,
        quality: 85,
      });
      if (photo?.dataUrl) setPhotoSrc(photo.dataUrl);
    } catch {
      // user cancelled or plugin unavailable
    }
  }, []);

  const takePhoto = useCallback(async () => {
    try {
      const mod = await import('@capacitor/camera');
      const { Camera, CameraSource, CameraResultType } = mod;
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.DataUrl,
        quality: 85,
      });
      if (photo?.dataUrl) setPhotoSrc(photo.dataUrl);
    } catch {}
  }, []);

  // ─── Touch handling ────────────────────────────────────────────────────
  // Native listeners with `{ passive: false }` — React's synthetic touch
  // events go through passive listeners on iOS WebKit, so `preventDefault`
  // is silently ignored and the page scrolls / pinch-zooms instead of the
  // sticker following the fingers. Attaching directly via addEventListener
  // is the only reliable fix.
  useEffect(() => {
    if (!open) return undefined;
    const el = editorRef.current;
    if (!el) return undefined;

    const handleStart = (e) => {
      if (e.touches.length === 1) {
        gesture.current = {
          mode: 'pan',
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startCx: cxRef.current,
          startCy: cyRef.current,
        };
      } else if (e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        gesture.current = {
          mode: 'pinch',
          startDist: Math.hypot(dx, dy) || 1,
          startW: wRef.current,
          startMidX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          startMidY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
          startCx: cxRef.current,
          startCy: cyRef.current,
        };
      }
    };

    const handleMove = (e) => {
      if (!gesture.current) return;
      const box = el.getBoundingClientRect();
      if (!box) return;
      e.preventDefault();
      if (gesture.current.mode === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - gesture.current.startX;
        const dy = e.touches[0].clientY - gesture.current.startY;
        setCx(clamp01(gesture.current.startCx + dx / box.width));
        setCy(clamp01(gesture.current.startCy + dy / box.height));
      } else if (gesture.current.mode === 'pinch' && e.touches.length >= 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy) || 1;
        const newW = clamp(gesture.current.startW * (dist / gesture.current.startDist), 0.15, 1.6);
        setWFrac(newW);
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const ddx = midX - gesture.current.startMidX;
        const ddy = midY - gesture.current.startMidY;
        setCx(clamp01(gesture.current.startCx + ddx / box.width));
        setCy(clamp01(gesture.current.startCy + ddy / box.height));
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

  // Track current values in refs so the native listeners (registered once)
  // always read the latest state.
  const cxRef = useRef(cx);
  const cyRef = useRef(cy);
  const wRef = useRef(wFrac);
  useEffect(() => { cxRef.current = cx; }, [cx]);
  useEffect(() => { cyRef.current = cy; }, [cy]);
  useEffect(() => { wRef.current = wFrac; }, [wFrac]);

  // ─── Compose to canvas ─────────────────────────────────────────────────
  const compose = useCallback(async () => {
    if (busy || !photoSrc || !stickerSrc) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_W;
      canvas.height = OUTPUT_H;
      const ctx = canvas.getContext('2d');

      // Draw the photo as cover-fit so the user's framing is preserved
      const photo = await loadImage(photoSrc);
      const photoAspect = photo.width / photo.height;
      const canvasAspect = OUTPUT_W / OUTPUT_H;
      let dw, dh, dx, dy;
      if (photoAspect > canvasAspect) {
        // Photo wider — crop horizontally
        dh = OUTPUT_H;
        dw = dh * photoAspect;
        dx = (OUTPUT_W - dw) / 2;
        dy = 0;
      } else {
        dw = OUTPUT_W;
        dh = dw / photoAspect;
        dx = 0;
        dy = (OUTPUT_H - dh) / 2;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);
      ctx.drawImage(photo, dx, dy, dw, dh);

      // Draw the sticker centred at (cx, cy) at width = wFrac * OUTPUT_W
      const sticker = await loadImage(stickerSrc);
      const sw = wFrac * OUTPUT_W;
      const sh = sw * (sticker.height / sticker.width);
      const sx = cx * OUTPUT_W - sw / 2;
      const sy = cy * OUTPUT_H - sh / 2;
      ctx.drawImage(sticker, sx, sy, sw, sh);

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob && onDone) onDone(blob);
    } catch (err) {
      console.warn('[StickerComposer] compose failed:', err?.message);
    } finally {
      setBusy(false);
    }
  }, [busy, photoSrc, stickerSrc, cx, cy, wFrac, onDone]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: '#000',
        display: 'flex', flexDirection: 'column',
        color: '#fff',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: 'max(env(safe-area-inset-top, 0px), 44px) 16px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <button
          type="button" onClick={onClose}
          aria-label={t('share.close', { defaultValue: 'Close' })}
          style={{
            width: 36, height: 36, borderRadius: 18, border: 'none',
            background: 'rgba(255,255,255,0.14)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={18} color="#fff" />
        </button>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>
          {t('share.composeSticker', { defaultValue: 'Compose sticker' })}
        </div>
        <button
          type="button"
          onClick={compose}
          disabled={!photoSrc || busy}
          style={{
            padding: '8px 14px', borderRadius: 18, border: 'none',
            background: !photoSrc || busy ? 'rgba(255,255,255,0.18)' : '#fff',
            color: !photoSrc || busy ? 'rgba(255,255,255,0.5)' : '#0A0D10',
            fontSize: 13, fontWeight: 800, cursor: !photoSrc || busy ? 'default' : 'pointer',
          }}
        >
          {busy
            ? t('share.composing', { defaultValue: 'Composing…' })
            : t('share.done', { defaultValue: 'Done' })}
        </button>
      </div>

      {/* Editor area — native touch listeners are attached via useEffect
          (React's synthetic events are passive on iOS WebKit, which makes
          preventDefault a no-op). */}
      <div
        ref={editorRef}
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          touchAction: 'none',
          background: '#0A0D10',
        }}
      >
        {photoSrc ? (
          <img
            src={photoSrc}
            alt=""
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 16, padding: 32, textAlign: 'center',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {t('share.composeAddPhoto', { defaultValue: 'Add a background photo to start' })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button" onClick={takePhoto}
                style={composerCtaStyle}
              >
                <CameraIcon size={14} />
                {t('share.takePhoto', { defaultValue: 'Take photo' })}
              </button>
              <button
                type="button" onClick={pickPhoto}
                style={composerCtaStyle}
              >
                <ImageIcon size={14} />
                {t('share.pickPhoto', { defaultValue: 'Pick photo' })}
              </button>
            </div>
          </div>
        )}

        {/* Sticker overlay — positioned with unit-space transform */}
        {stickerSrc && (
          <img
            src={stickerSrc}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: `${cx * 100}%`,
              top: `${cy * 100}%`,
              width: `${wFrac * 100}%`,
              height: 'auto',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              userSelect: 'none',
              // Sticker aspect-derived height — fallback to image's natural ratio
              aspectRatio: `1 / ${stickerAspect}`,
              filter: 'drop-shadow(0 10px 30px rgba(0,0,0,0.45))',
            }}
          />
        )}
      </div>

      {/* Helper bar */}
      <div
        style={{
          padding: '10px 16px max(env(safe-area-inset-bottom, 0px), 16px)',
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center',
        }}
      >
        {photoSrc && (
          <>
            <button type="button" onClick={takePhoto} style={composerSmallStyle}>
              <CameraIcon size={13} /> {t('share.retake', { defaultValue: 'Retake' })}
            </button>
            <button type="button" onClick={pickPhoto} style={composerSmallStyle}>
              <ImageIcon size={13} /> {t('share.changePhoto', { defaultValue: 'Change' })}
            </button>
          </>
        )}
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginLeft: 6 }}>
          {t('share.composeHint', { defaultValue: 'Drag to move · Pinch to resize' })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const composerCtaStyle = {
  padding: '10px 14px', borderRadius: 12,
  border: '1.5px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff', fontSize: 13, fontWeight: 700,
  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
};

const composerSmallStyle = {
  padding: '7px 10px', borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff', fontSize: 11, fontWeight: 700,
  display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
};

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function clamp01(v) { return clamp(v, 0, 1); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
