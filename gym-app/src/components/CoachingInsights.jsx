import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brain, TrendingUp, TrendingDown, AlertTriangle, Trophy,
  Battery, Flame, Scale, Activity,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { subDays, startOfWeek, endOfWeek, differenceInWeeks } from 'date-fns';

// ── Muscle group mapping from exercise primary_muscle ────────────────────────
const PUSH_MUSCLES = ['Chest', 'Shoulders', 'Triceps'];
const PULL_MUSCLES = ['Back', 'Biceps'];
const LEG_MUSCLES  = ['Legs', 'Glutes', 'Calves', 'Hamstrings', 'Quadriceps'];

function classifyMuscle(muscle) {
  if (!muscle) return 'other';
  if (PUSH_MUSCLES.some(m => muscle.includes(m))) return muscle;
  if (PULL_MUSCLES.some(m => muscle.includes(m))) return muscle;
  if (LEG_MUSCLES.some(m => muscle.includes(m)))  return muscle;
  return muscle;
}

// ── Insight type config ──────────────────────────────────────────────────────
const INSIGHT_STYLES = {
  warning:     { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',  border: 'color-mix(in srgb, var(--color-warning) 18%, transparent)' },
  celebration: { color: 'var(--color-accent)', bg: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',  border: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' },
  info:        { color: 'var(--color-blue-soft)', bg: 'color-mix(in srgb, var(--color-blue-soft) 8%, transparent)',  border: 'color-mix(in srgb, var(--color-blue-soft) 18%, transparent)' },
};

const INSIGHT_ICONS = {
  plateau:     AlertTriangle,
  volume_up:   TrendingUp,
  volume_down: TrendingDown,
  imbalance:   Scale,
  consistency: Activity,
  pr:          Trophy,
  deload:      Battery,
  streak:      Flame,
};

// ── Helper: compute estimated 1RM (Epley) ────────────────────────────────────
function estimate1RM(weight, reps) {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

// ── Main component ───────────────────────────────────────────────────────────
export default function CoachingInsights() {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const analyze = async () => {
      setLoading(true);

      const now = new Date();
      const fourWeeksAgo = subDays(now, 28);
      const eightWeeksAgo = subDays(now, 56);
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
      const sevenDaysAgo = subDays(now, 7);

      // Fetch all data in parallel
      const [sessionsRes, prHistoryRes, streakRes, scheduleRes] = await Promise.all([
        // Sessions from last 8 weeks with exercises + sets
        supabase
          .from('workout_sessions')
          .select(`
            id, completed_at, total_volume_lbs,
            session_exercises(
              exercise_id, snapshot_name,
              exercises(muscle_group),
              session_sets(weight_lbs, reps, is_completed, is_pr)
            )
          `)
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', eightWeeksAgo.toISOString())
          .order('completed_at', { ascending: true }),

        // PR history from last 7 days
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, estimated_1rm, achieved_at, exercises(name, name_es)')
          .eq('profile_id', user.id)
          .gte('achieved_at', sevenDaysAgo.toISOString())
          .order('achieved_at', { ascending: false }),

        // Current streak
        supabase
          .from('streak_cache')
          .select('current_streak_days, longest_streak_days')
          .eq('profile_id', user.id)
          .maybeSingle(),

        // Scheduled days (to compute consistency)
        supabase
          .from('workout_schedule')
          .select('day_of_week')
          .eq('profile_id', user.id),
      ]);

      if (cancelled) return;

      const sessions = sessionsRes.data ?? [];
      const recentPRs = prHistoryRes.data ?? [];
      const streakData = streakRes.data;
      const scheduledDays = (scheduleRes.data ?? []).map(s => s.day_of_week);

      if (sessions.length < 3) {
        setInsights([]);
        setLoading(false);
        return;
      }

      const generated = [];

      // ── 1. Plateau detection ──────────────────────────────────────────────
      // Group sessions by exercise, check if 1RM hasn't increased in 3+ weeks
      const exerciseHistory = {};
      for (const session of sessions) {
        const sessionDate = new Date(session.completed_at);
        for (const ex of (session.session_exercises ?? [])) {
          const exId = ex.exercise_id;
          if (!exId) continue;
          const sets = (ex.session_sets ?? []).filter(s => s.is_completed && s.weight_lbs > 0 && s.reps > 0);
          if (sets.length === 0) continue;

          if (!exerciseHistory[exId]) {
            exerciseHistory[exId] = { name: ex.snapshot_name, entries: [] };
          }

          const best1RM = Math.max(...sets.map(s => estimate1RM(s.weight_lbs, s.reps)));
          exerciseHistory[exId].entries.push({ date: sessionDate, best1RM });
        }
      }

      for (const [exId, data] of Object.entries(exerciseHistory)) {
        const { name, entries } = data;
        if (entries.length < 3) continue;

        // Check last 3 weeks vs prior
        const threeWeeksAgo = subDays(now, 21);
        const recentEntries = entries.filter(e => e.date >= threeWeeksAgo);
        const olderEntries = entries.filter(e => e.date < threeWeeksAgo);

        if (recentEntries.length < 2 || olderEntries.length === 0) continue;

        const recentMax = Math.max(...recentEntries.map(e => e.best1RM));
        const olderMax = Math.max(...olderEntries.map(e => e.best1RM));
        const weeksStalledRaw = differenceInWeeks(now, threeWeeksAgo);
        const weeksStalled = Math.max(3, weeksStalledRaw);

        // Stalled = recent max hasn't exceeded older max by more than 1%
        if (recentMax <= olderMax * 1.01 && recentEntries.length >= 3) {
          generated.push({
            id: `plateau-${exId}`,
            type: 'plateau',
            category: 'warning',
            text: t('coaching.plateau', {
              exercise: name,
              weight: Math.round(recentMax),
              weeks: weeksStalled,
            }),
          });
        }
      }

      // ── 2. Volume trend (this week vs 4-week average) ─────────────────────
      const thisWeekSessions = sessions.filter(s => {
        const d = new Date(s.completed_at);
        return d >= weekStart && d <= weekEnd;
      });
      const thisWeekVol = thisWeekSessions.reduce(
        (sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0
      );

      const fourWeekSessions = sessions.filter(s => {
        const d = new Date(s.completed_at);
        return d >= fourWeeksAgo && d < weekStart;
      });

      if (fourWeekSessions.length > 0) {
        // Group by week
        const weekVolumes = {};
        for (const s of fourWeekSessions) {
          const wk = startOfWeek(new Date(s.completed_at), { weekStartsOn: 1 }).toISOString();
          weekVolumes[wk] = (weekVolumes[wk] || 0) + (parseFloat(s.total_volume_lbs) || 0);
        }
        const weekVals = Object.values(weekVolumes);
        const avgVol = weekVals.reduce((a, b) => a + b, 0) / weekVals.length;

        if (avgVol > 0 && thisWeekVol > 0) {
          const pctChange = Math.round(((thisWeekVol - avgVol) / avgVol) * 100);
          if (pctChange >= 10) {
            generated.push({
              id: 'volume-up',
              type: 'volume_up',
              category: 'celebration',
              text: t('coaching.volumeUp', { pct: pctChange }),
            });
          } else if (pctChange <= -15) {
            generated.push({
              id: 'volume-down',
              type: 'volume_down',
              category: 'warning',
              text: t('coaching.volumeDown', { pct: Math.abs(pctChange) }),
            });
          }
        }
      }

      // ── 3. Muscle imbalance ───────────────────────────────────────────────
      const muscleFrequency = {};
      const recentSessions = sessions.filter(s => new Date(s.completed_at) >= fourWeeksAgo);
      for (const session of recentSessions) {
        for (const ex of (session.session_exercises ?? [])) {
          const muscle = ex.exercises?.muscle_group;
          if (!muscle) continue;
          const key = classifyMuscle(muscle);
          muscleFrequency[key] = (muscleFrequency[key] || 0) + 1;
        }
      }

      const muscleEntries = Object.entries(muscleFrequency).sort((a, b) => b[1] - a[1]);
      if (muscleEntries.length >= 2) {
        const [topMuscle, topCount] = muscleEntries[0];
        const [lowMuscle, lowCount] = muscleEntries[muscleEntries.length - 1];
        if (topCount >= lowCount * 2.5 && topCount >= 4) {
          generated.push({
            id: 'imbalance',
            type: 'imbalance',
            category: 'warning',
            text: t('coaching.imbalance', {
              highMuscle: topMuscle,
              highCount: topCount,
              lowMuscle: lowMuscle,
              lowCount: lowCount,
            }),
          });
        }
      }

      // ── 4. Consistency ────────────────────────────────────────────────────
      if (scheduledDays.length > 0) {
        const thisWeekDays = new Set();
        for (const s of thisWeekSessions) {
          thisWeekDays.add(new Date(s.completed_at).getDay());
        }
        const completed = thisWeekDays.size;
        const scheduled = scheduledDays.length;
        const pct = Math.round((completed / scheduled) * 100);

        if (pct > 0 && pct < 100) {
          generated.push({
            id: 'consistency',
            type: 'consistency',
            category: 'info',
            text: t('coaching.consistency', {
              completed,
              scheduled,
              pct,
            }),
          });
        } else if (pct >= 100) {
          generated.push({
            id: 'consistency-perfect',
            type: 'consistency',
            category: 'celebration',
            text: t('coaching.consistencyPerfect', { completed }),
          });
        }
      }

      // ── 5. PR celebration ─────────────────────────────────────────────────
      if (recentPRs.length > 0) {
        const topPR = recentPRs[0];
        const exName = topPR.exercises?.name_es && t('_lang') === 'es'
          ? topPR.exercises.name_es
          : (topPR.exercises?.name ?? 'Exercise');

        generated.push({
          id: `pr-${topPR.exercise_id}`,
          type: 'pr',
          category: 'celebration',
          text: t('coaching.prCelebration', {
            exercise: exName,
            weight: Math.round(topPR.weight_lbs),
          }),
        });
      }

      // ── 6. Deload suggestion ──────────────────────────────────────────────
      // Check if volume has increased for 4+ consecutive weeks
      const weeklyVolumes = {};
      for (const s of sessions) {
        const wk = startOfWeek(new Date(s.completed_at), { weekStartsOn: 1 }).getTime();
        weeklyVolumes[wk] = (weeklyVolumes[wk] || 0) + (parseFloat(s.total_volume_lbs) || 0);
      }
      const sortedWeeks = Object.entries(weeklyVolumes)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, vol]) => vol);

      let consecutiveIncreases = 0;
      for (let i = 1; i < sortedWeeks.length; i++) {
        if (sortedWeeks[i] > sortedWeeks[i - 1]) {
          consecutiveIncreases++;
        } else {
          consecutiveIncreases = 0;
        }
      }

      if (consecutiveIncreases >= 4) {
        generated.push({
          id: 'deload',
          type: 'deload',
          category: 'warning',
          text: t('coaching.deload', { weeks: consecutiveIncreases + 1 }),
        });
      }

      // ── 7. Streak motivation ──────────────────────────────────────────────
      if (streakData) {
        const current = streakData.current_streak_days ?? 0;
        const longest = streakData.longest_streak_days ?? 0;
        if (current >= 3) {
          generated.push({
            id: 'streak',
            type: 'streak',
            category: current >= longest && longest > 0 ? 'celebration' : 'info',
            text: longest > current
              ? t('coaching.streakChase', { current, longest })
              : t('coaching.streakRecord', { current }),
          });
        }
      }

      // ── Prioritize & limit ────────────────────────────────────────────────
      const priority = { warning: 0, celebration: 1, info: 2 };
      generated.sort((a, b) => priority[a.category] - priority[b.category]);

      if (!cancelled) {
        setInsights(generated.slice(0, 5));
        setLoading(false);
      }
    };

    analyze();
    return () => { cancelled = true; };
  }, [user?.id, t]);

  if (loading || insights.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-0.5">
        <Brain size={14} className="text-[#D4AF37]" />
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6B7280]">
          {t('coaching.title')}
        </p>
      </div>

      {/* Insight cards */}
      {insights.map((insight) => {
        const style = INSIGHT_STYLES[insight.category];
        const Icon = INSIGHT_ICONS[insight.type] ?? Brain;
        return (
          <div
            key={insight.id}
            className="rounded-2xl px-4 py-3 flex items-start gap-3 transition-colors duration-200"
            style={{
              background: style.bg,
              border: `1px solid ${style.border}`,
            }}
          >
            <div
              className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
              style={{ background: `${style.color}15` }}
            >
              <Icon size={14} style={{ color: style.color }} strokeWidth={2.5} />
            </div>
            <p className="text-[12px] leading-relaxed text-[#E5E7EB] font-medium flex-1">
              {insight.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
