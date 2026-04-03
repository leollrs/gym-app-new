import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Flame, Clock, Dumbbell, ChevronRight, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { generateGymWOD } from '../lib/wodGenerator';
import { getExerciseById } from '../data/exercises';

// ── Difficulty badge colors ────────────────────────────────────────────────────
const DIFFICULTY_STYLES = {
  beginner:     'bg-emerald-500/20 text-emerald-400',
  intermediate: 'bg-amber-500/20 text-amber-400',
  advanced:     'bg-red-500/20 text-red-400',
};

// ── Muscle pill colors ─────────────────────────────────────────────────────────
const MUSCLE_COLORS = {
  Chest:     'bg-red-500/20 text-red-400',
  Back:      'bg-blue-500/20 text-blue-400',
  Shoulders: 'bg-orange-500/20 text-orange-400',
  Biceps:    'bg-purple-500/20 text-purple-400',
  Triceps:   'bg-pink-500/20 text-pink-400',
  Legs:      'bg-emerald-500/20 text-emerald-400',
  Glutes:    'bg-amber-500/20 text-amber-400',
  Core:      'bg-cyan-500/20 text-cyan-400',
  Calves:    'bg-teal-500/20 text-teal-400',
};

export default function GymWOD() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [wod, setWod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const gymId = profile?.gym_id;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ── Load or generate today's WOD ──────────────────────────────────────────
  useEffect(() => {
    if (!gymId) return;
    let cancelled = false;

    const loadWOD = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. Try to fetch today's WOD from DB
        const { data: existing, error: fetchErr } = await supabase
          .from('gym_workouts_of_the_day')
          .select('*')
          .eq('gym_id', gymId)
          .eq('date', today)
          .maybeSingle();

        if (fetchErr) throw fetchErr;

        if (existing && !cancelled) {
          setWod(existing);
          setLoading(false);
          return;
        }

        // 2. No WOD for today — fetch recent focus keys to avoid repetition
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: recentWods } = await supabase
          .from('gym_workouts_of_the_day')
          .select('workout_data')
          .eq('gym_id', gymId)
          .gte('date', sevenDaysAgo.toISOString().slice(0, 10))
          .order('date', { ascending: false });

        const recentFocusKeys = (recentWods || [])
          .map(w => w.workout_data?.focusKey)
          .filter(Boolean);

        // 3. Generate new WOD
        const generated = generateGymWOD(new Date(), recentFocusKeys);

        // 4. Store it in DB so all gym members see the same one
        const row = {
          gym_id:            gymId,
          date:              today,
          workout_data:      generated,
          theme:             generated.theme,
          difficulty:        generated.difficulty,
          estimated_duration: generated.estimated_duration,
        };

        const { data: inserted, error: insertErr } = await supabase
          .from('gym_workouts_of_the_day')
          .upsert(row, { onConflict: 'gym_id,date' })
          .select()
          .single();

        if (insertErr) {
          // If insert fails (race condition), try fetching again
          const { data: retry } = await supabase
            .from('gym_workouts_of_the_day')
            .select('*')
            .eq('gym_id', gymId)
            .eq('date', today)
            .maybeSingle();

          if (retry && !cancelled) {
            setWod(retry);
          } else {
            // Use generated data locally even if DB write failed
            if (!cancelled) setWod({ ...row, id: 'local', workout_data: generated });
          }
        } else if (!cancelled) {
          setWod(inserted);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load workout');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadWOD();
    return () => { cancelled = true; };
  }, [gymId, today]);

  // ── Start workout: create temp routine and navigate to session ─────────────
  const handleStart = async () => {
    if (!wod || saving) return;
    setSaving(true);

    try {
      const exercises = wod.workout_data?.exercises || [];

      // Create a temporary routine
      const { data: routine, error: rErr } = await supabase
        .from('routines')
        .insert({
          name: `WOD: ${wod.theme}`,
          gym_id: gymId,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (rErr) throw rErr;

      // Insert routine exercises
      const rows = exercises.map((ex, i) => ({
        routine_id:   routine.id,
        exercise_id:  ex.exerciseId,
        position:     i + 1,
        target_sets:  ex.sets,
        target_reps:  ex.reps,
        rest_seconds: ex.restSeconds,
      }));

      const { error: exErr } = await supabase
        .from('routine_exercises')
        .insert(rows);

      if (exErr) throw exErr;

      navigate(`/session/${routine.id}`);
    } catch (err) {
      setError(err.message || 'Failed to start workout');
      setSaving(false);
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-[var(--color-bg-card)] rounded-[14px] border border-white/8 p-5 animate-pulse overflow-hidden">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded bg-white/10" />
          <div className="h-5 w-44 rounded bg-white/10" />
        </div>
        <div className="h-6 w-52 rounded bg-white/10 mb-3" />
        <div className="flex gap-2 mb-4">
          <div className="h-6 w-20 rounded-full bg-white/10" />
          <div className="h-6 w-16 rounded-full bg-white/10" />
          <div className="h-6 w-14 rounded-full bg-white/10" />
        </div>
        <div className="space-y-2.5 mb-5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-4 w-40 rounded bg-white/8" />
              <div className="h-4 w-16 rounded bg-white/8" />
            </div>
          ))}
        </div>
        <div className="h-12 rounded-xl bg-white/10" />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error && !wod) {
    return (
      <div className="bg-[var(--color-bg-card)] rounded-[14px] border border-white/8 p-5 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Flame className="w-5 h-5 text-orange-400 flex-shrink-0" />
          <h3 className="text-[var(--color-text-primary)] font-semibold text-sm tracking-wide truncate">
            {t('gymWOD.title')}
          </h3>
        </div>
        <p className="text-sm text-red-400 mb-3">{error}</p>
      </div>
    );
  }

  if (!wod) return null;

  const exercises = wod.workout_data?.exercises || [];
  const muscleGroups = [...new Set(
    exercises
      .map(ex => getExerciseById(ex.exerciseId)?.muscle)
      .filter(Boolean)
  )];

  // Check if this is a "fresh" workout (generated today)
  const isNew = wod.date === today;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[var(--color-bg-card)] rounded-[14px] border border-white/8 p-5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-400 flex-shrink-0" />
          <h3 className="text-[var(--color-text-primary)] font-semibold text-sm tracking-wide truncate">
            {t('gymWOD.title')}
          </h3>
          {isNew && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 text-[9px] font-bold uppercase tracking-wider">
              <Zap className="w-2.5 h-2.5" />
              {t('gymWOD.new')}
            </span>
          )}
        </div>
      </div>

      {/* Theme name */}
      <h2 className="text-[var(--color-text-primary)] font-bold text-[18px] leading-tight mb-2 truncate">
        {t(`gymWOD.themes.${wod.theme.replace(/[^a-zA-Z]/g, '_').toLowerCase()}`, wod.theme)}
      </h2>

      {/* Meta: duration + difficulty + muscle pills */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="flex items-center gap-1 text-xs text-[var(--color-text-subtle)]">
          <Clock className="w-3.5 h-3.5" />
          ~{wod.estimated_duration} min
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${DIFFICULTY_STYLES[wod.difficulty] || ''}`}>
          {t(`gymWOD.difficulty.${wod.difficulty}`)}
        </span>
        {muscleGroups.slice(0, 4).map(muscle => (
          <span
            key={muscle}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${MUSCLE_COLORS[muscle] || 'bg-white/10 text-[var(--color-text-muted)]'}`}
          >
            {muscle}
          </span>
        ))}
      </div>

      {/* Exercise list */}
      <div className="space-y-2 mb-5">
        {exercises.map((ex, idx) => {
          const exerciseData = getExerciseById(ex.exerciseId);
          const name = exerciseData?.name || ex.exerciseId;

          return (
            <div key={ex.exerciseId} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="text-xs text-[var(--color-text-subtle)] font-mono mt-0.5 w-4 shrink-0 text-right">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-[var(--color-text-primary)] font-medium truncate">{name}</p>
                  {exerciseData?.muscle && (
                    <p className="text-[11px] text-[var(--color-text-subtle)] leading-snug mt-0.5">
                      {exerciseData.muscle}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-xs text-[var(--color-text-muted)] font-medium whitespace-nowrap shrink-0 mt-0.5">
                {ex.sets} x {ex.reps}
              </span>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <button
        onClick={handleStart}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-60"
      >
        {saving ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            {t('gymWOD.settingUp')}
          </>
        ) : (
          <>
            <Dumbbell className="w-4 h-4" />
            {t('gymWOD.startWorkout')}
            <ChevronRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}
