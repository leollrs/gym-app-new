// ShareCardioSheet.jsx
// -----------------------------------------------------------------------------
// Cardio-specific share sheet. Adapts the ShareSheet.jsx pattern: template
// picker, format picker (story / square / portrait), destinations (IG Story,
// IG Feed, WhatsApp, Messages, TuGymPR feed post, Save, Copy link), rasterizes
// the offscreen template node to a PNG via rasterizeNode(), then hands the
// blob to the native share sheet / Filesystem / activity_feed_items insert.
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Image as ImageIcon } from 'lucide-react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { shareBlob } from '../ShareCardRenderer';
import ShareTplCardio from './ShareTplCardio';
import { ShareFormats, ShareExportSizes, TuFont } from './ShareFormats';
import { rasterizeNode } from './ShareSheet';
import { clearCachedMapImage } from '../../lib/mapImageCache';
import { shareToInstagramStory, isInstagramStoriesAvailable } from '../../lib/instagramShare';
import {
  shareToMessages,
  shareToWhatsApp,
  shareToInstagramFeed,
  canShareViaMessages,
  isWhatsAppInstalled,
  isInstagramInstalled,
} from '../../lib/socialShare';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';

function PanelLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10, fontWeight: 800,
        color: 'var(--color-text-subtle)',
        letterSpacing: 1.4, textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function Dest({ children, label, color, active, onClick, light }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 0, minWidth: 58,
      }}
    >
      <div
        style={{
          width: 54, height: 54, borderRadius: 16,
          background: light ? 'var(--color-bg-card, #F2F2EF)' : color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: active ? '2.5px solid var(--color-text-primary)' : 'none',
          color: light ? 'var(--color-text-primary)' : '#fff',
          transition: 'transform 160ms',
          transform: active ? 'scale(1.04)' : 'scale(1)',
        }}
      >
        {children}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-primary)' }}>
        {label}
      </div>
    </button>
  );
}

const IGIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1" fill="#fff" />
  </svg>
);
const WAIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
    <path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.4A10 10 0 1012 2zm5 14.3c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-4.2-1.2a10 10 0 01-4.3-5.4c-.3-.9.4-1.6.7-2 .3-.2.6-.2.8-.2h.5c.2 0 .4 0 .6.4l.8 2c.1.2 0 .4-.1.5l-.3.4c-.1.2-.3.3-.1.6a7 7 0 003.4 3c.3.2.5.1.7 0l.6-.7c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.5.3 0 .2 0 .9-.2 1.3z" />
  </svg>
);
const MsgIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
    <path d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.1 6.1L4 22l4.7-2.5c1 .3 2.2.5 3.3.5 5.5 0 10-3.8 10-8.5S17.5 2 12 2z" />
  </svg>
);
const TuShareIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" />
    <circle cx="10" cy="7" r="4" />
    <path d="M18 8v6M21 11h-6" />
  </svg>
);
const SaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A0D10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
  </svg>
);
const LinkIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A0D10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" />
    <path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
  </svg>
);

function TemplateChip({ active, onClick, label, accent }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        border: active ? `2px solid ${accent}` : '1.5px solid var(--color-border-subtle, rgba(15,20,25,0.14))',
        background: active ? `color-mix(in srgb, ${accent} 10%, var(--color-bg-card))` : 'var(--color-bg-card)',
        color: active ? accent : 'var(--color-text-primary)',
        fontSize: 11, fontWeight: 800,
        cursor: 'pointer', textAlign: 'center',
      }}
    >
      {label}
    </button>
  );
}

