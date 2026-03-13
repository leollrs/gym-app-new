// ── Rewards & Points Page ────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Coins, Trophy, Gift, Crown, History, Star,
  Dumbbell, MapPin, Flame, Target, Award, Scale,
  Zap, CalendarCheck, CheckCircle2, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  getUserPoints,
  getRewardTier,
  getPointsHistory,
  getLeaderboard,
  REWARDS_CATALOG,
} from '../lib/rewardsEngine';
import { formatDistanceToNow } from 'date-fns';

// ── Action icon mapping ──────────────────────────────────────────────────────
const ACTION_META = {
  workout_completed:    { icon: Dumbbell,      color: '#D4AF37', label: 'Workout' },
  pr_hit:               { icon: Target,        color: '#EF4444', label: 'Personal Record' },
  check_in:             { icon: MapPin,         color: '#10B981', label: 'Check-in' },
  streak_day:           { icon: Flame,          color: '#F97316', label: 'Streak' },
  challenge_completed:  { icon: Trophy,         color: '#A78BFA', label: 'Challenge' },
  achievement_unlocked: { icon: Award,          color: '#F59E0B', label: 'Achievement' },
  weight_logged:        { icon: Scale,          color: '#60A5FA', label: 'Weight Log' },
  first_weekly_workout: { icon: CalendarCheck,  color: '#10B981', label: 'Weekly Bonus' },
  streak_7:             { icon: Zap,            color: '#F97316', label: '7-Day Streak' },
  streak_30:            { icon: Crown,          color: '#D4AF37', label: '30-Day Streak' },
};

