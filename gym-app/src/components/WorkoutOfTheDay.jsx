import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles, Clock, RefreshCw, Dumbbell, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { generateAdaptiveWorkout } from '../lib/adaptiveWorkout';
import { getExerciseById } from '../data/exercises';

// ── Pill colors by muscle group ─────────────────────────────────────────────
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

export default function WorkoutOfTheDay() {
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [workout, setWorkout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [variant, setVariant] = useState(0);

  // ── Fetch / generate workout ────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const generate = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await generateAdaptiveWorkout(user.id, variant);
        if (!cancelled) setWorkout(result);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to generate workout');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRegenerating(false);
        }
      }
    };

    generate();
    return () => { cancelled = true; };
  }, [user?.id, variant]);

  // ── Regenerate handler ──────────────────────────────────────────────────
  const handleRegenerate = () => {
    setRegenerating(true);
    setVariant(v => v + 1);
  };

  // ── Start workout: save as temporary routine, navigate to session ───────
  const handleStart = async () => {
    if (!workout || saving) return;
    setSaving(true);

    try {
      // Create a temporary routine
      const { data: routine, error: rErr } = await supabase
        .from('routines')
        .insert({
          name: workout.name,
          gym_id: profile?.gym_id,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (rErr) throw rErr;

      // Insert routine exercises
      const rows = workout.exercises.map((ex, i) => ({
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

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5 animate-pulse">
        {/* Header skeleton */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-5 h-5 rounded bg-white/10" />
          <div className="h-5 w-36 rounded bg-white/10" />
        </div>
        {/* Title skeleton */}
        <div className="h-6 w-52 rounded bg-white/10 mb-3" />
        {/* Pills skeleton */}
        <div className="flex gap-2 mb-4">
          <div className="h-6 w-16 rounded-full bg-white/10" />
          <div className="h-6 w-20 rounded-full bg-white/10" />
          <div className="h-6 w-14 rounded-full bg-white/10" />
        </div>
        {/* Reasoning skeleton */}
        <div className="h-4 w-full rounded bg-white/8 mb-1" />
        <div className="h-4 w-3/4 rounded bg-white/8 mb-5" />
        {/* Exercise list skeleton */}
        <div className="space-y-2.5 mb-5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-4 w-40 rounded bg-white/8" />
              <div className="h-4 w-16 rounded bg-white/8" />
            </div>
          ))}
        </div>
        {/* Button skeleton */}
        <div className="h-12 rounded-xl bg-white/10" />
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────
  if (error && !workout) {
    return (
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-[#D4AF37]" />
          <h3 className="text-[#E5E7EB] font-semibold text-sm tracking-wide">{t('workoutOfDay.todaysWorkout')}</h3>
        </div>
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <button
          onClick={handleRegenerate}
          className="text-sm text-[#D4AF37] font-medium hover:underline"
        >
          {t('workoutOfDay.tryAgain')}
        </button>
      </div>
    );
  }

  if (!workout) return null;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#D4AF37]" />
          <h3 className="text-[#E5E7EB] font-semibold text-sm tracking-wide">{t('workoutOfDay.todaysWorkout')}</h3>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#D4AF37] transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? 'animate-spin' : ''}`} />
          {t('workoutOfDay.regenerate')}
        </button>
      </div>

      {/* Workout name */}
      <h2 className="text-[#E5E7EB] font-bold text-lg leading-tight mb-2">
        {workout.name}
      </h2>

      {/* Meta: time + muscle pills */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="flex items-center gap-1 text-xs text-[#6B7280]">
          <Clock className="w-3.5 h-3.5" />
          ~{workout.estimatedMinutes} min
        </span>
        {workout.musclesFocused.map(muscle => (
          <span
            key={muscle}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${MUSCLE_COLORS[muscle] || 'bg-white/10 text-[#9CA3AF]'}`}
          >
            {muscle}
          </span>
        ))}
      </div>

      {/* Reasoning */}
      <p className="text-sm text-[#9CA3AF] leading-relaxed mb-4">
        {workout.reasoning}
      </p>

      {/* Exercise list */}
      <div className="space-y-2 mb-5">
        {workout.exercises.map((ex, idx) => {
          const exerciseData = getExerciseById(ex.exerciseId);
          const name = exerciseData?.name || ex.exerciseId;

          return (
            <div key={ex.exerciseId} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="text-xs text-[#6B7280] font-mono mt-0.5 w-4 shrink-0 text-right">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-[#E5E7EB] font-medium truncate">{name}</p>
                  <p className="text-[11px] text-[#6B7280] leading-snug mt-0.5 line-clamp-1">
                    {ex.reason}
                  </p>
                </div>
              </div>
              <span className="text-xs text-[#9CA3AF] font-medium whitespace-nowrap shrink-0 mt-0.5">
                {ex.sets} × {ex.reps}
              </span>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <button
        onClick={handleStart}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 bg-[#D4AF37] hover:bg-[#B8962E] text-[#05070B] font-bold text-sm py-3 rounded-xl transition-colors disabled:opacity-60"
      >
        {saving ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            {t('workoutOfDay.settingUp')}
          </>
        ) : (
          <>
            <Dumbbell className="w-4 h-4" />
            {t('workoutOfDay.startThisWorkout')}
            <ChevronRight className="w-4 h-4" />
          </>
        )}
      </button>
    </div>
  );
}
