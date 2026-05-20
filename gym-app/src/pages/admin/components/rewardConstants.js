import { adminKeys } from '../../../lib/adminQueryKeys';

/**
 * Reward-type display config shared across AdminRewards modals and lists.
 * Each value is a stable string stored on `gym_rewards.reward_type`; the
 * color is a Tailwind chip preset used by the type pill renderer.
 */
export const REWARD_TYPES = [
  { value: 'smoothie',     color: 'text-cyan-400 bg-cyan-500/10' },
  { value: 'guest_pass',   color: 'text-blue-400 bg-blue-500/10' },
  { value: 'merch',        color: 'text-purple-400 bg-purple-500/10' },
  { value: 'pt_session',   color: 'text-amber-400 bg-amber-500/10' },
  { value: 'free_month',   color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'class_pass',   color: 'text-pink-400 bg-pink-500/10' },
  { value: 'discount',     color: 'text-orange-400 bg-orange-500/10' },
  { value: 'bring_friend', color: 'text-indigo-400 bg-indigo-500/10' },
  { value: 'custom',       color: 'text-[#9CA3AF] bg-white/6' },
];

export const rewardKeys = adminKeys.rewards;

export const typeColor = (type) =>
  REWARD_TYPES.find(t => t.value === type)?.color ?? 'text-[#9CA3AF] bg-white/6';

// Shared input class for the AdminRewards form/modal inputs.
export const REWARD_INPUT_CLASS = 'w-full bg-white/[0.04] border border-white/8 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all';
