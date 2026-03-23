// ── Rewards & Points Page ────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Coins, Trophy, Gift, Crown, History, Star,
  Dumbbell, MapPin, Flame, Target, Award, Scale,
  Zap, CalendarCheck, CheckCircle2, X, ShoppingBag,
  Coffee, Ticket, Shirt, Medal, Wallet, QrCode,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import logger from '../lib/logger';
import { useAuth } from '../contexts/AuthContext';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import ProductQRModal from '../components/ProductQRModal';
import {
  getUserPoints,
  getRewardTier,
  getPointsHistory,
  REWARDS_CATALOG,
} from '../lib/rewardsEngine';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Capacitor, registerPlugin } from '@capacitor/core';

const WalletPass = registerPlugin('WalletPass');

// ── Action icon mapping ──────────────────────────────────────────────────────
const ACTION_META = {
  workout_completed:    { icon: Dumbbell,      color: '#D4AF37', labelKey: 'workout_completed' },
  pr_hit:               { icon: Target,        color: '#EF4444', labelKey: 'pr_hit' },
  check_in:             { icon: MapPin,         color: '#10B981', labelKey: 'check_in' },
  streak_day:           { icon: Flame,          color: '#F97316', labelKey: 'streak_day' },
  challenge_completed:  { icon: Trophy,         color: '#A78BFA', labelKey: 'challenge_completed' },
  achievement_unlocked: { icon: Award,          color: '#F59E0B', labelKey: 'achievement_unlocked' },
  weight_logged:        { icon: Scale,          color: '#60A5FA', labelKey: 'weight_logged' },
  first_weekly_workout: { icon: CalendarCheck,  color: '#10B981', labelKey: 'first_weekly_workout' },
  streak_7:             { icon: Zap,            color: '#F97316', labelKey: 'streak_7' },
  streak_30:            { icon: Crown,          color: '#D4AF37', labelKey: 'streak_30' },
};

// Map reward icon names → lucide components
const REWARD_ICON_MAP = { Coffee, Ticket, Shirt, Dumbbell, Medal, Gift, Trophy, Star };
const RewardIcon = ({ name, size = 28, className = '' }) => {
  const Icon = REWARD_ICON_MAP[name] || Gift;
  return <Icon size={size} className={className} />;
};

