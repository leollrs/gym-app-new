// ── Rewards & Points Page ────────────────────────────────────────────────────
// Design: Rewards A hero/layout + Rewards B punch card style
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useCachedState, hasCachedState } from '../hooks/useCachedState';
import {
  Coins, Trophy, Gift, Crown, History, Star,
  Dumbbell, MapPin, Flame, Target, Award, Scale,
  Zap, CalendarCheck, CheckCircle2, X, ShoppingBag,
  Coffee, Ticket, Shirt, Medal, Wallet, QrCode, CreditCard,
  Check, Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { signQRPayload } from '../lib/qrSecurity';
import logger from '../lib/logger';
import { useAuth } from '../contexts/AuthContext';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import ProductQRModal from '../components/ProductQRModal';
import {
  getUserPoints,
  getRewardTier,
  getPointsHistory,
} from '../lib/rewardsEngine';
import { formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { formatStatNumber, statFontSize } from '../lib/formatStatValue';
import { Capacitor } from '@capacitor/core';
import { usePostHog } from '@posthog/react';
import { WalletPass } from '../lib/walletPass';

// ── Font stacks (Rewards A uses Familjen Grotesk + Archivo) ──────────────────
const FONT_DISPLAY = "'Familjen Grotesk', 'Archivo', system-ui, sans-serif";
const FONT_BODY = "'Archivo', 'Familjen Grotesk', system-ui, sans-serif";

// Allow-list of hostnames we are willing to open in the in-app browser /
// system browser. Prevents arbitrary navigation if a server response ever
// supplies a saveUrl we did not expect.
// TODO: extend with gymConfig.customDomain when added to gym schema
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'wallet.google.com',
  'pay.google.com',
  'apple.com',
  'www.apple.com',
  'tugympr.com',
  'www.tugympr.com',
]);

// Open an external URL using SFSafariViewController (via @capacitor/browser)
// when available, falling back to window.open for the web build.
async function openExternalUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
    if (!ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
      throw new Error(`Blocked external host: ${u.hostname}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[openExternalUrl] rejected', err);
    return;
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* swallow */ }
  }
}

// ── Action icon mapping ──────────────────────────────────────────────────────
const ACTION_META = {
  workout_completed:    { icon: Dumbbell,      color: 'var(--color-accent)', labelKey: 'workout_completed' },
  workout:              { icon: Dumbbell,      color: 'var(--color-accent)', labelKey: 'workout_completed' },
  pr_hit:               { icon: Target,        color: 'var(--color-danger)', labelKey: 'pr_hit' },
  pr:                   { icon: Target,        color: 'var(--color-danger)', labelKey: 'pr_hit' },
  check_in:             { icon: MapPin,         color: 'var(--color-success)', labelKey: 'check_in' },
  streak_day:           { icon: Flame,          color: '#F97316', labelKey: 'streak_day' },
  streak:               { icon: Flame,          color: '#F97316', labelKey: 'streak_day' },
  challenge_completed:  { icon: Trophy,         color: '#A78BFA', labelKey: 'challenge_completed' },
  challenge:            { icon: Trophy,         color: '#A78BFA', labelKey: 'challenge_completed' },
  challenge_joined:     { icon: Trophy,         color: '#A78BFA', labelKey: 'challenge_joined' },
  achievement_unlocked: { icon: Award,          color: 'var(--color-warning)', labelKey: 'achievement_unlocked' },
  achievement:          { icon: Award,          color: 'var(--color-warning)', labelKey: 'achievement_unlocked' },
  weight_logged:        { icon: Scale,          color: 'var(--color-blue-soft)', labelKey: 'weight_logged' },
  first_weekly_workout: { icon: CalendarCheck,  color: 'var(--color-success)', labelKey: 'first_weekly_workout' },
  streak_7:             { icon: Zap,            color: '#F97316', labelKey: 'streak_7' },
  streak_30:            { icon: Crown,          color: 'var(--color-accent)', labelKey: 'streak_30' },
  referral:             { icon: Gift,           color: 'var(--color-success)', labelKey: 'referral' },
  admin_gift:           { icon: Gift,           color: 'var(--color-accent)', labelKey: 'admin_gift' },
  // Refund entries written by complete_workout's reverse path when a user
  // soft-deletes a session (migration 0327). Without this map, the raw
  // action string "session_deleted" renders verbatim in the history list.
  session_deleted:      { icon: Trash2,         color: 'var(--color-text-subtle)', labelKey: 'session_deleted' },
  birthday_gift:        { icon: Gift,           color: 'var(--color-accent)', labelKey: 'birthday_gift' },
};

// Map reward icon names → lucide components
const REWARD_ICON_MAP = { Coffee, Ticket, Shirt, Dumbbell, Medal, Gift, Trophy, Star };
const RewardIcon = ({ name, size = 28, className = '' }) => {
  const Icon = REWARD_ICON_MAP[name] || Gift;
  return <Icon size={size} className={className} />;
};

// ── Tier badge component ─────────────────────────────────────────────────────
const TierBadge = ({ tier, size = 'md', t }) => {
  const sizes = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-[11px] px-3 py-1',
    lg: 'text-[11px] px-3 py-1.5',
  };
  const label = t ? t(`rewards.tiers.${tier.nameKey}`, tier.name) : tier.name;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-extrabold rounded-full ${sizes[size]}`}
      style={{
        background: `linear-gradient(180deg, ${tier.color}E8 0%, ${tier.color}C0 100%)`,
        color: '#1a1a1a',
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        fontFamily: FONT_DISPLAY,
      }}
    >
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#1a1a1a' }} />
      {label}
    </span>
  );
};

// ── Animated counter ─────────────────────────────────────────────────────────
const AnimatedPoints = ({ value }) => {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const duration = 800;
    const start = display;
    const diff = value - start;
    const startTime = Date.now();

    const step = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);

  return (
    <span className="tabular-nums">{formatStatNumber(display)}</span>
  );
};

