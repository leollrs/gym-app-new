import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// ── Generic Supabase query hook ─────────────────────────────────────────────
// Wraps any supabase query builder in TanStack Query for caching + deduplication.
export function useSupabaseQuery(queryKey, queryFn, options = {}) {
  return useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await queryFn();
      if (error) throw error;
      return data;
    },
    ...options,
  });
}

// ── Dashboard data ──────────────────────────────────────────────────────────
export function useDashboardSessions(userId) {
  return useSupabaseQuery(
    ['dashboard-sessions', userId],
    () => supabase
      .from('workout_sessions')
      .select('id, name, completed_at, total_volume_lbs, duration_seconds, routine_id')
      .eq('profile_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(50),
    { enabled: !!userId },
  );
}

export function useRoutines(userId) {
  return useSupabaseQuery(
    ['routines', userId],
    () => supabase
      .from('routines')
      .select('id, name, description, created_at, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name))')
      .eq('created_by', userId)
      .eq('is_template', false)
      .order('created_at', { ascending: false }),
    { enabled: !!userId },
  );
}

// ── Leaderboard ─────────────────────────────────────────────────────────────
export function useLeaderboard(gymId, metric, startDate) {
  return useSupabaseQuery(
    ['leaderboard', gymId, metric, startDate],
    () => {
      if (metric === 'streak') {
        return supabase
          .from('streak_cache')
          .select('profile_id, current_streak_days, profiles!profile_id(full_name, username, avatar_url)')
          .eq('gym_id', gymId)
          .gt('current_streak_days', 0)
          .order('current_streak_days', { ascending: false })
          .limit(20);
      }
      return supabase.rpc('get_leaderboard_volume', {
        p_gym_id: gymId,
        p_metric: metric,
        p_start_date: startDate || null,
        p_limit: 20,
      }).then(res => ({ data: res.data, error: res.error }));
    },
    { enabled: !!gymId },
  );
}

// ── Notifications ───────────────────────────────────────────────────────────
export function useNotifications(userId) {
  return useSupabaseQuery(
    ['notifications', userId],
    () => supabase
      .from('notifications')
      .select('id, title, body, type, read_at, created_at, profile_id')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    { enabled: !!userId },
  );
}

// ── Challenges ──────────────────────────────────────────────────────────────
export function useChallenges(gymId) {
  return useSupabaseQuery(
    ['challenges', gymId],
    () => supabase
      .from('challenges')
      .select('id, name, description, type, start_date, end_date, reward_description, gym_id')
      .eq('gym_id', gymId)
      .order('start_date', { ascending: false })
      .limit(50),
    { enabled: !!gymId },
  );
}

// ── Personal Records ────────────────────────────────────────────────────────
export function usePersonalRecords(userId) {
  return useSupabaseQuery(
    ['personal-records', userId],
    () => supabase
      .from('personal_records')
      .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
      .eq('profile_id', userId)
      .order('estimated_1rm', { ascending: false })
      .limit(100),
    { enabled: !!userId },
  );
}

// ── Invalidation helpers ────────────────────────────────────────────────────
export function useInvalidate() {
  const queryClient = useQueryClient();
  return {
    invalidateSessions: (userId) => queryClient.invalidateQueries({ queryKey: ['dashboard-sessions', userId] }),
    invalidateRoutines: (userId) => queryClient.invalidateQueries({ queryKey: ['routines', userId] }),
    invalidateLeaderboard: (gymId) => queryClient.invalidateQueries({ queryKey: ['leaderboard', gymId] }),
    invalidateNotifications: (userId) => queryClient.invalidateQueries({ queryKey: ['notifications', userId] }),
    invalidateChallenges: (gymId) => queryClient.invalidateQueries({ queryKey: ['challenges', gymId] }),
    invalidatePRs: (userId) => queryClient.invalidateQueries({ queryKey: ['personal-records', userId] }),
    invalidateAll: () => queryClient.invalidateQueries(),
  };
}
