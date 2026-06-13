import { supabase } from './supabase';

/**
 * After a workout completes, check and update any active goals for the user.
 *
 * @param {string} profileId
 * @param {string} gymId
 * @param {object} sessionData — { totalVolume, sessionPRs: [{ exerciseId, estimated1RM }] }
 */
export async function updateGoalsAfterWorkout(profileId, gymId, sessionData = {}) {
  const { totalVolume = 0, sessionPRs = [] } = sessionData;

  // Fetch all active (not yet achieved) goals
  const { data: goals, error } = await supabase
    .from('member_goals')
    .select('*')
    .eq('profile_id', profileId)
    .is('achieved_at', null);

  if (error || !goals?.length) return [];

  const achieved = [];

  for (const goal of goals) {
    let newValue = goal.current_value;

    switch (goal.goal_type) {
      case 'lift_1rm': {
        // Check if any PR in this session matches the goal's exercise
        const match = sessionPRs.find(pr => pr.exerciseId === goal.exercise_id);
        if (match && match.estimated1RM > newValue) {
          newValue = match.estimated1RM;
        }
        break;
      }

      case 'workout_count': {
        newValue = parseFloat(newValue) + 1;
        break;
      }

      case 'volume': {
        newValue = parseFloat(newValue) + (totalVolume || 0);
        break;
      }

      case 'streak': {
        // Fetch current streak from cache
        const { data: streakRow } = await supabase
          .from('streak_cache')
          .select('current_streak_days')
          .eq('profile_id', profileId)
          .maybeSingle();
        const streak = streakRow?.current_streak_days ?? 0;
        if (streak > newValue) newValue = streak;
        break;
      }

      // body_weight and body_fat are updated elsewhere (body metrics page)
      default:
        continue;
    }

    // Only update if value changed
    if (newValue !== parseFloat(goal.current_value)) {
      const isAchieved = parseFloat(newValue) >= parseFloat(goal.target_value);
      const updates = {
        current_value: newValue,
        ...(isAchieved ? { achieved_at: new Date().toISOString() } : {}),
      };

      const { error: updateErr } = await supabase
        .from('member_goals')
        .update(updates)
        .eq('id', goal.id);

      if (updateErr) {
        console.error('[goalUpdater] failed to update goal', goal.id, updateErr);
        continue;
      }

      if (isAchieved) {
        achieved.push(goal);
      }
    }
  }

  return achieved;
}

/**
 * Update body_weight / body_fat goals after the member logs a new body metric.
 *
 * updateGoalsAfterWorkout deliberately skips these types because they aren't
 * driven by workouts — they change when the member logs a weight or body-fat
 * reading on the body-metrics page (ProgressBody). This is that update path:
 * call it after a successful body_weight_logs / body_measurements write.
 *
 * Body goals can move in EITHER direction (cut to a lower weight, or bulk to a
 * higher one), so achievement is decided by the direction implied by
 * start_value → target_value, not a fixed >= comparison. When start_value is
 * missing (goal created before any metric was logged), the first real reading
 * backfills the baseline so direction + progress are correct from then on.
 *
 * @param {string} profileId
 * @param {'body_weight'|'body_fat'} goalType
 * @param {number} newValue — freshly logged metric (lbs for weight, % for body fat)
 * @returns {Promise<Array>} goals newly marked achieved
 */
export async function updateBodyMetricGoals(profileId, goalType, newValue) {
  const value = parseFloat(newValue);
  if (!profileId || isNaN(value)) return [];

  const { data: goals, error } = await supabase
    .from('member_goals')
    .select('*')
    .eq('profile_id', profileId)
    .eq('goal_type', goalType)
    .is('achieved_at', null);

  if (error || !goals?.length) return [];

  const achieved = [];

  for (const goal of goals) {
    const target = parseFloat(goal.target_value);
    const updates = { current_value: value };

    // Establish the baseline. A goal seeded with a real metric already has
    // start_value; one created before any reading was seeded 0/null — backfill
    // it with this first real reading. (Weight / body-fat are never <= 0, so
    // <= 0 reliably means "unseeded".)
    let startVal = goal.start_value != null ? parseFloat(goal.start_value) : NaN;
    if (isNaN(startVal) || startVal <= 0) {
      startVal = value;
      updates.start_value = value;
    }

    // Only auto-complete when we can trust the direction (a real baseline that
    // differs from the target). On the backfill reading start === current, so
    // this is naturally false until a later reading actually reaches the target.
    const hasDirection = !isNaN(startVal) && startVal !== target;
    const decreasing = startVal > target;
    const isAchieved = hasDirection && (decreasing ? value <= target : value >= target);
    if (isAchieved) updates.achieved_at = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from('member_goals')
      .update(updates)
      .eq('id', goal.id);

    if (updateErr) {
      console.error('[goalUpdater] failed to update body goal', goal.id, updateErr);
      continue;
    }

    if (isAchieved) achieved.push(goal);
  }

  return achieved;
}