// ── Redeem Confirmation Modal (portaled) ─────────────────────────────────────
const RedeemModal = ({ reward, points, onConfirm, onClose, t }) => {
  const canAfford = points >= reward.cost;
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleConfirm = async () => {
    setRedeeming(true);
    await onConfirm(reward);
    setRedeeming(false);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-xl bg-black/60 px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ fontFamily: FONT_BODY }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="redeem-reward-title"
          className="bg-[var(--color-bg-card)] rounded-[22px] border border-[var(--color-border-subtle)] p-6 max-w-sm w-full shadow-2xl"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h3
              id="redeem-reward-title"
              className="text-[18px] font-extrabold text-[var(--color-text-primary)] tracking-tight"
              style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.3px' }}
            >
              {t('rewards.redeemReward')}
            </h3>
            <button
              onClick={onClose}
              aria-label={t('rewards.closeDialog', { defaultValue: 'Close dialog' })}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            >
              <X size={20} />
            </button>
          </div>

          <div className="text-center py-4">
            <span className="text-[48px]">{reward.emoji_icon || '🎁'}</span>
            <p
              className="text-[17px] font-extrabold text-[var(--color-text-primary)] mt-3"
              style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.3px' }}
            >
              {reward.name}
            </p>
            {reward.description && <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{reward.description}</p>}
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Coins size={16} className="text-[var(--color-accent)]" />
              <span
                className="text-[22px] font-extrabold text-[var(--color-accent)] tabular-nums"
                style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.5px' }}
              >
                {formatStatNumber(reward.cost)}
              </span>
              <span className="text-[13px] text-[var(--color-text-muted)] font-semibold">pts</span>
            </div>
            {!canAfford && (
              <p className="text-[12px] text-[var(--color-danger)] mt-2 font-semibold">
                {t('rewards.youNeedMore', { count: formatStatNumber(reward.cost - points) })}
              </p>
            )}
          </div>

          <div className="flex gap-3 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl text-[13px] font-bold text-[var(--color-text-muted)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
              style={{ letterSpacing: '0.2px' }}
            >
              {t('rewards.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canAfford || redeeming}
              className="flex-1 py-3.5 rounded-xl text-[13px] font-extrabold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--color-accent)] text-[var(--color-text-on-accent)] hover:brightness-110"
              style={{ letterSpacing: '0.2px' }}
            >
              {redeeming ? t('rewards.redeeming') : t('rewards.confirm')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// ── Redemption QR Modal (portaled) ───────────────────────────────────────────
const RedemptionQRModal = ({ reward, redemptionId, userId, gymId, memberName, onClose }) => {
  const { t } = useTranslation('pages');
  const payload = `gym-reward:${gymId}:${userId}:${redemptionId}`;
  const [signedPayload, setSignedPayload] = useState(null);
  const [signError, setSignError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    // Signed payload is REQUIRED — the admin scanner rejects unsigned
    // `gym-reward:` QRs with "Invalid QR — please refresh in the app".
    // If signing fails, surface the error so the member knows to retry
    // instead of handing the admin a QR that can never validate.
    let cancelled = false;
    setSignedPayload(null);
    setSignError(null);
    signQRPayload(payload)
      .then((signed) => { if (!cancelled) setSignedPayload(signed); })
      .catch((err) => {
        logger.warn('signQRPayload failed (redemption)', err);
        if (!cancelled) setSignError(err?.message || 'Could not sign QR. Tap to retry.');
      });
    return () => { cancelled = true; };
  }, [payload, retryNonce]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ fontFamily: FONT_BODY }}>
      <div className="absolute inset-0 backdrop-blur-xl bg-black/60" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t('rewards.rewardRedeemed', 'Reward Redeemed')}
        className="relative w-full max-w-sm mx-4 rounded-[22px] overflow-hidden shadow-2xl"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <button
          onClick={onClose}
          aria-label={t('rewards.closeRedemptionQR', { defaultValue: 'Close redemption QR' })}
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/20 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
        >
          <X size={18} />
        </button>

        <div className="bg-gradient-to-r from-[#10B981]/15 to-[#059669]/15 flex items-center justify-center gap-2 py-3.5">
          <CheckCircle2 size={18} className="text-[#10B981]" />
          <span
            className="text-[13px] font-extrabold text-[#10B981]"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '0.3px', textTransform: 'uppercase' }}
          >
            {t('rewards.rewardRedeemed', 'Reward Redeemed')}
          </span>
        </div>

        <div className="bg-[var(--color-bg-card)] flex flex-col items-center pt-5 pb-3">
          <span className="text-[40px] mb-1">{reward.emoji_icon || '🎁'}</span>
          <p
            className="text-[18px] font-extrabold text-[var(--color-text-primary)]"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.4px' }}
          >
            {reward.name}
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{memberName}</p>
        </div>

        <div className="bg-white flex flex-col items-center px-8 py-6" role="img" aria-label={t('rewards.redemptionQRCode', 'Redemption QR code')}>
          {signedPayload ? (
            <QRCodeSVG
              value={signedPayload}
              size={220}
              level="H"
              includeMargin={false}
              bgColor="#FFFFFF"
              fgColor="#000000"
            />
          ) : signError ? (
            <button
              onClick={() => setRetryNonce(n => n + 1)}
              className="flex flex-col items-center justify-center gap-2 px-4 py-12"
              style={{ minHeight: 220 }}
            >
              <div style={{ fontSize: 32 }}>⚠️</div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C', textAlign: 'center' }}>
                {t('rewards.qrSignFailed', "Couldn't generate QR")}
              </p>
              <p style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', maxWidth: 200 }}>
                {signError}
              </p>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#2563EB', marginTop: 8 }}>
                {t('rewards.tapToRetry', 'Tap to retry')}
              </p>
            </button>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3" style={{ minHeight: 220 }}>
              <div
                className="w-8 h-8 rounded-full animate-spin"
                style={{ border: '3px solid #E5E7EB', borderTopColor: '#10B981' }}
              />
              <p style={{ fontSize: 12, color: '#6B7280' }}>
                {t('rewards.signingQR', 'Signing QR…')}
              </p>
            </div>
          )}
        </div>

        <div className="bg-[var(--color-bg-card)] border-t border-[var(--color-border-subtle)] py-4 px-5">
          <div className="flex items-center justify-center gap-2">
            <QrCode size={14} className="text-[var(--color-accent)]" />
            <p className="text-[12px] font-bold text-[var(--color-text-muted)]" style={{ letterSpacing: '0.3px' }}>
              {t('rewards.showQrToStaff', 'Show this QR to staff to claim')}
            </p>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};

// ── Points History Tab ───────────────────────────────────────────────────────
const HistoryTab = ({ history, loading, t }) => {
  const { i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (loading) return <Skeleton variant="list-item" count={4} />;

  if (history.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="w-14 h-14 rounded-[14px] bg-[var(--color-bg-deep)] flex items-center justify-center mx-auto mb-3">
          <History size={28} className="text-[var(--color-text-muted)]" />
        </div>
        <p
          className="text-[15px] font-extrabold text-[var(--color-text-primary)]"
          style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
        >
          {t('rewards.noPointsYet')}
        </p>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{t('rewards.noPointsHint')}</p>
      </div>
    );
  }

  const visible = showAll ? history : history.slice(0, 5);

  return (
    <FadeIn>
      <div className="rounded-[18px] bg-white/[0.04] border border-[var(--color-border-subtle)] overflow-hidden">
        {visible.map((entry, idx) => {
          const rawMeta = ACTION_META[entry.action] || { icon: Star, color: 'var(--color-text-subtle)', labelKey: entry.action };
          const meta = { ...rawMeta, label: t(`rewards.actionLabels.${rawMeta.labelKey}`, rawMeta.labelKey) };
          return (
            <div
              key={entry.id}
              className={`flex items-center gap-3 px-4 py-3.5 ${idx === visible.length - 1 ? '' : 'border-b border-[var(--color-border-subtle)]'}`}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: meta.color }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-[13px] font-bold text-[var(--color-text-primary)] truncate"
                  style={{ letterSpacing: '-0.1px' }}
                >
                  {meta.label}
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale: i18n.language?.startsWith('es') ? esLocale : undefined })}
                </p>
              </div>
              <span
                className={`text-[14px] font-extrabold flex-shrink-0 tabular-nums ${entry.points >= 0 ? 'text-[var(--color-accent)]' : 'text-[#EF4444]'}`}
                style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
              >
                {entry.points >= 0 ? '+' : ''}{entry.points}
              </span>
            </div>
          );
        })}
      </div>
      {history.length > 5 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full mt-3 py-2.5 rounded-xl text-[12px] font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
          style={{ letterSpacing: '0.2px' }}
        >
          {showAll ? t('rewards.showLess') : t('rewards.showAllEntries', { count: history.length })}
        </button>
      )}
    </FadeIn>
  );
};

