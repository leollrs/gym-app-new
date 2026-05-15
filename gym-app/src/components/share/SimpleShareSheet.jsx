import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { shareBlob } from '../ShareCardRenderer';
import { rasterizeNode } from './ShareSheet';
import { ShareFormats, ShareExportSizes, TuFont } from './ShareFormats';
import { shareToInstagramStory, isInstagramStoriesAvailable } from '../../lib/instagramShare';

// Single-template share sheet for the lighter share surfaces (PR, streak
// milestone, monthly recap, body composition). It mirrors the workout
// ShareSheet's plumbing — format selector, sticker toggle, native + direct
// destinations — but drops the multi-template chooser, since these cards
// have a single canonical layout per type.
//
// Pass `renderCard(w, h, { transparent, accent })` to draw the actual
// template. The sheet handles export sizing, rasterization, and share dest.

function PanelLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800,
      color: 'var(--color-text-subtle)',
      letterSpacing: 1.4, textTransform: 'uppercase',
    }}>{children}</div>
  );
}

function Dest({ children, label, color, active, onClick, light }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
        minWidth: 58,
      }}
    >
      <div style={{
        width: 54, height: 54, borderRadius: 16,
        background: light ? 'var(--color-bg-card, #F2F2EF)' : color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: active ? '2.5px solid var(--color-text-primary)' : 'none',
        color: light ? 'var(--color-text-primary)' : '#fff',
        transition: 'transform 160ms',
        transform: active ? 'scale(1.04)' : 'scale(1)',
      }}>{children}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</div>
    </button>
  );
}

const IGIcon  = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="#fff"/></svg>;
const WAIcon  = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.4A10 10 0 1012 2zm5 14.3c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-4.2-1.2a10 10 0 01-4.3-5.4c-.3-.9.4-1.6.7-2 .3-.2.6-.2.8-.2h.5c.2 0 .4 0 .6.4l.8 2c.1.2 0 .4-.1.5l-.3.4c-.1.2-.3.3-.1.6a7 7 0 003.4 3c.3.2.5.1.7 0l.6-.7c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.5.3 0 .2 0 .9-.2 1.3z"/></svg>;
const MsgIcon = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.1 6.1L4 22l4.7-2.5c1 .3 2.2.5 3.3.5 5.5 0 10-3.8 10-8.5S17.5 2 12 2z"/></svg>;
const SaveIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A0D10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/></svg>;

