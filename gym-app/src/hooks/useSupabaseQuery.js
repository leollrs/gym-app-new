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

// ── Recent sessions WITH sets (for readiness/recovery analysis) ─────────────
// Heavier than useDashboardSessions because it pulls workout_sets per session.
// Use only on screens that actually need set-level detail.
export function useRecentSessionsWithSets(userId, daysBack = 14) {
  return useSupabaseQuery(
    ['recent-sessions-with-sets', userId, daysBack],
    () => {
      const since = new Date(Date.now() - daysBack * 86400000).toISOString();
      return supabase
        .from('workout_sessions')
        .select('id, completed_at, total_volume_lbs, duration_seconds, workout_sets(exercise_id, weight_lbs, reps, completed)')
        .eq('profile_id', userId)
        .eq('status', 'completed')
        .gte('completed_at', since)
        .order('completed_at', { ascending: false });
    },
    { enabled: !!userId, staleTime: 5 * 60_000 },
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

// ── Shape data (rarely changes — treat as immutable until explicitly invalidated) ──
// Exercise library, food items, program templates, gym info: these only change
// when an admin edits them. Bump staleTime to Infinity + refetchOnMount:false
// so we never hit the network after the initial fetch.
export function useExerciseLibrary() {
  return useSupabaseQuery(
    ['exercise-library'],
    () => supabase
      .from('exercises')
      .select('id, name, name_es, muscle_group, equipment, video_url, is_active')
      .eq('is_active', true)
      .order('name'),
    { staleTime: Infinity, refetchOnMount: false },
  );
}

export function useFoodItems() {
  return useSupabaseQuery(
    ['food-items'],
    () => supabase
      .from('food_items')
      .select('id, name, name_es, brand, serving_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, nutri_score'),
    { staleTime: Infinity, refetchOnMount: false },
  );
}

export function useGymInfo(gymId) {
  return useSupabaseQuery(
    ['gym-info', gymId],
    () => supabase
      .from('gyms')
      .select('id, name, slug, is_active, open_days, open_time, close_time, country, address')
      .eq('id', gymId)
      .single(),
    { enabled: !!gymId, staleTime: Infinity, refetchOnMount: false },
  );
}

export function useGymHours(gymId) {
  return useSupabaseQuery(
    ['gym-hours', gymId],
    () => supabase
      .from('gym_hours')
      .select('day_of_week, is_closed, open_time, close_time')
      .eq('gym_id', gymId)
      .order('day_of_week'),
    { enabled: !!gymId, staleTime: Infinity, refetchOnMount: false },
  );
}

export function useAnnouncements(gymId) {
  return useSupabaseQuery(
    ['announcements', gymId],
    () => supabase
      .from('announcements')
      .select('id, title, message, type, published_at')
      .eq('gym_id', gymId)
      .lte('published_at', new Date().toISOString())
      .order('published_at', { ascending: false })
      .limit(10),
    // Announcements change from time to time but rarely within a session — let
    // them be considered fresh for 30 minutes.
    { enabled: !!gymId, staleTime: 30 * 60 * 1000 },
  );
}

// ── Leaderboard ─────────────────────────────────────────────────────────────
export function useLeaderboard(gymId, metric, startDate, tier = null) {
  return useSupabaseQuery(
    ['leaderboard', gymId, metric, startDate, tier],
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
        p_tier: tier,
      }).then(res => ({ data: res.data, error: res.error }));
    },
    { enabled: !!gymId },
  );
}

export function useLeaderboardMostImproved(gymId, metric, period, tier = null) {
  return useSupabaseQuery(
    ['leaderboard-improved', gymId, metric, period, tier],
    () => supabase.rpc('get_leaderboard_most_improved', {
      p_gym_id: gymId,
      p_metric: metric,
      p_period: period,
      p_tier: tier,
      p_limit: 20,
    }).then(res => ({ data: res.data, error: res.error })),
    { enabled: !!gymId },
  );
}

