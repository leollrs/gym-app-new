import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  X,
  Trophy,
  Dumbbell,
  Flame,
  Zap,
  Star,
  CalendarCheck,
  RotateCw,
  Rocket,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  Brain,
  Medal,
  Gem,
  Weight,
  Shield,
  Crown,
  Heart,
  Award,
  Mountain,
  Megaphone,
  Swords,
  MapPin,
  Apple,
} from 'lucide-react';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { supabase } from '../../lib/supabase';
import { PROD_WEB_URL } from '../../lib/appUrls';
import { useAuth } from '../../contexts/AuthContext';
import { shareBlob } from '../ShareCardRenderer';
import { rasterizeNode } from './ShareSheet';
import GymLockup from './GymLockup';
import { TuFont } from './ShareFormats';

// Achievement icon name → Lucide component
const ICON_MAP = {
  Dumbbell, Flame, Zap, Star, Trophy, CalendarCheck, RotateCw, Rocket,
  Target, TrendingUp, UserPlus, Users, Brain, Medal, Weight, Gem,
  Shield, Crown, Mountain, Award, Heart, Megaphone, Swords, MapPin, Apple,
};
function AchIcon({ name, size = 56, color = '#0A0D10' }) {
  const Icon = ICON_MAP[name] || Trophy;
  return <Icon size={size} color={color} strokeWidth={2} />;
}

// ── Destination chips (light set, mirrors ShareSheet) ──────────────────────
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
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-on-accent, #fff)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
          transform: active ? 'scale(1.04)' : 'scale(1)',
          transition: 'transform 160ms',
        }}
      >
        {children}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</div>
    </button>
  );
}

