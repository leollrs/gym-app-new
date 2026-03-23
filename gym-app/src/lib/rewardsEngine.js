// ── Rewards & Points Engine ───────────────────────────────────────────────────
import { supabase } from './supabase';
import logger from './logger';

// ── Points Configuration ─────────────────────────────────────────────────────
const POINTS_MAP = {
  workout_completed:     50,
  pr_hit:                100,
  check_in:              20,
  streak_day:            10,   // multiplied by streak_length, capped at 200
  challenge_completed:   500,
  achievement_unlocked:  75,
  weight_logged:         10,
  first_weekly_workout:  25,
  streak_7:              200,
  streak_30:             1000,
};

// ── Reward Tiers ─────────────────────────────────────────────────────────────
const TIERS = [
  { name: 'Bronze',   min: 0,     max: 999,   color: '#CD7F32' },
  { name: 'Silver',   min: 1000,  max: 4999,  color: '#9CA3AF' },
  { name: 'Gold',     min: 5000,  max: 14999, color: '#D4AF37' },
  { name: 'Platinum', min: 15000, max: 49999, color: '#A78BFA' },
  { name: 'Diamond',  min: 50000, max: Infinity, color: '#60A5FA' },
];

// ── calculatePointsForAction ─────────────────────────────────────────────────
// Returns the number of points earned for a given action.
// metadata: { streakLength } for streak_day action
export function calculatePointsForAction(action, metadata = {}) {
  const base = POINTS_MAP[action];
  if (base === undefined) return 0;

  if (action === 'streak_day') {
    const streakLength = metadata.streakLength || 1;
    return Math.min(base * streakLength, 200);
  }

  return base;
}

// ── getRewardTier ────────────────────────────────────────────────────────────
// Returns current tier info + progress to next tier
export function getRewardTier(points) {
  const idx = TIERS.findIndex(t => points >= t.min && points <= t.max);
  const tier = TIERS[idx] || TIERS[0];
  const nextTier = idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
  const pointsToNext = nextTier ? nextTier.min - points : 0;
  const progress = nextTier
    ? ((points - tier.min) / (nextTier.min - tier.min)) * 100
    : 100;

  return {
    name: tier.name,
    color: tier.color,
    min: tier.min,
    max: tier.max,
    nextTier: nextTier ? nextTier.name : null,
    nextTierColor: nextTier ? nextTier.color : null,
    pointsToNext,
    progress: Math.min(progress, 100),
  };
}

// ── getUserPoints ────────────────────────────────────────────────────────────
// Fetches total points from reward_points table. Creates row via upsert if not exists.
export async function getUserPoints(userId) {
  const { data, error } = await supabase
    .from('reward_points')
    .select('total_points, lifetime_points, last_updated')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) {
    logger.error('getUserPoints error:', error);
    return { total_points: 0, lifetime_points: 0 };
  }

  if (!data) {
    // Row doesn't exist yet — create it
    const { data: newRow, error: upsertErr } = await supabase
      .from('reward_points')
      .upsert(
        { profile_id: userId, total_points: 0, lifetime_points: 0, last_updated: new Date().toISOString() },
        { onConflict: 'profile_id' }
      )
      .select('total_points, lifetime_points, last_updated')
      .single();

    if (upsertErr) {
      logger.error('getUserPoints upsert error:', upsertErr);
      return { total_points: 0, lifetime_points: 0 };
    }
    return newRow;
  }

  return data;
}

// ── addPoints ────────────────────────────────────────────────────────────────
// Single RPC call that inserts log + upserts totals atomically (was 3 round trips).
export async function addPoints(userId, gymId, action, points, description) {
  if (!userId || !points) return null;

  const { data, error } = await supabase.rpc('add_reward_points', {
    p_user_id: userId,
    p_gym_id: gymId,
    p_action: action,
    p_points: points,
    p_description: description || null,
  });

  if (error) {
    logger.error('addPoints error:', error);
    return null;
  }

  return data;
}

// ── getPointsHistory ─────────────────────────────────────────────────────────
// Fetches recent point transactions for a user.
export async function getPointsHistory(userId, limit = 50) {
  const { data, error } = await supabase
    .from('reward_points_log')
    .select('id, action, points, description, created_at')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('getPointsHistory error:', error);
    return [];
  }

  return data || [];
}

// ── getLeaderboard ───────────────────────────────────────────────────────────
// Fetches top earners in a gym.
export async function getLeaderboard(gymId, limit = 10) {
  const { data, error } = await supabase
    .from('reward_points')
    .select('profile_id, total_points, lifetime_points, profiles(full_name, avatar_url)')
    .eq('gym_id', gymId)
    .order('total_points', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('getLeaderboard error:', error);
    return [];
  }

  return (data || []).map((row, i) => ({
    rank: i + 1,
    profileId: row.profile_id,
    name: row.profiles?.full_name ?? 'Unknown',
    avatarUrl: row.profiles?.avatar_url ?? null,
    totalPoints: row.total_points,
    lifetimePoints: row.lifetime_points,
    tier: getRewardTier(row.total_points),
  }));
}

// ── Placeholder rewards catalog ──────────────────────────────────────────────
export const REWARDS_CATALOG = [
  { id: 'smoothie',  name: 'Free Smoothie',              cost: 2000,  icon: 'Coffee', description: 'Redeem at the gym bar' },
  { id: 'guest',     name: 'Guest Pass',                 cost: 3500,  icon: 'Ticket', description: 'Bring a friend for a day' },
  { id: 'merch',     name: 'Gym Merch',                  cost: 7500,  icon: 'Shirt', description: 'T-shirt or water bottle' },
  { id: 'pt',        name: 'Personal Training Session',  cost: 15000, icon: 'Dumbbell', description: '1-on-1 with a trainer' },
  { id: 'month',     name: 'Free Month',                 cost: 30000, icon: 'Medal', description: 'One month membership' },
];