// ── Challenge Prizes Banner ──────────────────────────────────────────────────
const ChallengePrizesBanner = ({ prizes, t, onShowQr }) => {
  if (!prizes || prizes.length === 0) return null;
  const placementEmoji = { 1: '\uD83E\uDD47', 2: '\uD83E\uDD48', 3: '\uD83E\uDD49' };
  const placementLabel = {
    1: t('rewards.placement1', '1st Place'),
    2: t('rewards.placement2', '2nd Place'),
    3: t('rewards.placement3', '3rd Place'),
  };

  return (
    <FadeIn>
      <div className="mb-6">
        <h3
          className="text-[15px] font-extrabold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
        >
          <Trophy size={16} className="text-[var(--color-accent)]" />
          {t('rewards.challengePrizes', 'Challenge Prizes')}
        </h3>
        <div className="space-y-3">
          {prizes.map((prize) => (
            <div
              key={prize.id}
              className="relative rounded-2xl overflow-hidden border border-[var(--color-accent)]/20 bg-gradient-to-r from-[var(--color-accent)]/[0.06] to-transparent"
            >
              <div className="px-4 py-4 flex items-center gap-3">
                <div className="text-[28px] flex-shrink-0">
                  {placementEmoji[prize.placement] || '\uD83C\uDFC6'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-extrabold text-[var(--color-text-primary)] truncate" style={{ fontFamily: FONT_DISPLAY }}>
                    {prize.challenges?.name || 'Challenge'}
                  </p>
                  <p className="text-[11px] font-bold text-[var(--color-accent)] mt-0.5" style={{ letterSpacing: '0.3px' }}>
                    {placementLabel[prize.placement] || `#${prize.placement}`}
                  </p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
                    {prize.reward_label}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {prize.points_awarded > 0 && (
                    <span className="text-[13px] font-extrabold text-[#10B981] tabular-nums" style={{ fontFamily: FONT_DISPLAY }}>
                      +{prize.points_awarded} pts
                    </span>
                  )}
                  {prize.qr_code && (
                    <button
                      onClick={() => onShowQr(prize)}
                      aria-label={t('rewards.showChallengeQR', 'Show challenge prize QR code')}
                      className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-[11px] font-bold text-[var(--color-accent)] bg-[var(--color-accent)]/[0.08] border border-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/[0.12] transition-all"
                    >
                      <QrCode size={12} />
                      {t('rewards.showQr', 'Show QR')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </FadeIn>
  );
};

// ── Challenge Prize QR Modal ────────────────────────────────────────────────
const ChallengePrizeQRModal = ({ prize, onClose }) => {
  const { t } = useTranslation('pages');
  const challengePayload = `challenge-prize:${prize.qr_code}`;
  const [signedPayload, setSignedPayload] = useState(null);

  useEffect(() => {
    signQRPayload(challengePayload)
      .then(setSignedPayload)
      .catch((err) => logger.warn('signQRPayload failed (challenge prize)', err));
  }, [challengePayload]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const placementEmoji = { 1: '\uD83E\uDD47', 2: '\uD83E\uDD48', 3: '\uD83E\uDD49' };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ fontFamily: FONT_BODY }}>
      <div className="absolute inset-0 backdrop-blur-xl bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('rewards.challengePrizeQRCode', 'Challenge prize QR code')}
        className="relative w-full max-w-sm mx-4 rounded-[22px] overflow-hidden animate-fade-in"
      >
        <button
          onClick={onClose}
          aria-label={t('rewards.closeQR', { defaultValue: 'Close QR' })}
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/20 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
        >
          <X size={18} />
        </button>

        <div className="bg-[var(--color-accent)]/10 flex items-center justify-center gap-2 py-3">
          <span className="text-[20px]">{placementEmoji[prize.placement] || '\uD83C\uDFC6'}</span>
          <span
            className="text-[13px] font-extrabold text-[var(--color-accent)]"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '0.3px', textTransform: 'uppercase' }}
          >
            {prize.challenges?.name || 'Challenge Prize'}
          </span>
        </div>

        <div className="bg-white flex flex-col items-center p-8" role="img" aria-label={t('rewards.challengePrizeQRCode', 'Challenge prize QR code')}>
          <QRCodeSVG
            value={signedPayload || challengePayload}
            size={220}
            level="H"
            includeMargin={false}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
          <p className="text-[14px] font-mono font-bold text-gray-800 mt-4 tracking-widest">{prize.qr_code}</p>
        </div>

        <div className="bg-[var(--color-bg-card)] border-t border-[var(--color-border-subtle)] p-5">
          <p className="text-[16px] font-extrabold text-[var(--color-text-primary)] text-center" style={{ fontFamily: FONT_DISPLAY }}>
            {prize.reward_label}
          </p>
          <p className="text-[12px] text-[var(--color-text-muted)] text-center mt-1">
            {t('rewards.showQrToStaff')}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Earned Rewards Banner (birthday + referral milestones) ─────────────────
const EarnedRewardsBanner = ({ rewards, onClaim, onShowQr, t, isEs, claiming }) => {
  if (!rewards || rewards.length === 0) return null;

  const sourceLabel = (source) => {
    switch (source) {
      case 'birthday':            return t('rewards.earnedSourceBirthday', 'Birthday gift');
      case 'referral_milestone':  return t('rewards.earnedSourceMilestone', 'Referral milestone');
      case 'manual_grant':        return t('rewards.earnedSourceManual', 'Gift');
      default:                    return t('rewards.earnedSourceGeneric', 'Earned');
    }
  };

  const sourceEmoji = (source) => {
    if (source === 'birthday') return '🎂';
    if (source === 'referral_milestone') return '🎉';
    return '🎁';
  };

  return (
    <FadeIn>
      <div className="mb-6">
        <h3
          className="text-[15px] font-extrabold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
        >
          <Gift size={16} className="text-[var(--color-accent)]" />
          {t('rewards.claimableEarned', 'Recompensas para reclamar')}
        </h3>
        <div className="space-y-3">
          {rewards.map((er) => {
            const label = (isEs && er.reward_label_es) ? er.reward_label_es : er.reward_label;
            return (
              <div
                key={er.id}
                className="relative rounded-2xl overflow-hidden border border-[var(--color-accent)]/20 bg-gradient-to-r from-[var(--color-accent)]/[0.06] to-transparent"
              >
                <div className="px-4 py-4 flex items-center gap-3">
                  <div className="text-[28px] flex-shrink-0">{er.reward_emoji || sourceEmoji(er.source)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-extrabold text-[var(--color-text-primary)] truncate" style={{ fontFamily: FONT_DISPLAY }}>
                      {label}
                    </p>
                    <p className="text-[11px] font-bold text-[var(--color-accent)] mt-0.5" style={{ letterSpacing: '0.3px' }}>
                      {sourceLabel(er.source)}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    {er.qr_code ? (
                      <button
                        onClick={() => onShowQr(er)}
                        aria-label={t('rewards.showEarnedQR', 'Show earned reward QR')}
                        className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-[12px] font-bold text-[var(--color-accent)] bg-[var(--color-accent)]/[0.08] border border-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/[0.12] transition-all"
                      >
                        <QrCode size={13} />
                        {t('rewards.showQr', 'Show QR')}
                      </button>
                    ) : (
                      <button
                        onClick={() => onClaim(er)}
                        disabled={claiming === er.id}
                        className="flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-[12px] font-bold text-[var(--color-bg-base)] bg-[var(--color-accent)] hover:opacity-90 transition-all disabled:opacity-50"
                      >
                        <Gift size={13} />
                        {claiming === er.id ? t('rewards.claiming', 'Claiming…') : t('rewards.claim', 'Claim')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FadeIn>
  );
};

// ── Earned Reward QR Modal ──────────────────────────────────────────────────
const EarnedRewardQRModal = ({ reward, onClose, t, isEs }) => {
  const payload = `earned-reward:${reward.qr_code}`;
  const [signedPayload, setSignedPayload] = useState(null);

  useEffect(() => {
    signQRPayload(payload)
      .then(setSignedPayload)
      .catch((err) => logger.warn('signQRPayload failed (earned reward)', err));
  }, [payload]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const label = (isEs && reward.reward_label_es) ? reward.reward_label_es : reward.reward_label;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ fontFamily: FONT_BODY }}>
      <div className="absolute inset-0 backdrop-blur-xl bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('rewards.earnedRewardQRCode', 'Earned reward QR code')}
        className="relative w-full max-w-sm mx-4 rounded-[22px] overflow-hidden animate-fade-in"
      >
        <button
          onClick={onClose}
          aria-label={t('rewards.closeQR', { defaultValue: 'Close QR' })}
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/20 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
        >
          <X size={18} />
        </button>

        <div className="bg-[var(--color-accent)]/10 flex items-center justify-center gap-2 py-3">
          <span className="text-[20px]">{reward.reward_emoji || '🎁'}</span>
          <span
            className="text-[13px] font-extrabold text-[var(--color-accent)]"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '0.3px', textTransform: 'uppercase' }}
          >
            {label}
          </span>
        </div>

        <div className="bg-white flex flex-col items-center p-8" role="img" aria-label={t('rewards.earnedRewardQRCode', 'Earned reward QR code')}>
          <QRCodeSVG
            value={signedPayload || payload}
            size={220}
            level="H"
            includeMargin={false}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
          <p className="text-[14px] font-mono font-bold text-gray-800 mt-4 tracking-widest">{reward.qr_code}</p>
        </div>

        <div className="bg-[var(--color-bg-card)] border-t border-[var(--color-border-subtle)] p-5">
          <p className="text-[16px] font-extrabold text-[var(--color-text-primary)] text-center" style={{ fontFamily: FONT_DISPLAY }}>
            {label}
          </p>
          <p className="text-[12px] text-[var(--color-text-muted)] text-center mt-1">
            {t('rewards.showQrToStaff', 'Show this QR to staff to redeem.')}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Rewards Catalog Tab (Rewards A: featured tile + grid) ────────────────────
const RewardsTab = ({ points, gymRewards, gymRewardsLoading, onRedeem, challengePrizes, onShowPrizeQr, earnedRewards, onClaimEarned, onShowEarnedQr, claimingEarnedId, pendingRedemptions, onShowPendingQr, onCancelRedemption, t, lang }) => {
  // Featured reward is now admin-chosen (gym_rewards.is_featured). When no
  // reward is flagged as featured, omit the featured tile and show every
  // reward as a normal grid item.
  const featured = gymRewards.find(r => r.is_featured) || null;
  const rest = featured
    ? gymRewards.filter(r => r.id !== featured.id)
    : gymRewards;

  return (
    <div>
      <EarnedRewardsBanner
        rewards={earnedRewards}
        onClaim={onClaimEarned}
        onShowQr={onShowEarnedQr}
        t={t}
        isEs={lang === 'es'}
        claiming={claimingEarnedId}
      />
      <ChallengePrizesBanner prizes={challengePrizes} t={t} onShowQr={onShowPrizeQr} />

      {/* Pending redemptions */}
      {pendingRedemptions && pendingRedemptions.length > 0 && (
        <div className="mb-5">
          <p
            className="text-[11px] font-extrabold text-[var(--color-text-muted)] mb-3"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '1.2px', textTransform: 'uppercase' }}
          >
            {t('rewards.pendingRedemptions', 'Pending Redemptions')}
          </p>
          <div className="space-y-2">
            {pendingRedemptions.map((r) => (
              <div key={r.id} className="flex items-center gap-3 bg-[var(--color-accent)]/[0.06] rounded-[14px] border border-[var(--color-accent)]/20 px-4 py-3">
                <QrCode size={18} className="text-[var(--color-accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-[var(--color-text-primary)] truncate">{r.reward_name}</p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {r.points_spent === 0
                      ? `🎁 ${t('rewards.giftFromGym', 'Gift from your gym')}`
                      : `${formatStatNumber(r.points_spent)} pts`}
                  </p>
                </div>
                <button
                  onClick={() => onShowPendingQr(r)}
                  aria-label={t('rewards.showRedemptionQR', 'Show redemption QR code')}
                  className="px-3 py-1.5 min-h-[44px] rounded-lg bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[11px] font-extrabold shrink-0 active:scale-95 transition-transform"
                  style={{ letterSpacing: '0.3px' }}
                >
                  {t('rewards.showQr', 'Show QR')}
                </button>
                <button
                  onClick={() => onCancelRedemption(r.id)}
                  className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-white/[0.06] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] shrink-0 active:scale-95 transition-all"
                  aria-label={t('rewards.cancelRedemption', 'Cancel redemption')}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {gymRewardsLoading ? (
        <>
          <Skeleton className="w-full h-[130px] rounded-[18px] mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-white/[0.04] rounded-2xl border border-[var(--color-border-subtle)] p-4 flex flex-col">
                <Skeleton className="w-11 h-11 rounded-xl mb-2.5" />
                <Skeleton className="w-20 h-4 mb-1" />
                <Skeleton className="w-16 h-3 mb-3" />
                <Skeleton className="w-full h-7 rounded-lg" />
              </div>
            ))}
          </div>
        </>
      ) : gymRewards.length === 0 ? (
        <div className="text-center py-12">
          <Gift size={40} className="text-[var(--color-text-muted)] mx-auto mb-3 opacity-40" />
          <p className="text-[14px] text-[var(--color-text-muted)]">{t('rewards.noRewardsAvailable', 'No rewards available yet')}</p>
        </div>
      ) : (
        <>
          {/* Featured reward (Rewards A style) */}
          {featured && (() => {
            const name = lang === 'es' && featured.name_es ? featured.name_es : featured.name;
            const desc = lang === 'es' && featured.description_es ? featured.description_es : (featured.description || '');
            const canAfford = points >= featured.cost;
            return (
              <div className="mb-4">
                <div
                  className="relative rounded-[18px] overflow-hidden p-5 text-[var(--color-text-on-accent)]"
                  style={{
                    background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent) 60%, color-mix(in srgb, var(--color-accent) 75%, black) 100%)',
                  }}
                >
                  <div className="absolute -top-5 -right-8 text-[140px] leading-none opacity-[0.13] select-none pointer-events-none">
                    {featured.emoji_icon || '🎁'}
                  </div>
                  <div
                    className="text-[10px] font-extrabold opacity-90"
                    style={{ fontFamily: FONT_DISPLAY, letterSpacing: '1.2px', textTransform: 'uppercase' }}
                  >
                    ⭐ {t('rewards.featured', 'Featured reward')}
                  </div>
                  <div
                    className="text-[22px] font-extrabold mt-1 leading-tight"
                    style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.6px' }}
                  >
                    {name}
                  </div>
                  {desc && <div className="text-[12px] opacity-85 mt-1">{desc}</div>}
                  <div className="flex items-center gap-3 mt-5">
                    <button
                      onClick={() => onRedeem({ ...featured, name, description: desc })}
                      disabled={!canAfford}
                      className="flex items-center gap-2 px-5 py-3 rounded-full active:scale-95 transition-all disabled:opacity-55"
                      style={{
                        background: '#0A0D10',
                        color: '#fff',
                        fontSize: 13, fontWeight: 900,
                        letterSpacing: '0.4px',
                        fontFamily: FONT_DISPLAY,
                        boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <Gift size={15} strokeWidth={2.4} />
                      {canAfford
                        ? `${t('rewards.redeem', 'Redeem')} · ${formatStatNumber(featured.cost)} pts`
                        : t('rewards.needMore', { count: formatStatNumber(featured.cost - points), defaultValue: 'Need {{count}} more pts' })}
                    </button>
                    <div className="text-[11px] font-extrabold" style={{ color: 'rgba(0,0,0,0.65)' }}>
                      {t('rewards.youHave', 'You have')} {formatStatNumber(points)} pts
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Available rewards grid */}
          <div className="flex items-baseline justify-between px-1 mb-3">
            <h3
              className="text-[17px] font-extrabold text-[var(--color-text-primary)]"
              style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.3px' }}
            >
              {t('rewards.availableRewards', 'Available rewards')}
            </h3>
            <span className="text-[12px] font-bold text-[var(--color-text-muted)]">
              {gymRewards.length} {t('rewards.total', 'total')}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {rest.map((reward) => {
              const canAfford = points >= reward.cost;
              const name = lang === 'es' && reward.name_es ? reward.name_es : reward.name;
              const desc = lang === 'es' && reward.description_es ? reward.description_es : (reward.description || '');
              return (
                <button
                  key={reward.id}
                  onClick={() => canAfford && onRedeem({ ...reward, name, description: desc })}
                  disabled={!canAfford}
                  className="relative text-left bg-white/[0.04] rounded-[16px] border border-[var(--color-border-subtle)] p-3.5 hover:bg-white/[0.06] transition-colors duration-200 disabled:opacity-70"
                  style={{ opacity: canAfford ? 1 : 0.72 }}
                >
                  <div
                    className="w-11 h-11 rounded-[12px] flex items-center justify-center mb-2.5"
                    style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
                  >
                    <span className="text-[22px]">{reward.emoji_icon || '🎁'}</span>
                  </div>
                  <p
                    className="text-[14px] font-extrabold text-[var(--color-text-primary)] leading-tight"
                    style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
                  >
                    {name}
                  </p>
                  {desc && <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 line-clamp-2 leading-snug">{desc}</p>}
                  <div className="flex items-center justify-between mt-2.5">
                    <div
                      className="text-[14px] font-extrabold text-[var(--color-accent)] tabular-nums"
                      style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
                    >
                      {formatStatNumber(reward.cost)}
                      <span className="text-[10px] text-[var(--color-text-muted)] font-semibold ml-1">pts</span>
                    </div>
                    <span
                      className="text-[10px] font-extrabold px-2 py-1 rounded-full"
                      style={{
                        color: canAfford ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        background: canAfford
                          ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
                          : 'var(--color-surface-hover, rgba(255,255,255,0.05))',
                        letterSpacing: '0.3px',
                        textTransform: 'uppercase',
                      }}
                    >
                      {canAfford ? t('rewards.redeem') : t('rewards.locked', 'Locked')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

// ── Rewards Wallet v2 palette (dark pass with teal accent) ────────────────────
const PUNCH_CARD_GRADIENT = 'linear-gradient(165deg, #12181E 0%, #0A0E12 60%, #0D1318 100%)';
const PUNCH_TEAL_GRADIENT = 'linear-gradient(135deg, #2EC4C4 0%, #0E8A8A 100%)';
const PEEK_COLORS = ['#FF7A3D', '#6D5FDB', '#D4A835', '#2EC4C4'];

// Stable deterministic color picker by card id
function peekColorFor(id, fallbackIdx = 0) {
  if (!id) return PEEK_COLORS[fallbackIdx % PEEK_COLORS.length];
  const s = String(id);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return PEEK_COLORS[hash % PEEK_COLORS.length];
}

// ── Inline QR block (used inside PunchPassHero) ──────────────────────────────
const PunchCardQR = ({ payload, caption }) => (
  <div className="inline-block bg-white rounded-[10px] p-2.5">
    <QRCodeSVG
      value={payload}
      size={152}
      level="H"
      includeMargin={false}
      bgColor="#FFFFFF"
      fgColor="#000000"
    />
    {caption && (
      <div
        className="mt-1 text-center text-black"
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
        }}
      >{caption}</div>
    )}
  </div>
);

// ── Punch Pass Hero — large dark gradient punch card with QR at bottom ────────
const PunchPassHero = ({ card, payload, caption, t, onAddToWallet, walletLoading }) => {
  const total = card.punch_card_target;
  const punches = card.current_punches;
  const remaining = Math.max(0, total - punches);
  const isComplete = punches >= total;
  const platform = Capacitor.getPlatform();
  const prize = card.gym_products?.reward_description
    || card.gym_products?.punch_card_reward
    || card.gym_products?.name
    || t('rewards.yourReward', 'Your reward');
  const title = card.gym_products?.name || t('rewards.punchCard', 'Punch Card');
  const punchGrid = Array.from({ length: total }, (_, i) => i < punches);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        borderRadius: 22,
        background: PUNCH_CARD_GRADIENT,
        boxShadow: '0 24px 50px rgba(0,0,0,0.35), inset 0 0 0 0.5px rgba(255,255,255,0.06)',
      }}
    >
      {/* Teal ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: -90, right: -60, width: 260, height: 260, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(46,196,196,0.25) 0%, transparent 60%)',
        }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between px-[18px] pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-[9px] flex items-center justify-center"
            style={{ background: PUNCH_TEAL_GRADIENT, boxShadow: '0 2px 6px rgba(46,196,196,0.35)' }}
          >
            <Gift size={16} color="#001512" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-bold uppercase"
              style={{ letterSpacing: '1.4px', color: 'rgba(255,255,255,0.72)' }}
            >
              {t('rewards.rewardCard', 'REWARD CARD')}
            </div>
            <div
              className="text-[15px] font-black truncate"
              style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.3px', marginTop: 2, color: '#FFFFFF' }}
            >{title}</div>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-full"
          style={{ background: 'rgba(46,196,196,0.18)', color: '#2EC4C4' }}
        >
          <span className="text-[10px] font-extrabold" style={{ letterSpacing: '0.4px' }}>
            {isComplete ? t('rewards.rewardUnlocked', 'Unlocked') : t('rewards.toGo', { count: remaining, defaultValue: '{{count}} to go' })}
          </span>
        </div>
      </div>

      {/* Prize */}
      <div className="relative px-[18px] pt-3 pb-4">
        <div className="text-[10px] font-extrabold uppercase" style={{ color: '#2EC4C4', letterSpacing: '1.6px' }}>
          {t('rewards.yourPrize', 'YOUR PRIZE')}
        </div>
        <div
          className="mt-1.5 leading-tight"
          style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 800, letterSpacing: '-0.6px', color: '#FFFFFF' }}
        >{prize}</div>
        <div className="text-[12.5px] mt-2 font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>
          {t('rewards.buyXGetY', {
            count: total,
            defaultValue: 'Buy {{count}} to unlock your free reward',
          })}
        </div>
      </div>

      {/* Punch grid — honeycomb/offset layout: when the count is odd, the
          smaller row sits nested in the gaps of the larger row (7 → top 4,
          bottom 3 tucked into the spaces between). Built on a grid with
          2 sub-columns per dot so the bottom row can start at a half-offset. */}
      <div
        className="relative px-[18px] pt-3 pb-5"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        {(() => {
          const topRowCount = Math.min(5, Math.ceil(total / 2));
          const bottomRowCount = Math.max(0, total - topRowCount);
          const useOffset = total <= 10 && bottomRowCount > 0 && topRowCount !== bottomRowCount;
          // Each dot spans 2 sub-columns so the bottom row can start at an
          // odd sub-column index, nesting it between top-row dots.
          const subCols = topRowCount * 2;
          const bottomStartCol = (topRowCount - bottomRowCount) + 1; // 1-based
          return (
            <div
              className="grid gap-2.5 mt-2"
              style={{
                gridTemplateColumns: useOffset
                  ? `repeat(${subCols}, minmax(0, 1fr))`
                  : `repeat(${topRowCount}, minmax(0, 1fr))`,
              }}
            >
              {punchGrid.map((done, i) => {
                const isBottom = i >= topRowCount;
                const bottomIndex = i - topRowCount;
                let cellStyle = {};
                if (useOffset) {
                  cellStyle = {
                    gridColumn: isBottom && bottomIndex === 0
                      ? `${bottomStartCol} / span 2`
                      : 'span 2',
                  };
                }
                return (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: i * 0.03, duration: 0.3 }}
                    className="relative rounded-full flex items-center justify-center"
                    style={{
                      ...cellStyle,
                      aspectRatio: '1 / 1',
                      background: done ? PUNCH_TEAL_GRADIENT : 'transparent',
                      border: done ? 'none' : '1.5px dashed rgba(255,255,255,0.22)',
                      boxShadow: done ? '0 4px 12px rgba(46,196,196,0.25)' : 'none',
                    }}
                  >
                    {done ? (
                      <Check size={18} color="#001512" strokeWidth={3} />
                    ) : (
                      <span
                        className="font-extrabold"
                        style={{ fontFamily: FONT_DISPLAY, fontSize: 13, color: 'rgba(255,255,255,0.3)' }}
                      >{i + 1}</span>
                    )}
                  </motion.div>
                );
              })}
            </div>
          );
        })()}

        {/* Progress footer */}
        <div className="flex items-center justify-between mt-4">
          <div className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.62)' }}>{t('rewards.progress', 'Progress')}</div>
          <div
            className="font-extrabold tabular-nums"
            style={{ fontFamily: FONT_DISPLAY, fontSize: 15, color: '#FFFFFF' }}
          >
            {punches}<span style={{ color: 'rgba(255,255,255,0.50)' }}> / {total}</span>
          </div>
        </div>
      </div>

      {/* QR footer */}
      <div
        className="relative text-center px-[18px] pt-4 pb-5"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'linear-gradient(0deg, rgba(46,196,196,0.04) 0%, transparent 100%)',
        }}
      >
        <div
          className="mb-2.5"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', color: 'rgba(255,255,255,0.72)' }}
        >{t('rewards.scanAtBar', 'SCAN AT THE BAR TO PUNCH')}</div>
        {payload ? (
          <PunchCardQR payload={payload} caption={caption} />
        ) : (
          <div className="inline-block bg-white rounded-[10px] p-2.5 text-black/50 text-[11px]">
            {t('rewards.qrUnavailable', 'QR unavailable')}
          </div>
        )}

        {/* Wallet button below QR */}
        <div className="mt-4 flex items-center justify-center">
          <button
            onClick={() => onAddToWallet(card)}
            disabled={walletLoading}
            aria-label={t('rewards.addToWallet', 'Add to wallet')}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-extrabold transition active:scale-95 disabled:opacity-40"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.14)',
              color: '#fff',
              fontFamily: FONT_DISPLAY,
              letterSpacing: '0.2px',
            }}
          >
            {walletLoading ? (
              <div className="w-3 h-3 border-[1.5px] border-white/20 border-t-white/80 rounded-full animate-spin" />
            ) : (
              <CreditCard size={13} />
            )}
            {walletLoading
              ? t('rewards.adding')
              : platform === 'ios'
                ? t('rewards.appleWallet')
                : platform === 'android'
                  ? t('rewards.googleWallet')
                  : t('rewards.addToWallet', 'Add to wallet')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Reward peek row — compact horizontal card for "Other Cards" ──────────────
const RewardPeek = ({ card, color, t, onSelect }) => {
  const total = card.punch_card_target;
  const punches = card.current_punches;
  const pct = total > 0 ? Math.min(100, (punches / total) * 100) : 0;
  const emoji = card.gym_products?.emoji_icon || '🎁';
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      className="w-full rounded-[18px] p-4 flex items-center gap-3.5 min-h-[44px] active:scale-[0.99] transition-transform text-left"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 text-[22px] leading-none"
        style={{
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
        }}
      >
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="text-[15px] font-extrabold text-[var(--color-text-primary)] truncate"
          style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
        >
          {card.gym_products?.name || t('rewards.product', 'Product')}
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
          {t('rewards.visitsLeft', { count: Math.max(0, total - punches) })}
        </div>
        <div
          className="h-1 rounded-full mt-2 overflow-hidden"
          style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.06))' }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div
          className="text-[16px] font-extrabold text-[var(--color-text-primary)] tabular-nums leading-none"
          style={{ fontFamily: FONT_DISPLAY }}
        >
          {punches}<span className="text-[var(--color-text-muted)] text-[12px]">/{total}</span>
        </div>
      </div>
    </button>
  );
};

// ── Purchases list ───────────────────────────────────────────────────────────
const PurchasesList = ({ purchases, t }) => {
  const { i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (purchases.length === 0) {
    return (
      <div className="text-center py-14 px-6 rounded-[18px] bg-white/[0.04] border border-[var(--color-border-subtle)]">
        <div className="w-14 h-14 rounded-[14px] bg-[var(--color-bg-deep)] flex items-center justify-center mx-auto mb-3">
          <ShoppingBag size={28} className="text-[var(--color-text-muted)]" />
        </div>
        <p
          className="text-[15px] font-extrabold text-[var(--color-text-primary)]"
          style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
        >
          {t('rewards.noPurchasesYet')}
        </p>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{t('rewards.purchaseHistoryHint')}</p>
      </div>
    );
  }

  const visible = showAll ? purchases : purchases.slice(0, 5);

  return (
    <div className="rounded-[18px] bg-white/[0.04] border border-[var(--color-border-subtle)] overflow-hidden">
      {visible.map((purchase, i) => (
        <div
          key={purchase.id}
          className={`flex items-center gap-3 px-4 py-3.5 ${i === visible.length - 1 ? '' : 'border-b border-[var(--color-border-subtle)]'}`}
        >
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: 'var(--color-accent)' }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-bold text-[var(--color-text-primary)] truncate">
                {purchase.gym_products?.name || 'Product'}
              </p>
              {purchase.quantity > 1 && (
                <span className="text-[11px] text-[var(--color-text-muted)]">x{purchase.quantity}</span>
              )}
              {purchase.is_free_reward && (
                <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981]" style={{ letterSpacing: '0.3px' }}>
                  {t('rewards.free')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
              {formatDistanceToNow(new Date(purchase.created_at), { addSuffix: true, locale: useTranslation().i18n.language?.startsWith('es') ? esLocale : undefined })}
            </p>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            {!purchase.is_free_reward && (
              <span className="text-[13px] font-extrabold text-[var(--color-text-primary)] tabular-nums" style={{ fontFamily: FONT_DISPLAY }}>
                ${parseFloat(purchase.total_price || 0).toFixed(2)}
              </span>
            )}
            {purchase.points_earned > 0 && (
              <span className="text-[11px] font-bold text-[#10B981] tabular-nums">
                +{purchase.points_earned} pts
              </span>
            )}
          </div>
        </div>
      ))}
      {purchases.length > 5 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full py-2.5 text-[12px] font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border-t border-[var(--color-border-subtle)] transition-colors"
          style={{ letterSpacing: '0.2px' }}
        >
          {showAll ? t('rewards.showLess') : t('rewards.showAllPurchases', { count: purchases.length })}
        </button>
      )}
    </div>
  );
};

// ── Punch Cards Tab ──────────────────────────────────────────────────────────
const PurchasesTab = ({ punchCards, purchases, loading, profile, t }) => {
  const [walletLoadingId, setWalletLoadingId] = useState(null);
  const [walletError, setWalletError] = useState('');
  const [qrProduct, setQrProduct] = useState(null);
  const [heroIdx, setHeroIdx] = useState(0);
  const [signedPayloads, setSignedPayloads] = useState({});

  // Sort: least remaining first so hero is the one closest to completion
  const sortedCards = [...punchCards].sort((a, b) => {
    const ra = (a.punch_card_target || 0) - (a.current_punches || 0);
    const rb = (b.punch_card_target || 0) - (b.current_punches || 0);
    return ra - rb;
  });
  const heroCard = sortedCards[heroIdx] || sortedCards[0];
  const otherCards = sortedCards.filter((c) => c.id !== heroCard?.id);

  // Sign hero punch card QR payload (same format as ProductQRModal)
  useEffect(() => {
    if (!heroCard || !profile?.id || !profile?.gym_id) return;
    const productId = heroCard.gym_products?.id || heroCard.product_id;
    if (!productId) return;
    const raw = `gym-purchase:${profile.gym_id}:${profile.id}:${productId}`;
    if (signedPayloads[heroCard.id]) return;
    let cancelled = false;
    signQRPayload(raw).then((signed) => {
      if (!cancelled) setSignedPayloads((prev) => ({ ...prev, [heroCard.id]: signed }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [heroCard?.id, profile?.id, profile?.gym_id]);

  const heroCaption = useMemo(() => {
    if (!heroCard) return '';
    const pid = String(heroCard.gym_products?.id || heroCard.product_id || '');
    const prefix = (heroCard.gym_products?.name || 'RW').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'RW';
    const suffix = pid.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase();
    return `${prefix}-${suffix || '00000'}`;
  }, [heroCard]);

  const handleAddToWallet = useCallback(async (card) => {
    setWalletLoadingId(card.id);
    setWalletError('');
    try {
      const platform = Capacitor.getPlatform();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const thisCard = {
        name: card.gym_products?.name || 'Product',
        productId: card.gym_products?.id || card.product_id,
        punches: card.current_punches,
        target: card.punch_card_target,
        completed: card.total_completed || 0,
      };
      const otherCards = punchCards
        .filter(c => c.id !== card.id)
        .map(c => ({
          name: c.gym_products?.name || 'Product',
          productId: c.gym_products?.id || c.product_id,
          punches: c.current_punches,
          target: c.punch_card_target,
          completed: c.total_completed || 0,
        }));

      const { data, error } = await supabase.functions.invoke(
        'generate-punch-card-pass',
        {
          body: {
            memberName: profile?.full_name || 'Member',
            gymName: profile?.gym_name || 'TuGymPR',
            punchCards: [thisCard, ...otherCards],
            cardName: thisCard.name,
          },
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (error) {
        // The supabase functions client wraps non-2xx responses; pull the body
        // so the user (and console) can see the actual server error message.
        const ctx = error.context;
        let details = '';
        if (ctx) {
          try { const body = await ctx.json(); details = body?.details || body?.error || ''; }
          catch { try { details = await ctx.text(); } catch {} }
        }
        // eslint-disable-next-line no-console
        console.error('[wallet-pass] server error:', error.message, '\nDETAILS:', details);
        throw new Error(details || error.message || 'Wallet pass server error');
      }
      if (data?.error) {
        // eslint-disable-next-line no-console
        console.error('[wallet-pass] data.error:', data.error, '\nDETAILS:', data.details, '\nSTACK:', data.stack);
        throw new Error(data.details ? `${data.error}: ${data.details}` : data.error);
      }
      if (data?.unsupported) throw new Error('Wallet passes not yet configured for this gym');

      if (platform === 'ios') {
        await WalletPass.addPass({ pkpassBase64: data.pkpass });
      } else {
        await openExternalUrl(data.saveUrl);
      }
    } catch (err) {
      setWalletError(err.message || 'Failed to add to wallet');
      logger.error('Wallet pass error:', err);
    } finally {
      setWalletLoadingId(null);
    }
  }, [profile, punchCards]);

  if (loading) return <Skeleton variant="list-item" count={4} />;

  return (
    <FadeIn>
      <div className="space-y-8">
        {/* ── Active punch cards (Rewards B style) ────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3
              className="text-[17px] font-extrabold text-[var(--color-text-primary)] flex items-center gap-2"
              style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.3px' }}
            >
              <Ticket size={16} className="text-[var(--color-accent)]" />
              {t('rewards.activePunchCards', 'Active punch cards')}
            </h3>
            {punchCards.length > 0 && (
              <span className="text-[12px] font-bold text-[var(--color-text-muted)]">
                {punchCards.length}
              </span>
            )}
          </div>

          {punchCards.length === 0 ? (
            <div className="text-center py-14 px-6 rounded-[18px] bg-white/[0.04] border border-[var(--color-border-subtle)]">
              <div className="w-14 h-14 rounded-[14px] bg-[var(--color-bg-deep)] flex items-center justify-center mx-auto mb-3">
                <Gift size={28} className="text-[var(--color-text-muted)]" />
              </div>
              <p
                className="text-[15px] font-extrabold text-[var(--color-text-primary)]"
                style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.2px' }}
              >
                {t('rewards.noPunchCardsYet')}
              </p>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
                {t('rewards.noPunchCardsHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Hero punch pass — if signing hasn't completed yet (or failed
                  offline), fall back to the unsigned raw payload so the QR
                  always renders. Admin scanners can validate the signature
                  separately when they re-attempt online. */}
              {heroCard && (() => {
                const productId = heroCard.gym_products?.id || heroCard.product_id;
                const rawPayload = productId && profile?.gym_id && profile?.id
                  ? `gym-purchase:${profile.gym_id}:${profile.id}:${productId}`
                  : '';
                return (
                  <PunchPassHero
                    card={heroCard}
                    payload={signedPayloads[heroCard.id] || rawPayload}
                    caption={heroCaption}
                    t={t}
                    onAddToWallet={handleAddToWallet}
                    walletLoading={walletLoadingId === heroCard.id}
                  />
                );
              })()}

              {/* Other active cards — peek rows */}
              {otherCards.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <div
                      className="text-[11px] font-extrabold text-[var(--color-text-muted)]"
                      style={{ fontFamily: FONT_DISPLAY, letterSpacing: '1.2px' }}
                    >
                      {t('rewards.otherCards', 'OTHER CARDS')}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">
                      {t('rewards.activeCount', { count: otherCards.length, defaultValue: '{{count}} active' })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {otherCards.map((card, idx) => (
                      <RewardPeek
                        key={card.id}
                        card={card}
                        color={peekColorFor(card.id, idx)}
                        t={t}
                        onSelect={(c) => {
                          const newIdx = sortedCards.findIndex((x) => x.id === c.id);
                          if (newIdx >= 0) setHeroIdx(newIdx);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Purchase History ────────────────────────────────── */}
        <div>
          <h3
            className="text-[17px] font-extrabold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
            style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.3px' }}
          >
            <ShoppingBag size={16} className="text-[var(--color-accent)]" />
            {t('rewards.purchaseHistory')}
          </h3>
          <PurchasesList purchases={purchases} t={t} />
        </div>
      </div>

      {qrProduct && (
        <ProductQRModal
          memberId={profile?.id}
          memberName={profile?.full_name}
          gymId={profile?.gym_id}
          product={{
            id: qrProduct.gym_products?.id || qrProduct.product_id,
            name: qrProduct.gym_products?.name || 'Product',
            emoji_icon: qrProduct.gym_products?.emoji_icon,
          }}
          onClose={() => setQrProduct(null)}
        />
      )}

      <AnimatePresence>
        {walletError && (
          <motion.div
            className="fixed top-24 left-1/2 z-50 -translate-x-1/2"
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
          >
            <div className="flex items-center gap-2 bg-[#EF4444]/20 border border-[#EF4444]/40 px-4 py-2.5 rounded-2xl backdrop-blur-xl shadow-lg">
              <span className="text-[12px] font-bold text-[#EF4444]">{walletError}</span>
              <button onClick={() => setWalletError('')} aria-label={t('rewards.dismissError', { defaultValue: 'Dismiss error' })} className="text-[#EF4444]/60 hover:text-[#EF4444] min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none">
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </FadeIn>
  );
};

// ── Main Rewards Page ────────────────────────────────────────────────────────
const TAB_KEYS = ['rewards', 'purchases', 'history'];

export default function Rewards() {
  const { t, i18n } = useTranslation('pages');
  const { user, profile, lifetimePoints: ctxLifetimePoints } = useAuth();
  const posthog = usePostHog();
  const rewardsCacheKey = `rewards-${user?.id}`;
  const hasCached = hasCachedState(`${rewardsCacheKey}-pts`);
  const [tab, setTab] = useState('rewards');
  const [loading, setLoading] = useState(!hasCached);
  const [pointsData, setPointsData] = useCachedState(`${rewardsCacheKey}-pts`, { total_points: 0, lifetime_points: ctxLifetimePoints ?? 0 });
  useEffect(() => { if (ctxLifetimePoints != null) setPointsData(prev => ({ ...prev, lifetime_points: ctxLifetimePoints })); }, [ctxLifetimePoints]);
  const [history, setHistory] = useCachedState(`${rewardsCacheKey}-hist`, []);
  const [punchCards, setPunchCards] = useCachedState(`${rewardsCacheKey}-punch`, []);
  const [purchases, setPurchases] = useCachedState(`${rewardsCacheKey}-purchases`, []);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [successReward, setSuccessReward] = useState(null);
  const [challengePrizes, setChallengePrizes] = useCachedState(`${rewardsCacheKey}-prizes`, []);
  const [prizeQrTarget, setPrizeQrTarget] = useState(null);
  const [pendingRedemptions, setPendingRedemptions] = useCachedState(`${rewardsCacheKey}-pending`, []);
  const [gymRewards, setGymRewards] = useCachedState(`${rewardsCacheKey}-gymRew`, []);
  const [gymRewardsLoading, setGymRewardsLoading] = useState(!hasCached);
  // Earned rewards — claimable items granted by the gym (birthday, referral milestones, manual)
  const [earnedRewards, setEarnedRewards] = useCachedState(`${rewardsCacheKey}-earned`, []);
  const [earnedQrTarget, setEarnedQrTarget] = useState(null);
  const [claimingEarnedId, setClaimingEarnedId] = useState(null);

  const tier = getRewardTier(pointsData.lifetime_points);
  const heldPoints = pendingRedemptions.reduce((sum, r) => sum + (r.points_spent || 0), 0);
  const availablePoints = (pointsData.total_points || 0) - heldPoints;

  const loadData = useCallback(async () => {
    if (!user?.id || !profile?.gym_id) return;
    setLoading(true);

    const [pts, hist, punchCardsRes, purchasesRes, prizesRes, pendingRes, gymRewardsRes, earnedRes] = await Promise.all([
      getUserPoints(user.id),
      getPointsHistory(user.id, 20),
      supabase
        .from('member_punch_cards')
        .select('*, gym_products!inner(id, name, emoji_icon, punch_card_enabled, punch_card_target)')
        .eq('member_id', user.id)
        .eq('gym_products.punch_card_enabled', true),
      supabase
        .from('member_purchases')
        .select('*, gym_products(name, emoji_icon)')
        .eq('member_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('challenge_prizes')
        .select('*, challenges(name)')
        .eq('profile_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('reward_redemptions')
        .select('id, reward_id, reward_name, points_spent, status, created_at')
        .eq('profile_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('gym_rewards')
        .select('id, name, name_es, description, description_es, cost_points, reward_type, emoji_icon, sort_order, is_featured')
        .eq('gym_id', profile.gym_id)
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('earned_rewards')
        .select('id, reward_id, reward_label, reward_label_es, reward_emoji, source, source_id, qr_code, status, created_at')
        .eq('profile_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ]);

    setPointsData(pts);
    setHistory(hist);
    setPendingRedemptions(pendingRes.data || []);
    setGymRewards((gymRewardsRes.data || []).map(r => ({ ...r, cost: r.cost_points })));
    setGymRewardsLoading(false);
    setPunchCards(
      (punchCardsRes.data || []).map((card) => ({
        ...card,
        current_punches: card.punches ?? 0,
        punch_card_target: card.gym_products?.punch_card_target ?? 10,
      }))
    );
    setPurchases(purchasesRes.data || []);
    setChallengePrizes(prizesRes.data || []);
    setEarnedRewards(earnedRes.data || []);
    setLoading(false);
  }, [user?.id, profile?.gym_id]);

  useEffect(() => { loadData(); }, [loadData]);

  const [redeemError, setRedeemError] = useState(null);

  const handleRedeem = async (reward) => {
    if (!user?.id || !profile?.gym_id) return;
    setRedeemError(null);

    const { data, error } = await supabase.rpc('redeem_reward', {
      p_reward_id: String(reward.id),
      p_reward_name: reward.name,
      p_cost: reward.cost,
    });

    if (error) {
      logger.error('Redemption error:', error);
      console.error('redeem_reward full error:', JSON.stringify(error));
      setRedeemError(error.message || error.details || error.hint || 'Redemption failed. Please try again.');
      setRedeemTarget(null);
      setTimeout(() => setRedeemError(null), 3000);
      return;
    }

    setRedeemTarget(null);
    setSuccessReward({ reward, redemptionId: data?.redemption_id || 'unknown' });
    posthog?.capture('reward_redeemed', { reward_name: reward.name, points_cost: reward.cost });
    loadData();
  };

  // Earned rewards: claim flow generates a QR code server-side; member shows it to staff.
  const handleClaimEarned = async (earned) => {
    if (!user?.id) return;
    setClaimingEarnedId(earned.id);
    try {
      const { data, error } = await supabase.rpc('claim_earned_reward', { p_id: earned.id });
      if (error) throw error;
      const qr = data?.qr_code;
      if (!qr) throw new Error('No QR returned');
      const updated = { ...earned, qr_code: qr };
      setEarnedRewards(prev => prev.map(er => er.id === earned.id ? updated : er));
      setEarnedQrTarget(updated);
      posthog?.capture('earned_reward_claimed', { source: earned.source });
    } catch (err) {
      logger.error('claim_earned_reward error:', err);
      setRedeemError(err.message || 'Failed to claim reward');
      setTimeout(() => setRedeemError(null), 3000);
    } finally {
      setClaimingEarnedId(null);
    }
  };

  return (
    <div
      className="min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12"
      style={{ fontFamily: FONT_BODY }}
    >
      {/* Portaled modals */}
      {prizeQrTarget && (
        <ChallengePrizeQRModal
          prize={prizeQrTarget}
          onClose={() => setPrizeQrTarget(null)}
        />
      )}
      {earnedQrTarget && (
        <EarnedRewardQRModal
          reward={earnedQrTarget}
          onClose={() => setEarnedQrTarget(null)}
          t={t}
          isEs={i18n.language?.startsWith('es')}
        />
      )}
      {successReward && (
        <RedemptionQRModal
          reward={successReward.reward}
          redemptionId={successReward.redemptionId}
          userId={user?.id}
          gymId={profile?.gym_id}
          memberName={profile?.full_name || 'Member'}
          onClose={() => setSuccessReward(null)}
        />
      )}
      {redeemTarget && (
        <RedeemModal
          reward={redeemTarget}
          points={availablePoints}
          onConfirm={handleRedeem}
          onClose={() => setRedeemTarget(null)}
          t={t}
        />
      )}

      {/* Error toast */}
      <AnimatePresence>
        {redeemError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl bg-[#EF4444]/15 border border-[#EF4444]/20 backdrop-blur-xl shadow-xl"
            style={{ top: 'calc(60px + var(--safe-area-top, env(safe-area-inset-top)))' }}
          >
            <p className="text-[13px] font-bold text-[#EF4444]">{redeemError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sticky Header ─────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border-b border-[var(--color-border-subtle)]">
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 pt-5 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-11 h-11 rounded-[13px] flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
            >
              <Award size={22} className="text-[var(--color-accent)]" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h1
                className="text-[22px] font-extrabold text-[var(--color-text-primary)] tracking-tight truncate"
                style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-0.5px' }}
              >
                {t('rewards.title')}
              </h1>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                {t('rewards.subtitle')}
              </p>
            </div>
          </div>

          {/* ── Tier Hero Card (Rewards A style) ─────────────── */}
          <div
            className="relative rounded-[22px] overflow-hidden p-5 mb-4"
            style={{
              background: 'linear-gradient(145deg, var(--color-bg-card) 0%, var(--color-bg-deep) 100%)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            {/* Subtle accent glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(circle at 85% 20%, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 55%), radial-gradient(circle at 15% 80%, color-mix(in srgb, var(--color-accent) 10%, transparent), transparent 50%)',
              }}
            />

            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className="text-[10px] font-extrabold text-[var(--color-text-muted)]"
                    style={{ fontFamily: FONT_DISPLAY, letterSpacing: '1.3px', textTransform: 'uppercase' }}
                  >
                    {t('rewards.yourPoints')}
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span
                      className={`${statFontSize(availablePoints, 'text-[46px]')} font-extrabold text-[var(--color-text-primary)] leading-none tabular-nums`}
                      style={{ fontFamily: FONT_DISPLAY, letterSpacing: '-1.5px' }}
                    >
                      <AnimatedPoints value={availablePoints} />
                    </span>
                    <span className="text-[13px] font-bold text-[var(--color-text-muted)]">pts</span>
                  </div>
                  {heldPoints > 0 && (
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                      {formatStatNumber(heldPoints)} {t('rewards.heldPending', 'held pending')}
                    </p>
                  )}
                </div>
                <TierBadge tier={tier} size="lg" t={t} />
              </div>

              {/* Progress to next tier */}
              {tier.nextTier && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-[var(--color-text-muted)]" style={{ letterSpacing: '0.2px' }}>
                      {t('rewards.progressTo', { tier: t(`rewards.tiers.${tier.nextTierKey}`, tier.nextTier) })}
                    </span>
                    <span className="text-[11px] font-extrabold" style={{ color: tier.nextTierColor || 'var(--color-accent)', fontFamily: FONT_DISPLAY }}>
                      {t('rewards.ptsToGo', { count: formatStatNumber(tier.pointsToNext) })}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.08)' }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{
                        background: `linear-gradient(90deg, ${tier.color} 0%, ${tier.nextTierColor || 'var(--color-accent)'} 100%)`,
                        boxShadow: '0 0 10px color-mix(in srgb, var(--color-accent) 40%, transparent)',
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${tier.progress}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                  <div
                    className="flex justify-between mt-1.5 text-[10px] font-extrabold"
                    style={{ color: 'var(--color-text-subtle, var(--color-text-muted))', fontFamily: FONT_DISPLAY, letterSpacing: '0.6px' }}
                  >
                    <span>{t(`rewards.tiers.${tier.nameKey}`, tier.name).toUpperCase()}</span>
                    <span>{t(`rewards.tiers.${tier.nextTierKey}`, tier.nextTier).toUpperCase()}</span>
                  </div>
                </div>
              )}

              {/* Lifetime + earn row */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/[0.06]">
                <span className="text-[11px] font-bold text-[var(--color-text-muted)]">
                  {t('rewards.lifetime')}: <span className="text-[var(--color-text-primary)] font-extrabold tabular-nums" style={{ fontFamily: FONT_DISPLAY }}>{formatStatNumber(pointsData.lifetime_points ?? 0)}</span>
                </span>
                <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--color-accent)]">
                  <Zap size={12} strokeWidth={2.4} />
                  <span>{t('rewards.pointsPerWorkout', '+50/workout')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1.5" role="tablist" aria-label={t('rewards.tabNavigation', 'Rewards navigation')}>
            {TAB_KEYS.map((tabKey) => {
              const active = tab === tabKey;
              return (
                <button
                  key={tabKey}
                  onClick={() => setTab(tabKey)}
                  role="tab"
                  aria-selected={active}
                  className="flex-1 py-2.5 min-h-[44px] rounded-[12px] text-[12px] font-extrabold transition-all active:scale-95"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    letterSpacing: '0.2px',
                    background: active ? 'var(--color-text-primary)' : 'transparent',
                    color: active ? 'var(--color-bg-primary)' : 'var(--color-text-muted)',
                    border: active ? 'none' : '1px solid var(--color-border-subtle)',
                  }}
                >
                  {t(`rewards.tabs.${tabKey}`)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tab Content ─────────────────────────────────────── */}
      <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 py-6">
        {tab === 'history' && (
          <HistoryTab history={history} loading={loading} t={t} />
        )}
        {tab === 'purchases' && (
          <PurchasesTab
            punchCards={punchCards}
            purchases={purchases}
            loading={loading}
            profile={profile}
            t={t}
          />
        )}
        {tab === 'rewards' && (
          <RewardsTab
            points={availablePoints}
            gymRewards={gymRewards}
            gymRewardsLoading={gymRewardsLoading}
            onRedeem={(reward) => setRedeemTarget(reward)}
            challengePrizes={challengePrizes}
            onShowPrizeQr={(prize) => setPrizeQrTarget(prize)}
            earnedRewards={earnedRewards}
            onClaimEarned={handleClaimEarned}
            onShowEarnedQr={(r) => setEarnedQrTarget(r)}
            claimingEarnedId={claimingEarnedId}
            pendingRedemptions={pendingRedemptions}
            onShowPendingQr={(r) => {
              const dbReward = gymRewards.find(gr => String(gr.id) === String(r.reward_id));
              setSuccessReward({
                reward: dbReward
                  ? { ...dbReward, name: r.reward_name }
                  : { id: r.reward_id, name: r.reward_name, emoji_icon: '🎁' },
                redemptionId: r.id,
              });
            }}
            onCancelRedemption={async (redemptionId) => {
              const { error } = await supabase.rpc('cancel_redemption', { p_redemption_id: redemptionId });
              if (error) {
                logger.error('Cancel redemption error:', error);
                const msg = error.message?.includes('pending')
                  ? t('rewards.alreadyClaimed', 'This reward was already claimed and cannot be cancelled.')
                  : t('rewards.cancelFailed', 'Failed to cancel. Please try again.');
                setRedeemError(msg);
                setTimeout(() => setRedeemError(null), 4000);
              }
              loadData();
            }}
            t={t}
            lang={i18n.language?.startsWith('es') ? 'es' : 'en'}
          />
        )}
      </div>
    </div>
  );
}
