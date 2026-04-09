// ── Rewards & Points Page ────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Coins, Trophy, Gift, Crown, History, Star,
  Dumbbell, MapPin, Flame, Target, Award, Scale,
  Zap, CalendarCheck, CheckCircle2, X, ShoppingBag,
  Coffee, Ticket, Shirt, Medal, Wallet, QrCode,
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
import { Capacitor, registerPlugin } from '@capacitor/core';

const WalletPass = registerPlugin('WalletPass');

// ── Action icon mapping ──────────────────────────────────────────────────────
const ACTION_META = {
  workout_completed:    { icon: Dumbbell,      color: 'var(--color-accent)', labelKey: 'workout_completed' },
  pr_hit:               { icon: Target,        color: 'var(--color-danger)', labelKey: 'pr_hit' },
  check_in:             { icon: MapPin,         color: 'var(--color-success)', labelKey: 'check_in' },
  streak_day:           { icon: Flame,          color: '#F97316', labelKey: 'streak_day' },
  challenge_completed:  { icon: Trophy,         color: '#A78BFA', labelKey: 'challenge_completed' },
  achievement_unlocked: { icon: Award,          color: 'var(--color-warning)', labelKey: 'achievement_unlocked' },
  weight_logged:        { icon: Scale,          color: 'var(--color-blue-soft)', labelKey: 'weight_logged' },
  first_weekly_workout: { icon: CalendarCheck,  color: 'var(--color-success)', labelKey: 'first_weekly_workout' },
  streak_7:             { icon: Zap,            color: '#F97316', labelKey: 'streak_7' },
  streak_30:            { icon: Crown,          color: 'var(--color-accent)', labelKey: 'streak_30' },
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
    lg: 'text-[13px] px-4 py-1.5',
  };
  const label = t ? t(`rewards.tiers.${tier.nameKey}`, tier.name) : tier.name;
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-full ${sizes[size]}`}
      style={{ backgroundColor: `${tier.color}15`, color: tier.color, border: `1px solid ${tier.color}30` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tier.color }} />
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
      // Ease out cubic
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

// ── Confirmation Modal ───────────────────────────────────────────────────────
const RedeemModal = ({ reward, points, onConfirm, onClose, t }) => {
  const canAfford = points >= reward.cost;
  const [redeeming, setRedeeming] = useState(false);

  const handleConfirm = async () => {
    setRedeeming(true);
    await onConfirm(reward);
    setRedeeming(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-xl bg-black/60 px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="redeem-reward-title"
          className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-subtle)] p-6 max-w-sm w-full shadow-2xl"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h3 id="redeem-reward-title" className="text-[18px] font-bold text-[var(--color-text-primary)]">{t('rewards.redeemReward')}</h3>
            <button onClick={onClose} aria-label="Close dialog" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
              <X size={20} />
            </button>
          </div>

          <div className="text-center py-4">
            <span className="text-[48px]">{reward.emoji_icon || '🎁'}</span>
            <p className="text-[16px] font-semibold text-[var(--color-text-primary)] mt-3">{reward.name}</p>
            {reward.description && <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{reward.description}</p>}
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Coins size={16} className="text-[#D4AF37]" />
              <span className="text-[20px] font-bold text-[#D4AF37] tabular-nums">{formatStatNumber(reward.cost)}</span>
              <span className="text-[13px] text-[var(--color-text-muted)]">pts</span>
            </div>
            {!canAfford && (
              <p className="text-[12px] text-[#EF4444] mt-2">
                {t('rewards.youNeedMore', { count: formatStatNumber(reward.cost - points) })}
              </p>
            )}
          </div>

          <div className="flex gap-3 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl text-[14px] font-semibold text-[var(--color-text-muted)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
            >
              {t('rewards.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canAfford || redeeming}
              className="flex-1 py-3.5 rounded-xl text-[14px] font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-[#D4AF37] text-black hover:bg-[#E6C766]"
            >
              {redeeming ? t('rewards.redeeming') : t('rewards.confirm')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ── Redemption QR Modal ──────────────────────────────────────────────────────
const RedemptionQRModal = ({ reward, redemptionId, userId, gymId, memberName, onClose }) => {
  const { t } = useTranslation('pages');
  const payload = `gym-reward:${gymId}:${userId}:${redemptionId}`;
  const [signedPayload, setSignedPayload] = useState(null);

  useEffect(() => {
    signQRPayload(payload).then(setSignedPayload);
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-xl bg-black/60" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Reward redeemed"
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden shadow-2xl"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <button
          onClick={onClose}
          aria-label="Close redemption QR"
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/20 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        >
          <X size={18} />
        </button>

        {/* Success badge */}
        <div className="bg-gradient-to-r from-[#10B981]/15 to-[#059669]/15 flex items-center justify-center gap-2 py-3.5">
          <CheckCircle2 size={18} className="text-[#10B981]" />
          <span className="text-[14px] font-bold text-[#10B981]">{t('rewards.rewardRedeemed', 'Reward Redeemed!')}</span>
        </div>

        {/* Reward info + emoji */}
        <div className="bg-[var(--color-bg-card)] flex flex-col items-center pt-5 pb-3">
          <span className="text-[40px] mb-1">{reward.emoji_icon || '🎁'}</span>
          <p className="text-[17px] font-bold text-[var(--color-text-primary)]">{reward.name}</p>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{memberName}</p>
        </div>

        {/* QR code */}
        <div className="bg-white flex flex-col items-center px-8 py-6" role="img" aria-label={t('rewards.redemptionQRCode', 'Redemption QR code')}>
          <QRCodeSVG
            value={signedPayload || payload}
            size={220}
            level="H"
            includeMargin={false}
            bgColor="#FFFFFF"
            fgColor="#000000"
          />
        </div>

        {/* Show to staff prompt */}
        <div className="bg-[var(--color-bg-card)] border-t border-[var(--color-border-subtle)] py-4 px-5">
          <div className="flex items-center justify-center gap-2">
            <QrCode size={14} className="text-[#D4AF37]" />
            <p className="text-[13px] font-semibold text-[var(--color-text-muted)]">
              {t('rewards.showQrToStaff', 'Show this QR to staff to claim')}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

// ── Points History Tab ───────────────────────────────────────────────────────
const HistoryTab = ({ history, loading, t }) => {
  const { i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (loading) {
    return <Skeleton variant="list-item" count={4} />;
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="w-14 h-14 rounded-[14px] bg-[var(--color-bg-deep)] flex items-center justify-center mx-auto mb-3">
          <History size={28} className="text-[var(--color-text-muted)]" />
        </div>
        <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('rewards.noPointsYet')}</p>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{t('rewards.noPointsHint')}</p>
      </div>
    );
  }

  const visible = showAll ? history : history.slice(0, 5);

  return (
    <FadeIn>
    <div className="space-y-2">
      {visible.map((entry) => {
        const rawMeta = ACTION_META[entry.action] || { icon: Star, color: 'var(--color-text-subtle)', labelKey: entry.action };
        const meta = { ...rawMeta, label: t(`rewards.actionLabels.${rawMeta.labelKey}`, rawMeta.labelKey) };
        const Icon = meta.icon;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] hover:bg-white/[0.06] transition-colors duration-200"
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${meta.color}15` }}
            >
              <Icon size={17} style={{ color: meta.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                {meta.label}
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale: i18n.language?.startsWith('es') ? esLocale : undefined })}
              </p>
            </div>
            <span className={`text-[14px] font-bold flex-shrink-0 ${entry.points >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
              {entry.points >= 0 ? '+' : ''}{entry.points}
            </span>
          </div>
        );
      })}
      {!showAll && history.length > 5 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-2.5 rounded-xl text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
        >
          {t('rewards.showAllEntries', { count: history.length })}
        </button>
      )}
      {showAll && history.length > 5 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full py-2.5 rounded-xl text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
        >
          {t('rewards.showLess')}
        </button>
      )}
    </div>
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
        <h3 className="text-[15px] font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-[#D4AF37]" />
          {t('rewards.challengePrizes', 'Challenge Prizes')}
        </h3>
        <div className="space-y-3">
          {prizes.map((prize) => (
            <div
              key={prize.id}
              className="relative rounded-2xl overflow-hidden border border-[#D4AF37]/20 bg-gradient-to-r from-[#D4AF37]/[0.06] to-transparent"
            >
              <div className="px-4 py-4 flex items-center gap-3">
                <div className="text-[28px] flex-shrink-0">
                  {placementEmoji[prize.placement] || '\uD83C\uDFC6'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-[var(--color-text-primary)] truncate">
                    {prize.challenges?.name || 'Challenge'}
                  </p>
                  <p className="text-[11px] font-semibold text-[#D4AF37] mt-0.5">
                    {placementLabel[prize.placement] || `#${prize.placement}`}
                  </p>
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
                    {prize.reward_label}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {prize.points_awarded > 0 && (
                    <span className="text-[13px] font-bold text-[#10B981]">
                      +{prize.points_awarded} pts
                    </span>
                  )}
                  {prize.qr_code && (
                    <button
                      onClick={() => onShowQr(prize)}
                      aria-label={t('rewards.showChallengeQR', 'Show challenge prize QR code')}
                      className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-[11px] font-semibold text-[#D4AF37] bg-[#D4AF37]/[0.08] border border-[#D4AF37]/15 hover:bg-[#D4AF37]/[0.12] transition-all"
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
    signQRPayload(challengePayload).then(setSignedPayload);
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 backdrop-blur-xl bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Challenge prize QR code"
        className="relative w-full max-w-sm mx-4 rounded-2xl overflow-hidden animate-fade-in"
      >
        <button
          onClick={onClose}
          aria-label="Close QR"
          className="absolute top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-black/20 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        >
          <X size={18} />
        </button>

        <div className="bg-[#D4AF37]/10 flex items-center justify-center gap-2 py-3">
          <span className="text-[20px]">{placementEmoji[prize.placement] || '\uD83C\uDFC6'}</span>
          <span className="text-[13px] font-bold text-[#D4AF37]">{prize.challenges?.name || 'Challenge Prize'}</span>
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
          <p className="text-[16px] font-bold text-[var(--color-text-primary)] text-center">{prize.reward_label}</p>
          <p className="text-[12px] text-[var(--color-text-muted)] text-center mt-1">
            {t('rewards.showQrToStaff')}
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Rewards Catalog Tab ──────────────────────────────────────────────────────
const RewardsTab = ({ points, gymRewards, gymRewardsLoading, onRedeem, challengePrizes, onShowPrizeQr, pendingRedemptions, onShowPendingQr, onCancelRedemption, t, lang }) => (
  <div>
    <ChallengePrizesBanner prizes={challengePrizes} t={t} onShowQr={onShowPrizeQr} />

    {/* Pending redemptions — show QR again */}
    {pendingRedemptions && pendingRedemptions.length > 0 && (
      <div className="mb-5">
        <p className="text-[12px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-3">
          {t('rewards.pendingRedemptions', 'Pending Redemptions')}
        </p>
        <div className="space-y-2">
          {pendingRedemptions.map((r) => (
            <div key={r.id} className="flex items-center gap-3 bg-[#D4AF37]/[0.06] rounded-xl border border-[#D4AF37]/20 px-4 py-3">
              <QrCode size={18} className="text-[#D4AF37] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">{r.reward_name}</p>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {r.points_spent === 0
                    ? `🎁 ${t('rewards.giftFromGym', 'Gift from your gym')}`
                    : `${formatStatNumber(r.points_spent)} pts`}
                </p>
              </div>
              <button
                onClick={() => onShowPendingQr(r)}
                aria-label={t('rewards.showRedemptionQR', 'Show redemption QR code')}
                className="px-3 py-1.5 min-h-[44px] rounded-lg bg-[#D4AF37] text-black text-[11px] font-bold shrink-0 active:scale-95 transition-transform"
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-white/[0.04] rounded-2xl border border-[var(--color-border-subtle)] p-4 flex flex-col items-center">
            <Skeleton className="w-10 h-10 rounded-full mb-2" />
            <Skeleton className="w-20 h-4 mb-1" />
            <Skeleton className="w-16 h-3 mb-3" />
            <Skeleton className="w-full h-10 rounded-xl" />
          </div>
        ))}
      </div>
    ) : gymRewards.length === 0 ? (
      <div className="text-center py-12">
        <Gift size={40} className="text-[var(--color-text-muted)] mx-auto mb-3 opacity-40" />
        <p className="text-[14px] text-[var(--color-text-muted)]">{t('rewards.noRewardsAvailable', 'No rewards available yet')}</p>
      </div>
    ) : (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {gymRewards.map((reward) => {
          const canAfford = points >= reward.cost;
          const name = lang === 'es' && reward.name_es ? reward.name_es : reward.name;
          const desc = lang === 'es' && reward.description_es ? reward.description_es : (reward.description || '');
          return (
            <div
              key={reward.id}
              className="bg-white/[0.04] rounded-2xl border border-[var(--color-border-subtle)] p-4 flex flex-col items-center text-center hover:bg-white/[0.06] transition-colors duration-200"
            >
              <span className="text-[28px] mb-2">{reward.emoji_icon || '🎁'}</span>
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)] leading-tight">{name}</p>
              {desc && <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-snug">{desc}</p>}
              <div className="flex items-center gap-1 mt-3">
                <Coins size={12} className="text-[#D4AF37]" />
                <span className="text-[13px] font-bold text-[#D4AF37]">{formatStatNumber(reward.cost)}</span>
              </div>
              <button
                onClick={() => onRedeem({ ...reward, name, description: desc })}
                disabled={!canAfford}
                className={`w-full mt-3 py-2.5 rounded-xl text-[12px] font-bold transition-all active:scale-95 ${
                  canAfford
                    ? 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'
                    : 'bg-white/[0.04] text-[var(--color-text-muted)] cursor-not-allowed'
                }`}
              >
                {canAfford ? t('rewards.redeem') : t('rewards.needMore', { count: formatStatNumber(reward.cost - points) })}
              </button>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

// ── Punch Card Stamp Grid ────────────────────────────────────────────────────
const StampCircle = ({ slot, emoji, total }) => {
  const size = total <= 6 ? 'w-10 h-10' : total <= 8 ? 'w-9 h-9' : 'w-8 h-8';
  const iconSize = total <= 6 ? 16 : 14;
  const giftSize = total <= 6 ? 18 : 16;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: slot.index * 0.04, duration: 0.3 }}
      className={`relative flex items-center justify-center rounded-full transition-all ${
        slot.isFree
          ? slot.filled
            ? `${size} bg-[#D4AF37]/20 border-2 border-[#D4AF37] shadow-[0_0_16px_rgba(212,175,55,0.35)]`
            : `${size} bg-white/[0.04] border-2 border-dashed border-[var(--color-border-subtle)]`
          : slot.filled
            ? `${size} bg-[#D4AF37]/12 border-[1.5px] border-[#D4AF37]/50 shadow-[0_0_10px_rgba(212,175,55,0.15)]`
            : `${size} bg-white/[0.04] border-[1.5px] border-[var(--color-border-subtle)]`
      }`}
    >
      {slot.isFree ? (
        slot.filled ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 12, delay: slot.index * 0.04 + 0.15 }}
          >
            <Gift size={giftSize} className="text-[#D4AF37]" />
          </motion.div>
        ) : (
          <Gift size={giftSize - 2} className="text-white/15" />
        )
      ) : slot.filled ? (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15, delay: slot.index * 0.04 + 0.1 }}
          className={`text-[${iconSize}px]`}
        >
          {emoji || <CheckCircle2 size={iconSize} className="text-[#D4AF37]" />}
        </motion.span>
      ) : (
        <span className="text-[10px] font-medium text-white/[0.08] select-none">{slot.index + 1}</span>
      )}
    </motion.div>
  );
};

const PunchCardStamps = ({ punches, target, emoji }) => {
  const total = target;
  const slots = [];
  for (let i = 0; i < target - 1; i++) {
    slots.push({ index: i, filled: i < punches, isFree: false });
  }
  slots.push({ index: target - 1, filled: punches >= target, isFree: true });

  // Single row if ≤5, two rows otherwise
  if (slots.length <= 5) {
    return (
      <div className="flex gap-3 justify-center">
        {slots.map(s => <StampCircle key={s.index} slot={s} emoji={emoji} total={total} />)}
      </div>
    );
  }

  const perRow = Math.ceil(slots.length / 2);
  const topRow = slots.slice(0, perRow);
  const bottomRow = slots.slice(perRow);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3 justify-center">
        {topRow.map(s => <StampCircle key={s.index} slot={s} emoji={emoji} total={total} />)}
      </div>
      <div className="flex gap-3 justify-center">
        {bottomRow.map(s => <StampCircle key={s.index} slot={s} emoji={emoji} total={total} />)}
      </div>
    </div>
  );
};

// ── Purchases Tab ────────────────────────────────────────────────────────────
const PurchasesList = ({ purchases, t }) => {
  const { i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (purchases.length === 0) {
    return (
      <div className="text-center py-14 px-6 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)]">
        <div className="w-14 h-14 rounded-[14px] bg-[var(--color-bg-deep)] flex items-center justify-center mx-auto mb-3">
          <ShoppingBag size={28} className="text-[var(--color-text-muted)]" />
        </div>
        <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('rewards.noPurchasesYet')}</p>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">{t('rewards.purchaseHistoryHint')}</p>
      </div>
    );
  }

  const visible = showAll ? purchases : purchases.slice(0, 5);

  return (
    <div className="space-y-2">
      {visible.map((purchase) => (
        <div
          key={purchase.id}
          className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)] hover:bg-white/[0.06] transition-colors duration-200"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#D4AF37]/10">
            <span className="text-[16px]">
              {purchase.gym_products?.emoji_icon || <ShoppingBag size={17} className="text-[#D4AF37]" />}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                {purchase.gym_products?.name || 'Product'}
              </p>
              {purchase.quantity > 1 && (
                <span className="text-[11px] text-[var(--color-text-muted)]">x{purchase.quantity}</span>
              )}
              {purchase.is_free_reward && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981]">
                  {t('rewards.free')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
              {formatDistanceToNow(new Date(purchase.created_at), { addSuffix: true, locale: i18n.language?.startsWith('es') ? esLocale : undefined })}
            </p>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            {!purchase.is_free_reward && (
              <span className="text-[13px] font-bold text-[var(--color-text-primary)]">
                ${parseFloat(purchase.total_price || 0).toFixed(2)}
              </span>
            )}
            {purchase.points_earned > 0 && (
              <span className="text-[11px] font-semibold text-[#10B981]">
                +{purchase.points_earned} pts
              </span>
            )}
          </div>
        </div>
      ))}
      {!showAll && purchases.length > 5 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-2.5 rounded-xl text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
        >
          {t('rewards.showAllPurchases', { count: purchases.length })}
        </button>
      )}
      {showAll && purchases.length > 5 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full py-2.5 rounded-xl text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
        >
          {t('rewards.showLess')}
        </button>
      )}
    </div>
  );
};

const PurchasesTab = ({ punchCards, purchases, loading, profile, t }) => {
  const [walletLoadingId, setWalletLoadingId] = useState(null);
  const [walletError, setWalletError] = useState('');
  const [qrProduct, setQrProduct] = useState(null);

  const handleAddToWallet = useCallback(async (card) => {
    setWalletLoadingId(card.id);
    setWalletError('');
    try {
      const platform = Capacitor.getPlatform();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Put the tapped card first, then the rest
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

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.unsupported) throw new Error('Wallet passes not yet configured for this gym');

      if (platform === 'ios') {
        await WalletPass.addPass({ pkpassBase64: data.pkpass });
      } else {
        window.open(data.saveUrl, '_blank');
      }
    } catch (err) {
      setWalletError(err.message || 'Failed to add to wallet');
      logger.error('Wallet pass error:', err);
    } finally {
      setWalletLoadingId(null);
    }
  }, [profile, punchCards]);

  if (loading) {
    return <Skeleton variant="list-item" count={4} />;
  }

  return (
    <FadeIn>
      <div className="space-y-8">
        {/* ── Punch Cards Section ─────────────────────────────── */}
        <div>
          <h3 className="text-[15px] font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
            <Gift size={16} className="text-[#D4AF37]" />
            {t('rewards.punchCards')}
          </h3>

          {punchCards.length === 0 ? (
            <div className="text-center py-14 px-6 rounded-2xl bg-white/[0.04] border border-[var(--color-border-subtle)]">
              <div className="w-14 h-14 rounded-[14px] bg-[var(--color-bg-deep)] flex items-center justify-center mx-auto mb-3">
                <Gift size={28} className="text-[var(--color-text-muted)]" />
              </div>
              <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{t('rewards.noPunchCardsYet')}</p>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
                {t('rewards.noPunchCardsHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {punchCards.map((card) => {
                const remaining = card.punch_card_target - card.current_punches;
                const progressPct = Math.min((card.current_punches / card.punch_card_target) * 100, 100);
                const isComplete = remaining <= 0;
                return (
                  <div
                    key={card.id}
                    className="relative rounded-[22px] overflow-hidden border border-[var(--color-border-subtle)] shadow-[0_2px_24px_rgba(0,0,0,0.4)]"
                    style={{
                      background: 'linear-gradient(165deg, var(--color-bg-card) 0%, var(--color-bg-secondary) 50%, var(--color-bg-card) 100%)',
                    }}
                  >
                    {/* Subtle top accent line */}
                    <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37]/25 to-transparent" />

                    {/* ── Header: product + count ── */}
                    <div className="px-5 pt-5 pb-1">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-[#D4AF37]/[0.08] border border-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[20px]">
                              {card.gym_products?.emoji_icon || <Gift size={20} className="text-[#D4AF37]" />}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[15px] font-bold text-[var(--color-text-primary)] tracking-[-0.01em] truncate">
                              {card.gym_products?.name || 'Product'}
                            </p>
                            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                              {isComplete
                                ? t('rewards.rewardUnlocked')
                                : t('rewards.visitsLeft', { count: remaining })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-baseline gap-0.5 flex-shrink-0 pt-0.5 min-w-0">
                          <span className={`${statFontSize(card.current_punches, 'text-[22px]')} font-bold text-[#D4AF37] tracking-tight leading-none tabular-nums truncate`}>
                            {card.current_punches}
                          </span>
                          <span className="text-[13px] font-medium text-[var(--color-text-muted)]">/{card.punch_card_target}</span>
                        </div>
                      </div>
                    </div>

                    {/* ── Stamp grid (focal point) ── */}
                    <div className="px-5 py-5">
                      <PunchCardStamps
                        punches={card.current_punches}
                        target={card.punch_card_target}
                        emoji={card.gym_products?.emoji_icon}
                      />
                    </div>

                    {/* ── Progress bar ── */}
                    <div className="px-5 pb-1">
                      <div className="h-[3px] rounded-full bg-white/[0.04] overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{
                            background: 'linear-gradient(90deg, #D4AF37, #E6C766)',
                            boxShadow: '0 0 8px rgba(212,175,55,0.3)',
                          }}
                          initial={{ width: 0 }}
                          animate={{ width: `${progressPct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                    </div>

                    {/* ── Footer: status + wallet ── */}
                    <div className="px-5 pt-3 pb-4 flex items-center justify-between">
                      <div>
                        {card.total_completed > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-full bg-[#D4AF37]/15 flex items-center justify-center">
                              <Gift size={10} className="text-[#D4AF37]" />
                            </div>
                            <span className="text-[12px] font-semibold text-[#D4AF37]">
                              {t('rewards.rewardsEarned', { count: card.total_completed })}
                            </span>
                          </div>
                        ) : (
                          <p className="text-[12px] text-[var(--color-text-muted)]">
                            {isComplete ? t('rewards.claimReward') : progressPct >= 60 ? t('rewards.almostThere') : t('rewards.keepGoing')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setQrProduct(card)}
                          aria-label={t('rewards.showPunchCardQR', 'Show punch card QR code')}
                          className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] min-w-[44px] rounded-lg text-[11px] font-semibold text-[#D4AF37] bg-[#D4AF37]/[0.08] border border-[#D4AF37]/15 hover:bg-[#D4AF37]/[0.12] transition-all"
                        >
                          <QrCode size={12} />
                          QR
                        </button>
                        <button
                          onClick={() => handleAddToWallet(card)}
                          disabled={walletLoadingId !== null}
                          aria-label={t('rewards.addToWallet', 'Add to wallet')}
                          className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-[11px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-surface-hover)] border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-deep)] transition-all disabled:opacity-40"
                        >
                          {walletLoadingId === card.id ? (
                            <div className="w-3 h-3 border-[1.5px] border-white/20 border-t-white/60 rounded-full animate-spin" />
                          ) : (
                            <Wallet size={12} />
                          )}
                          {walletLoadingId === card.id ? t('rewards.adding') : Capacitor.getPlatform() === 'ios' ? t('rewards.appleWallet') : Capacitor.getPlatform() === 'android' ? t('rewards.googleWallet') : t('rewards.wallet')}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Purchase History Section ────────────────────────── */}
        <div>
          <h3 className="text-[15px] font-bold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
            <ShoppingBag size={16} className="text-[#D4AF37]" />
            {t('rewards.purchaseHistory')}
          </h3>

          <PurchasesList purchases={purchases} t={t} />
        </div>
      </div>

      {/* Product QR modal */}
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

      {/* Wallet error toast */}
      <AnimatePresence>
        {walletError && (
          <motion.div
            className="fixed top-24 left-1/2 z-50 -translate-x-1/2"
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
          >
            <div className="flex items-center gap-2 bg-[#EF4444]/20 border border-[#EF4444]/40 px-4 py-2.5 rounded-2xl backdrop-blur-xl shadow-lg">
              <span className="text-[12px] font-medium text-[#EF4444]">{walletError}</span>
              <button onClick={() => setWalletError('')} aria-label="Dismiss error" className="text-[#EF4444]/60 hover:text-[#EF4444] min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
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
  const [tab, setTab] = useState('rewards');
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState({ total_points: 0, lifetime_points: ctxLifetimePoints ?? 0 });
  useEffect(() => { if (ctxLifetimePoints != null) setPointsData(prev => ({ ...prev, lifetime_points: ctxLifetimePoints })); }, [ctxLifetimePoints]);
  const [history, setHistory] = useState([]);
  const [punchCards, setPunchCards] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [successReward, setSuccessReward] = useState(null); // { reward, redemptionId }
  const [challengePrizes, setChallengePrizes] = useState([]);
  const [prizeQrTarget, setPrizeQrTarget] = useState(null);
  const [pendingRedemptions, setPendingRedemptions] = useState([]);
  const [gymRewards, setGymRewards] = useState([]);
  const [gymRewardsLoading, setGymRewardsLoading] = useState(true);

  const tier = getRewardTier(pointsData.lifetime_points);
  // Points held by pending redemptions (not yet deducted, but reserved)
  const heldPoints = pendingRedemptions.reduce((sum, r) => sum + (r.points_spent || 0), 0);
  const availablePoints = (pointsData.total_points || 0) - heldPoints;

  const loadData = useCallback(async () => {
    if (!user?.id || !profile?.gym_id) return;
    setLoading(true);

    const [pts, hist, punchCardsRes, purchasesRes, prizesRes, pendingRes, gymRewardsRes] = await Promise.all([
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
        .select('id, name, name_es, description, description_es, cost_points, reward_type, emoji_icon, sort_order')
        .eq('gym_id', profile.gym_id)
        .eq('is_active', true)
        .order('sort_order'),
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
      setRedeemError(error.message?.includes('Insufficient') ? 'Not enough points' : 'Redemption failed. Please try again.');
      setRedeemTarget(null);
      setTimeout(() => setRedeemError(null), 3000);
      return;
    }

    setRedeemTarget(null);
    setSuccessReward({ reward, redemptionId: data?.redemption_id || 'unknown' });
    loadData();
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] pb-28 md:pb-12">
      {/* Challenge Prize QR modal */}
      {prizeQrTarget && (
        <ChallengePrizeQRModal
          prize={prizeQrTarget}
          onClose={() => setPrizeQrTarget(null)}
        />
      )}

      {/* Redemption QR modal */}
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

      {/* Error toast */}
      <AnimatePresence>
        {redeemError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl bg-[#EF4444]/15 border border-[#EF4444]/20 backdrop-blur-xl shadow-xl"
          >
            <p className="text-[13px] font-semibold text-[#EF4444]">{redeemError}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Redeem modal */}
      {redeemTarget && (
        <RedeemModal
          reward={redeemTarget}
          points={availablePoints}
          onConfirm={handleRedeem}
          onClose={() => setRedeemTarget(null)}
          t={t}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border-b border-[var(--color-border-subtle)]">
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-4 pt-6 pb-5">
          {/* Title row */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-[14px] bg-[#D4AF37]/10 flex items-center justify-center">
              <Coins size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[var(--color-text-primary)] tracking-tight truncate">{t('rewards.title')}</h1>
              <p className="text-[13px] text-[var(--color-text-muted)] mt-0.5">{t('rewards.subtitle')}</p>
            </div>
          </div>

          {/* Points hero card */}
          <div className="bg-white/[0.04] rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">{t('rewards.yourPoints')}</p>
                <p className={`${statFontSize(availablePoints, 'text-[24px]')} font-bold text-[#D4AF37] leading-tight mt-1 tabular-nums truncate`}>
                  <AnimatedPoints value={availablePoints} />
                </p>
                {heldPoints > 0 && (
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                    {formatStatNumber(heldPoints)} {t('rewards.heldPending', 'held pending')}
                  </p>
                )}
              </div>
              <div className="text-right">
                <TierBadge tier={tier} size="lg" t={t} />
                <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
                  {t('rewards.lifetime')}: {formatStatNumber(pointsData.lifetime_points ?? 0)}
                </p>
              </div>
            </div>

            {/* Progress to next tier */}
            {tier.nextTier && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
                    {t('rewards.progressTo', { tier: t(`rewards.tiers.${tier.nextTierKey}`, tier.nextTier) })}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: tier.nextTierColor }}>
                    {t('rewards.ptsToGo', { count: formatStatNumber(tier.pointsToNext) })}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: tier.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${tier.progress}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 bg-[var(--color-bg-deep)] p-1 rounded-xl" role="tablist" aria-label={t('rewards.tabNavigation', 'Rewards navigation')}>
            {TAB_KEYS.map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                role="tab"
                aria-selected={tab === tabKey}
                className={`flex-1 py-2.5 min-h-[44px] rounded-xl text-[13px] font-semibold transition-all ${
                  tab === tabKey
                    ? 'bg-[#D4AF37] text-black font-semibold'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-muted)]'
                }`}
              >
                {t(`rewards.tabs.${tabKey}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ─────────────────────────────────────────── */}
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
                setRedeemError('Failed to cancel. Please try again.');
                setTimeout(() => setRedeemError(null), 3000);
                return;
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
