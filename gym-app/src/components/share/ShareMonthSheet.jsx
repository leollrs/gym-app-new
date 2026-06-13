// ShareMonthSheet.jsx — redesigned "Share month" surface (Wrapped × Strava).
//
// Pulls the card designs from the Claude Design handoff (ShareMonthCard.jsx)
// and wires the canonical send-to-IG pipeline used elsewhere in the app:
//   render the chosen card at 1080×1920 → shareToInstagramStory (direct,
//   one tap) → native-share fallback when Instagram isn't installed.
//
// Per product direction: the send is a SINGLE direct action — no format
// picker, no destination grid. You flip which flex card to post, optionally
// flip on sticker mode, and tap once to land straight in IG Stories. Auto
// 9:16 / 1080×1920 (the IG Story size) so it never clips.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Download, Loader2 } from 'lucide-react';
import { Share } from '@capacitor/share';
import { saveBlob } from '../../lib/saveBlob';
import { shareBlob } from '../ShareCardRenderer';
import { rasterizeNode, urlToDataUrl } from './ShareSheet';
import { ShareExportSizes } from './ShareFormats';
import { shareToInstagramStory, isInstagramStoriesAvailable } from '../../lib/instagramShare';
import { shareToInstagramFeed, isInstagramInstalled, shareToWhatsApp, shareToMessages, isWhatsAppInstalled, canShareViaMessages } from '../../lib/socialShare';
import { ShareMonthCard, SM_CARD_IDS, buildShareMonthData, smVol } from './ShareMonthCard';

// dark sheet chrome (only the CARDS go vivid — the app sheet stays dark,
// matching the design's smonth-kit SM tokens)
const C = {
  bg: '#0B0E11', panel: '#15191E', panel2: '#1E242B',
  border: 'rgba(255,255,255,0.08)', borderHi: 'rgba(255,255,255,0.16)',
  text: '#F4F7F9', textSub: '#9AA6B1', textMute: '#5C6772',
  accent: '#2EC4C4', accentDim: 'rgba(46,196,196,0.16)', cream: '#ECEAE3',
};
const FONT_D = '"Familjen Grotesk","Archivo",system-ui,sans-serif';

// 9:16 story preview, fit inside a box
function previewDims(maxW, maxH) {
  const ar = 9 / 16;
  let h = maxH, w = h * ar;
  if (w > maxW) { w = maxW; h = w / ar; }
  return { w: Math.round(w), h: Math.round(h) };
}