// Tolerant data mapper — the sheet receives either the in-memory object
// (camelCase) or a freshly-inserted Supabase row (snake_case). Normalize once
// at the top so every consumer (caption builder, template, activity-feed post)
// sees the same shape.
function normalizeCardioData(raw) {
  if (!raw) return null;
  return {
    sessionId: raw.sessionId ?? raw.session_id ?? raw.id ?? null,
    cardioType: raw.cardioType ?? raw.cardio_type ?? 'running',
    durationSeconds: Number(raw.durationSeconds ?? raw.duration_seconds ?? 0) || 0,
    distanceKm: raw.distanceKm ?? raw.distance_km ?? null,
    calories: Number(raw.calories ?? 0) || 0,
    avgPaceSecPerKm: raw.avgPaceSecPerKm ?? raw.avg_pace_sec_per_km ?? null,
    elevationGainM: Number(raw.elevationGainM ?? raw.elevation_gain_m ?? 0) || 0,
    route: Array.isArray(raw.route) ? raw.route : [],
    unit: raw.unit || 'km',
    gymName: raw.gymName ?? raw.gym_name ?? null,
  };
}

export default function ShareCardioSheet({ open, onClose, data: rawData, accent = '#2EC4C4' }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const data = React.useMemo(() => normalizeCardioData(rawData), [rawData]);
  const [variant, setVariant] = useState('editorial');
  const [format, setFormat] = useState('story');
  const [showGym, setShowGym] = useState(true);
  const [caption, setCaption] = useState('');
  const [activeDest, setActiveDest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [backgroundSrc, setBackgroundSrc] = useState(null);
  // Clear-background (Strava Stats Sticker) toggle for the Photo variant.
  // When on AND no photo picked, ShareTplCardio renders the photo variant
  // with a transparent canvas so the exported PNG carries alpha and the
  // user can layer it on whatever they compose in IG Stories.
  const [clearBackground, setClearBackground] = useState(false);
  // Bumping mapVersion forces StaticRouteMapImage to re-mount so its useEffect
  // re-runs the renderRouteMap chain. Used by the "Regenerate" button after we
  // clear the IndexedDB cache for the current session.
  const [mapVersion, setMapVersion] = useState(0);
  const cardRef = useRef(null);
  const fileInputRef = useRef(null);

  const pickBackgroundPhoto = useCallback(async () => {
    try {
      const mod = await import('@capacitor/camera');
      const { Camera, CameraSource, CameraResultType } = mod;
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        resultType: CameraResultType.DataUrl,
        quality: 85,
      });
      if (photo?.dataUrl) { setBackgroundSrc(photo.dataUrl); return; }
    } catch {}
    fileInputRef.current?.click();
  }, []);

  const onFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBackgroundSrc(String(reader.result || ''));
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      const tm = setTimeout(() => setMounted(false), 260);
      return () => clearTimeout(tm);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  useEffect(() => {
    if (open && !caption && data) {
      const km = data.distanceKm ? `${(data.unit === 'mi' ? data.distanceKm / 1.60934 : data.distanceKm).toFixed(2)} ${data.unit}` : '';
      setCaption(
        `${data.cardioType ? data.cardioType.replace(/_/g, ' ') : 'Cardio'} ${km}`.trim()
      );
    }
  }, [open, data]); // eslint-disable-line

  // NOTE: hooks must run unconditionally on every render — keep all useCallback
  // / useMemo / useState calls ABOVE any early return. Putting them after the
  // `if (!mounted || !data) return null` guard violates the Rules of Hooks
  // and triggers React error #310 ("Rendered more hooks than previous render")
  // the moment the sheet first opens.
  const exportSize = ShareExportSizes[format];

  // Photo variant + no picked photo + clearBackground toggle = sticker mode.
  // The exported PNG carries alpha so the user can drop it on their own IG
  // Story photo (Strava's Stats Sticker UX). Declared HERE — above the
  // buildCard useCallback that captures it — to avoid the "Cannot access
  // 'photoTransparent' before initialization" TDZ error when buildCard fires
  // (the deps array evaluates eagerly on every render).
  const photoTransparent = variant === 'photo' && clearBackground && !backgroundSrc;

  const buildCard = useCallback(async () => {
    // The offscreen template may not be in the DOM yet on the very first
    // click after open — wait up to ~600ms for cardRef to populate.
    for (let i = 0; i < 6; i++) {
      if (cardRef.current) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!cardRef.current) {
      throw new Error('Share card not mounted yet — try again in a moment');
    }
    // Wait for every <img> inside the card to finish loading before we
    // serialize it. Without this the rasterized PNG can show "Loading map…"
    // because the route-map <img> hadn't decoded yet.
    const imgs = Array.from(cardRef.current.querySelectorAll('img'));
    await Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          // Hard timeout — never block the share button forever on a flaky
          // tile fetch. After 8s we proceed with whatever's loaded.
          setTimeout(done, 8000);
        });
      }),
    );
    try {
      return await rasterizeNode(cardRef.current, exportSize.w, exportSize.h, { transparent: photoTransparent });
    } catch (err) {
      console.warn('[ShareCardioSheet] rasterize attempt 1 failed, retrying:', err?.message);
      await new Promise((r) => setTimeout(r, 120));
      return await rasterizeNode(cardRef.current, exportSize.w, exportSize.h, { transparent: photoTransparent });
    }
  }, [exportSize, photoTransparent]);

  const handleDest = useCallback(async (dest) => {
    if (busy) return;
    setBusy(true);
    let blob = null;
    try {
      try {
        blob = await buildCard();
      } catch (renderErr) {
        console.error('[ShareCardioSheet] buildCard failed:', renderErr?.message || renderErr);
        // Fall through — some destinations (link, tu, native share text-only)
        // don't require the blob, so we keep going instead of aborting.
      }
      const link = `https://tugympr.app/share/cardio/${data?.sessionId || 'run'}`;
      const text = caption?.trim() || 'TuGymPR';
      const full = `${text}\n${link}`;

      if (dest === 'link') {
        try { await navigator.clipboard.writeText(link); } catch {}
      } else if (dest === 'save') {
        if (blob) {
          const reader = new FileReader();
          const b64 = await new Promise((resolve) => {
            reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
            reader.readAsDataURL(blob);
          });
          try {
            await Filesystem.writeFile({
              path: `tugympr-run-${Date.now()}.png`,
              data: b64,
              directory: Directory.Documents,
            });
          } catch {
            await shareBlob(blob, 'tugympr-run.png', full);
          }
        }
      } else if (dest === 'tu') {
        if (user?.id && profile?.gym_id) {
          const { error: postErr } = await supabase.from('activity_feed_items').insert({
            actor_id: user.id,
            gym_id: profile.gym_id,
            type: 'user_post',
            post_type: 'user',
            is_public: true,
            body: text,
            data: {
              body: text,
              cardio_session_id: data?.sessionId || null,
              cardio_type: data?.cardioType,
              distance_km: data?.distanceKm,
              duration_seconds: data?.durationSeconds,
            },
          });
          if (postErr) console.error('[ShareCardioSheet] post failed', postErr);
        }
      } else if (dest === 'ig-story') {
        // Direct deep link into the IG Stories composer — same flow as the
        // workout share sheet. Sticker template renders transparent so the
        // export carries alpha; everything else fills the background slot.
        let landedInIG = false;
        if (blob && await isInstagramStoriesAvailable()) {
          const ig = await shareToInstagramStory({ backgroundBlob: blob, contentURL: link });
          landedInIG = ig.ok;
        }
        if (!landedInIG && blob) {
          await shareBlob(blob, 'tugympr-run.png', full);
        }
      } else if (dest === 'im') {
        let landed = false;
        if (blob && await canShareViaMessages()) {
          const res = await shareToMessages({ blob, text: full });
          landed = res.ok;
        }
        if (!landed && blob) {
          await shareBlob(blob, 'tugympr-run.png', full);
        }
      } else if (dest === 'wa') {
        let landed = false;
        if (blob && await isWhatsAppInstalled()) {
          const res = await shareToWhatsApp({ blob, text: full });
          landed = res.ok;
        }
        if (!landed && blob) {
          await shareBlob(blob, 'tugympr-run.png', full);
        }
      } else if (dest === 'ig-feed') {
        // IG Feed/Reels don't support alpha — IG composites transparent
        // pixels to black. If the user picked Photo + Clear background,
        // the export carries alpha and IG would flatten to black. Re-
        // rasterize opaquely for the Feed path so the Photo template's
        // solid fallback bg renders instead. Transparent export still
        // wins for IG Story.
        let feedBlob = blob;
        if (photoTransparent && cardRef.current) {
          try {
            feedBlob = await rasterizeNode(
              cardRef.current, exportSize.w, exportSize.h, { transparent: false },
            );
          } catch (e) {
            console.warn('[ShareCardioSheet] opaque re-rasterize for ig-feed failed', e);
          }
        }
        let landed = false;
        if (feedBlob && await isInstagramInstalled()) {
          const res = await shareToInstagramFeed({ blob: feedBlob });
          landed = res.ok;
        }
        if (!landed && feedBlob) {
          await shareBlob(feedBlob, 'tugympr-run.png', full);
        }
      } else if (blob) {
        await shareBlob(blob, 'tugympr-run.png', full);
      } else {
        try {
          await Share.share({
            title: 'TuGymPR',
            text: full,
            url: link,
          });
        } catch {}
      }
    } catch (err) {
      console.error('[ShareCardioSheet] share failed:', err?.message || err);
      try {
        // Surface a lightweight toast. The app exposes window.__tugymToast in
        // most hosts; fall back to alert so the user sees *something*.
        const msg = "Couldn't render share card";
        if (typeof window !== 'undefined' && typeof window.__tugymToast === 'function') {
          window.__tugymToast(msg, 'error');
        } else if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(msg);
        }
      } catch {}
    } finally {
      setBusy(false);
      onClose?.();
    }
  }, [busy, buildCard, caption, data, profile, user, onClose]);

  const handleCta = () => {
    if (!activeDest) return;
    handleDest(activeDest);
  };

  // Safe to early-return below this line — all hooks have already run.
  if (!mounted || !data) return null;

  const { w, h } = ShareFormats[format];
  // Bigger preview — let the card actually fill the viewport so the user can
  // see the design and read the stats. Cap to viewport size so it never
  // overflows on smaller phones.
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 390;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const maxW = Math.min(vw - 48, 380);
  const maxH = Math.min(vh - 360, 620);
  const scale = Math.min(maxW / w, maxH / h);

  const tplProps = {
    variant, data, accent,
    showGym,
    backgroundSrc: variant === 'photo' ? backgroundSrc : undefined,
    transparent: photoTransparent,
    mapVersion,
  };

  const variants = [
    { id: 'editorial', label: t('cardio.share.editorial', 'Editorial') },
    { id: 'bold',      label: t('cardio.share.bold',      'Bold') },
    { id: 'poster',    label: t('cardio.share.poster',    'Poster') },
    { id: 'photo',     label: t('cardio.share.photo',     'Photo') },
  ];

  return createPortal(
    <div
      role="dialog" aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(10,13,16,0.72)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        display: 'flex', flexDirection: 'column',
        opacity: visible ? 1 : 0, transition: 'opacity 220ms ease-out',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: 'max(env(safe-area-inset-top, 0px), 44px) 16px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          color: '#fff',
        }}
      >
        <button
          type="button" onClick={onClose} aria-label={t('share.close', { defaultValue: 'Close' })}
          style={{
            width: 36, height: 36, borderRadius: 18, border: 'none',
            cursor: 'pointer', background: 'rgba(255,255,255,0.14)',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={18} color="#fff" />
        </button>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: '#fff' }}>
          {t('cardio.share.shareRun', 'Share run')}
        </div>
        <button
          type="button"
          onClick={async () => {
            const sid = data?.sessionId;
            if (sid) await clearCachedMapImage(sid);
            setMapVersion((v) => v + 1);
          }}
          aria-label={t('share.regenerateMap', { defaultValue: 'Regenerate map' })}
          title={t('share.regenerateMap', { defaultValue: 'Regenerate map' })}
          style={{
            width: 36, height: 36, borderRadius: 18, border: 'none',
            cursor: 'pointer', background: 'rgba(255,255,255,0.14)',
            color: '#fff', fontSize: 18, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ↻
        </button>
      </div>

      {/* Preview */}
      <div
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '8px 20px', minHeight: 0,
        }}
      >
        <div
          style={{
            width: w * scale, height: h * scale,
            position: 'relative', borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
            // Preview-only checkerboard when the export is going to be
            // transparent — visual confirmation that "Clear background"
            // is active. Without this the dark backdrop bleeds through
            // and reads the same as the opaque path.
            backgroundColor: photoTransparent ? '#FFFFFF' : 'transparent',
            backgroundImage: photoTransparent
              ? 'linear-gradient(45deg, #d6d6d6 25%, transparent 25%), linear-gradient(-45deg, #d6d6d6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d6d6d6 75%), linear-gradient(-45deg, transparent 75%, #d6d6d6 75%)'
              : 'none',
            backgroundSize: photoTransparent ? '20px 20px' : 'auto',
            backgroundPosition: photoTransparent ? '0 0, 0 10px, 10px -10px, -10px 0px' : 'auto',
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`, transformOrigin: 'top left',
              width: w, height: h,
            }}
          >
            <ShareTplCardio w={w} h={h} {...tplProps} />
          </div>
        </div>
      </div>

      {/* Offscreen full-res */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', left: -99999, top: 0,
          pointerEvents: 'none',
          width: exportSize.w, height: exportSize.h,
        }}
      >
        <div ref={cardRef} style={{ width: exportSize.w, height: exportSize.h }}>
          <ShareTplCardio w={exportSize.w} h={exportSize.h} {...tplProps} />
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          background: 'var(--color-bg-card)',
          borderTopLeftRadius: 26, borderTopRightRadius: 26,
          paddingTop: 10,
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 30px)',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.25)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 320ms cubic-bezier(0.2,0.9,0.3,1)',
        }}
      >
        <div
          style={{
            width: 40, height: 4, borderRadius: 2,
            background: 'var(--color-border, rgba(255,255,255,0.14))',
            margin: '4px auto 10px',
          }}
        />

        <div style={{ padding: '4px 16px 0' }}>
          <PanelLabel>{t('cardio.share.style', 'Style')}</PanelLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 6 }}>
            {variants.map(v => (
              <TemplateChip
                key={v.id}
                active={variant === v.id}
                onClick={() => setVariant(v.id)}
                label={v.label}
                accent={accent}
              />
            ))}
          </div>

          {variant === 'photo' && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { setClearBackground(false); pickBackgroundPhoto(); }}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12,
                    border: `1.5px ${backgroundSrc ? 'solid var(--color-accent)' : 'dashed var(--color-border, rgba(255,255,255,0.18))'}`,
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-primary)',
                    fontSize: 12, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 8, cursor: 'pointer',
                  }}
                >
                  <ImageIcon size={14} />
                  {backgroundSrc
                    ? t('cardio.share.changePhoto', 'Change photo')
                    : t('cardio.share.pickPhoto', 'Pick photo')}
                </button>
                {/* Clear-background toggle. Tapping clears the picked photo
                    AND turns on transparent export so the card lands on
                    alpha — Strava Stats Sticker UX for cardio runs. */}
                <button
                  type="button"
                  onClick={() => { setBackgroundSrc(null); setClearBackground(!clearBackground || !!backgroundSrc); }}
                  aria-pressed={photoTransparent}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12,
                    border: `1.5px solid ${photoTransparent ? 'var(--color-accent)' : 'var(--color-border, rgba(255,255,255,0.18))'}`,
                    background: photoTransparent
                      ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                      : 'var(--color-bg-primary)',
                    color: photoTransparent ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    fontSize: 12, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 8, cursor: 'pointer',
                  }}
                >
                  {t('cardio.share.clearBackground', 'Clear background')}
                </button>
              </div>
              <input
                ref={fileInputRef} type="file" accept="image/*"
                onChange={onFileChange} style={{ display: 'none' }}
              />
            </div>
          )}
        </div>

        {/* Format */}
        <div style={{ padding: '12px 16px 0' }}>
          <PanelLabel>{t('cardio.share.format', 'Format')}</PanelLabel>
          <div
            style={{
              display: 'flex', gap: 6, marginTop: 6,
              background: 'var(--color-bg-primary)', padding: 3, borderRadius: 12,
            }}
          >
            {Object.entries(ShareFormats).map(([k, v]) => (
              <button
                key={k} type="button" onClick={() => setFormat(k)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 9,
                  border: 'none', cursor: 'pointer',
                  background: format === k ? 'var(--color-bg-card)' : 'transparent',
                  color: format === k ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                  fontSize: 12, fontWeight: 700,
                }}
              >
                {k === 'story'
                  ? t('cardio.share.story', v.label)
                  : k === 'square'
                    ? t('cardio.share.feed', v.label)
                    : t('cardio.share.portrait', v.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Gym toggle + caption */}
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowGym(s => !s)}
            style={{
              padding: '7px 12px', borderRadius: 999,
              border: `1.5px solid ${showGym ? accent : 'var(--color-border, rgba(255,255,255,0.14))'}`,
              background: showGym ? `color-mix(in srgb, ${accent} 14%, transparent)` : 'transparent',
              color: showGym ? accent : 'var(--color-text-subtle)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('cardio.share.showGym', 'Show gym')}
          </button>
        </div>

        {/* Caption */}
        <div style={{ padding: '12px 16px 0' }}>
          <PanelLabel>{t('cardio.share.caption', 'Caption')}</PanelLabel>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={{
              width: '100%', marginTop: 6, padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid var(--color-border, rgba(255,255,255,0.14))',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Destinations */}
        <div style={{ padding: '14px 0 0 16px' }}>
          <PanelLabel>{t('cardio.share.shareTo', 'Share to')}</PanelLabel>
          <div
            style={{
              display: 'flex', gap: 10, marginTop: 8,
              overflowX: 'auto', paddingRight: 16, paddingBottom: 4,
              scrollbarWidth: 'none',
            }}
          >
            <Dest active={activeDest === 'ig-story'} onClick={() => { setActiveDest('ig-story'); setFormat('story'); }} label="IG Story" color="#E1306C"><IGIcon /></Dest>
            <Dest active={activeDest === 'ig-feed'} onClick={() => { setActiveDest('ig-feed'); setFormat('square'); }} label="IG Feed" color="#C13584"><IGIcon /></Dest>
            <Dest active={activeDest === 'wa'} onClick={() => { setActiveDest('wa'); setFormat('square'); }} label="WhatsApp" color="#25D366"><WAIcon /></Dest>
            <Dest active={activeDest === 'im'} onClick={() => { setActiveDest('im'); setFormat('square'); }} label="Messages" color="#34C759"><MsgIcon /></Dest>
            <Dest active={activeDest === 'tu'} onClick={() => { setActiveDest('tu'); setFormat('square'); }} label="TuGymPR" color="var(--color-accent)"><TuShareIcon /></Dest>
            <Dest active={activeDest === 'save'} onClick={() => setActiveDest('save')} label={t('cardio.share.save', 'Save')} color="#5A6570" light><SaveIcon /></Dest>
            <Dest active={activeDest === 'link'} onClick={() => setActiveDest('link')} label={t('cardio.share.copyLink', 'Copy link')} color="#5A6570" light><LinkIcon /></Dest>
          </div>
        </div>

        {/* CTA */}
        <div style={{ padding: '14px 16px 0' }}>
          <button
            type="button" onClick={handleCta}
            disabled={!activeDest || busy}
            style={{
              width: '100%', padding: 14, borderRadius: 14,
              border: 'none', cursor: activeDest && !busy ? 'pointer' : 'default',
              background: activeDest ? 'var(--color-text-primary)' : 'var(--color-bg-primary)',
              color: activeDest ? 'var(--color-bg-card)' : 'var(--color-text-muted)',
              fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 800,
              letterSpacing: -0.2, opacity: busy ? 0.6 : 1,
            }}
          >
            {busy
              ? t('cardio.share.generating', 'Generating…')
              : activeDest
                ? t('cardio.share.shareNow', 'Share now')
                : t('cardio.share.pickDestination', 'Pick a destination')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