function Toggle({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
        border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border, rgba(255,255,255,0.14))'}`,
        background: on ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
        color: on ? 'var(--color-accent)' : 'var(--color-text-subtle)',
        fontSize: 11, fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
      <div style={{
        width: 12, height: 12, borderRadius: 6,
        background: on ? 'var(--color-accent)' : 'transparent',
        border: on ? 'none' : '1.5px solid var(--color-border, rgba(255,255,255,0.14))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {on && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1.5 4l1.8 1.8L6.5 2.5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      {children}
    </button>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title              Header title for the sheet.
 * @param {string} props.shareLink          Deep-link URL attached to text shares.
 * @param {string} props.shareText          Pre-filled caption / share message.
 * @param {string} [props.accent]           Override accent (default teal).
 * @param {string} [props.defaultCaption]   Initial caption string.
 * @param {(opts: { w: number, h: number, transparent: boolean, accent: string }) => React.ReactNode} props.renderCard
 *                                          Render the actual card body at the
 *                                          given size. Called twice: once for
 *                                          the on-screen preview and once for
 *                                          the offscreen full-res export.
 * @param {boolean} [props.allowSticker]    Show the sticker (transparent) toggle.
 *                                          Default true.
 */
export default function SimpleShareSheet({
  open,
  onClose,
  title,
  shareLink,
  shareText,
  accent = '#2EC4C4',
  defaultCaption,
  renderCard,
  allowSticker = true,
}) {
  const { t } = useTranslation('pages');
  const [format, setFormat] = useState('story');
  const [sticker, setSticker] = useState(false);
  const [caption, setCaption] = useState('');
  const [activeDest, setActiveDest] = useState('ig-story');
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const cardRef = useRef(null);

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
    if (open && !caption) setCaption(defaultCaption || shareText || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { w, h } = ShareFormats[format];
  const maxW = 300;
  const maxH = 440;
  const scale = Math.min(maxW / w, maxH / h, 1);

  const buildCard = useCallback(async () => {
    if (!cardRef.current) return null;
    const exp = ShareExportSizes[format];
    return await rasterizeNode(cardRef.current, exp.w, exp.h, { transparent: sticker });
  }, [format, sticker]);

  const handleDest = useCallback(async (dest) => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await buildCard();
      const text = caption?.trim() || shareText || 'TuGymPR';
      const full = shareLink ? `${text}\n${shareLink}` : text;

      if (dest === 'save') {
        if (blob) {
          const reader = new FileReader();
          const b64 = await new Promise((res) => {
            reader.onloadend = () => res(String(reader.result).split(',')[1]);
            reader.readAsDataURL(blob);
          });
          try {
            await Filesystem.writeFile({
              path: `tugympr-share-${Date.now()}.png`,
              data: b64,
              directory: Directory.Documents,
            });
          } catch {
            await shareBlob(blob, 'tugympr-share.png', full);
          }
        }
      } else if (dest === 'ig-story') {
        let landedInIG = false;
        if (blob && await isInstagramStoriesAvailable()) {
          const ig = await shareToInstagramStory(
            sticker
              ? { stickerBlob: blob, contentURL: shareLink }
              : { backgroundBlob: blob, contentURL: shareLink }
          );
          landedInIG = ig.ok;
        }
        if (!landedInIG && blob) await shareBlob(blob, 'tugympr-share.png', full);
      } else if (dest === 'wa' || dest === 'im' || dest === 'ig-feed' || dest === 'more') {
        if (blob) {
          await shareBlob(blob, 'tugympr-share.png', full);
        } else {
          try { await Share.share({ title: 'TuGymPR', text: full, url: shareLink }); } catch {}
        }
      }
    } catch (err) {
      console.warn('[SimpleShareSheet] share failed', err);
    } finally {
      setBusy(false);
      onClose?.();
    }
  }, [buildCard, caption, shareLink, shareText, onClose, busy, sticker]);

  if (!mounted) return null;

  const exportSize = ShareExportSizes[format];

  return createPortal(
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(10,13,16,0.72)',
      backdropFilter: 'blur(14px)',
      WebkitBackdropFilter: 'blur(14px)',
      display: 'flex', flexDirection: 'column',
      opacity: visible ? 1 : 0,
      transition: 'opacity 220ms ease-out',
    }}>
      {/* Top bar */}
      <div style={{
        padding: 'max(env(safe-area-inset-top, 0px), 44px) 16px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        color: '#fff',
      }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{
          width: 36, height: 36, borderRadius: 18, border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.14)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <X size={18} color="#fff" />
        </button>
        <div style={{ fontFamily: TuFont.display, fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: '#fff' }}>
          {title}
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Preview */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 20px', minHeight: 0,
      }}>
        <div style={{
          width: w * scale, height: h * scale,
          position: 'relative', borderRadius: 24, overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
          background: sticker ? 'rgba(80,80,80,0.25)' : 'transparent',
          backgroundImage: sticker
            ? `repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 50% / 16px 16px`
            : undefined,
        }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: w, height: h }}>
            {renderCard({ w, h, transparent: sticker, accent })}
          </div>
        </div>
      </div>

      {/* Offscreen full-res render for export */}
      <div aria-hidden="true" style={{
        position: 'fixed', left: -99999, top: 0, pointerEvents: 'none',
        width: exportSize.w, height: exportSize.h,
      }}>
        <div ref={cardRef} style={{ width: exportSize.w, height: exportSize.h }}>
          {renderCard({ w: exportSize.w, h: exportSize.h, transparent: sticker, accent })}
        </div>
      </div>

      {/* Controls */}
      <div style={{
        background: 'var(--color-bg-card)',
        borderTopLeftRadius: 26, borderTopRightRadius: 26,
        paddingTop: 10,
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 30px)',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.25)',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 320ms cubic-bezier(0.2,0.9,0.3,1)',
      }}>
        <div style={{
          width: 40, height: 4, borderRadius: 2,
          background: 'var(--color-border, rgba(255,255,255,0.14))',
          margin: '4px auto 10px',
        }}/>

        {/* Format */}
        <div style={{ padding: '4px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.format', 'Format')}</PanelLabel>
          <div style={{
            display: 'flex', gap: 6, marginTop: 6,
            background: 'var(--color-bg-primary)', padding: 3, borderRadius: 12,
          }}>
            {Object.entries(ShareFormats).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setFormat(k)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 9,
                  border: 'none', cursor: 'pointer',
                  background: format === k ? 'var(--color-bg-card)' : 'transparent',
                  boxShadow: format === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  color: format === k ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                  fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}>
                {k === 'story' ? '9:16 Story' : k === 'square' ? '1:1 Feed' : '4:5 Portrait'}
              </button>
            ))}
          </div>
        </div>

        {/* Sticker toggle */}
        {allowSticker && (
          <div style={{ padding: '14px 16px 0' }}>
            <Toggle on={sticker} onClick={() => setSticker(!sticker)}>
              {t('share.stickerMode', 'Sticker mode (overlay on your photo)')}
            </Toggle>
          </div>
        )}

        {/* Caption */}
        <div style={{ padding: '14px 16px 0' }}>
          <PanelLabel>{t('sessionSummary.share.caption', 'Caption')}</PanelLabel>
          <input value={caption} onChange={(e) => setCaption(e.target.value)}
            style={{
              width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 12,
              border: '1px solid var(--color-border, rgba(255,255,255,0.14))',
              background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
              fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            }}/>
        </div>

        {/* Destinations */}
        <div style={{ padding: '14px 0 0 16px' }}>
          <PanelLabel>{t('sessionSummary.share.shareTo', 'Share to')}</PanelLabel>
          <div style={{
            display: 'flex', gap: 10, marginTop: 8,
            overflowX: 'auto', paddingRight: 16, paddingBottom: 4, scrollbarWidth: 'none',
          }}>
            <Dest active={activeDest === 'ig-story'} onClick={() => setActiveDest('ig-story')} label="IG Story" color="#E1306C"><IGIcon /></Dest>
            <Dest active={activeDest === 'ig-feed'}  onClick={() => setActiveDest('ig-feed')}  label="IG Feed"  color="#C13584"><IGIcon /></Dest>
            <Dest active={activeDest === 'wa'}       onClick={() => setActiveDest('wa')}       label="WhatsApp" color="#25D366"><WAIcon /></Dest>
            <Dest active={activeDest === 'im'}       onClick={() => setActiveDest('im')}       label="Messages" color="#34C759"><MsgIcon /></Dest>
            <Dest active={activeDest === 'save'}     onClick={() => setActiveDest('save')}     label="Save"     color="#5A6570" light><SaveIcon /></Dest>
          </div>
        </div>

        {/* Confirm */}
        <div style={{ padding: '14px 16px 0' }}>
          <button type="button" onClick={() => handleDest(activeDest)} disabled={busy}
            style={{
              width: '100%', padding: '14px', borderRadius: 14, border: 'none',
              cursor: busy ? 'default' : 'pointer',
              background: 'var(--color-text-primary)', color: 'var(--color-bg-card)',
              fontFamily: TuFont.display, fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? t('sessionSummary.generating', 'Generating…') : t('sessionSummary.share.shareNow', 'Share now')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