// ── Tier badge component ─────────────────────────────────────────────────────
const TierBadge = ({ tier, size = 'md' }) => {
  const sizes = {
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-[11px] px-3 py-1',
    lg: 'text-[13px] px-4 py-1.5',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-full ${sizes[size]}`}
      style={{ backgroundColor: `${tier.color}15`, color: tier.color, border: `1px solid ${tier.color}30` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tier.color }} />
      {tier.name}
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
    <span className="tabular-nums">{display.toLocaleString()}</span>
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="redeem-reward-title"
          className="bg-[#0F172A] rounded-[18px] border border-white/10 p-6 max-w-sm w-full shadow-2xl"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <h3 id="redeem-reward-title" className="text-[18px] font-bold text-[#E5E7EB]">{t('rewards.redeemReward')}</h3>
            <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="text-center py-4">
            <RewardIcon name={reward.icon} size={48} className="text-[#D4AF37]" />
            <p className="text-[16px] font-semibold text-[#E5E7EB] mt-3">{reward.name}</p>
            <p className="text-[13px] text-[#9CA3AF] mt-1">{reward.description}</p>
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Coins size={16} className="text-[#D4AF37]" />
              <span className="text-[20px] font-black text-[#D4AF37]">{reward.cost.toLocaleString()}</span>
              <span className="text-[13px] text-[#9CA3AF]">pts</span>
            </div>
            {!canAfford && (
              <p className="text-[12px] text-[#EF4444] mt-2">
                {t('rewards.youNeedMore', { count: (reward.cost - points).toLocaleString() })}
              </p>
            )}
          </div>

          <div className="flex gap-3 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-[#9CA3AF] bg-white/5 hover:bg-white/10 transition-colors"
            >
              {t('rewards.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canAfford || redeeming}
              className="flex-1 py-3 rounded-xl text-[14px] font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-[#D4AF37] text-black hover:bg-[#E6C766]"
            >
              {redeeming ? t('rewards.redeeming') : t('rewards.confirm')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ── Success Toast ────────────────────────────────────────────────────────────
const SuccessToast = ({ reward, onDone, t }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      className="fixed top-24 left-1/2 z-50 -translate-x-1/2"
      initial={{ y: -30, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -30, opacity: 0 }}
    >
      <div className="flex items-center gap-3 bg-[#10B981]/20 border border-[#10B981]/40 px-5 py-3 rounded-2xl backdrop-blur-xl shadow-lg">
        <CheckCircle2 size={20} className="text-[#10B981]" />
        <span className="text-[14px] font-semibold text-[#10B981]">
          {t('rewards.redeemed', { name: reward.name })}
        </span>
      </div>
    </motion.div>
  );
};

// ── Points History Tab ───────────────────────────────────────────────────────
const HistoryTab = ({ history, loading, t }) => {
  if (loading) {
    return <Skeleton variant="list-item" count={4} />;
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="w-14 h-14 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-3">
          <History size={28} className="text-[#6B7280]" />
        </div>
        <p className="text-[15px] font-semibold text-[#E5E7EB]">{t('rewards.noPointsYet')}</p>
        <p className="text-[13px] text-[#9CA3AF] mt-1">{t('rewards.noPointsHint')}</p>
      </div>
    );
  }

  return (
    <FadeIn>
    <div className="space-y-2">
      {history.map((entry) => {
        const rawMeta = ACTION_META[entry.action] || { icon: Star, color: '#6B7280', labelKey: entry.action };
        const meta = { ...rawMeta, label: t(`rewards.actionLabels.${rawMeta.labelKey}`, rawMeta.labelKey) };
        const Icon = meta.icon;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-4 py-3.5 rounded-[14px] bg-[#0F172A] border border-white/8 hover:border-white/20 hover:bg-white/[0.03] transition-all"
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${meta.color}15` }}
            >
              <Icon size={17} style={{ color: meta.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                {entry.description || meta.label}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
              </p>
            </div>
            <span className="text-[14px] font-bold text-[#10B981] flex-shrink-0">
              +{entry.points}
            </span>
          </div>
        );
      })}
    </div>
    </FadeIn>
  );
};

