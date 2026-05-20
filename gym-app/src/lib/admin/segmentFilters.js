import { supabase } from '../supabase.js';
import logger from '../logger.js';

/**
 * Run a member-segment filter spec against the DB and return the matched
 * profiles, enriched with computed fields (`_workoutCount`,
 * `_lastWorkoutAt`, `_currentStreak`).
 *
 * Two-phase fetch:
 *   1. Pull profiles matching the simple column filters (joined dates,
 *      fitness_level, role).
 *   2. Apply post-query filters that need joins — workout count + last
 *      workout (from `workout_sessions`), churn tier (from
 *      `churn_risk_scores`), and referral status (from `referrals`).
 *
 * The 500-row limit on the profiles query is intentional: segments are a
 * targeting tool, not a full members export. If an admin needs more, they
 * narrow the filter spec.
 *
 * Shared between the segments list (counts), the detail panel (preview),
 * and the editor modal (live count).
 */
export async function applySegmentFilters(gymId, filters) {
  // `fitness_level` lives on `member_onboarding`, not `profiles` — we used to
  // select it directly which 400'd the whole segment preview. The fitness-level
  // filter is now applied as a post-query join below (same pattern as workouts
  // / churn-tier filters).
  let query = supabase
    .from('profiles')
    .select('id, full_name, username, created_at, last_active_at, avatar_type, avatar_value, streak_cache(current_streak_days)')
    .eq('gym_id', gymId)
    .eq('role', 'member');

  if (filters.joined_after) {
    query = query.gte('created_at', filters.joined_after);
  }
  if (filters.joined_before) {
    query = query.lte('created_at', filters.joined_before);
  }
  // Note: streak filtering requires join to streak_cache table
  // These filters are applied client-side after fetch if needed

  const { data: members, error } = await query.order('full_name').limit(500);
  if (error) {
    logger.error('applySegmentFilters: profiles query', error);
    return [];
  }

  let filtered = members || [];

  // Fitness-level post-filter via member_onboarding join.
  if (filters.fitness_level?.length) {
    const ALLOWED_LEVELS = ['beginner', 'intermediate', 'advanced'];
    const safe = filters.fitness_level.filter(l => ALLOWED_LEVELS.includes(l));
    if (safe.length && filtered.length) {
      const memberIds = filtered.map(m => m.id);
      const { data: onboarding } = await supabase
        .from('member_onboarding')
        .select('profile_id, fitness_level')
        .in('profile_id', memberIds)
        .in('fitness_level', safe);
      const levelSet = new Set((onboarding || []).map(r => r.profile_id));
      filtered = filtered.filter(m => levelSet.has(m.id));
    }
  }

  // Post-query filters that need join data
  if (
    filters.last_workout_days_ago_gt != null ||
    filters.last_workout_days_ago_lt != null ||
    filters.workout_count_lt != null ||
    filters.workout_count_gt != null
  ) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('profile_id, started_at')
        .eq('gym_id', gymId)
        .eq('status', 'completed')
        .in('profile_id', memberIds);

      const sessionMap = {};
      const lastSessionMap = {};
      (sessions || []).forEach(s => {
        sessionMap[s.profile_id] = (sessionMap[s.profile_id] || 0) + 1;
        if (!lastSessionMap[s.profile_id] || s.started_at > lastSessionMap[s.profile_id]) {
          lastSessionMap[s.profile_id] = s.started_at;
        }
      });

      const now = Date.now();
      const MS_PER_DAY = 86400000;

      filtered = filtered.filter(m => {
        const count = sessionMap[m.id] || 0;
        const lastSession = lastSessionMap[m.id];
        const daysSinceWorkout = lastSession
          ? Math.floor((now - new Date(lastSession).getTime()) / MS_PER_DAY)
          : 9999;

        if (filters.last_workout_days_ago_gt != null && daysSinceWorkout <= filters.last_workout_days_ago_gt) return false;
        if (filters.last_workout_days_ago_lt != null && daysSinceWorkout >= filters.last_workout_days_ago_lt) return false;
        if (filters.workout_count_lt != null && count >= filters.workout_count_lt) return false;
        if (filters.workout_count_gt != null && count <= filters.workout_count_gt) return false;
        return true;
      });

      // Attach computed data
      filtered = filtered.map(m => ({
        ...m,
        _workoutCount: sessionMap[m.id] || 0,
        _lastWorkoutAt: lastSessionMap[m.id] || null,
        _currentStreak: m.streak_cache?.current_streak_days ?? m.streak_cache?.[0]?.current_streak_days ?? 0,
      }));
    } else {
      filtered = filtered.map(m => ({
        ...m,
        _currentStreak: m.streak_cache?.current_streak_days ?? m.streak_cache?.[0]?.current_streak_days ?? 0,
      }));
    }
  } else {
    filtered = filtered.map(m => ({
      ...m,
      _currentStreak: m.streak_cache?.current_streak_days ?? m.streak_cache?.[0]?.current_streak_days ?? 0,
    }));
  }

  // Streak filter — operates on `_currentStreak` which the workout block
  // above attaches to every member (from `streak_cache.current_streak_days`).
  // The editor modal exposes streak_lt/streak_gt inputs and two prebuilt
  // templates (Power Users, Consistent Trainers) rely on streak_gt, so this
  // block must stay or those segments silently return the wrong members.
  if (filters.streak_gt != null || filters.streak_lt != null) {
    filtered = filtered.filter(m => {
      const s = m._currentStreak ?? 0;
      if (filters.streak_gt != null && s <= filters.streak_gt) return false;
      if (filters.streak_lt != null && s >= filters.streak_lt) return false;
      return true;
    });
  }

  // Churn tier filter
  if (filters.churn_tier?.length) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const { data: churnRows } = await supabase
        .from('churn_risk_scores')
        .select('profile_id, risk_tier')
        .eq('gym_id', gymId)
        .in('profile_id', memberIds)
        .in('risk_tier', filters.churn_tier);

      const churnSet = new Set((churnRows || []).map(r => r.profile_id));
      filtered = filtered.filter(m => churnSet.has(m.id));
    }
  }

  // Referral filter
  if (filters.has_referral === true || filters.has_referral === false) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const { data: referrals } = await supabase
        .from('referrals')
        .select('referrer_id')
        .eq('gym_id', gymId)
        .in('referrer_id', memberIds);

      const referrerSet = new Set((referrals || []).map(r => r.referrer_id));
      filtered = filtered.filter(m =>
        filters.has_referral ? referrerSet.has(m.id) : !referrerSet.has(m.id)
      );
    }
  }

  return filtered;
}
