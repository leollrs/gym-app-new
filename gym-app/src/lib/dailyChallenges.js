// ── Daily Challenges (shared between Dashboard + Challenges page) ────────────
import { supabase } from './supabase';

export const DAILY_CHALLENGES = [
  { name: 'Volume Crusher',    desc: 'Hit 10,000 lbs total volume today',     target: 10000, unit: 'lbs',       metric: 'volume',    nameKey: 'volume_crusher',    descKey: 'volume_crusher'    },
  { name: 'Rep Master',        desc: 'Complete 100 total reps today',          target: 100,   unit: 'reps',      metric: 'reps',      nameKey: 'rep_master',        descKey: 'rep_master'        },
  { name: 'Iron Will',         desc: 'Log at least 3 exercises today',         target: 3,     unit: 'exercises', metric: 'exercises', nameKey: 'iron_will',         descKey: 'iron_will'         },
  { name: 'Speed Demon',       desc: 'Finish a workout in under 30 minutes',  target: 1,     unit: 'workout',   metric: 'speed',     nameKey: 'speed_demon',       descKey: 'speed_demon'       },
  { name: 'Consistency King',  desc: 'Check in at the gym today',             target: 1,     unit: 'check-in',  metric: 'checkin',   nameKey: 'consistency_king',  descKey: 'consistency_king'  },
  { name: 'PR Hunter',         desc: 'Hit a new personal record today',        target: 1,     unit: 'PR',        metric: 'pr',        nameKey: 'pr_hunter',         descKey: 'pr_hunter'         },
  { name: 'Early Bird',        desc: 'Complete a workout before noon',         target: 1,     unit: 'workout',   metric: 'early',     nameKey: 'early_bird',        descKey: 'early_bird'        },
];

export function seededIndex(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % DAILY_CHALLENGES.length;
}

// Local calendar date (yyyy-mm-dd) — the member's "today". Used for BOTH the
// challenge seed and the per-day cache keys so the Dashboard card and the
// Challenges page always land on the SAME challenge of the day. (getTodayChallenge
// previously sliced a UTC ISO string, which disagreed with the Challenges page's
// local-date seed for several hours a day → two different daily challenges.)
export function todayChallengeDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getTodayChallenge() {
  return DAILY_CHALLENGES[seededIndex(todayChallengeDate())];
}

// Read-only: compute today's progress value toward a daily challenge's target.
// PURE DATA FETCH — no completion insert / points award (those live on the
// Challenges page). Shared by the Challenges page and the Dashboard "Challenge
// of the Day" card so both always show the same number. Returns 0 on error.
export async function fetchDailyChallengeProgress(userId, challenge, todayStartISO) {
  if (!userId || !challenge) return 0;
  const todayStart = todayStartISO || (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); })();
  try {
    if (challenge.metric === 'volume') {
      const { data: sets } = await supabase
        .from('session_sets')
        .select('weight_lbs, reps, session_exercises!inner(exercise_id, workout_sessions!inner(profile_id, completed_at, status))')
        .eq('session_exercises.workout_sessions.profile_id', userId)
        .eq('session_exercises.workout_sessions.status', 'completed')
        .gte('session_exercises.workout_sessions.completed_at', todayStart)
        .eq('is_completed', true);
      return (sets || []).reduce((sum, s) => sum + (s.weight_lbs ?? 0) * (s.reps ?? 0), 0);
    }
    if (challenge.metric === 'reps') {
      const { data: sets } = await supabase
        .from('session_sets')
        .select('reps, session_exercises!inner(workout_sessions!inner(profile_id, completed_at, status))')
        .eq('session_exercises.workout_sessions.profile_id', userId)
        .eq('session_exercises.workout_sessions.status', 'completed')
        .gte('session_exercises.workout_sessions.completed_at', todayStart)
        .eq('is_completed', true);
      return (sets || []).reduce((sum, s) => sum + (s.reps ?? 0), 0);
    }
    if (challenge.metric === 'exercises') {
      const { data: sets } = await supabase
        .from('session_sets')
        .select('session_exercises!inner(exercise_id, workout_sessions!inner(profile_id, completed_at, status))')
        .eq('session_exercises.workout_sessions.profile_id', userId)
        .eq('session_exercises.workout_sessions.status', 'completed')
        .gte('session_exercises.workout_sessions.completed_at', todayStart)
        .eq('is_completed', true);
      return new Set((sets || []).map((s) => s.session_exercises?.exercise_id)).size;
    }
    if (challenge.metric === 'speed') {
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('started_at, completed_at')
        .eq('profile_id', userId)
        .eq('status', 'completed')
        .gte('completed_at', todayStart);
      const fast = (sessions || []).some((s) => {
        if (!s.started_at || !s.completed_at) return false;
        return (new Date(s.completed_at) - new Date(s.started_at)) < 30 * 60 * 1000;
      });
      return fast ? 1 : 0;
    }
    if (challenge.metric === 'checkin') {
      const { count } = await supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId)
        .gte('checked_in_at', todayStart);
      return count ?? 0;
    }
    if (challenge.metric === 'pr') {
      const { count } = await supabase
        .from('personal_records')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId)
        .gte('achieved_at', todayStart);
      return count ?? 0;
    }
    if (challenge.metric === 'early') {
      const noon = new Date(); noon.setHours(12, 0, 0, 0);
      const { count } = await supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', userId)
        .eq('status', 'completed')
        .gte('completed_at', todayStart)
        .lt('completed_at', noon.toISOString());
      return count ?? 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