// ── Rewards Catalog Tab ──────────────────────────────────────────────────────
const RewardsTab = ({ points, onRedeem, t }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
    {REWARDS_CATALOG.map((reward) => {
      const canAfford = points >= reward.cost;
      return (
        <div
          key={reward.id}
          className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4 flex flex-col items-center text-center hover:border-white/20 hover:bg-white/[0.03] transition-all"
        >
          <RewardIcon name={reward.icon} size={28} className="text-[#D4AF37] mb-2" />
          <p className="text-[13px] font-semibold text-[#E5E7EB] leading-tight">{reward.name}</p>
          <p className="text-[11px] text-[#6B7280] mt-1 leading-snug">{reward.description}</p>
          <div className="flex items-center gap-1 mt-3">
            <Coins size={12} className="text-[#D4AF37]" />
            <span className="text-[13px] font-bold text-[#D4AF37]">{reward.cost.toLocaleString()}</span>
          </div>
          <button
            onClick={() => onRedeem(reward)}
            disabled={!canAfford}
            className={`w-full mt-3 py-2.5 rounded-xl text-[12px] font-bold transition-all active:scale-95 ${
              canAfford
                ? 'bg-[#D4AF37] text-black hover:bg-[#E6C766]'
                : 'bg-white/5 text-[#6B7280] cursor-not-allowed'
            }`}
          >
            {canAfford ? t('rewards.redeem') : t('rewards.needMore', { count: (reward.cost - points).toLocaleString() })}
          </button>
        </div>
      );
    })}
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
            : `${size} bg-white/[0.02] border-2 border-dashed border-white/10`
          : slot.filled
            ? `${size} bg-[#D4AF37]/12 border-[1.5px] border-[#D4AF37]/50 shadow-[0_0_10px_rgba(212,175,55,0.15)]`
            : `${size} bg-white/[0.02] border-[1.5px] border-white/[0.06]`
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
          <h3 className="text-[15px] font-bold text-[#E5E7EB] mb-3 flex items-center gap-2">
            <Gift size={16} className="text-[#D4AF37]" />
            {t('rewards.punchCards')}
          </h3>

          {punchCards.length === 0 ? (
            <div className="text-center py-14 px-6 rounded-[14px] bg-[#0F172A] border border-white/8">
              <div className="w-14 h-14 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-3">
                <Gift size={28} className="text-[#6B7280]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB]">{t('rewards.noPunchCardsYet')}</p>
              <p className="text-[13px] text-[#9CA3AF] mt-1">
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
                    className="relative rounded-[22px] overflow-hidden border border-white/[0.06] shadow-[0_2px_24px_rgba(0,0,0,0.4)]"
                    style={{
                      background: 'linear-gradient(165deg, #0F172A 0%, #0A0D14 50%, #0D1117 100%)',
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
                            <p className="text-[15px] font-bold text-white tracking-[-0.01em] truncate">
                              {card.gym_products?.name || 'Product'}
                            </p>
                            <p className="text-[12px] text-white/40 mt-0.5">
                              {isComplete
                                ? t('rewards.rewardUnlocked')
                                : t('rewards.visitsLeft', { count: remaining })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-baseline gap-0.5 flex-shrink-0 pt-0.5">
                          <span className="text-[22px] font-black text-[#D4AF37] tracking-tight leading-none">
                            {card.current_punches}
                          </span>
                          <span className="text-[13px] font-medium text-white/20">/{card.punch_card_target}</span>
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
                          <p className="text-[12px] text-white/25">
                            {isComplete ? t('rewards.claimReward') : progressPct >= 60 ? t('rewards.almostThere') : t('rewards.keepGoing')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => setQrProduct(card)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#D4AF37] bg-[#D4AF37]/[0.08] border border-[#D4AF37]/15 hover:bg-[#D4AF37]/[0.12] transition-all"
                        >
                          <QrCode size={12} />
                          QR
                        </button>
                        <button
                          onClick={() => handleAddToWallet(card)}
                          disabled={walletLoadingId !== null}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white/50 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] hover:text-white/70 transition-all disabled:opacity-40"
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
          <h3 className="text-[15px] font-bold text-[#E5E7EB] mb-3 flex items-center gap-2">
            <ShoppingBag size={16} className="text-[#D4AF37]" />
            {t('rewards.purchaseHistory')}
          </h3>

          {purchases.length === 0 ? (
            <div className="text-center py-14 px-6 rounded-[14px] bg-[#0F172A] border border-white/8">
              <div className="w-14 h-14 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-3">
                <ShoppingBag size={28} className="text-[#6B7280]" />
              </div>
              <p className="text-[15px] font-semibold text-[#E5E7EB]">{t('rewards.noPurchasesYet')}</p>
              <p className="text-[13px] text-[#9CA3AF] mt-1">
                {t('rewards.purchaseHistoryHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {purchases.map((purchase) => (
                <div
                  key={purchase.id}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-[14px] bg-[#0F172A] border border-white/8 hover:border-white/20 hover:bg-white/[0.03] transition-all"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#D4AF37]/10">
                    <span className="text-[16px]">
                      {purchase.gym_products?.emoji_icon || <ShoppingBag size={17} className="text-[#D4AF37]" />}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                        {purchase.gym_products?.name || 'Product'}
                      </p>
                      {purchase.quantity > 1 && (
                        <span className="text-[11px] text-[#9CA3AF]">x{purchase.quantity}</span>
                      )}
                      {purchase.is_free_reward && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#10B981]/15 text-[#10B981]">
                          {t('rewards.free')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#6B7280] mt-0.5">
                      {formatDistanceToNow(new Date(purchase.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    {!purchase.is_free_reward && (
                      <span className="text-[13px] font-bold text-[#E5E7EB]">
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
            </div>
          )}
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
              <button onClick={() => setWalletError('')} className="text-[#EF4444]/60 hover:text-[#EF4444]">
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
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [tab, setTab] = useState('rewards');
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState({ total_points: 0, lifetime_points: 0 });
  const [history, setHistory] = useState([]);
  const [punchCards, setPunchCards] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [successReward, setSuccessReward] = useState(null);

  const tier = getRewardTier(pointsData.lifetime_points);

  const loadData = useCallback(async () => {
    if (!user?.id || !profile?.gym_id) return;
    setLoading(true);

    const [pts, hist, punchCardsRes, purchasesRes] = await Promise.all([
      getUserPoints(user.id),
      getPointsHistory(user.id, 50),
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
        .limit(50),
    ]);

    setPointsData(pts);
    setHistory(hist);
    setPunchCards(
      (punchCardsRes.data || []).map((card) => ({
        ...card,
        current_punches: card.punches ?? 0,
        punch_card_target: card.gym_products?.punch_card_target ?? 10,
      }))
    );
    setPurchases(purchasesRes.data || []);
    setLoading(false);
  }, [user?.id, profile?.gym_id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRedeem = async (reward) => {
    if (!user?.id || !profile?.gym_id) return;

    // Insert redemption record
    const { error } = await supabase
      .from('reward_redemptions')
      .insert({
        profile_id: user.id,
        gym_id: profile.gym_id,
        reward_id: reward.id,
        reward_name: reward.name,
        points_spent: reward.cost,
        status: 'pending',
        created_at: new Date().toISOString(),
      });

    if (error) {
      logger.error('Redemption error:', error);
      return;
    }

    // Deduct points from reward_points
    const newTotal = Math.max(0, pointsData.total_points - reward.cost);
    await supabase
      .from('reward_points')
      .update({ total_points: newTotal, last_updated: new Date().toISOString() })
      .eq('profile_id', user.id);

    // Log the deduction
    await supabase
      .from('reward_points_log')
      .insert({
        profile_id: user.id,
        gym_id: profile.gym_id,
        action: 'redemption',
        points: -reward.cost,
        description: `Redeemed: ${reward.name}`,
        created_at: new Date().toISOString(),
      });

    setRedeemTarget(null);
    setSuccessReward(reward);
    loadData();
  };

  return (
    <div className="min-h-screen bg-[#05070B] pb-28 md:pb-12">
      {/* Success toast */}
      <AnimatePresence>
        {successReward && (
          <SuccessToast reward={successReward} onDone={() => setSuccessReward(null)} t={t} />
        )}
      </AnimatePresence>

      {/* Redeem modal */}
      {redeemTarget && (
        <RedeemModal
          reward={redeemTarget}
          points={pointsData.total_points}
          onConfirm={handleRedeem}
          onClose={() => setRedeemTarget(null)}
          t={t}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl border-b border-white/6">
        <div className="max-w-2xl md:max-w-4xl mx-auto px-4 pt-6 pb-5">
          {/* Title row */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-[14px] bg-[#D4AF37]/10 flex items-center justify-center">
              <Coins size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[#E5E7EB] tracking-tight">{t('rewards.title')}</h1>
              <p className="text-[13px] text-[#9CA3AF] mt-0.5">{t('rewards.subtitle')}</p>
            </div>
          </div>

          {/* Points hero card */}
          <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest">{t('rewards.yourPoints')}</p>
                <p className="text-[36px] font-black text-[#D4AF37] leading-tight mt-1">
                  <AnimatedPoints value={pointsData.total_points} />
                </p>
              </div>
              <div className="text-right">
                <TierBadge tier={tier} size="lg" />
                <p className="text-[11px] text-[#6B7280] mt-2">
                  {t('rewards.lifetime')}: {pointsData.lifetime_points?.toLocaleString() ?? 0}
                </p>
              </div>
            </div>

            {/* Progress to next tier */}
            {tier.nextTier && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-[#6B7280]">
                    {t('rewards.progressTo', { tier: tier.nextTier })}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: tier.nextTierColor }}>
                    {t('rewards.ptsToGo', { count: tier.pointsToNext.toLocaleString() })}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
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
          <div className="flex gap-1 bg-[#111827] p-1 rounded-xl">
            {TAB_KEYS.map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                  tab === tabKey
                    ? 'bg-[#D4AF37] text-black font-semibold'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                {t(`rewards.tabs.${tabKey}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ─────────────────────────────────────────── */}
      <div className="max-w-2xl md:max-w-4xl mx-auto px-4 py-6">
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
            points={pointsData.total_points}
            onRedeem={(reward) => setRedeemTarget(reward)}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
