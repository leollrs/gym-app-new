import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Image as ImageIcon, Sparkles } from 'lucide-react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { shareBlob } from '../ShareCardRenderer';
import { shareToInstagramStory, isInstagramStoriesAvailable } from '../../lib/instagramShare';
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
            <path d="M1.5 4l1.8 1.8L6.5 2.5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {children}
    </button>
  );
}

function Dest({ children, label, color, active, onClick, light }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        minWidth: 58,
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
    st: (
      // Sticker preview: transparent backdrop (checkerboard hint) with a
      // small frosted-glass pill — mirrors how the export will overlay on
      // the user's IG Story photo.
      <div
        style={{
          position: 'absolute',
          inset: 3,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundImage:
            'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%), linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%)',
          backgroundSize: '6px 6px',
          backgroundPosition: '0 0, 3px 3px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: '78%',
            padding: '4px 5px',
            borderRadius: 4,
            background: 'rgba(10,13,16,0.85)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div style={{ height: 2, width: '40%', background: '#2EC4C4', borderRadius: 1 }} />
          <div style={{ height: 6, width: '90%', background: '#fff', borderRadius: 1 }} />
          <div style={{ display: 'flex', gap: 2, marginTop: 1 }}>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
          </div>
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
export async function rasterizeNode(node, targetW, targetH, { transparent = false } = {}) {
  const rect = node.getBoundingClientRect();
  const srcW = Math.max(1, Math.round(rect.width));
  const srcH = Math.max(1, Math.round(rect.height));
  const scale = Math.min(targetW / srcW, targetH / srcH);

  // Clone the node and inline enough to survive serialization.
  const clone = node.cloneNode(true);
  const xml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${srcW}" height="${srcH}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${srcW}px;height:${srcH}px;">
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
  // Sticker mode is now derived from the active template — picking the
  // 'sticker' chip in the Style row IS the toggle. Renamed back to a derived
  // value to avoid the state-vs-string desync that bit us earlier.
  const sticker = template === 'sticker';
  const [caption, setCaption] = useState('');
  const [activeDest, setActiveDest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [backgroundSrc, setBackgroundSrc] = useState(null);
  const cardRef = useRef(null);
  // Second offscreen card kept permanently at IG Stories' 1080×1920. The
  // user-picked format drives Save / Copy / IG Feed sizing, but IG Stories
  // expects a 9:16 background image — anything else lands letterboxed in
  // the middle of the canvas and the user sees a postage-stamp card.
  const igStoryCardRef = useRef(null);
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

  const { w, h } = ShareFormats[format];
  const maxW = 300;
  const maxH = 440;
  const scale = Math.min(maxW / w, maxH / h, 1);

  const renderedAccent = template === 'poster' ? '#FF5A2E' : accent;

  // Transparency is requested either by the user-facing "Sticker" toggle OR by
  // picking the dedicated Sticker template (its canvas is already transparent;
  // the export must carry alpha for the IG Stories sticker pasteboard slot to
  // accept it). Computed once so buildCard + the IG handler stay in sync.
  const isTransparentExport = sticker || template === 'sticker';

  const buildCard = useCallback(async () => {
    if (!cardRef.current) return null;
    const exp = ShareExportSizes[format];
    // rasterizeNode skips the opaque black fillRect when transparent=true so
    // the rasterized PNG keeps its alpha channel.
    return await rasterizeNode(cardRef.current, exp.w, exp.h, { transparent: isTransparentExport });
  }, [format, isTransparentExport]);

  const handleDest = useCallback(async (dest) => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await buildCard();
      const link = `https://tugympr.app/share/${data?.sessionId || 'workout'}`;
      const text = caption?.trim() || data?.name || 'TuGymPR';
      const full = `${text}\n${link}`;

      if (dest === 'link') {
        try { await navigator.clipboard.writeText(link); } catch {}
      } else if (dest === 'save') {
        if (blob) {
          // Convert blob to base64 for Capacitor Filesystem
          const reader = new FileReader();
          const b64 = await new Promise((resolve) => {
            reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
            reader.readAsDataURL(blob);
          });
          try {
            await Filesystem.writeFile({
              path: `tugympr-workout-${Date.now()}.png`,
              data: b64,
              directory: Directory.Documents,
            });
          } catch {
            // web fallback
            await shareBlob(blob, 'tugympr-workout.png', full);
          }
        }
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
        let storyBlob = null;
        const igStory = ShareExportSizes.story;
        if (igStoryCardRef.current) {
          storyBlob = await rasterizeNode(
            igStoryCardRef.current, igStory.w, igStory.h,
            { transparent: isTransparentExport },
          );
        }
        if (!storyBlob) storyBlob = blob; // defensive fallback to format export
        let landedInIG = false;
        if (storyBlob && await isInstagramStoriesAvailable()) {
          const ig = await shareToInstagramStory(
            isTransparentExport
              ? { stickerBlob: storyBlob, contentURL: link }
              : { backgroundBlob: storyBlob, contentURL: link }
          );
          landedInIG = ig.ok;
        }
        if (!landedInIG && storyBlob) {
          await shareBlob(storyBlob, 'tugympr-workout.png', full);
        }
      } else if (dest === 'wa' || dest === 'im' || dest === 'ig-feed') {
        // IG Feed has no published deep-link scheme for pre-loading an image
        // (Stories is the only one Instagram exposes), so all of these route
        // through the native share sheet. iOS surfaces IG/WhatsApp/Messages
        // tiles inline and the user picks the destination.
        if (blob) {
          await shareBlob(blob, 'tugympr-workout.png', full);
        } else {
          try {
            await Share.share({
              title: 'TuGymPR',
              text: full,
              url: link,
              dialogTitle: dest === 'wa' ? 'WhatsApp' : dest === 'im' ? 'Messages' : 'Share',
            });
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[ShareSheet] share failed', err);
    } finally {
      setBusy(false);
      onClose?.();
    }
  }, [buildCard, caption, data, profile, user, onClose, busy, isTransparentExport]);

  const handleCta = () => {
    if (!activeDest) return;
    handleDest(activeDest);
  };

  if (!mounted) return null;

  const templateProps = {
    w, h,
    data: data || {},
    showGym, showExactWeights, showMuscles, showPRs,
    accent: renderedAccent,
    backgroundSrc: template === 'photo' ? backgroundSrc : undefined,
    // Sticker template handles its own transparent bg internally; the four
    // full-bleed templates ignore this prop. Kept here so a future template
    // refit can opt in without touching the renderer.
    transparent: false,
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
        <div style={{ width: 36 }} />
      </div>

      {/* Preview */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 20px',
          minHeight: 0,
        }}
      >
        <div
          style={{
            width: w * scale,
            height: h * scale,
            position: 'relative',
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: w, height: h }}>
            {renderTemplate(effectiveTemplate, templateProps)}
          </div>
        </div>
      </div>

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

      {/* Controls panel */}
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
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={pickBackgroundPhoto}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1.5px dashed var(--color-border, rgba(255,255,255,0.18))',
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
                  ? t('sessionSummary.share.changePhoto', 'Change background photo')
                  : t('sessionSummary.share.pickPhoto', 'Pick background photo')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onFileChange}
                style={{ display: 'none' }}
              />
            </div>
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

        {/* Caption */}
        <div style={{ padding: '14px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.caption', 'Caption')}</PanelLabel>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
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
            <Dest active={activeDest === 'ig-feed'} onClick={() => setActiveDest('ig-feed')} label="IG Feed" color="#C13584">
              <IGIcon />
            </Dest>
            <Dest active={activeDest === 'wa'} onClick={() => setActiveDest('wa')} label="WhatsApp" color="#25D366">
              <WAIcon />
            </Dest>
            <Dest active={activeDest === 'im'} onClick={() => setActiveDest('im')} label={t('share.destMessages', { defaultValue: 'Messages' })} color="#34C759">
              <MsgIcon />
            </Dest>
            <Dest active={activeDest === 'tu'} onClick={() => setActiveDest('tu')} label="TuGymPR" color="var(--color-accent)">
              <TuShareIcon />
            </Dest>
            <Dest active={activeDest === 'save'} onClick={() => setActiveDest('save')} label={t('sessionSummary.share.save', 'Save')} color="#5A6570" light>
              <SaveIcon />
            </Dest>
            <Dest active={activeDest === 'link'} onClick={() => setActiveDest('link')} label={t('sessionSummary.share.copyLink', 'Copy link')} color="#5A6570" light>
              <LinkIcon />
            </Dest>
          </div>
        </div>

        {/* Confirm CTA */}
        <div style={{ padding: '14px 16px 0' }}>
          <button
            type="button"
            onClick={handleCta}
            disabled={!activeDest || busy}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 14,
              border: 'none',
              cursor: activeDest && !busy ? 'pointer' : 'default',
              background: activeDest ? 'var(--color-text-primary)' : 'var(--color-bg-primary)',
              color: activeDest ? 'var(--color-bg-card)' : 'var(--color-text-muted)',
              fontFamily: TuFont.display,
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: -0.2,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy
              ? t('sessionSummary.generating', 'Generating...')
              : activeDest
                ? t('sessionSummary.share.shareNow', 'Share now')
                : t('sessionSummary.share.pickDestination', 'Pick a destination')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
