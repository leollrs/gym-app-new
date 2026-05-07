import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sliders, Copy, MoreHorizontal } from 'lucide-react';
import { STRATA_FONT_DISPLAY, STRATA_HOT } from './strataTokens';
import ShareCard, { sessionFromFeedItem } from './ShareCard';

// Tiny inline icons for the share targets so this file has no asset deps.
function TargetIcon({ kind, color }) {
  if (kind === 'story' || kind === 'reels') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <rect x="5" y="2" width="14" height="20" rx="3" />
        {kind === 'reels' && <path d="M10 9l5 3-5 3z" fill={color} stroke="none" />}
      </svg>
    );
  }
  if (kind === 'square') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    );
  }
  if (kind === 'x') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill={color}>
        <path d="M18.244 3H21.5l-7.31 8.36L22.5 21h-6.86l-5.37-7.02L3.96 21H.7l7.79-8.91L.5 3h7.04l4.85 6.42L18.244 3zm-1.2 16.2h1.83L7.04 4.7H5.07l11.97 14.5z" />
      </svg>
    );
  }
  if (kind === 'link') return <Copy size={20} color={color} strokeWidth={1.8} />;
  return <MoreHorizontal size={20} color={color} strokeWidth={1.8} />;
}

const TARGETS = [
  { id: 'story',  labelKey: 'share.targetStory',    labelDefault: 'Story',     icon: 'story',  fmt: 'story',    tpl: 'photo' },
  { id: 'square', labelKey: 'share.targetPost',     labelDefault: 'Post',      icon: 'square', fmt: 'square',   tpl: 'photo' },
  { id: 'reels',  labelKey: 'share.targetReels',    labelDefault: 'Reels',     icon: 'reels',  fmt: 'reels',    tpl: 'photo' },
  { id: 'x',      labelKey: 'share.targetX',        labelDefault: 'X',         icon: 'x',      fmt: 'x',        tpl: 'stats' },
  { id: 'copy',   labelKey: 'share.targetCopyLink', labelDefault: 'Copy link', icon: 'link' },
  { id: 'more',   labelKey: 'share.targetMore',     labelDefault: 'More…',     icon: 'more' },
];

export default function ShareSheet({
  open, item, profile, gymName = 'TuGymPR', onClose, onCustomize, onShareTo, t,
}) {
  // lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !item) return null;
  const session = sessionFromFeedItem(item, profile);

  const subtitle = [
    session.duration > 0 && `${session.duration}m`,
    session.volume > 0 && `${(session.volume / 1000).toFixed(1)}k lb`,
    session.prCount > 0 && `${session.prCount} PR`,
  ].filter(Boolean).join(' · ');

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('social.share', 'Share')}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(10,13,16,0.55)',
          backdropFilter: 'blur(4px)',
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 480,
          background: 'var(--color-bg-card)',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
          animation: 'sheetUp 220ms cubic-bezier(0.2,0.9,0.3,1) both',
        }}
      >
        <style>{`
          @keyframes sheetUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>

        {/* drag handle */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 999,
            background: 'var(--color-border-strong)',
            margin: '12px auto 14px',
          }}
        />

        {/* mini preview strip */}
        <div className="flex items-center gap-3" style={{ padding: '0 18px 14px' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 10,
              overflow: 'hidden',
              flexShrink: 0,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <ShareCard
              format="square"
              template="photo"
              displayW={52}
              branding={false}
              accent={STRATA_HOT}
              filter="moody"
              stats={['duration', 'pr']}
              session={session}
              gymName={gymName}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: 'var(--color-text-primary)',
                letterSpacing: -0.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {session.title}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted)',
                marginTop: 2,
              }}
            >
              {subtitle || t('social.shareSubtitle', 'Tap a target to share')}
            </div>
          </div>
        </div>

        {/* sheet header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '4px 18px 14px' }}
        >
          <div
            style={{
              fontFamily: STRATA_FONT_DISPLAY,
              fontSize: 18,
              fontWeight: 800,
              color: 'var(--color-text-primary)',
              letterSpacing: -0.4,
            }}
          >
            {t('social.share', 'Share')}
          </div>
          <button
            type="button"
            onClick={() => onCustomize?.(item)}
            className="inline-flex items-center gap-1.5"
            style={{
              padding: '7px 12px',
              borderRadius: 999,
              background: 'color-mix(in srgb, var(--color-accent, #2EC4C4) 15%, transparent)',
              color: 'var(--color-accent, #2EC4C4)',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.2,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Sliders size={12} strokeWidth={2.4} />
            {t('social.customize', 'Customize')}
          </button>
        </div>

        {/* targets grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            padding: '0 8px 4px',
            rowGap: 14,
          }}
        >
          {TARGETS.map((tg) => (
            <button
              key={tg.id}
              type="button"
              onClick={() => onShareTo?.(tg, item)}
              className="flex flex-col items-center gap-1.5 transition-transform active:scale-95"
              style={{
                padding: '4px 4px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 13,
                  background: 'var(--color-bg-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <TargetIcon kind={tg.icon} color="var(--color-text-primary)" />
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  textAlign: 'center',
                  letterSpacing: -0.1,
                }}
              >
                {t(tg.labelKey, tg.labelDefault)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