export function useLeaderboardConsistency(gymId, period, tier = null) {
  return useSupabaseQuery(
    ['leaderboard-consistency', gymId, period, tier],
    () => supabase.rpc('get_leaderboard_consistency', {
      p_gym_id: gymId,
      p_period: period,
      p_tier: tier,
      p_limit: 20,
    }).then(res => ({ data: res.data, error: res.error })),
    { enabled: !!gymId },
  );
}

export function useLeaderboardPrs(gymId, startDate, tier = null) {
  return useSupabaseQuery(
    ['leaderboard-prs', gymId, startDate, tier],
    () => supabase.rpc('get_leaderboard_prs', {
      p_gym_id: gymId,
      p_start_date: startDate || null,
      p_limit: 20,
      p_tier: tier,
    }).then(res => ({ data: res.data, error: res.error })),
    { enabled: !!gymId },
  );
}

export function useLeaderboardCheckins(gymId, startDate, tier = null) {
  return useSupabaseQuery(
    ['leaderboard-checkins', gymId, startDate, tier],
    () => supabase.rpc('get_leaderboard_checkins', {
      p_gym_id: gymId,
      p_start_date: startDate || null,
      p_tier: tier,
      p_limit: 20,
    }).then(res => ({ data: res.data, error: res.error })),
    { enabled: !!gymId },
  );
}

export function useLeaderboardNewcomers(gymId, metric, startDate) {
  return useSupabaseQuery(
    ['leaderboard-newcomers', gymId, metric, startDate],
    () => supabase.rpc('get_leaderboard_newcomers', {
      p_gym_id: gymId,
      p_metric: metric,
      p_start_date: startDate || null,
      p_limit: 20,
    }).then(res => ({ data: res.data, error: res.error })),
    { enabled: !!gymId },
  );
}

export function useMilestoneFeed(gymId) {
  return useSupabaseQuery(
    ['milestone-feed', gymId],
    () => supabase.rpc('get_milestone_feed', {
      p_gym_id: gymId,
      p_limit: 30,
    }).then(res => ({ data: res.data, error: res.error })),
    { enabled: !!gymId },
  );
}

// ── Notifications ───────────────────────────────────────────────────────────
// Audience filter:
//   'member'  → audience IS NULL OR audience = 'member' (legacy rows had no audience)
//   'trainer' → audience = 'trainer'
//   'admin'   → audience = 'admin'  (also matches 'super_admin' for super admins)
export function useNotifications(userId, audience = 'member') {
  return useSupabaseQuery(
    ['notifications', userId, audience],
    () => {
      let q = supabase
        .from('notifications')
        .select('id, title, body, type, read_at, created_at, profile_id, audience, data');
      if (audience === 'member') {
        q = q.or('audience.is.null,audience.eq.member');
      } else if (audience === 'admin') {
        q = q.in('audience', ['admin', 'super_admin']);
      } else {
        q = q.eq('audience', audience);
      }
      return q
        .eq('profile_id', userId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
    },
    // 5s staleTime overrides the global Infinity. The postgres_changes
    // subscription pushes live updates; this is just a safety net so a
    // missed event self-corrects on the next mount/refocus.
    { enabled: !!userId, staleTime: 5_000 },
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
    invalidateNotifications: (userId) => queryClient.invalidateQueries({ queryKey: ['notifications', userId], exact: false }),
    invalidateChallenges: (gymId) => queryClient.invalidateQueries({ queryKey: ['challenges', gymId] }),
    invalidatePRs: (userId) => queryClient.invalidateQueries({ queryKey: ['personal-records', userId] }),
    // Prefer scoped helpers above (e.g. invalidateSessions, invalidateRoutines) over
    // invalidateAll — a blanket invalidation refetches every cached query and should
    // only be used as a last resort (e.g. role change, gym switch).
    invalidateAll: () => queryClient.invalidateQueries(),
  };
}
