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

      await supabase
        .from('member_goals')
        .update(updates)
        .eq('id', goal.id);

      if (isAchieved) {
        achieved.push(goal);
      }
    }
  }

  return achieved;
}
