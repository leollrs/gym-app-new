import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Image as ImageIcon, Sparkles, Layers as LayersIcon } from 'lucide-react';
import StickerComposer from './StickerComposer';
import PreviewOverlay from './PreviewOverlay';
import ShareCtaButton from './ShareCtaButton';
import { Share } from '@capacitor/share';
import { saveBlob } from '../../lib/saveBlob';
import posthogClient from 'posthog-js';
import { supabase } from '../../lib/supabase';
import { appShareUrl } from '../../lib/appUrls';
import { useAuth } from '../../contexts/AuthContext';
import { shareBlob } from '../ShareCardRenderer';
import { shareToInstagramStory, isInstagramStoriesAvailable } from '../../lib/instagramShare';
import {
  shareToMessages,
  shareToWhatsApp,
  shareToInstagramFeed,
  canShareViaMessages,
  isWhatsAppInstalled,
  isInstagramInstalled,
} from '../../lib/socialShare';
import ShareTplEditorial from './ShareTplEditorial';
import ShareTplBoldSport from './ShareTplBoldSport';
import ShareTplPoster from './ShareTplPoster';
import ShareTplPhoto from './ShareTplPhoto';
import ShareTplSticker from './ShareTplSticker';
import { ShareFormats, ShareExportSizes, TuFont } from './ShareFormats';

// Destination icons (ported from reference)
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
// color (var(--color-text-primary)) — stays visible on the neutral chip in
// BOTH light and dark mode. (Was hardcoded near-black → invisible in dark.)
const SaveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
  </svg>
);

function PanelLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 800,
        color: 'var(--color-text-subtle)',
        letterSpacing: 1.4,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

function FormatIcon({ fmt, color }) {
  const spec = { story: [8, 12], square: [10, 10], portrait: [9, 11] }[fmt];
  return <div style={{ width: spec[0], height: spec[1], border: `1.5px solid ${color}`, borderRadius: 2 }} />;
}

function Toggle({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border, rgba(255,255,255,0.14))'}`,
        background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
        color: on ? 'var(--color-accent)' : 'var(--color-text-subtle)',
        fontSize: 11,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          background: on ? 'var(--color-accent)' : 'transparent',
          border: on ? 'none' : '1.5px solid var(--color-border, rgba(255,255,255,0.14))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on && (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <path d="M1.5 4l1.8 1.8L6.5 2.5" stroke="var(--color-text-on-accent, #fff)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {children}
    </button>
  );
}

function Dest({ children, label, color, active, onClick, light, disabled }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        minWidth: 58,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: 16,
          background: light ? 'var(--color-bg-card, #F2F2EF)' : color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: active ? '2.5px solid var(--color-text-primary)' : 'none',
          color: light ? 'var(--color-text-primary)' : '#fff',
          transition: 'transform 160ms',
          transform: active ? 'scale(1.04)' : 'scale(1)',
        }}
      >
        {children}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</div>
    </button>
  );
}

function TemplateChip({ active, onClick, label, preview }) {
  const previews = {
    ed: (
      <div style={{ position: 'absolute', inset: 3, borderRadius: 6, background: '#FAFAF7', padding: 4 }}>
        <div style={{ height: 3, width: '60%', background: '#2EC4C4', borderRadius: 1 }} />
        <div style={{ height: 2, width: '80%', background: '#0A0D10', borderRadius: 1, marginTop: 2 }} />
        <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          <div style={{ flex: 1, height: 8, background: '#0A0D10', borderRadius: 1 }} />
          <div style={{ flex: 1, height: 8, background: '#0A0D10', borderRadius: 1 }} />
        </div>
      </div>
    ),
    bd: (
      <div
        style={{
          position: 'absolute',
          inset: 3,
          borderRadius: 6,
          background: '#0A0D10',
          padding: 4,
          backgroundImage: 'radial-gradient(ellipse at 30% 20%, #2EC4C4aa 0%, transparent 60%)',
        }}
      >
        <div style={{ height: 2, width: '40%', background: '#2EC4C4', borderRadius: 1 }} />
        <div style={{ height: 3, width: '80%', background: '#fff', borderRadius: 1, marginTop: 2 }} />
        <div style={{ height: 10, width: '60%', background: '#fff', borderRadius: 1, marginTop: 4 }} />
      </div>
    ),
    ps: (
      <div style={{ position: 'absolute', inset: 3, borderRadius: 6, background: '#EEEBE3', padding: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 12, left: -6, right: -6, height: 18, background: '#FF5A2E', transform: 'rotate(-6deg)' }} />
        <div style={{ position: 'relative', fontSize: 10, fontWeight: 900, color: '#0A0D10', lineHeight: 0.8 }}>
          LOWER<br />POWER
        </div>
      </div>
    ),
    ph: (
      <div
        style={{
          position: 'absolute',
          inset: 3,
          borderRadius: 6,
          overflow: 'hidden',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.85) 100%), linear-gradient(135deg, #5a3a2a 0%, #2a1a12 100%)',
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        <div style={{ height: 3, width: '70%', background: '#fff', borderRadius: 1 }} />
        <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
          <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.9)', borderRadius: 1 }} />
          <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.9)', borderRadius: 1 }} />
          <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.9)', borderRadius: 1 }} />
        </div>
      </div>
    ),
    // Sticker preview — checkerboard hint at transparency, frosted card on top.
    st: (
      <div
        style={{
          position: 'absolute',
          inset: 3,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: '#1a1d22',
          backgroundImage:
            'linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.05) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.05) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.05) 75%)',
          backgroundSize: '6px 6px',
          backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '75%',
            padding: 3,
            borderRadius: 4,
            background: 'rgba(10,13,16,0.78)',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <div style={{ height: 2, width: '60%', background: '#2EC4C4', borderRadius: 1 }} />
          <div style={{ height: 6, width: '80%', background: '#fff', borderRadius: 1, marginTop: 2 }} />
        </div>
      </div>
    ),
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        aspectRatio: '1/1.1',
        borderRadius: 10,
        cursor: 'pointer',
        border: active
          ? '2px solid var(--color-accent)'
          : '1.5px solid var(--color-border, rgba(255,255,255,0.14))',
        background: 'var(--color-bg-card)',
        padding: 0,
      }}
    >
      {previews[preview]}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: active ? 'var(--color-accent)' : 'var(--color-text-subtle)',
        }}
      >
        {label}
      </div>
    </button>
  );
}

