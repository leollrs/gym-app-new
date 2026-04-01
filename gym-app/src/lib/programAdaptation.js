import { supabase } from './supabase';

/**
 * Analyze recent performance and return adaptation suggestions.
 * Called after each completed workout (from SessionSummary) or at program midpoint.
 *
 * @param {string} userId - Supabase auth user ID
 * @param {string} gymId  - Gym ID for scoping
 * @returns {Promise<object|null>} Adaptation suggestions or null if not enough data
 */
export async function analyzeAndAdapt(userId, gymId) {
  // 1. Fetch last 14 days of completed sessions with sets
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('id, routine_id, completed_at, duration_seconds, total_volume_lbs, workout_sets(exercise_id, weight_lbs, reps, completed)')
    .eq('profile_id', userId)
    .gte('completed_at', twoWeeksAgo)
    .order('completed_at', { ascending: false });

  if (!sessions || sessions.length < 3) return null; // Not enough data

  // 2. Attendance analysis
  const completedDays = new Set(sessions.map(s => new Date(s.completed_at).toDateString()));
  const { data: schedule } = await supabase
    .from('workout_schedule')
    .select('day_of_week')
    .eq('profile_id', userId);

  const scheduledDays = schedule?.length || 0;
  // Attendance rate over 2 weeks (each scheduled day should appear twice)
  const attendanceRate = scheduledDays > 0 ? completedDays.size / (scheduledDays * 2) : 1;

  // 3. Volume trend (are they progressing?)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const firstWeekSessions = sessions.filter(s => new Date(s.completed_at) < sevenDaysAgo);
  const secondWeekSessions = sessions.filter(s => new Date(s.completed_at) >= sevenDaysAgo);

  const avgVolumeWeek1 = firstWeekSessions.reduce((s, x) => s + (x.total_volume_lbs || 0), 0) / Math.max(firstWeekSessions.length, 1);
  const avgVolumeWeek2 = secondWeekSessions.reduce((s, x) => s + (x.total_volume_lbs || 0), 0) / Math.max(secondWeekSessions.length, 1);
  const volumeTrend = avgVolumeWeek1 > 0 ? (avgVolumeWeek2 - avgVolumeWeek1) / avgVolumeWeek1 : 0;

  // 4. Exercise completion analysis
  const exerciseStats = {};
  for (const session of sessions) {
    for (const set of (session.workout_sets || [])) {
      if (!exerciseStats[set.exercise_id]) {
        exerciseStats[set.exercise_id] = { completed: 0, total: 0, weights: [] };
      }
      exerciseStats[set.exercise_id].total++;
      if (set.completed) {
        exerciseStats[set.exercise_id].completed++;
        if (set.weight_lbs) exerciseStats[set.exercise_id].weights.push(set.weight_lbs);
      }
    }
  }

  // 5. Build suggestions
  const suggestions = {
    attendanceRate,
    volumeTrend,
    shouldDeload: volumeTrend < -0.1, // Volume dropped >10%
    shouldIncrease: volumeTrend > 0.15, // Volume up >15%
    underperformingExercises: [], // Exercises with <70% completion rate
    strongExercises: [], // Exercises with 100% completion and weight increases
    suggestReduceDays: false,
    suggestedDays: null,
    timestamp: new Date().toISOString(),
  };

  for (const [exId, stats] of Object.entries(exerciseStats)) {
    const completionRate = stats.total > 0 ? stats.completed / stats.total : 1;
    if (completionRate < 0.7 && stats.total >= 4) {
      suggestions.underperformingExercises.push(exId);
    }
    if (completionRate === 1 && stats.weights.length >= 4) {
      const sorted = [...stats.weights].sort((a, b) => a - b);
      if (sorted[sorted.length - 1] > sorted[0]) {
        suggestions.strongExercises.push(exId);
      }
    }
  }

  // 6. If attendance is low, suggest reducing days
  if (attendanceRate < 0.6 && scheduledDays > 2) {
    suggestions.suggestReduceDays = true;
    suggestions.suggestedDays = Math.max(2, scheduledDays - 1);
  }

  return suggestions;
}

/**
 * Save adaptation suggestions to localStorage for display on Workouts page.
 */
export function saveAdaptationSuggestions(suggestions) {
  if (!suggestions) return;
  try {
    localStorage.setItem('program_adaptations', JSON.stringify(suggestions));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/**
 * Load adaptation suggestions from localStorage.
 * @returns {object|null}
 */
export function loadAdaptationSuggestions() {
  try {
    const raw = localStorage.getItem('program_adaptations');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Expire suggestions older than 7 days
    if (parsed.timestamp && Date.now() - new Date(parsed.timestamp).getTime() > 7 * 86400000) {
      localStorage.removeItem('program_adaptations');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Dismiss (clear) adaptation suggestions.
 */
export function dismissAdaptationSuggestions() {
  try {
    localStorage.removeItem('program_adaptations');
  } catch {
    // silently ignore
  }
}
