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
import { X, Image as ImageIcon, Camera as CameraIcon, Layers as LayersIcon } from 'lucide-react';
import { Share } from '@capacitor/share';
import { saveBlob } from '../../lib/saveBlob';
import { supabase } from '../../lib/supabase';
import { PROD_WEB_URL } from '../../lib/appUrls';
import { useAuth } from '../../contexts/AuthContext';
import { shareBlob } from '../ShareCardRenderer';
import ShareTplCardio from './ShareTplCardio';
import PreviewOverlay from './PreviewOverlay';
import StickerComposer from './StickerComposer';
import ShareCtaButton from './ShareCtaButton';
import { ShareFormats, ShareExportSizes, TuFont } from './ShareFormats';
import { rasterizeNode, urlToDataUrl } from './ShareSheet';
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
const FBIcon = () => (
  <svg width="14" height="22" viewBox="0 0 320 512" fill="#fff" aria-hidden="true">
    <path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z" />
  </svg>
);
const TuShareIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-on-accent, #fff)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" />
    <circle cx="10" cy="7" r="4" />
    <path d="M18 8v6M21 11h-6" />
  </svg>
);
// stroke=currentColor so the Save chip's icon inherits the Dest container's
// color (var(--color-text-primary)) — visible on the neutral chip in BOTH
// light and dark mode. (Was hardcoded near-black → invisible in dark.)
const SaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
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

// blob → data URL (for handing the rasterized overlay to the photo composer).
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
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
    gymLogoUrl: raw.gymLogoUrl ?? raw.gym_logo_url ?? null,
  };
}