// ── Template resolver ──────────────────────────────────────────────────────
// `template === 'sticker'` is the transparent-background variant — overlays
// the user's IG Story photo (Strava Stats Sticker pattern). All other ids
// resolve to the existing full-bleed designs.
function renderTemplate(template, props) {
  if (template === 'sticker') return <ShareTplSticker {...props} />;
  if (template === 'editorial') return <ShareTplEditorial {...props} />;
  if (template === 'bold') return <ShareTplBoldSport {...props} />;
  if (template === 'photo') return <ShareTplPhoto {...props} />;
  return <ShareTplPoster {...props} />;
}

// ── DOM → PNG blob via SVG foreignObject rasterization ─────────────────────
// `transparent: true` skips the black background fill so the exported PNG
// carries alpha — needed for the IG Stories sticker / Strava-style overlay
// flow where the user composes our card on top of their own photo.
async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function rasterizeNode(node, targetW, targetH, { transparent = false } = {}) {
  const rect = node.getBoundingClientRect();
  const srcW = Math.max(1, Math.round(rect.width));
  const srcH = Math.max(1, Math.round(rect.height));
  const scale = Math.min(targetW / srcW, targetH / srcH);

  // Clone the node and inline enough to survive serialization.
  const clone = node.cloneNode(true);
  // Inline any external <img> (e.g. the gym logo) as a data URL. The SVG raster
  // can't fetch external URLs, so without this the logo is blank in the EXPORT
  // even when it loads fine in the live preview. Doing it here (not just in the
  // sheet) also kills the race where the user shares before a pre-fetch lands.
  try {
    const imgs = clone.querySelectorAll ? Array.from(clone.querySelectorAll('img')) : [];
    await Promise.all(imgs.map(async (im) => {
      const src = im.getAttribute('src');
      if (src && /^https?:/i.test(src)) {
        const d = await urlToDataUrl(src);
        if (d) im.setAttribute('src', d);
      }
    }));
  } catch { /* best-effort — fall through with whatever resolved */ }
  const xml = new XMLSerializer().serializeToString(clone);
  // Inline the brand fonts (Anton / Archivo / Archivo Black / Familjen Grotesk)
  // as base64 @font-face so the EXPORT renders the real typeface. The page's web
  // fonts aren't available in the SVG-as-image context, so without this the
  // upload falls back to a system font and looks different from the preview.
  // Bundled (not fetched) → always available; dynamic-imported so the ~200KB of
  // base64 stays out of the main bundle until the first share.
  let fontCss = '';
  try { fontCss = (await import('./embeddedFonts')).SHARE_FONT_CSS || ''; } catch { /* fall back to system */ }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${srcW}" height="${srcH}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${srcW}px;height:${srcH}px;">
        ${fontCss ? `<style>${fontCss}</style>` : ''}
        ${xml}
      </div>
    </foreignObject>
  </svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);
  const ctx = canvas.getContext('2d');
  if (!transparent) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
}

// Inline a remote image as a base64 data URL. The SVG-foreignObject rasterizer
// (rasterizeNode) renders the card via an <img src="data:image/svg+xml,…">, and
// browsers REFUSE to load external resources (https <img>) inside an SVG that's
// being painted as an image — so the gym logo (a Supabase URL) came out blank in
// the exported PNG even though it rendered fine in the live DOM preview. Fetching
// it to a data URL up front means the logo is embedded inline and survives the
// rasterization. Supabase storage allows cross-origin GET and CSP connect-src
// includes supabase, so the fetch works; on any failure we return null and the
// template falls back to its no-logo (initial/box) treatment.
export async function urlToDataUrl(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return url || null;
  // 1) fetch → blob → data URL. Works when connect-src + CORS allow it.
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      const d = await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result));
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
      if (d) return d;
    }
  } catch { /* fall through to the <img> path */ }
  // 2) Fallback: load via a crossOrigin <img> and read it back off a canvas.
  // Supabase signed URLs display fine as an <img> (the preview proves it) but
  // their fetch() can be blocked by a cross-host redirect / CSP — the image
  // path isn't, and a CORS-clean image draws to canvas without tainting it.
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 256;
          c.height = img.naturalHeight || 256;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } catch {
    return null;
  }
}