const MEDAL = ['🥇', '🥈', '🥉'];

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
const RedeemModal = ({ reward, points, onConfirm, onClose }) => {
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
            <h3 id="redeem-reward-title" className="text-[18px] font-bold text-[#E5E7EB]">Redeem Reward</h3>
            <button onClick={onClose} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="text-center py-4">
            <span className="text-5xl">{reward.icon}</span>
            <p className="text-[16px] font-semibold text-[#E5E7EB] mt-3">{reward.name}</p>
            <p className="text-[13px] text-[#9CA3AF] mt-1">{reward.description}</p>
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Coins size={16} className="text-[#D4AF37]" />
              <span className="text-[20px] font-black text-[#D4AF37]">{reward.cost.toLocaleString()}</span>
              <span className="text-[13px] text-[#9CA3AF]">pts</span>
            </div>
            {!canAfford && (
              <p className="text-[12px] text-[#EF4444] mt-2">
                You need {(reward.cost - points).toLocaleString()} more points
              </p>
            )}
          </div>

          <div className="flex gap-3 mt-5">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-xl text-[14px] font-semibold text-[#9CA3AF] bg-white/5 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canAfford || redeeming}
              className="flex-1 py-3 rounded-xl text-[14px] font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bg-[#D4AF37] text-black hover:bg-[#E6C766]"
            >
              {redeeming ? 'Redeeming...' : 'Confirm'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ── Success Toast ────────────────────────────────────────────────────────────
const SuccessToast = ({ reward, onDone }) => {
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
          {reward.name} redeemed!
        </span>
      </div>
    </motion.div>
  );
};

// ── Points History Tab ───────────────────────────────────────────────────────
const HistoryTab = ({ history, loading }) => {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-7 h-7 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="w-14 h-14 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-3">
          <History size={28} className="text-[#6B7280]" />
        </div>
        <p className="text-[15px] font-semibold text-[#E5E7EB]">No points earned yet</p>
        <p className="text-[13px] text-[#9CA3AF] mt-1">Complete workouts, hit PRs, and check in to earn points</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {history.map((entry) => {
        const meta = ACTION_META[entry.action] || { icon: Star, color: '#6B7280', label: entry.action };
        const Icon = meta.icon;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-4 py-3.5 rounded-[14px] bg-[#0F172A] border border-white/8"
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
  );
};

// ── Rewards Catalog Tab ──────────────────────────────────────────────────────
const RewardsTab = ({ points, onRedeem }) => (
  <div className="grid grid-cols-2 gap-3">
    {REWARDS_CATALOG.map((reward) => {
      const canAfford = points >= reward.cost;
      return (
        <div
          key={reward.id}
          className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4 flex flex-col items-center text-center"
        >
          <span className="text-3xl mb-2">{reward.icon}</span>
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
            {canAfford ? 'Redeem' : `Need ${(reward.cost - points).toLocaleString()} more`}
          </button>
        </div>
      );
    })}
  </div>
);

// ── Leaderboard Tab ──────────────────────────────────────────────────────────
const LeaderboardTab = ({ entries, loading, myId }) => {
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-7 h-7 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-20 px-6">
        <div className="w-14 h-14 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-3">
          <Trophy size={28} className="text-[#6B7280]" />
        </div>
        <p className="text-[15px] font-semibold text-[#E5E7EB]">No leaderboard data yet</p>
        <p className="text-[13px] text-[#9CA3AF] mt-1">Be the first to earn points at your gym</p>
      </div>
    );
  }

  // Podium for top 3
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  // Reorder for podium display: [2nd, 1st, 3rd]
  const podiumOrder = podium.length >= 3
    ? [podium[1], podium[0], podium[2]]
    : podium.length === 2
      ? [podium[1], podium[0]]
      : podium;

  return (
    <div>
      {/* Podium */}
      <div className="flex items-end justify-center gap-3 mb-6 pt-4">
        {podiumOrder.map((entry, i) => {
          const isFirst = entry.rank === 1;
          const isMe = entry.profileId === myId;
          const height = isFirst ? 'h-28' : entry.rank === 2 ? 'h-22' : 'h-18';
          return (
            <div key={entry.profileId} className="flex flex-col items-center flex-1 max-w-[120px]">
              {/* Avatar */}
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 border-2 ${
                  isFirst ? 'border-[#D4AF37]' : 'border-white/10'
                } ${isMe ? 'ring-2 ring-[#D4AF37]/50' : ''}`}
                style={{ backgroundColor: `${entry.tier.color}15` }}
              >
                {entry.avatarUrl ? (
                  <img src={entry.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <span className="text-[14px] font-bold" style={{ color: entry.tier.color }}>
                    {entry.name[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <p className={`text-[12px] font-semibold truncate max-w-full ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                {entry.name}
                {isMe && <span className="ml-1 text-[9px] font-bold text-[#D4AF37]">YOU</span>}
              </p>
              <p className="text-[11px] font-bold text-[#9CA3AF] mt-0.5">
                {entry.totalPoints.toLocaleString()} pts
              </p>
              {/* Podium bar */}
              <div
                className={`w-full ${height} rounded-t-xl mt-2 flex items-start justify-center pt-2`}
                style={{ backgroundColor: `${entry.tier.color}15`, borderTop: `2px solid ${entry.tier.color}40` }}
              >
                <span className="text-lg">{MEDAL[entry.rank - 1]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Rest of the leaderboard */}
      {rest.length > 0 && (
        <div className="space-y-2">
          {rest.map((entry) => {
            const isMe = entry.profileId === myId;
            return (
              <div
                key={entry.profileId}
                className={`flex items-center gap-3 px-4 py-3 rounded-[14px] ${
                  isMe
                    ? 'bg-[#D4AF37]/10 border border-[#D4AF37]/30'
                    : 'bg-[#0F172A] border border-white/8'
                }`}
              >
                <span className="text-[14px] font-bold w-6 text-center text-[#6B7280]">
                  {entry.rank}
                </span>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${entry.tier.color}15` }}
                >
                  {entry.avatarUrl ? (
                    <img src={entry.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <span className="text-[11px] font-bold" style={{ color: entry.tier.color }}>
                      {entry.name[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] font-semibold truncate ${isMe ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                    {entry.name}
                    {isMe && <span className="ml-1.5 text-[10px] font-bold text-[#D4AF37]">YOU</span>}
                  </p>
                </div>
                <TierBadge tier={entry.tier} size="sm" />
                <span className={`text-[13px] font-bold flex-shrink-0 ${isMe ? 'text-[#D4AF37]' : 'text-[#9CA3AF]'}`}>
                  {entry.totalPoints.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Main Rewards Page ────────────────────────────────────────────────────────
const TABS = ['History', 'Rewards', 'Leaderboard'];

export default function Rewards() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState('History');
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState({ total_points: 0, lifetime_points: 0 });
  const [history, setHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [redeemTarget, setRedeemTarget] = useState(null);
  const [successReward, setSuccessReward] = useState(null);

  const tier = getRewardTier(pointsData.total_points);

  const loadData = useCallback(async () => {
    if (!user?.id || !profile?.gym_id) return;
    setLoading(true);

    const [pts, hist, lb] = await Promise.all([
      getUserPoints(user.id),
      getPointsHistory(user.id, 50),
      getLeaderboard(profile.gym_id, 10),
    ]);

    setPointsData(pts);
    setHistory(hist);
    setLeaderboard(lb);
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
      console.error('Redemption error:', error);
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
          <SuccessToast reward={successReward} onDone={() => setSuccessReward(null)} />
        )}
      </AnimatePresence>

      {/* Redeem modal */}
      {redeemTarget && (
        <RedeemModal
          reward={redeemTarget}
          points={pointsData.total_points}
          onConfirm={handleRedeem}
          onClose={() => setRedeemTarget(null)}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-[#05070B]/95 backdrop-blur-xl border-b border-white/6">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-5">
          {/* Title row */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 rounded-[14px] bg-[#D4AF37]/10 flex items-center justify-center">
              <Coins size={24} className="text-[#D4AF37]" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-[#E5E7EB] tracking-tight">Rewards</h1>
              <p className="text-[13px] text-[#9CA3AF] mt-0.5">Earn points, unlock rewards</p>
            </div>
          </div>

          {/* Points hero card */}
          <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-widest">Your Points</p>
                <p className="text-[36px] font-black text-[#D4AF37] leading-tight mt-1">
                  <AnimatedPoints value={pointsData.total_points} />
                </p>
              </div>
              <div className="text-right">
                <TierBadge tier={tier} size="lg" />
                <p className="text-[11px] text-[#6B7280] mt-2">
                  Lifetime: {pointsData.lifetime_points?.toLocaleString() ?? 0}
                </p>
              </div>
            </div>

            {/* Progress to next tier */}
            {tier.nextTier && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-[#6B7280]">
                    Progress to {tier.nextTier}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: tier.nextTierColor }}>
                    {tier.pointsToNext.toLocaleString()} pts to go
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
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                  tab === t
                    ? 'bg-[#D4AF37] text-black font-semibold'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ─────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {tab === 'History' && (
          <HistoryTab history={history} loading={loading} />
        )}
        {tab === 'Rewards' && (
          <RewardsTab
            points={pointsData.total_points}
            onRedeem={(reward) => setRedeemTarget(reward)}
          />
        )}
        {tab === 'Leaderboard' && (
          <LeaderboardTab
            entries={leaderboard}
            loading={loading}
            myId={user?.id}
          />
        )}
      </div>
    </div>
  );
}