export default function ShareMonthSheet({ open, onClose, recap, monthSessions = [], monthPRs = [], user, gym, gymLogoUrl, shareLink }) {
  const { t, i18n } = useTranslation('pages');
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [styleId, setStyleId] = useState('volume');
  const [sticker, setSticker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeDest, setActiveDest] = useState('ig-story');
  // Story (9:16) or Feed (1:1). The recap cards scale to fit either via
  // smScale, so the same designs render correctly for both sizes.
  const [format, setFormat] = useState('story');
  // Gym logo pre-resolved to a data URL (same pattern the other sheets use).
  // The card's <img> is then ALREADY inlined before rasterization, so the logo
  // survives the export instead of relying on the rasterizer's inline step.
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (open) { setMounted(true); requestAnimationFrame(() => setVisible(true)); }
    else if (mounted) { setVisible(false); const tm = setTimeout(() => setMounted(false), 300); return () => clearTimeout(tm); }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  // Resolve the gym logo (https → inline data URL) on open so the recap card's
  // <img> is already a data URL by share time — the logo then survives the
  // export (matches how the workout/cardio/achievement sheets do it).
  useEffect(() => {
    let cancelled = false;
    if (!open || !gymLogoUrl || String(gymLogoUrl).startsWith('data:')) { setLogoDataUrl(null); return undefined; }
    urlToDataUrl(gymLogoUrl).then((d) => { if (!cancelled) setLogoDataUrl(d); });
    return () => { cancelled = true; };
  }, [open, gymLogoUrl]);

  // Map recap + this month's data → card data (memo-free; cheap, and recap
  // identity is stable while the sheet is open). Use the inlined logo when ready.
  const data = recap ? buildShareMonthData({ recap, monthSessions, monthPRs, user, gym, gymLogoUrl: logoDataUrl || gymLogoUrl, t, lang: i18n.language }) : null;

  // Story → 1080×1920 (9:16); Feed → 1080×1080 (1:1).
  const exp = format === 'feed' ? ShareExportSizes.square : ShareExportSizes.story;
  const prev = format === 'feed' ? { w: 300, h: 300 } : previewDims(248, 372);

  const buildBlob = useCallback(async () => {
    if (!cardRef.current) return null;
    return await rasterizeNode(cardRef.current, exp.w, exp.h, { transparent: sticker });
  }, [exp.w, exp.h, sticker]);

  const caption = data
    ? t('shareMonth.caption', '{{month}} {{year}} on {{gym}} — {{n}} workouts 💪', {
        month: data.monthLabel, year: data.year, n: data.workouts, gym: gym || 'TuGymPR',
      })
    : (gym || 'TuGymPR');
  const fullText = shareLink ? `${caption}\n${shareLink}` : caption;

  // ── share to the chosen destination (not IG-only — everyone can share) ──
  // ig-story → straight to IG Stories; wa/im → native share sheet (pick any
  // app: WhatsApp, Messages, Mail, …); save → write the PNG to files.
  const handleDest = useCallback(async (dest) => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await buildBlob();
      if (dest === 'save') {
        // saveBlob → Cache + native share sheet ("Save Image") / web download.
        // Old code wrote to Directory.Documents (app sandbox) — image was lost.
        if (blob) await saveBlob(`tugympr-month-${Date.now()}.png`, blob);
      } else if (dest === 'ig-story') {
        let landed = false;
        if (blob && await isInstagramStoriesAvailable()) {
          const ig = await shareToInstagramStory(
            sticker ? { stickerBlob: blob, contentURL: shareLink }
                    : { backgroundBlob: blob, contentURL: shareLink }
          );
          landed = ig.ok;
        }
        // Fallback (web / Android / IG not installed): native share sheet.
        if (!landed && blob) await shareBlob(blob, 'tugympr-month.png', fullText);
      } else if (dest === 'ig-feed') {
        // IG Feed: save the image to Photos and open IG's library picker with
        // it pre-selected (same flow as the workout/cardio sheets).
        let landed = false;
        if (blob && await isInstagramInstalled()) {
          const res = await shareToInstagramFeed({ blob });
          landed = res.ok;
        }
        if (!landed && blob) await shareBlob(blob, 'tugympr-month.png', fullText);
      } else if (dest === 'wa') {
        // WhatsApp: attach the IMAGE via the native helper (not a link). Falls
        // back to the OS share sheet (still image-first via shareBlob).
        let landed = false;
        if (blob && await isWhatsAppInstalled()) { const r = await shareToWhatsApp({ blob, text: fullText }); landed = r.ok; }
        if (!landed && blob) await shareBlob(blob, 'tugympr-month.png', fullText);
      } else if (dest === 'im') {
        // Messages: attach the IMAGE via the native composer (not a link).
        let landed = false;
        if (blob && await canShareViaMessages()) { const r = await shareToMessages({ blob, text: fullText }); landed = r.ok; }
        if (!landed && blob) await shareBlob(blob, 'tugympr-month.png', fullText);
      } else {
        // fb / other → OS share sheet (image-first; Facebook has no clean
        // image deep-link without the FB SDK, so you tap Facebook there).
        if (blob) await shareBlob(blob, 'tugympr-month.png', fullText);
        else await Share.share({ title: gym || 'TuGymPR', text: fullText, url: shareLink });
      }
    } catch (err) {
      console.warn('[ShareMonthSheet] share failed', err);
    } finally {
      setBusy(false);
      onClose?.();
    }
  }, [busy, buildBlob, sticker, shareLink, fullText, gym, onClose]);

  if (!mounted || !data) return null;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', flexDirection: 'column',
      justifyContent: 'flex-end', fontFamily: FONT_D }}>
      {/* scrim */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(5,7,9,0.66)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        opacity: visible ? 1 : 0, transition: 'opacity 280ms ease' }}/>

      {/* sheet */}
      <div role="dialog" aria-modal="true" aria-label={t('shareMonth.title', 'Share month')}
        style={{ position: 'relative', background: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
          maxHeight: '94dvh', overflowY: 'auto', boxShadow: '0 -16px 50px rgba(0,0,0,0.5)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 360ms cubic-bezier(.32,.72,0,1)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 18px)' }}>

        {/* faint app-behind glow */}
        <div style={{ position: 'absolute', top: -40, left: -30, width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(46,196,196,0.10), transparent 70%)', pointerEvents: 'none' }}/>

        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 4px' }}>
          <button type="button" onClick={onClose} aria-label={t('shareMonth.close', 'Close')}
            style={{ width: 38, height: 38, borderRadius: 19, border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={17} color={C.text}/>
          </button>
          <div style={{ fontWeight: 700, fontSize: 19, color: C.text, letterSpacing: -0.3 }}>{t('shareMonth.title', 'Share month')}</div>
          <div style={{ width: 38 }}/>
        </div>

        {/* preview */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0 14px' }}>
          <div style={{ width: prev.w, height: prev.h, borderRadius: sticker ? 18 : 22, overflow: 'hidden',
            boxShadow: '0 18px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
            background: sticker ? 'repeating-linear-gradient(135deg,#262b33 0 16px,#1d2229 16px 32px)' : 'transparent' }}>
            <ShareMonthCard id={styleId} data={data} w={prev.w} h={prev.h} sticker={sticker}/>
          </div>
        </div>

        {/* format — Story 9:16 / Feed 1:1 (cards scale to fit either) */}
        <div style={{ padding: '0 18px 6px' }}>
          <div style={{ display: 'flex', gap: 6, background: C.panel2, padding: 3, borderRadius: 12 }}>
            {[{ id: 'story', label: t('shareMonth.story', 'Story') }, { id: 'feed', label: t('shareMonth.feed', 'Feed') }].map(o => {
              const on = format === o.id;
              return (
                <button key={o.id} type="button" onClick={() => setFormat(o.id)} style={{
                  flex: 1, padding: '9px 4px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: on ? C.accent : 'transparent', color: on ? '#04201F' : C.textSub,
                  fontWeight: 800, fontSize: 13, fontFamily: FONT_D }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* card style flip */}
        <div style={{ padding: '0 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: C.textMute }}>
            {t('shareMonth.cardStyle', 'Card style')}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 9, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            {SM_CARD_IDS.map(c => {
              const on = styleId === c.id;
              return (
                <button key={c.id} type="button" onClick={() => setStyleId(c.id)} style={{
                  flex: '0 0 auto', cursor: 'pointer', textAlign: 'left', padding: '9px 14px', borderRadius: 13,
                  background: on ? C.accentDim : C.panel2, border: `1px solid ${on ? C.accent : 'transparent'}` }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: on ? C.accent : C.text,
                    letterSpacing: -0.2, whiteSpace: 'nowrap' }}>{t(c.labelKey, c.labelDefault)}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* sticker toggle */}
        <div style={{ padding: '14px 18px 0' }}>
          <button type="button" onClick={() => setSticker(s => !s)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
            padding: '13px 16px', borderRadius: 14, textAlign: 'left',
            background: sticker ? C.accentDim : 'transparent', border: `1px solid ${sticker ? C.accent : C.border}` }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0,
              border: `2px solid ${sticker ? C.accent : C.textMute}`, background: sticker ? C.accent : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {sticker && <div style={{ width: 8, height: 8, borderRadius: 4, background: C.bg }}/>}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{t('shareMonth.stickerMode', 'Sticker mode')}</div>
              <div style={{ fontSize: 12, color: C.textSub, marginTop: 1 }}>{t('shareMonth.stickerDesc', 'Overlay the recap on your own photo')}</div>
            </div>
          </button>
        </div>

        {/* destinations — share anywhere, not just IG (matches the other sheets) */}
        <div style={{ padding: '16px 18px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: 'uppercase', color: C.textMute, marginBottom: 10 }}>
            {t('shareMonth.shareTo', 'Share to')}
          </div>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
            <SMDest active={activeDest === 'ig-story'} onClick={() => { setActiveDest('ig-story'); setFormat('story'); }} label="IG Story" color="#E1306C"><IGGlyph size={21}/></SMDest>
            <SMDest active={activeDest === 'ig-feed'} onClick={() => { setActiveDest('ig-feed'); setFormat('feed'); }} label="IG Feed" color="#C13584"><IGGlyph size={21}/></SMDest>
            <SMDest active={activeDest === 'fb'} onClick={() => setActiveDest('fb')} label="Facebook" color="#1877F2"><FBGlyph/></SMDest>
            <SMDest active={activeDest === 'wa'} onClick={() => setActiveDest('wa')} label="WhatsApp" color="#25D366"><WAGlyph/></SMDest>
            <SMDest active={activeDest === 'im'} onClick={() => setActiveDest('im')} label={t('shareMonth.messages', 'Messages')} color="#34C759"><MsgGlyph/></SMDest>
            <SMDest active={activeDest === 'save'} onClick={() => setActiveDest('save')} label={t('shareMonth.saveShort', 'Save')} color="#5A6570"><Download size={19} color="#fff"/></SMDest>
          </div>
        </div>

        {/* confirm CTA — adapts to the chosen destination */}
        <div style={{ padding: '16px 18px', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
          <button type="button" onClick={() => handleDest(activeDest)} disabled={busy} style={{
            width: '100%', padding: 17, borderRadius: 16, border: 'none', cursor: busy ? 'default' : 'pointer',
            background: (activeDest === 'ig-story' || activeDest === 'ig-feed')
              ? 'linear-gradient(135deg,#FEDA75,#FA7E1E 28%,#D62976 62%,#962FBF 100%)'
              : activeDest === 'fb' ? '#1877F2'
              : C.accent,
            color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={18} className="animate-spin"/> : <DestGlyph dest={activeDest}/>}
            {busy
              ? t('shareMonth.preparing', 'Preparing…')
              : (activeDest === 'ig-story' || activeDest === 'ig-feed') ? t('shareMonth.shareToIG', 'Share to Instagram')
              : activeDest === 'fb' ? t('shareMonth.shareToFB', 'Share to Facebook')
              : activeDest === 'save' ? t('shareMonth.save', 'Save image')
              : t('shareMonth.shareNow', 'Share')}
          </button>
        </div>
      </div>

      {/* off-screen export node @ 1080×1920 (the rasterize source) */}
      <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', opacity: 0 }} aria-hidden="true">
        <div ref={cardRef} style={{ width: exp.w, height: exp.h }}>
          <ShareMonthCard id={styleId} data={data} w={exp.w} h={exp.h} sticker={sticker}/>
        </div>
      </div>
    </div>,
    document.body
  );
}

// A single share-destination tile (icon chip + label), matching the other sheets.
function SMDest({ active, onClick, label, color, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
      background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, minWidth: 58, fontFamily: FONT_D }}>
      <div style={{ width: 54, height: 54, borderRadius: 16, background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: active ? '2.5px solid #fff' : '2.5px solid transparent',
        boxShadow: active ? '0 0 0 3px rgba(255,255,255,0.16)' : 'none',
        transform: active ? 'scale(1.05)' : 'scale(1)', transition: 'transform 150ms' }}>
        {children}
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: active ? C.text : C.textSub }}>{label}</span>
    </button>
  );
}

function WAGlyph() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.4A10 10 0 1012 2zm5 14.3c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-4.2-1.2a10 10 0 01-4.3-5.4c-.3-.9.4-1.6.7-2 .3-.2.6-.2.8-.2h.5c.2 0 .4 0 .6.4l.8 2c.1.2 0 .4-.1.5l-.3.4c-.1.2-.3.3-.1.6a7 7 0 003.4 3c.3.2.5.1.7 0l.6-.7c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.5.3 0 .2 0 .9-.2 1.3z"/></svg>;
}

function MsgGlyph() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.1 6.1L4 22l4.7-2.5c1 .3 2.2.5 3.3.5 5.5 0 10-3.8 10-8.5S17.5 2 12 2z"/></svg>;
}

function FBGlyph() {
  return <svg width="14" height="22" viewBox="0 0 320 512" fill="#fff" aria-hidden="true"><path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"/></svg>;
}

// Icon shown inside the confirm CTA — mirrors the active destination.
function DestGlyph({ dest }) {
  if (dest === 'wa') return <WAGlyph/>;
  if (dest === 'im') return <MsgGlyph/>;
  if (dest === 'fb') return <FBGlyph/>;
  if (dest === 'save') return <Download size={18} color="#fff"/>;
  return <IGGlyph size={19}/>; // ig-story + ig-feed
}

function IGGlyph({ size = 20, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.1">
      <rect x="3" y="3" width="18" height="18" rx="5.4"/><circle cx="12" cy="12" r="4.2"/>
      <circle cx="17.4" cy="6.6" r="1.2" fill={color} stroke="none"/></svg>
  );
}

// re-export for any caller that wants the volume formatter
export { smVol };