// ── Main component ─────────────────────────────────────────────────────────
// `kind` controls what the card describes. Defaults to 'workout' for back-compat.
//   - 'workout' → full session summary (volume / sets / PRs)
//   - 'pr'      → single PR card (data.prExercise, data.prValue, data.prPrevious)
//   - 'streak'  → streak milestone (data.streakDays, data.streakSubtitle)
//   - 'monthly' → monthly recap (data.workoutsCount, data.prCount, data.monthLabel)
//   - 'body'    → body progress (data.beforeUrl, data.afterUrl, data.weeks)
// The sticker template reads `kind` directly. For the 4 full-bleed templates
// only 'workout' is supported today; the other kinds default to sticker.
export default function ShareSheet({ open, onClose, data, accent = '#2EC4C4', kind = 'workout' }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  // Default to 'sticker' for non-workout kinds (PR / streak / monthly / body)
  // — those are conceptually small achievement cards designed to overlay on
  // a user photo, not full-bleed posters. Workout summaries keep 'editorial'
  // as the default for back-compat with every existing call site.
  const [template, setTemplate] = useState(kind === 'workout' ? 'editorial' : 'sticker');
  const [format, setFormat] = useState('story');
  const [showGym, setShowGym] = useState(true);
  const [showExactWeights, setShowExactWeights] = useState(true);
  const [showMuscles, setShowMuscles] = useState(true);
  const [showPRs, setShowPRs] = useState(true);
  // Sticker mode is derived from the active template — picking the 'sticker'
  // chip in the Style row IS the toggle. For the Photo template we also want
  // a "clear background" affordance the user can flip without leaving the
  // Photo style (Strava's Stats Sticker UX). Tracking that intent in its
  // own state so the button next to the photo picker has something to bind
  // to — previous version called `setSticker(...)` which doesn't exist now
  // that sticker is derived, so the button silently no-op'd on tap.
  const sticker = template === 'sticker';
  const [clearBackground, setClearBackground] = useState(false);
  const [caption, setCaption] = useState('');
  const [customAccent, setCustomAccent] = useState(null);
  const [customTitle, setCustomTitle] = useState('');
  const [themeMode] = useState('dark'); // locked to 'dark' (original) — Light option removed
  const [previewFull, setPreviewFull] = useState(false);
  // Sticker composer state: when the user composes the sticker onto a photo
  // in-app, the resulting blob overrides buildCard so every destination
  // (IG Story / Save / Copy) ships the already-flattened image instead of
  // the transparent sticker.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerStickerSrc, setComposerStickerSrc] = useState(null);
  // The photo the composer opens with as its fixed background. For the Photo
  // template this is the user's picked photo (so they drag the stats/logo over
  // it); for the Sticker template it's null (they pick one inside the composer).
  const [composerInitialPhoto, setComposerInitialPhoto] = useState(null);
  const [composedBlob, setComposedBlob] = useState(null);
  const [activeDest, setActiveDest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [backgroundSrc, setBackgroundSrc] = useState(null);
  // Gym logo inlined as a data URL (see urlToDataUrl) so it survives the SVG
  // rasterization and actually appears in the exported/shared image.
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const cardRef = useRef(null);
  // Second offscreen card kept permanently at IG Stories' 1080×1920. The
  // user-picked format drives Save / Copy / IG Feed sizing, but IG Stories
  // expects a 9:16 background image — anything else lands letterboxed in
  // the middle of the canvas and the user sees a postage-stamp card.
  const igStoryCardRef = useRef(null);
  // Third offscreen card always rendered with transparent=false. IG Feed /
  // Reels flatten alpha to black, so re-rasterizing the user's transparent
  // cardRef can't help (the DOM is transparent — painting black behind it
  // is still black). This sibling holds an always-opaque copy.
  const cardOpaqueRef = useRef(null);
  // Overlay-only (transparent, no photo) render of the active template at story
  // size — the source we rasterize as the draggable "sticker" when the user
  // composes the card over their own photo (Photo / Sticker templates).
  const overlayCardRef = useRef(null);
  const fileInputRef = useRef(null);

  // Photo picker: prefer Capacitor Camera, fall back to hidden file input.
  const pickBackgroundPhoto = useCallback(async () => {
    try {
      const mod = await import('@capacitor/camera');
      const { Camera, CameraSource, CameraResultType } = mod;
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        resultType: CameraResultType.DataUrl,
        quality: 85,
        allowEditing: false,
      });
      if (photo?.dataUrl) {
        setBackgroundSrc(photo.dataUrl);
        return;
      }
    } catch {
      // fall through to web fallback
    }
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

  // Mount / unmount with CSS transitions.
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

  // Body scroll lock.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // Pre-fill caption once
  useEffect(() => {
    if (open && !caption) {
      const nm = data?.name || t('sessionSummary.workoutComplete', 'Workout complete');
      setCaption(nm);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the gym logo (https → inline data URL) when the sheet opens so it
  // renders in the exported PNG, not just the live preview.
  useEffect(() => {
    let cancelled = false;
    const src = data?.gymLogoUrl;
    if (!open || !src || String(src).startsWith('data:')) { setLogoDataUrl(null); return undefined; }
    urlToDataUrl(src).then((d) => { if (!cancelled) setLogoDataUrl(d); });
    return () => { cancelled = true; };
  }, [open, data?.gymLogoUrl]);

  const { w, h } = ShareFormats[format];
  // Preview shares the viewport with a 60vh controls sheet + ~70px top bar;
  // 28vh keeps the card inside the visible flex slot without bleeding into
  // the top bar or pushing under the controls sheet.
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 390;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const maxW = Math.min(320, vw - 48);
  const maxH = Math.min(vh * 0.28, 380);
  const scale = Math.min(maxW / w, maxH / h, 1);

  // The user's accent override (from the customize picker) wins over the
  // gym accent. Poster historically forces orange, but a user-picked accent
  // should win there too so the picker isn't a no-op on that template.
  const renderedAccent = customAccent || (template === 'poster' ? '#FF5A2E' : accent);

  // Transparency is requested either by the user-facing "Sticker" toggle OR by
  // picking the dedicated Sticker template (its canvas is already transparent;
  // the export must carry alpha for the IG Stories sticker pasteboard slot to
  // accept it). Computed once so buildCard + the IG handler stay in sync.
  // Transparency request: dedicated Sticker template, OR the Photo template
  // with the user's "Clear background" toggle on and no photo picked. The
  // raster + IG pasteboard slot both follow this flag.
  const isTransparentExport =
    sticker
    || template === 'sticker'
    || (template === 'photo' && clearBackground && !backgroundSrc);

  const buildCard = useCallback(async () => {
    // When the user has composed the sticker onto a photo in-app, that
    // single composite is the source of truth — every destination should
    // ship the already-flattened image instead of going back to the raw
    // transparent card.
    if (composedBlob) return composedBlob;
    if (!cardRef.current) return null;
    const exp = ShareExportSizes[format];
    // rasterizeNode skips the opaque black fillRect when transparent=true so
    // the rasterized PNG keeps its alpha channel.
    return await rasterizeNode(cardRef.current, exp.w, exp.h, { transparent: isTransparentExport });
  }, [format, isTransparentExport, composedBlob]);

  // Drop the composed blob whenever anything visual changes — the card it
  // was built from is stale and shipping it would mislead the user.
  // NOTE: deliberately NOT keyed on `format` — the composite is always 1080×1920
  // and format-independent, so changing the format selector (or a destination
  // that switches format) must not discard the user's composed layout.
  useEffect(() => {
    setComposedBlob(null);
  }, [template, customAccent, customTitle, themeMode, showGym, showExactWeights, showMuscles, showPRs, backgroundSrc]);

  // When the user finishes composing, the output is always 1080×1920 (story
  // ratio). Auto-steer the destination to IG Story so the CTA button is
  // immediately ready, and non-story dests are disabled in the Dest row.
  useEffect(() => {
    if (composedBlob) setActiveDest('ig-story');
  }, [composedBlob]);

  // Object URL for the composed photo so the preview shows EXACTLY what will be
  // shared (the user's positioned overlay), not the default template layout.
  const [composedUrl, setComposedUrl] = useState(null);
  useEffect(() => {
    if (!composedBlob) { setComposedUrl(null); return undefined; }
    const url = URL.createObjectURL(composedBlob);
    setComposedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [composedBlob]);

  // Open the composer: rasterize the OVERLAY ONLY (transparent, no photo) as
  // the sticker the user drags over a photo. For the Photo template their
  // picked photo becomes the composer's fixed background (so they position the
  // stats/logo on it); for the Sticker template they pick a photo in-composer.
  const openComposer = useCallback(async () => {
    const node = overlayCardRef.current || cardRef.current;
    if (!node) return;
    try {
      const blob = await rasterizeNode(node, ShareExportSizes.story.w, ShareExportSizes.story.h, { transparent: true });
      if (!blob) return;
      const dataUrl = await blobToDataUrl(blob);
      setComposerStickerSrc(dataUrl);
      setComposerInitialPhoto(template === 'photo' ? (backgroundSrc || null) : null);
      setComposerOpen(true);
      // Force story format so the composite (1080×1920) lines up with the
      // destination dimensions when the user shares.
      setFormat('story');
    } catch (err) {
      console.warn('[ShareSheet] composer open failed:', err?.message);
    }
  }, [template, backgroundSrc]);

  const handleDest = useCallback(async (dest) => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await buildCard();
      // Download-oriented link: a non-user who taps it lands on the app's
      // "Get the app" page (/get), not the bare web app.
      const link = appShareUrl('workout', data?.sessionId);
      const text = caption?.trim() || data?.name || profile?.gym_name || 'TuGymPR';
      const full = `${text}\n${link}`;

      if (dest === 'save') {
        // Save to the user's library. saveBlob → Directory.Cache + native share
        // sheet ("Save Image") on iOS/Android, real <a download> on web. The old
        // code wrote to Directory.Documents — the app's private sandbox — so the
        // PNG silently vanished where the user could never reach it.
        if (blob) await saveBlob(`tugympr-workout-${Date.now()}.png`, blob);
      } else if (dest === 'tu') {
        // Create a post in activity_feed_items (existing social post mechanism).
        if (user?.id && profile?.gym_id) {
          // Note: Supabase doesn't throw on Postgres errors — it returns them
          // in `error`. Catching the promise alone hides every failure.
          const { error: postErr } = await supabase.from('activity_feed_items').insert({
            actor_id: user.id,
            gym_id: profile.gym_id,
            type: 'user_post',
            post_type: 'user',
            is_public: true,
            body: text,
            data: {
              body: text,
              session_id: data?.sessionId || null,
              workout_name: data?.name || null,
              duration_seconds: data?.durationSeconds || null,
              total_volume_lbs: data?.volume || null,
            },
          });
          if (postErr) console.error('[ShareSheet] post failed', postErr);
        }
      } else if (dest === 'ig-story') {
        // Direct deep link into the IG Stories composer — skips the native
        // share sheet middle step. Always rasterize from the dedicated
        // 9:16 offscreen card (igStoryCardRef): IG's backgroundImage slot
        // fills the 1080×1920 canvas, so any other aspect ratio would
        // letterbox the card into a tiny rectangle in the middle. The
        // user-picked format still drives Save / Copy / IG Feed exports
        // via the format-specific cardRef above.
        // A composed photo+overlay is a finished, opaque image → send it as the
        // Story BACKGROUND exactly as the user positioned it. Otherwise use the
        // dedicated 9:16 card (transparent sticker, or opaque per the template).
        let storyBlob = composedBlob || null;
        const igStory = ShareExportSizes.story;
        if (!storyBlob && igStoryCardRef.current) {
          storyBlob = await rasterizeNode(
            igStoryCardRef.current, igStory.w, igStory.h,
            { transparent: isTransparentExport },
          );
        }
        if (!storyBlob) storyBlob = blob; // defensive fallback to format export
        // Sticker only when transparent AND not a finished composite.
        const sendAsSticker = isTransparentExport && !composedBlob;
        let landedInIG = false;
        if (storyBlob && await isInstagramStoriesAvailable()) {
          // Sticker mode → IG fills the page with the gradient between
          // backgroundTopColor and backgroundBottomColor. Without these the
          // native plugin defaults to near-black and the Story looks like
          // a black-background sticker. Send the gym accent on top and a
          // deep neutral bottom so the brand color frames the sticker.
          const ig = await shareToInstagramStory(
            sendAsSticker
              ? {
                  stickerBlob: storyBlob,
                  contentURL: link,
                  backgroundTopColor: renderedAccent,
                  backgroundBottomColor: '#0A0D10',
                }
              : { backgroundBlob: storyBlob, contentURL: link }
          );
          landedInIG = ig.ok;
        }
        if (!landedInIG && storyBlob) {
          await shareBlob(storyBlob, 'tugympr-workout.png', full);
        }
      } else if (dest === 'im') {
        // iMessage composer in-app: image attached + body pre-filled, the
        // user just picks a recipient and sends. Falls through to the
        // generic share sheet if the device can't send Messages (no SIM,
        // iCloud-only iPad, web, etc).
        let landed = false;
        if (blob && await canShareViaMessages()) {
          const res = await shareToMessages({ blob, text: full });
          landed = res.ok;
        }
        if (!landed && blob) {
          await shareBlob(blob, 'tugympr-workout.png', full);
        }
      } else if (dest === 'wa') {
        // WhatsApp's "Open in WhatsApp" menu — one tap → WhatsApp opens at
        // the contact picker with the image attached. Fallback to the
        // generic sheet if WhatsApp isn't installed.
        let landed = false;
        if (blob && await isWhatsAppInstalled()) {
          const res = await shareToWhatsApp({ blob, text: full });
          landed = res.ok;
        }
        if (!landed && blob) {
          await shareBlob(blob, 'tugympr-workout.png', full);
        }
      } else if (dest === 'ig-feed') {
        // Save to Photos + open IG's library picker with our image
        // pre-selected. IG Feed/Reels flatten alpha to black, so when
        // the user picked transparency we ship the always-opaque sibling
        // copy (cardOpaqueRef) instead. Re-rasterizing cardRef with
        // transparent=false doesn't work — the DOM itself was painted
        // transparent, so the result is still black where the template
        // was meant to be empty.
        // composedBlob is already an opaque photo+overlay composite → ship it
        // directly. Otherwise, for a transparent template, render the opaque
        // sibling (IG Feed/Reels flatten alpha to black).
        let feedBlob = blob;
        if (!composedBlob && isTransparentExport && cardOpaqueRef.current) {
          try {
            const exp = ShareExportSizes[format];
            feedBlob = await rasterizeNode(
              cardOpaqueRef.current, exp.w, exp.h, { transparent: false },
            );
          } catch (e) {
            console.warn('[ShareSheet] opaque rasterize for ig-feed failed', e);
          }
        }
        let landed = false;
        if (feedBlob && await isInstagramInstalled()) {
          const res = await shareToInstagramFeed({ blob: feedBlob });
          landed = res.ok;
        }
        if (!landed && feedBlob) {
          await shareBlob(feedBlob, 'tugympr-workout.png', full);
        }
      } else if (dest === 'fb') {
        // Facebook has no clean image-to-feed deep link without bundling the FB
        // SDK, so route through the OS share sheet — the user taps Facebook there.
        if (blob) await shareBlob(blob, 'tugympr-workout.png', full);
      }
      // Reached only when the destination dispatch above didn't throw.
      try { posthogClient?.capture('content_shared', { type: kind || 'workout', dest }); } catch { /* noop */ }
    } catch (err) {
      console.warn('[ShareSheet] share failed', err);
    } finally {
      setBusy(false);
      onClose?.();
    }
  }, [buildCard, caption, data, profile, user, onClose, busy, isTransparentExport, composedBlob]);

  const handleCta = () => {
    if (!activeDest) return;
    handleDest(activeDest);
  };

  if (!mounted) return null;

  // When the user provides a custom title, override data.name so all
  // templates (which read data.name for the headline) pick it up without
  // each having to know about the customize section.
  const trimmedTitle = customTitle?.trim();
  const renderedData = {
    ...(data || {}),
    ...(trimmedTitle ? { name: trimmedTitle.slice(0, 32) } : {}),
    // Use the inlined logo data URL so the gym logo survives rasterization;
    // fall back to the raw URL if it hasn't resolved yet.
    gymLogoUrl: logoDataUrl || data?.gymLogoUrl || null,
  };

  const templateProps = {
    w, h,
    data: renderedData,
    showGym, showExactWeights, showMuscles, showPRs,
    accent: renderedAccent,
    customTitle: trimmedTitle || undefined,
    themeMode,
    backgroundSrc: template === 'photo' ? backgroundSrc : undefined,
    // When the Sticker toggle is on, render every template with a
    // transparent canvas so the exported PNG carries alpha and the user
    // can drop it over their own IG Story photo (Strava's Stats Sticker
    // pattern). Editorial/Bold drop their fill; Photo template drops
    // bg+overlay only when no user photo is picked (with a photo the
    // photo IS the design anchor, so we keep it). Poster keeps its
    // surface because the slanted accent bar IS the template.
    transparent: isTransparentExport && template !== 'poster',
    // Sticker template switches its headline by `kind` ('workout' | 'pr' |
    // 'streak' | 'monthly' | 'body'). Accept either the top-level prop on
    // the sheet (preferred) or a `data.kind` field (legacy callsites).
    kind: kind || data?.kind || 'workout',
  };

  // Full-bleed templates only support the workout kind today; non-workout
  // kinds (PR / streak / monthly / body) always render through the sticker
  // template regardless of the user's template pick. effectiveTemplate is
  // what we actually render.
  const effectiveTemplate = (kind && kind !== 'workout') ? 'sticker' : template;

  // Full-res offscreen render (used for rasterization).
  const exportSize = ShareExportSizes[format];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(10,13,16,0.72)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        display: 'flex',
        flexDirection: 'column',
        opacity: visible ? 1 : 0,
        transition: 'opacity 220ms ease-out',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: 'max(env(safe-area-inset-top, 0px), 44px) 16px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: '#fff',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('share.close', { defaultValue: 'Close' })}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            border: 'none',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.14)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={18} color="#fff" />
        </button>
        <div style={{ fontFamily: TuFont.display, fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: '#fff' }}>
          {t('sessionSummary.share.shareWorkout', 'Share workout')}
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
            backgroundColor: isTransparentExport ? '#FFFFFF' : 'transparent',
            backgroundImage: isTransparentExport
              ? 'linear-gradient(45deg, #d6d6d6 25%, transparent 25%), linear-gradient(-45deg, #d6d6d6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d6d6d6 75%), linear-gradient(-45deg, transparent 75%, #d6d6d6 75%)'
              : 'none',
            backgroundSize: isTransparentExport ? '20px 20px' : 'auto',
            backgroundPosition: isTransparentExport ? '0 0, 0 10px, 10px -10px, -10px 0px' : 'auto',
          }}
        >
          {composedUrl ? (
            // Composed photo+overlay → show the actual composite (what ships).
            <img src={composedUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: w, height: h }}>
              {renderTemplate(effectiveTemplate, templateProps)}
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
          : renderTemplate(effectiveTemplate, templateProps)}
      </PreviewOverlay>

      {/* Offscreen full-resolution card at the user's chosen format
          (drives Save / Copy / IG Feed exports). */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: -99999,
          top: 0,
          pointerEvents: 'none',
          width: exportSize.w,
          height: exportSize.h,
        }}
      >
        <div ref={cardRef} style={{ width: exportSize.w, height: exportSize.h }}>
          {renderTemplate(effectiveTemplate, { ...templateProps, w: exportSize.w, h: exportSize.h })}
        </div>
      </div>

      {/* Permanent 9:16 IG Stories card — always rendered alongside the
          format-specific one above so the IG Story dest can rasterize at the
          right aspect ratio without re-rendering on demand. Same template +
          props otherwise; only the dimensions differ. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: -99999,
          top: 0,
          pointerEvents: 'none',
          width: ShareExportSizes.story.w,
          height: ShareExportSizes.story.h,
        }}
      >
        <div ref={igStoryCardRef} style={{ width: ShareExportSizes.story.w, height: ShareExportSizes.story.h }}>
          {renderTemplate(effectiveTemplate, {
            ...templateProps,
            w: ShareExportSizes.story.w,
            h: ShareExportSizes.story.h,
          })}
        </div>
      </div>

      {/* Always-opaque offscreen card at the user's chosen format. IG Feed /
          Reels flatten alpha to black, so when the user has Clear background
          on we need a proper opaque render to ship for those destinations. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: -99999,
          top: 0,
          pointerEvents: 'none',
          width: exportSize.w,
          height: exportSize.h,
        }}
      >
        <div ref={cardOpaqueRef} style={{ width: exportSize.w, height: exportSize.h }}>
          {renderTemplate(effectiveTemplate, { ...templateProps, transparent: false, w: exportSize.w, h: exportSize.h })}
        </div>
      </div>

      {/* Overlay-only (transparent, no photo) source @ 1080×1920 — rasterized
          as the draggable sticker for the photo composer. Only rendered for the
          templates that compose over a photo. */}
      {(effectiveTemplate === 'photo' || effectiveTemplate === 'sticker') && (
        <div
          aria-hidden="true"
          style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', width: ShareExportSizes.story.w, height: ShareExportSizes.story.h }}
        >
          <div ref={overlayCardRef} style={{ width: ShareExportSizes.story.w, height: ShareExportSizes.story.h }}>
            {renderTemplate(effectiveTemplate, { ...templateProps, backgroundSrc: undefined, transparent: true, w: ShareExportSizes.story.w, h: ShareExportSizes.story.h })}
          </div>
        </div>
      )}

      {/* Controls panel — capped + internally scrollable so the preview above
          stays visible regardless of how many sections are expanded. */}
      <div
        style={{
          background: 'var(--color-bg-card)',
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
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
        {/* grip */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: 'var(--color-border, rgba(255,255,255,0.14))',
            margin: '4px auto 10px',
          }}
        />

        {/* Templates */}
        <div style={{ padding: '4px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.style', 'Style')}</PanelLabel>
          {/* 5-up grid. 'Sticker' is the Strava Stats Sticker analogue —
              transparent canvas with a centered card so the user can drop
              it over their own IG Story photo. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 6 }}>
            {[
              { id: 'editorial', label: t('sessionSummary.share.editorial', 'Editorial'), preview: 'ed' },
              { id: 'bold', label: t('sessionSummary.share.bold', 'Bold'), preview: 'bd' },
              { id: 'poster', label: t('sessionSummary.share.poster', 'Poster'), preview: 'ps' },
              { id: 'photo', label: t('sessionSummary.share.photo', 'Photo'), preview: 'ph' },
              { id: 'sticker', label: t('sessionSummary.share.sticker', 'Sticker'), preview: 'st' },
            ].map((o) => (
              <TemplateChip
                key={o.id}
                active={template === o.id}
                onClick={() => setTemplate(o.id)}
                label={o.label}
                preview={o.preview}
              />
            ))}
          </div>

          {/* Photo picker (only when photo template selected) */}
          {template === 'photo' && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { setClearBackground(false); pickBackgroundPhoto(); }}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1.5px ${backgroundSrc ? 'solid var(--color-accent)' : 'dashed var(--color-border, rgba(255,255,255,0.18))'}`,
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-primary)',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  <ImageIcon size={14} />
                  {backgroundSrc
                    ? t('sessionSummary.share.changePhoto', 'Change photo')
                    : t('sessionSummary.share.pickPhoto', 'Pick photo')}
                </button>
                {/* Clear-background toggle. Tapping clears any picked photo
                    AND flips clearBackground on, which feeds through
                    isTransparentExport → the Photo template renders on a
                    transparent canvas (Strava Stats Sticker behavior). */}
                <button
                  type="button"
                  onClick={() => {
                    setBackgroundSrc(null);
                    setClearBackground((prev) => (backgroundSrc ? true : !prev));
                  }}
                  aria-pressed={clearBackground && !backgroundSrc}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1.5px solid ${clearBackground && !backgroundSrc ? 'var(--color-accent)' : 'var(--color-border, rgba(255,255,255,0.18))'}`,
                    background: clearBackground && !backgroundSrc
                      ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                      : 'var(--color-bg-primary)',
                    color: clearBackground && !backgroundSrc ? 'var(--color-accent)' : 'var(--color-text-primary)',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  {t('sessionSummary.share.clearBackground', 'Clear background')}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {/* Compose-with-photo button — for sticker template (and photo +
              transparent mode), opens a fullscreen editor where the user
              places + resizes the sticker over a photo and exports a single
              composite image. Skips IG's double-sticker workflow. */}
          {(template === 'sticker' || template === 'photo') && (
            <button
              type="button"
              onClick={openComposer}
              style={{
                marginTop: 10, width: '100%',
                padding: '12px', borderRadius: 12,
                border: composedBlob ? '1.5px solid var(--color-accent)' : '1.5px dashed var(--color-border, rgba(255,255,255,0.18))',
                background: composedBlob
                  ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                  : 'var(--color-bg-primary)',
                color: composedBlob ? 'var(--color-accent)' : 'var(--color-text-primary)',
                fontSize: 13, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer',
              }}
            >
              <LayersIcon size={14} />
              {composedBlob
                ? t('sessionSummary.share.recompose', 'Re-position on photo')
                : (template === 'photo' && backgroundSrc)
                  ? t('sessionSummary.share.positionLayout', 'Position on photo')
                  : t('sessionSummary.share.compose', 'Compose with photo')}
            </button>
          )}
        </div>

        {/* Format */}
        <div style={{ padding: '12px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.format', 'Format')}</PanelLabel>
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 6,
              background: 'var(--color-bg-primary)',
              padding: 3,
              borderRadius: 12,
            }}
          >
            {Object.entries(ShareFormats).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormat(k)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 9,
                  border: 'none',
                  cursor: 'pointer',
                  background: format === k ? 'var(--color-bg-card)' : 'transparent',
                  boxShadow: format === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  color: format === k ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                  fontSize: 12,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <FormatIcon fmt={k} color={format === k ? 'var(--color-text-primary)' : 'var(--color-text-subtle)'} />
                {k === 'story'
                  ? t('sessionSummary.share.story', v.label)
                  : k === 'square'
                    ? t('sessionSummary.share.feed', v.label)
                    : t('sessionSummary.share.portrait', v.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Show / hide toggles */}
        <div style={{ padding: '14px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.showOnCard', 'Show on card')}</PanelLabel>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Toggle on={showGym} onClick={() => setShowGym(!showGym)}>
              {t('sessionSummary.share.gym', 'Gym')}
            </Toggle>
            <Toggle on={showPRs} onClick={() => setShowPRs(!showPRs)}>
              {t('sessionSummary.share.prs', 'PRs')}
            </Toggle>
            <Toggle on={showMuscles} onClick={() => setShowMuscles(!showMuscles)}>
              {t('sessionSummary.share.muscles', 'Muscles')}
            </Toggle>
            <Toggle on={showExactWeights} onClick={() => setShowExactWeights(!showExactWeights)}>
              {t('sessionSummary.share.exactWeights', 'Exact weights')}
            </Toggle>
          </div>
        </div>

        {/* Customize — title override, accent picker, theme.
            Caption removed: IG won't accept a pre-filled caption from a
            share intent, so it was misleading. Caption is still auto-built
            from the workout name internally for activity-feed posts. */}
        <div style={{ padding: '14px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.customize', 'Customize')}</PanelLabel>
          <input
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder={t('sessionSummary.share.titlePlaceholder', 'Custom title (optional)')}
            maxLength={32}
            style={{
              width: '100%',
              marginTop: 6,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid var(--color-border, rgba(255,255,255,0.14))',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {/* Accent color swatches — each fills 1/7 of the row width so the
              picker reads as a deliberate full-bleed bar, not a scatter
              of dots. */}
          <div style={{ display: 'flex', gap: 4, marginTop: 10, alignItems: 'stretch' }}>
            {['#2EC4C4', '#FF5A2E', '#3B82F6', '#10B981', '#EC4899', '#8B5CF6', '#F59E0B'].map((c) => {
              const active = (renderedAccent || '').toUpperCase() === c.toUpperCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCustomAccent(c)}
                  aria-label={c}
                  style={{
                    flex: 1, height: 32, borderRadius: 8,
                    background: c,
                    border: active ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                    boxShadow: active ? 'inset 0 0 0 2px var(--color-bg-card)' : 'none',
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
              {t('sessionSummary.share.resetAccent', 'Reset')}
            </button>
          )}
          {/* Light/Dark toggle removed — workout cards stay on the original
              (dark) treatment. themeMode is locked to 'dark' below. */}
        </div>

        {/* Destinations */}
        <div style={{ padding: '14px 0 0 16px' }}>
          <PanelLabel>{t('sessionSummary.share.shareTo', 'Share to')}</PanelLabel>
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 8,
              overflowX: 'auto',
              paddingRight: 16,
              paddingBottom: 4,
              scrollbarWidth: 'none',
            }}
          >
            <Dest active={activeDest === 'ig-story'} onClick={() => setActiveDest('ig-story')} label="IG Story" color="#E1306C">
              <IGIcon />
            </Dest>
            {/* When a composed photo+overlay exists it is always 1080×1920 (story
                ratio). Sending it to a square or non-story destination would crop
                or pillarbox the image. Disable non-story dests while a composition
                is active; tapping Re-position on photo resets composedBlob if
                the user picks a different format. */}
            <Dest active={activeDest === 'ig-feed'} onClick={() => setActiveDest('ig-feed')} label="IG Feed" color="#C13584" disabled={!!composedBlob}>
              <IGIcon />
            </Dest>
            <Dest active={activeDest === 'fb'} onClick={() => setActiveDest('fb')} label="Facebook" color="#1877F2" disabled={!!composedBlob}>
              <FBIcon />
            </Dest>
            <Dest active={activeDest === 'wa'} onClick={() => setActiveDest('wa')} label="WhatsApp" color="#25D366" disabled={!!composedBlob}>
              <WAIcon />
            </Dest>
            <Dest active={activeDest === 'im'} onClick={() => setActiveDest('im')} label={t('share.destMessages', { defaultValue: 'Messages' })} color="#34C759" disabled={!!composedBlob}>
              <MsgIcon />
            </Dest>
            <Dest active={activeDest === 'tu'} onClick={() => setActiveDest('tu')} label={profile?.gym_name || 'TuGymPR'} color="var(--color-accent)" disabled={!!composedBlob}>
              <TuShareIcon />
            </Dest>
            <Dest active={activeDest === 'save'} onClick={() => setActiveDest('save')} label={t('sessionSummary.share.save', 'Save')} color="#5A6570" light disabled={!!composedBlob}>
              <SaveIcon />
            </Dest>
          </div>
        </div>

        {/* Confirm CTA — adaptive color/label/glyph per destination */}
        <div style={{ padding: '14px 16px 0' }}>
          <ShareCtaButton
            dest={activeDest}
            busy={busy}
            accent={renderedAccent}
            gymLabel={renderedData?.gym?.name || profile?.gym_name}
            onClick={handleCta}
            t={t}
          />
        </div>
      </div>

      {/* Sticker composer — fullscreen editor (renders into its own portal) */}
      <StickerComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        stickerSrc={composerStickerSrc}
        initialPhotoSrc={composerInitialPhoto}
        onDone={(blob) => {
          setComposedBlob(blob);
          setComposerOpen(false);
        }}
      />
    </div>,
    document.body
  );
}