export default function ShareCardioSheet({ open, onClose, data: rawData, accent = '#2EC4C4' }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const data = React.useMemo(() => normalizeCardioData(rawData), [rawData]);
  const [variant, setVariant] = useState('editorial');
  const [format, setFormat] = useState('story');
  const [showGym, setShowGym] = useState(true);
  const [showMap, setShowMap] = useState(true);
  const [customAccent, setCustomAccent] = useState(null);
  const [previewFull, setPreviewFull] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [themeMode, setThemeMode] = useState('dark'); // 'dark' | 'light' — editorial/bold only
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
  // Photo composer: place the stats/logo overlay anywhere on the user's photo,
  // then ship the single flattened composite to every destination.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStickerSrc, setComposerStickerSrc] = useState(null);
  const [composerInitialPhoto, setComposerInitialPhoto] = useState(null);
  const [composedBlob, setComposedBlob] = useState(null);
  // Gym logo inlined as a data URL so it survives rasterization (external <img>
  // URLs don't load inside the SVG-as-image used to export the card).
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  // Bumping mapVersion forces StaticRouteMapImage to re-mount so its useEffect
  // re-runs the renderRouteMap chain. Used by the "Regenerate" button after we
  // clear the IndexedDB cache for the current session.
  const [mapVersion, setMapVersion] = useState(0);
  const cardRef = useRef(null);
  // Second offscreen card always rendered with transparent=false. IG Feed /
  // Reels flatten alpha to black, so when the user has clearBackground on we
  // need an opaque copy to ship for those destinations. Re-rasterizing the
  // transparent cardRef with `transparent: false` doesn't help — the DOM
  // itself was painted transparent, so the rasterizer ends up painting black
  // BEHIND a transparent DOM (visible result = black).
  const cardOpaqueRef = useRef(null);
  // Overlay-only (transparent, no photo) render — rasterized as the draggable
  // sticker for the photo composer.
  const overlayCardRef = useRef(null);
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

  const takeBackgroundPhoto = useCallback(async () => {
    try {
      const mod = await import('@capacitor/camera');
      const { Camera, CameraSource, CameraResultType } = mod;
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.DataUrl,
        quality: 85,
      });
      if (photo?.dataUrl) setBackgroundSrc(photo.dataUrl);
    } catch {
      // user cancelled or no camera available — silent
    }
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

  // Resolve the gym logo (https → inline data URL) so it renders in the export.
  useEffect(() => {
    let cancelled = false;
    const src = data?.gymLogoUrl;
    if (!open || !src || String(src).startsWith('data:')) { setLogoDataUrl(null); return undefined; }
    urlToDataUrl(src).then((d) => { if (!cancelled) setLogoDataUrl(d); });
    return () => { cancelled = true; };
  }, [open, data?.gymLogoUrl]);

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
    // A composed photo+overlay is the source of truth — ship it everywhere.
    if (composedBlob) return composedBlob;
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
  }, [exportSize, photoTransparent, composedBlob]);

  // Drop the composite whenever anything visual changes — it'd be stale. NOT
  // keyed on `format`: the composite is always 1080×1920, and the destination
  // tiles call setFormat() on tap, which would otherwise wipe the composite
  // the instant the user picks where to share it.
  useEffect(() => { setComposedBlob(null); }, [variant, customAccent, customTitle, themeMode, showGym, showMap, backgroundSrc]);

  // Object URL for the composed photo so the preview shows EXACTLY what ships
  // (the user's positioned overlay), not the default template layout.
  const [composedUrl, setComposedUrl] = useState(null);
  useEffect(() => {
    if (!composedBlob) { setComposedUrl(null); return undefined; }
    const url = URL.createObjectURL(composedBlob);
    setComposedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [composedBlob]);

  // Open the composer: rasterize the OVERLAY ONLY (transparent, no photo) as
  // the sticker, with the user's picked photo as the composer's fixed bg.
  const openComposer = useCallback(async () => {
    const node = overlayCardRef.current;
    if (!node) return;
    try {
      const blob = await rasterizeNode(node, ShareExportSizes.story.w, ShareExportSizes.story.h, { transparent: true });
      if (!blob) return;
      const dataUrl = await blobToDataUrl(blob);
      setComposerStickerSrc(dataUrl);
      setComposerInitialPhoto(backgroundSrc || null);
      setComposerOpen(true);
      setFormat('story');
    } catch (err) {
      console.warn('[ShareCardioSheet] composer open failed:', err?.message);
    }
  }, [backgroundSrc]);

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
      const link = `${PROD_WEB_URL}/share/cardio/${data?.sessionId || 'run'}`;
      const text = caption?.trim() || profile?.gym_name || 'TuGymPR';
      const full = `${text}\n${link}`;

      if (dest === 'save') {
        // saveBlob → Cache + native share sheet ("Save Image") / web download.
        // Old code wrote to Directory.Documents (app sandbox) — image was lost.
        if (blob) await saveBlob(`tugympr-run-${Date.now()}.png`, blob);
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
        // workout share sheet. Photo template with Clear background renders
        // transparent so it lands in IG as a sticker; everything else fills
        // the background slot. In sticker mode IG fills the page with a
        // gradient (top→bottom colors), so we pass the gym accent so the
        // Story isn't framed in default black.
        // A composed photo+overlay is opaque & finished → send as BACKGROUND,
        // not as a sticker (so the user's positioned layout fills the Story).
        const sendAsSticker = photoTransparent && !composedBlob;
        let landedInIG = false;
        if (blob && await isInstagramStoriesAvailable()) {
          const ig = await shareToInstagramStory(
            sendAsSticker
              ? {
                  stickerBlob: blob,
                  contentURL: link,
                  backgroundTopColor: customAccent || accent,
                  backgroundBottomColor: '#0A0D10',
                }
              : { backgroundBlob: blob, contentURL: link }
          );
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
        // IG Feed/Reels flatten alpha to black. Use the opaque sibling
        // (always rendered with transparent=false) when the user picked
        // Clear background; otherwise the regular blob is already opaque.
        // composedBlob is already an opaque composite → ship it directly.
        let feedBlob = blob;
        if (!composedBlob && photoTransparent && cardOpaqueRef.current) {
          try {
            feedBlob = await rasterizeNode(
              cardOpaqueRef.current, exportSize.w, exportSize.h, { transparent: false },
            );
          } catch (e) {
            console.warn('[ShareCardioSheet] opaque rasterize for ig-feed failed', e);
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
      } else if (dest === 'fb') {
        // Facebook: OS share sheet (no clean FB image deep link without the SDK).
        if (blob) await shareBlob(blob, 'tugympr-run.png', full);
      } else if (blob) {
        await shareBlob(blob, 'tugympr-run.png', full);
      } else {
        try {
          await Share.share({
            title: profile?.gym_name || 'TuGymPR',
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
  }, [busy, buildCard, caption, data, profile, user, onClose, composedBlob, photoTransparent]);

  const handleCta = () => {
    if (!activeDest) return;
    handleDest(activeDest);
  };

  // Safe to early-return below this line — all hooks have already run.
  if (!mounted || !data) return null;

  const { w, h } = ShareFormats[format];
  // Preview must fit the viewport space NOT occupied by the controls sheet
  // (capped at 60vh) and the top bar (~70px). Otherwise the card overflows
  // the centred flex slot — half hangs above, half below, and the top
  // bleeds into the chrome. 28vh leaves clearance for the top bar.
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const maxW = Math.min(320, ((typeof window !== 'undefined' && window.innerWidth) || 390) - 48);
  const maxH = Math.min(vh * 0.28, 380);
  const scale = Math.min(maxW / w, maxH / h, 1);

  const tplProps = {
    variant,
    // Inject the inlined logo data URL so the gym logo survives rasterization.
    data: logoDataUrl ? { ...data, gymLogoUrl: logoDataUrl } : data,
    accent: customAccent || accent,
    customTitle: customTitle?.trim() || undefined,
    themeMode,
    showGym,
    showMap,
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
          onClick={() => setPreviewFull(true)}
          aria-label={t('share.preview', { defaultValue: 'Preview' })}
          style={{
            height: 36, padding: '0 14px', borderRadius: 18, border: 'none',
            cursor: 'pointer', background: 'rgba(255,255,255,0.14)',
            color: '#fff', fontSize: 13, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, letterSpacing: -0.1,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 900 }}>⤢</span>
          {t('share.preview', { defaultValue: 'Preview' })}
        </button>
      </div>

      {/* Preview — overflow hidden so a too-tall card never bleeds into
          the top bar or the controls sheet. */}
      <div
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '8px 20px', minHeight: 0, overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: w * scale, height: h * scale,
            position: 'relative', borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
            backgroundColor: photoTransparent ? '#FFFFFF' : 'transparent',
            backgroundImage: photoTransparent
              ? 'linear-gradient(45deg, #d6d6d6 25%, transparent 25%), linear-gradient(-45deg, #d6d6d6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d6d6d6 75%), linear-gradient(-45deg, transparent 75%, #d6d6d6 75%)'
              : 'none',
            backgroundSize: photoTransparent ? '20px 20px' : 'auto',
            backgroundPosition: photoTransparent ? '0 0, 0 10px, 10px -10px, -10px 0px' : 'auto',
          }}
        >
          {composedUrl ? (
            // Composed photo+overlay → show the actual composite (what ships).
            <img src={composedUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div
              style={{
                transform: `scale(${scale})`, transformOrigin: 'top left',
                width: w, height: h,
              }}
            >
              <ShareTplCardio w={w} h={h} {...tplProps} />
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen preview — static fit-to-screen look at what gets shared */}
      <PreviewOverlay
        open={previewFull}
        onClose={() => setPreviewFull(false)}
        w={composedUrl ? ShareExportSizes.story.w : w}
        h={composedUrl ? ShareExportSizes.story.h : h}
      >
        {composedUrl
          ? <img src={composedUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <ShareTplCardio w={w} h={h} {...tplProps} />}
      </PreviewOverlay>

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

      {/* Second offscreen, always opaque. IG Feed/Reels flatten alpha to
          black, so even when the user picked Clear background we need a
          properly rendered opaque image for those destinations — re-
          rasterizing the transparent cardRef can't help (the DOM itself
          painted transparent). This sibling always renders with
          transparent=false; the Feed handler rasterizes it. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', left: -99999, top: 0,
          pointerEvents: 'none',
          width: exportSize.w, height: exportSize.h,
        }}
      >
        <div ref={cardOpaqueRef} style={{ width: exportSize.w, height: exportSize.h }}>
          <ShareTplCardio w={exportSize.w} h={exportSize.h} {...tplProps} transparent={false} />
        </div>
      </div>

      {/* Overlay-only (transparent, no photo) @ 1080×1920 — the draggable
          sticker source for the photo composer. */}
      {variant === 'photo' && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', width: ShareExportSizes.story.w, height: ShareExportSizes.story.h }}
        >
          <div ref={overlayCardRef} style={{ width: ShareExportSizes.story.w, height: ShareExportSizes.story.h }}>
            <ShareTplCardio w={ShareExportSizes.story.w} h={ShareExportSizes.story.h} {...tplProps} backgroundSrc={undefined} transparent={true} />
          </div>
        </div>
      )}

      {/* Controls — capped to ~60% viewport with internal scrolling so the
          preview above stays visible even when the customize/photo sections
          expand. WebKit momentum scrolling kept on for iOS. */}
      <div
        style={{
          background: 'var(--color-bg-card)',
          borderTopLeftRadius: 26, borderTopRightRadius: 26,
          paddingTop: 10,
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 30px)',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.25)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 320ms cubic-bezier(0.2,0.9,0.3,1)',
          maxHeight: '60vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
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
                  onClick={() => { setClearBackground(false); takeBackgroundPhoto(); }}
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
                  <CameraIcon size={14} />
                  {t('cardio.share.takePhoto', 'Take photo')}
                </button>
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
              </div>
              {/* Clear-background toggle. Tapping clears the picked photo
                  AND turns on transparent export so the card lands on
                  alpha — Strava Stats Sticker UX for cardio runs. */}
              <button
                type="button"
                onClick={() => { setBackgroundSrc(null); setClearBackground(!clearBackground || !!backgroundSrc); }}
                aria-pressed={photoTransparent}
                style={{
                  padding: '10px 12px', borderRadius: 12,
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
              {/* Position the stats/logo overlay anywhere on the photo, then
                  ship the flattened composite to IG/etc. — "photo still, drag
                  the thingy, goes to IG like that". */}
              <button
                type="button"
                onClick={openComposer}
                style={{
                  padding: '10px 12px', borderRadius: 12,
                  border: composedBlob ? '1.5px solid var(--color-accent)' : '1.5px dashed var(--color-border, rgba(255,255,255,0.18))',
                  background: composedBlob ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-primary)',
                  color: composedBlob ? 'var(--color-accent)' : 'var(--color-text-primary)',
                  fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  cursor: 'pointer',
                }}
              >
                <LayersIcon size={14} />
                {composedBlob
                  ? t('cardio.share.recompose', 'Re-position on photo')
                  : (backgroundSrc ? t('cardio.share.positionLayout', 'Position on photo') : t('cardio.share.compose', 'Compose with photo'))}
              </button>
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

        {/* Gym toggle + map toggle + caption */}
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
          <button
            type="button"
            onClick={() => setShowMap(s => !s)}
            style={{
              padding: '7px 12px', borderRadius: 999,
              border: `1.5px solid ${showMap ? accent : 'var(--color-border, rgba(255,255,255,0.14))'}`,
              background: showMap ? `color-mix(in srgb, ${accent} 14%, transparent)` : 'transparent',
              color: showMap ? accent : 'var(--color-text-subtle)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('cardio.share.showMap', 'Show map')}
          </button>
        </div>

        {/* Customize section — title override, accent color, theme.
            Caption was removed: IG won't accept a pre-filled caption from
            a share intent (only the media), so the input was misleading
            users. Caption is still auto-built internally from the cardio
            type for activity-feed posts / native shares. */}
        <div style={{ padding: '12px 16px 0' }}>
          <PanelLabel>{t('cardio.share.customize', 'Customize')}</PanelLabel>
          <input
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder={t('cardio.share.titlePlaceholder', 'Custom title (optional)')}
            maxLength={32}
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
          {/* Accent color swatches — each fills 1/7 of the row width so the
              picker feels deliberate (full-bleed bar) instead of a sparse
              dot row. Tap a swatch to set; tap the reset row below. */}
          <div style={{ display: 'flex', gap: 4, marginTop: 10, alignItems: 'stretch' }}>
            {['#2EC4C4', '#FF5A2E', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F59E0B'].map((c) => {
              const active = (customAccent || accent).toUpperCase() === c.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCustomAccent(c)}
                  aria-label={t('cardio.share.accentColor', { defaultValue: 'Accent {{c}}', c })}
                  style={{
                    flex: 1, height: 32, borderRadius: 8,
                    background: c,
                    border: active ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                    boxShadow: active ? `inset 0 0 0 2px var(--color-bg-card)` : 'none',
                    cursor: 'pointer', padding: 0, minWidth: 0,
                  }}
                />
              );
            })}
          </div>
          {customAccent && (
            <button
              type="button"
              onClick={() => setCustomAccent(null)}
              style={{
                marginTop: 6, fontSize: 11, fontWeight: 700,
                color: 'var(--color-text-subtle)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                textDecoration: 'underline', padding: 0,
              }}
            >
              {t('cardio.share.resetAccent', 'Reset')}
            </button>
          )}
          {/* Light/Dark theme toggle — only relevant for editorial + bold */}
          {(variant === 'editorial' || variant === 'bold') && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, background: 'var(--color-bg-primary)', padding: 3, borderRadius: 12 }}>
              {[
                { id: 'dark', label: t('cardio.share.themeDark', 'Dark') },
                { id: 'light', label: t('cardio.share.themeLight', 'Light') },
              ].map(m => (
                <button
                  key={m.id} type="button" onClick={() => setThemeMode(m.id)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 9,
                    border: 'none', cursor: 'pointer',
                    background: themeMode === m.id ? 'var(--color-bg-card)' : 'transparent',
                    color: themeMode === m.id ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                    fontSize: 12, fontWeight: 700,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
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
            <Dest active={activeDest === 'fb'} onClick={() => { setActiveDest('fb'); setFormat('square'); }} label="Facebook" color="#1877F2"><FBIcon /></Dest>
            <Dest active={activeDest === 'wa'} onClick={() => { setActiveDest('wa'); setFormat('square'); }} label="WhatsApp" color="#25D366"><WAIcon /></Dest>
            <Dest active={activeDest === 'im'} onClick={() => { setActiveDest('im'); setFormat('square'); }} label="Messages" color="#34C759"><MsgIcon /></Dest>
            <Dest active={activeDest === 'tu'} onClick={() => { setActiveDest('tu'); setFormat('square'); }} label={profile?.gym_name || 'TuGymPR'} color="var(--color-accent)"><TuShareIcon /></Dest>
            <Dest active={activeDest === 'save'} onClick={() => setActiveDest('save')} label={t('cardio.share.save', 'Save')} color="#5A6570" light><SaveIcon /></Dest>
          </div>
        </div>

        {/* CTA — adaptive color/label/glyph per destination */}
        <div style={{ padding: '14px 16px 0' }}>
          <ShareCtaButton
            dest={activeDest}
            busy={busy}
            accent={customAccent || accent}
            gymLabel={profile?.gym_name}
            onClick={handleCta}
            t={t}
          />
        </div>
      </div>

      {/* Photo composer — make the photo still, drag the stats/logo overlay
          anywhere, then the flattened composite ships to every destination. */}
      <StickerComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        stickerSrc={composerStickerSrc}
        initialPhotoSrc={composerInitialPhoto}
        onDone={(blob) => { setComposedBlob(blob); setComposerOpen(false); }}
      />
    </div>,
    document.body
  );
}