// ── Achievement card template (1080x1350 portrait) ─────────────────────────
function AchievementCard({ w, h, achievement, user, gym, gymLogoUrl }) {
  const pad = Math.round(w * 0.08);
  const color = achievement.color || '#D4AF37';
  const iconSize = Math.round(w * 0.22);
  const dateStr = achievement.unlockedAt
    ? new Date(achievement.unlockedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        overflow: 'hidden',
        background: '#EEEBE3',
        fontFamily: TuFont.body,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: pad,
        boxSizing: 'border-box',
      }}
    >
      {/* paper texture */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.35,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(10,13,16,0.04) 0, rgba(10,13,16,0.04) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* Soft color glow behind icon */}
      <div
        style={{
          position: 'absolute',
          top: '28%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: w * 0.8,
          height: w * 0.8,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color}40 0%, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Eyebrow */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 3,
          color,
          textTransform: 'uppercase',
          zIndex: 2,
        }}
      >
        Achievement Unlocked
      </div>

      {/* Icon badge */}
      <div
        style={{
          marginTop: pad * 0.8,
          width: iconSize + pad,
          height: iconSize + pad,
          borderRadius: (iconSize + pad) / 2,
          background: '#fff',
          border: `3px solid ${color}`,
          boxShadow: `0 12px 40px ${color}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}
      >
        <AchIcon name={achievement.icon} size={iconSize} color={color} />
      </div>

      {/* Label */}
      <div
        style={{
          marginTop: pad * 0.9,
          fontFamily: '"Archivo", "Familjen Grotesk", sans-serif',
          fontSize: Math.round(w * 0.085),
          fontWeight: 800,
          color: '#0A0D10',
          letterSpacing: -1,
          textAlign: 'center',
          lineHeight: 1,
          zIndex: 2,
        }}
      >
        {achievement.label}
      </div>

      {/* Description */}
      {achievement.description && (
        <div
          style={{
            marginTop: 14,
            fontSize: Math.round(w * 0.028),
            color: 'rgba(10,13,16,0.68)',
            textAlign: 'center',
            maxWidth: w * 0.78,
            lineHeight: 1.35,
            zIndex: 2,
          }}
        >
          {achievement.description}
        </div>
      )}

      {/* Date */}
      {dateStr && (
        <div
          style={{
            marginTop: 18,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: 'rgba(10,13,16,0.45)',
            zIndex: 2,
          }}
        >
          {dateStr}
        </div>
      )}

      {/* Footer: user + gym */}
      <div
        style={{
          position: 'absolute',
          left: pad,
          right: pad,
          bottom: pad,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: '#0A0D10' }}>
          {user ? `@${user}` : (gym?.name || 'TuGymPR')}
        </div>
        {gym ? (
          <GymLockup gym={gym} logoUrl={gymLogoUrl} size="sm" tone="dark" />
        ) : (
          <div style={{ fontFamily: TuFont.display, fontSize: 13, fontWeight: 800, color: '#0A0D10', letterSpacing: -0.3 }}>
            {gym?.name || 'TuGymPR'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ShareAchievementSheet({ open = true, onClose, achievement }) {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [activeDest, setActiveDest] = useState(null);
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
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  // Preview + export sizes (portrait 4:5)
  const previewW = 300;
  const previewH = 375;
  const exportW = 1080;
  const exportH = 1350;

  const buildCard = useCallback(async () => {
    if (!cardRef.current) return null;
    return await rasterizeNode(cardRef.current, exportW, exportH);
  }, []);

  const handleDest = useCallback(
    async (dest) => {
      if (busy || !achievement) return;
      setBusy(true);
      try {
        const blob = await buildCard();
        const link = `${PROD_WEB_URL}/share/achievement/${achievement.key || ''}`;
        const text = `${achievement.label} — ${gym?.name || 'TuGymPR'}`;
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
                path: `tugympr-achievement-${Date.now()}.png`,
                data: b64,
                directory: Directory.Documents,
              });
            } catch {
              await shareBlob(blob, 'tugympr-achievement.png', full);
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
                achievement_key: achievement.key || null,
                achievement_label: achievement.label || null,
              },
            });
            if (postErr) console.error('[ShareAchievementSheet] post failed', postErr);
          }
        } else if (dest === 'wa' || dest === 'im' || dest === 'ig-story' || dest === 'ig-feed') {
          if (blob) {
            await shareBlob(blob, 'tugympr-achievement.png', full);
          } else {
            try {
              await Share.share({ title: gym?.name || 'TuGymPR', text: full, url: link });
            } catch {}
          }
        }
      } catch (err) {
        console.warn('[ShareAchievementSheet] share failed', err);
      } finally {
        setBusy(false);
        onClose?.();
      }
    },
    [buildCard, achievement, profile, user, onClose, busy]
  );

  if (!mounted || !achievement) return null;

  const displayName =
    profile?.username || profile?.full_name || user?.email?.split('@')[0] || '';
  const gym = profile?.gym ? { name: profile.gym.name, location: profile.gym.city } : null;
  const gymLogoUrl = profile?.gym?.logo_url || null;

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
          {t('profile.shareAchievement', 'Share achievement')}
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
            width: previewW,
            height: previewH,
            position: 'relative',
            borderRadius: 24,
            overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          <AchievementCard
            w={previewW}
            h={previewH}
            achievement={achievement}
            user={displayName}
            gym={gym}
            gymLogoUrl={gymLogoUrl}
          />
        </div>
      </div>

      {/* Offscreen export-resolution card */}
      <div
        aria-hidden="true"
        style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', width: exportW, height: exportH }}
      >
        <div ref={cardRef} style={{ width: exportW, height: exportH }}>
          <AchievementCard
            w={exportW}
            h={exportH}
            achievement={achievement}
            user={displayName}
            gym={gym}
            gymLogoUrl={gymLogoUrl}
          />
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
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            background: 'var(--color-border, rgba(255,255,255,0.14))',
            margin: '4px auto 10px',
          }}
        />

        {/* Destinations */}
        <div style={{ padding: '10px 0 0 16px' }}>
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
            <Dest active={activeDest === 'im'} onClick={() => setActiveDest('im')} label="Messages" color="#34C759">
              <MsgIcon />
            </Dest>
            <Dest active={activeDest === 'tu'} onClick={() => setActiveDest('tu')} label={gym?.name || 'TuGymPR'} color="var(--color-accent)">
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

        {/* CTA */}
        <div style={{ padding: '14px 16px 0' }}>
          <button
            type="button"
            onClick={() => activeDest && handleDest(activeDest)}
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
