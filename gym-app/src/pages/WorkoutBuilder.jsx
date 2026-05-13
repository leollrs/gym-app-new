import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Plus, Trash2, Dumbbell,
  ChevronRight, RotateCcw, Link2, Unlink, ArrowLeftRight
} from 'lucide-react';
import ExerciseLibrary from './ExerciseLibrary';
import LazyVideoTile from '../components/LazyVideoTile';
import { getExerciseById, exercises as ALL_EXERCISES } from '../data/exercises';
import { getSwapMatchScore, filterByReason } from '../lib/swapMatchScore';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { goalAdjustedDefaults } from '../lib/goalAdjustedDefaults';
import { useToast } from '../contexts/ToastContext';
import { clearCache } from '../lib/queryCache';
import { exName } from '../lib/exerciseName';
import { usePostHog } from '@posthog/react';

const nanoid = (len = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

const REST_OPTIONS = [30, 60, 90, 120, 180, 240];

const ExerciseRow = ({ item, exercise, index, total, onChange, onRemove, onMoveUp, onMoveDown, onSwap, isSelected, onToggleSelect, t, primaryGoal }) => {
  if (!exercise) return null;

  return (
    <div className={`rounded-2xl overflow-hidden transition-colors duration-200 ${isSelected ? 'ring-1 ring-[#D4AF37]/50' : ''}`} style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)' }}>
      {/* Top: name + reorder + delete — all 44px touch targets */}
      <div className="flex items-center gap-2 px-5 py-3">
        {/* Select checkbox for grouping */}
        <button
          type="button"
          onClick={() => onToggleSelect(index)}
          aria-label={isSelected ? t('workoutBuilder.ariaDeselect', 'Deselect exercise') : t('workoutBuilder.ariaSelect', 'Select exercise')}
          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
            isSelected
              ? 'bg-[#D4AF37] border-[#D4AF37] text-black'
              : 'text-transparent'
          }`}
          style={!isSelected ? { borderColor: 'var(--color-border-strong)' } : undefined}
        >
          {isSelected && <span className="text-[12px] font-bold leading-none">&#10003;</span>}
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>{exName(exercise)}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[12px] truncate" style={{ color: 'var(--color-text-subtle)' }}>{t(`muscleGroups.${exercise.muscle}`, exercise.muscle)} · {t(`exerciseLibrary.equipmentNames.${exercise.equipment}`, exercise.equipment)}</p>
            {item.groupType && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                item.groupType === 'superset' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
              }`}>
                {item.groupType === 'superset' ? t('activeSession.superset', 'Superset') : t('activeSession.circuit', 'Circuit')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center flex-shrink-0 -mr-1">
          <button
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            aria-label={t('workoutBuilder.ariaMoveUp', 'Move exercise up')}
            className="w-11 h-11 flex items-center justify-center disabled:opacity-20 transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ChevronLeft size={18} className="rotate-90" />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            aria-label={t('workoutBuilder.ariaMoveDown', 'Move exercise down')}
            className="w-11 h-11 flex items-center justify-center disabled:opacity-20 transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ChevronRight size={18} className="rotate-90" />
          </button>
          <button
            onClick={() => onSwap(index)}
            aria-label={t('workoutBuilder.ariaSwap', 'Swap exercise')}
            className="w-11 h-11 flex items-center justify-center hover:text-[#D4AF37] transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <ArrowLeftRight size={16} />
          </button>
          <button
            onClick={() => onRemove(index)}
            aria-label={t('workoutBuilder.ariaRemove', 'Remove exercise')}
            className="w-11 h-11 flex items-center justify-center hover:text-red-400 transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Controls: sets / reps / rest */}
      <div className="grid grid-cols-3" style={{ borderTop: '1px solid var(--color-border, rgba(255,255,255,0.05))', background: 'color-mix(in srgb, var(--color-bg-primary) 50%, var(--color-bg-card))' }}>
        {/* Sets */}
        <div className="px-3 py-3 flex flex-col items-center">
          <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.sets')}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => onChange(index, 'sets', Math.max(1, item.sets - 1))}
              aria-label={t('workoutBuilder.ariaDecreaseSets', 'Decrease sets')}
              className="w-7 h-7 rounded-lg text-[13px] flex items-center justify-center active:scale-90 transition-all leading-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', color: '#000' }}
            >−</button>
            <span className="font-bold text-[15px] tabular-nums w-5 text-center" style={{ color: 'var(--color-text-primary)' }}>{item.sets}</span>
            <button
              onClick={() => onChange(index, 'sets', Math.min(10, item.sets + 1))}
              aria-label={t('workoutBuilder.ariaIncreaseSets', 'Increase sets')}
              className="w-7 h-7 rounded-lg text-[13px] flex items-center justify-center active:scale-90 transition-all leading-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 25%, transparent)', color: '#000' }}
            >+</button>
          </div>
        </div>

        {/* Reps */}
        <div className="px-3 py-3 flex flex-col items-center" style={{ borderLeft: '1px solid var(--color-border-subtle)', borderRight: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.reps')}</p>
          <div className="flex items-center justify-center">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={item.reps}
              aria-label={`${t('workoutBuilder.reps')} for ${exercise ? exName(exercise) : t('workoutBuilder.exerciseFallback', 'exercise')}`}
              onChange={e => {
                const v = e.target.value;
                if (v === '' || v === '-') return onChange(index, 'reps', v);
                const n = parseInt(v, 10);
                if (!isNaN(n) && n > 999) return onChange(index, 'reps', '999');
                onChange(index, 'reps', (!isNaN(n) && n < 0) ? '0' : v);
              }}
              className="w-16 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors"
              style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-text-primary)' }}
            />
          </div>
          {/* Goal-tailored rep recommendation — pulled from the same
              goal-adjusted defaults table the auto-workout generator uses,
              so what we recommend matches what the engine would have set. */}
          {(() => {
            if (!exercise) return null;
            const rec = goalAdjustedDefaults(exercise, primaryGoal || 'general_fitness');
            if (!rec?.reps || rec.reps === '—') return null;
            const matches = String(item.reps).trim() === String(rec.reps).trim();
            return (
              <p
                className="text-[9px] font-bold uppercase tracking-wider mt-1.5 tabular-nums"
                style={{
                  color: matches ? 'var(--color-accent)' : 'var(--color-text-subtle)',
                  letterSpacing: 0.6,
                }}
                aria-label={t('workoutBuilder.recommendedRepsAria', { reps: rec.reps, defaultValue: `Recommended ${rec.reps} reps` })}
              >
                {t('workoutBuilder.recommendedRepsShort', { defaultValue: 'rec' })} {rec.reps}
              </p>
            );
          })()}
        </div>

        {/* Rest */}
        <div className="px-3 py-3 flex flex-col items-center">
          <p className="text-[10px] uppercase font-bold tracking-wider mb-2 text-center" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.rest')}</p>
          <select
            value={item.restSeconds}
            aria-label={`${t('workoutBuilder.rest')} for ${exercise ? exName(exercise) : t('workoutBuilder.exerciseFallback', 'exercise')}`}
            onChange={e => onChange(index, 'restSeconds', Number(e.target.value))}
            className="w-16 rounded-lg py-1.5 text-[13px] font-semibold focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors appearance-none"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)', color: 'var(--color-text-primary)', textAlign: 'center', textAlignLast: 'center', paddingLeft: '0', paddingRight: '0' }}
          >
            {REST_OPTIONS.map(s => (
              <option key={s} value={s}>{s < 60 ? `${s}s` : `${s / 60}m`}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

// Simple card list for Mine / Friends picker tabs
const PickerList = ({ exercises, selectedIds, onSelect, emptyText, t }) => {
  if (exercises.length === 0) {
    return (
      <div className="text-center py-16">
        <Dumbbell size={36} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--color-text-subtle)' }} />
        <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {exercises.map(ex => {
        const added = selectedIds.includes(ex.id);
        return (
          <div
            key={ex.id}
            className="bg-white/[0.04] rounded-2xl border border-white/[0.06] flex items-center gap-4 px-5 py-3.5"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>{exName(ex)}</p>
              <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>{t(`muscleGroups.${ex.muscle}`, ex.muscle)} · {t(`exerciseLibrary.equipmentNames.${ex.equipment}`, ex.equipment)}</p>
            </div>
            {added ? (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)' }}>
                {t('workoutBuilder.added')}
              </span>
            ) : (
              <button
                onClick={() => onSelect(ex)}
                aria-label={t('workoutBuilder.ariaAddExercise', { name: exName(ex), defaultValue: `Add ${exName(ex)}` })}
                className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)', border: '1.5px solid color-mix(in srgb, var(--color-accent) 50%, transparent)' }}
              >
                <Plus size={18} strokeWidth={2.5} style={{ color: 'var(--color-accent)' }} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

const WorkoutBuilder = () => {
  const posthog = usePostHog();
  const { t } = useTranslation('pages');
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawReturn = searchParams.get('from') || '/workouts';
  // Only allow relative paths starting with / but not // (protocol-relative URLs)
  const returnTo = /^\/[a-zA-Z0-9\-\/\?=&]*$/.test(rawReturn) ? rawReturn : '/workouts';
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [showLibrary, setShowLibrary] = useState(false);
  const [pickerTab, setPickerTab]     = useState('library');
  // When non-null, the exercise picker swaps the row at this index instead
  // of appending. Used by the swap icon on each routine row.
  const [swapTargetIndex, setSwapTargetIndex] = useState(null);
  // Same reason chips as the in-session swap modal — used to cull
  // alternatives that wouldn't help (busy equipment / aggravating muscle).
  const [swapReason, setSwapReason] = useState(null);

  const [name, setName]                       = useState(t('workoutBuilder.newWorkoutDefault', 'New Workout'));
  const [routineExercises, setRoutineExercises] = useState([]);
  const [originalExercises, setOriginalExercises] = useState([]);
  const [selectedIndices, setSelectedIndices]   = useState(new Set());
  const [loading, setLoading]                 = useState(true);
  const [saving, setSaving]                   = useState(false);
  const [saved, setSaved]                     = useState(false);
  const [error, setError]                     = useState('');
  const [customExs, setCustomExs]             = useState([]);
  const [friendIds, setFriendIds]             = useState(new Set());
  const [savedIds, setSavedIds]               = useState(new Set());

  // Load routine from DB
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('routines')
        .select(`
          id, name,
          routine_exercises(id, exercise_id, position, target_sets, target_reps, rest_seconds, group_id, group_type)
        `)
        .eq('id', id)
        .single();

      if (!err && data) {
        setName(data.name);
        const exs = (data.routine_exercises || [])
          .sort((a, b) => a.position - b.position)
          .map(re => ({
            id:          re.exercise_id,
            sets:        re.target_sets,
            reps:        re.target_reps,
            restSeconds: re.rest_seconds,
            groupId:     re.group_id || null,
            groupType:   re.group_type || null,
          }));
        setRoutineExercises(exs);
        setOriginalExercises(exs);
      }
      setLoading(false);
    };
    load();
  }, [id]);

  // Load custom exercises + friend IDs so the picker can split into three sections
  useEffect(() => {
    if (!profile?.gym_id || !user) return;

    supabase
      .from('exercises')
      .select('id, name, name_es, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, created_by')
      .eq('gym_id', profile.gym_id)
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) {
          setCustomExs((data || []).map(r => ({
            id:               r.id,
            name:             r.name,
            name_es:          r.name_es || null,
            muscle:           r.muscle_group,
            equipment:        r.equipment,
            category:         r.category,
            defaultSets:      r.default_sets,
            defaultReps:      r.default_reps,
            restSeconds:      r.rest_seconds,
            instructions:     r.instructions ?? '',
            primaryRegions:   [],
            secondaryRegions: [],
            createdBy:        r.created_by,
            isCustom:         true,
          })));
        }
      });

    supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq('status', 'accepted')
      .then(({ data }) => {
        if (data) {
          setFriendIds(new Set((data || []).map(f =>
            f.requester_id === user.id ? f.addressee_id : f.requester_id
          )));
        }
      });

    supabase
      .from('user_saved_exercises')
      .select('exercise_id')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) setSavedIds(new Set((data || []).map(r => r.exercise_id)));
      });
  }, [profile?.gym_id, user?.id]);

  // Resolve an exercise by ID — checks local library then custom exercises
  const findExercise = (exerciseId) =>
    getExerciseById(exerciseId) || customExs.find(e => e.id === exerciseId);

  // Split custom exercises into mine vs friends for the picker tabs
  // "Mine" = created by me OR saved by me
  const myExs     = customExs.filter(e => e.createdBy === user?.id || savedIds.has(e.id));
  const friendExs = customExs.filter(e => e.createdBy && e.createdBy !== user?.id && friendIds.has(e.createdBy) && !savedIds.has(e.id));

  const handleAdd = (exercise) => {
    // If the picker was opened via the swap icon on a row, replace that row
    // (preserving its sets/reps/rest/group settings) instead of appending.
    if (swapTargetIndex !== null) {
      setRoutineExercises(prev => prev.map((row, i) =>
        i === swapTargetIndex ? { ...row, id: exercise.id } : row
      ));
      setSwapTargetIndex(null);
      setSwapReason(null);
      setShowLibrary(false);
      return;
    }
    // Adopt the user's goal-tailored defaults when adding an exercise so
    // the routine reflects what they're actually training for. Strength
    // user gets ~5 sets × 3-5 reps; hypertrophy user gets ~4 sets × 8-10.
    const goal = profile?.primary_goal || 'general_fitness';
    const adj = goalAdjustedDefaults(exercise, goal);
    setRoutineExercises(prev => [
      ...prev,
      { id: exercise.id, sets: adj.sets, reps: adj.reps, restSeconds: adj.rest, groupId: null, groupType: null }
    ]);
    setShowLibrary(false);
  };

  const handleSwap = (index) => {
    setSwapTargetIndex(index);
    setSwapReason(null);
    setShowLibrary(true);
  };

  const handleChange = (index, field, value) => {
    setRoutineExercises(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleRemove  = (index) => setRoutineExercises(prev => prev.filter((_, i) => i !== index));

  const handleMoveUp = (index) => {
    if (index === 0) return;
    setRoutineExercises(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const handleMoveDown = (index) => {
    setRoutineExercises(prev => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const handleToggleSelect = (index) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else if (next.size < 3) next.add(index);
      return next;
    });
  };

  const handleGroup = (type) => {
    if (selectedIndices.size < 2) return;
    const gid = nanoid();
    setRoutineExercises(prev => {
      const next = [...prev];
      selectedIndices.forEach(i => {
        next[i] = { ...next[i], groupId: gid, groupType: type };
      });
      return next;
    });
    setSelectedIndices(new Set());
  };

  const handleUngroup = (groupId) => {
    setRoutineExercises(prev =>
      prev.map(ex => ex.groupId === groupId ? { ...ex, groupId: null, groupType: null } : ex)
    );
  };

  const handleSave = async ({ andExit = false } = {}) => {
    setSaving(true);
    setError('');
    try {
      // Update routine name
      const { error: nameErr } = await supabase
        .from('routines')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (nameErr) throw nameErr;

      // Delete all existing routine_exercises and re-insert in order
      const { error: delErr } = await supabase
        .from('routine_exercises')
        .delete()
        .eq('routine_id', id);
      if (delErr) throw delErr;

      if (routineExercises.length > 0) {
        // Guard: every exercise must have a valid id. Saving with a null
        // exercise_id silently fails the DB NOT NULL and corrupts the routine.
        const missing = routineExercises.find(ex => !ex.id);
        if (missing) throw new Error('One or more exercises are missing an ID. Please re-add them.');

        const rows = routineExercises.map((ex, i) => ({
          routine_id:   id,
          exercise_id:  ex.id,
          position:     i + 1,
          target_sets:  Number.isFinite(parseInt(ex.sets)) ? parseInt(ex.sets) : 3,
          target_reps:  ex.reps || '8-12',
          rest_seconds: Number.isFinite(parseInt(ex.restSeconds)) ? parseInt(ex.restSeconds) : 90,
          group_id:     ex.groupId || null,
          group_type:   ex.groupType || null,
        }));
        const { error: insErr } = await supabase
          .from('routine_exercises')
          .insert(rows);
        if (insErr) throw insErr;
      }

      setOriginalExercises([...routineExercises]);
      clearCache(`dash:${user.id}`);
      posthog?.capture('workout_built', { exercise_count: routineExercises.length });

      if (andExit) {
        navigate(returnTo);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        showToast(t('workoutBuilder.routineSaved'), 'success');
      }
    } catch (err) {
      const failMsg = t('workoutBuilder.saveFailed', 'Save failed');
      setError(err.message || failMsg);
      showToast(err.message || failMsg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    // If nothing changed, just navigate back
    const isDirty =
      routineExercises.length !== originalExercises.length ||
      routineExercises.some((ex, i) => {
        const orig = originalExercises[i];
        return !orig || ex.id !== orig.id || ex.sets !== orig.sets ||
               ex.reps !== orig.reps || ex.restSeconds !== orig.restSeconds ||
               ex.groupId !== orig.groupId || ex.groupType !== orig.groupType;
      });

    if (!isDirty) {
      navigate(returnTo);
      return;
    }

    // Save then exit
    await handleSave({ andExit: true });
  };

  const selectedIds = routineExercises.map(e => e.id);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>

      {/* Header — safe area aware, premium dark + gold accent */}
      <header
        className="flex-shrink-0 px-5 pb-4 flex items-center gap-3"
        style={{
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
          paddingTop: 'max(0.875rem, var(--safe-area-top, env(safe-area-inset-top)))',
        }}
      >
        <button
          onClick={handleBack}
          disabled={saving}
          aria-label={t('workoutBuilder.ariaBack', 'Back')}
          className="flex items-center justify-center transition-transform active:scale-95 disabled:opacity-50 flex-shrink-0 focus:outline-none"
          style={{
            width: 40, height: 40, borderRadius: 20,
            background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
            border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
            color: 'var(--color-text-primary)',
          }}
        >
          <ChevronLeft size={19} strokeWidth={2.5} />
        </button>

        <div className="flex-1 min-w-0 text-center">
          <p
            className="uppercase mb-0.5"
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '0.16em',
              color: 'var(--color-accent)',
            }}
          >
            {t('workoutBuilder.editRoutine', 'Edit routine')}
          </p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label={t('workoutBuilder.ariaWorkoutName', 'Workout name')}
            className="bg-transparent text-center w-full max-w-[260px] mx-auto outline-none transition-colors"
            style={{
              fontFamily: '"Archivo", "Familjen Grotesk", system-ui, sans-serif',
              fontWeight: 900, fontSize: 19,
              letterSpacing: -0.4,
              color: 'var(--color-text-primary)',
              borderBottom: '1.5px dashed transparent',
            }}
            onFocus={(e) => { e.currentTarget.style.borderBottomColor = 'var(--color-accent)'; }}
            onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
          />
        </div>

        {/* Save lives on the sticky bottom bar ("Save and Done") + a quiet
            "saved ✓" inline indicator here when the autosave round trip
            completes. One canonical write action; the header just confirms. */}
        {saved && (
          <span
            className="font-bold text-[12px] flex-shrink-0 inline-flex items-center gap-1"
            style={{ color: '#10B981' }}
            aria-live="polite"
          >
            ✓ {t('workoutBuilder.saved')}
          </span>
        )}
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

      {error && (
        <div className="mx-auto max-w-[480px] md:max-w-4xl lg:max-w-6xl px-4 mt-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400">
            {error}
          </div>
        </div>
      )}

      {/* Exercise Library Slide-in */}
      {showLibrary && (
        <div className="fixed inset-0 z-[95] flex flex-col animate-fade-in" style={{ background: 'var(--color-bg-primary)' }}>
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-white/[0.06] backdrop-blur-2xl" style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)' }}>
            <div className="px-4 py-3.5 flex items-center gap-3">
              <button
                onClick={() => { setShowLibrary(false); setSwapTargetIndex(null); setSwapReason(null); }}
                className="text-[#D4AF37] hover:text-[#E6C766] flex items-center gap-0.5 transition-colors"
              >
                <ChevronLeft size={24} strokeWidth={2.5} />
                <span className="font-semibold text-[14px]">{t('workoutBuilder.back')}</span>
              </button>
              <h2 className="flex-1 text-center font-semibold text-[16px] truncate" style={{ color: 'var(--color-text-primary)' }}>{swapTargetIndex !== null ? t('workoutBuilder.swapExercise', 'Swap Exercise') : t('workoutBuilder.addExercise')}</h2>
              <div className="w-16" />
            </div>
            {/* Tabs — hidden in swap mode, which shows a dedicated tile-grid
                view instead of the multi-tab picker. */}
            {swapTargetIndex === null && (
              <div className="flex px-4 gap-5">
                {[
                  { key: 'library', label: t('workoutBuilder.library') },
                  { key: 'mine',    label: `${t('workoutBuilder.mine')}${myExs.length ? ` (${myExs.length})` : ''}` },
                  { key: 'friends', label: `${t('workoutBuilder.friends')}${friendExs.length ? ` (${friendExs.length})` : ''}` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setPickerTab(key)}
                    className={`pb-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                      pickerTab === key
                        ? 'border-[#D4AF37] text-[#D4AF37]'
                        : 'border-transparent'
                    }`}
                    style={pickerTab !== key ? { color: 'var(--color-text-subtle)' } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
            {/* Swap mode — same video-tile grid as the active-session swap.
                Same-muscle picks first, then other muscles. Tap a tile to
                run handleAdd, which replaces the target row's exercise id. */}
            {swapTargetIndex !== null ? (() => {
              const targetItem = routineExercises[swapTargetIndex];
              const targetLib = targetItem ? findExercise(targetItem.id) : null;
              const targetMuscle = targetLib?.muscle || '';
              const currentIds = new Set(routineExercises.map((r) => r.id));
              const VIDEO_BASE = 'https://erdhnixjnjullhjzmvpm.supabase.co/storage/v1/object/public/exercise-videos/';
              const toVideoSrc = (ex) => {
                const raw = ex.videoUrl || ex.video_url || ex.video;
                if (!raw) return null;
                if (/^(https?:|blob:|data:)/.test(raw)) return raw;
                return `${VIDEO_BASE}${raw}`;
              };
              const sameMuscleRaw = [];
              const otherMusclesRaw = [];
              for (const ex of ALL_EXERCISES) {
                if (currentIds.has(ex.id)) continue;
                if (targetMuscle && ex.muscle === targetMuscle) sameMuscleRaw.push(ex);
                else otherMusclesRaw.push(ex);
                if (sameMuscleRaw.length + otherMusclesRaw.length >= 120) break;
              }
              const decorate = (list) => filterByReason(list, swapReason, targetLib)
                .map((ex) => ({ ...ex, _swapMatch: getSwapMatchScore(targetLib, ex) }))
                .sort((a, b) => (b._swapMatch || 0) - (a._swapMatch || 0));
              const sameMuscle = decorate(sameMuscleRaw).slice(0, 50);
              const otherMuscles = decorate(otherMusclesRaw).slice(0, 30);
              const renderTile = (ex, accent = false) => {
                const vsrc = toVideoSrc(ex);
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => handleAdd(ex)}
                    className="relative aspect-[4/5] rounded-xl overflow-hidden text-left active:scale-[0.98] transition-transform"
                    style={{
                      background: '#000',
                      border: accent
                        ? '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)'
                        : '1px solid var(--color-border-subtle)',
                    }}
                    aria-label={t('workoutBuilder.swapToAria', { name: exName(ex) || ex.name, defaultValue: `Swap to ${exName(ex) || ex.name}` })}
                  >
                    {vsrc ? (
                      <LazyVideoTile
                        src={vsrc}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 14%, transparent), transparent)' }} />
                    )}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 55%, rgba(0,0,0,0) 100%)' }} />
                    <span
                      className="absolute top-2 left-2 inline-flex items-center justify-center rounded-full"
                      style={{ width: 26, height: 26, background: accent ? 'var(--color-accent)' : 'rgba(0,0,0,0.55)', color: accent ? '#0A0D14' : 'var(--color-text-primary)' }}
                    >
                      <ArrowLeftRight size={13} strokeWidth={2.6} />
                    </span>
                    {typeof ex._swapMatch === 'number' && (
                      <span
                        className="absolute top-2 right-2 text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded tabular-nums"
                        style={{
                          background: accent ? 'var(--color-accent)' : 'rgba(0,0,0,0.55)',
                          color: accent ? '#0A0D14' : '#fff',
                          letterSpacing: 0.4,
                        }}
                        aria-label={t('activeSession.swapMatchAria', { pct: ex._swapMatch, defaultValue: `${ex._swapMatch}% match` })}
                      >
                        {ex._swapMatch}%
                      </span>
                    )}
                    <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, color: '#fff' }}>
                      <p className="text-[11px] font-extrabold leading-tight" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                        {exName(ex) || ex.name}
                      </p>
                      <p className="text-[10px] font-semibold mt-0.5 opacity-85" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                        {t(`muscleGroups.${ex.muscle}`, ex.muscle)}{ex.equipment ? ` · ${ex.equipment}` : ''}
                      </p>
                    </div>
                  </button>
                );
              };
              return (
                <>
                  {/* Reason chips — same vocabulary as the in-session swap.
                      Selecting one filters out candidates that wouldn't help
                      (busy equipment / aggravating muscle). */}
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {[
                      { key: 'equipment_busy', label: t('activeSession.swapReasonEquipment', 'Equipment busy') },
                      { key: 'injury', label: t('activeSession.swapReasonInjury', 'Injury') },
                      { key: 'preference', label: t('activeSession.swapReasonPreference', 'Preference') },
                    ].map((r) => {
                      const active = swapReason === r.key;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => setSwapReason(active ? null : r.key)}
                          className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors active:scale-95"
                          style={{
                            background: active ? 'var(--color-accent)' : 'var(--color-surface-hover)',
                            color: active ? '#0A0D14' : 'var(--color-text-muted)',
                            border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                          }}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                  {sameMuscle.length > 0 && targetMuscle && (
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] pb-2" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('activeSession.swapSameMuscle', { defaultValue: '{{muscle}} alternatives', muscle: t(`muscleGroups.${targetMuscle}`, targetMuscle) })}
                    </p>
                  )}
                  {sameMuscle.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 mb-5">
                      {sameMuscle.slice(0, 50).map((ex) => renderTile(ex, true))}
                    </div>
                  )}
                  {otherMuscles.length > 0 && (
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] pb-2" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('activeSession.swapOtherMuscles', 'Other muscles')}
                    </p>
                  )}
                  {otherMuscles.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {otherMuscles.slice(0, 30).map((ex) => renderTile(ex, false))}
                    </div>
                  )}
                  {sameMuscle.length === 0 && otherMuscles.length === 0 && (
                    <div className="rounded-2xl py-12 px-4 text-center" style={{ background: 'var(--color-surface-hover)', border: '1px dashed var(--color-border-subtle)' }}>
                      <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                        {t('activeSession.swapNoResults')}
                      </p>
                    </div>
                  )}
                </>
              );
            })() : (
              <>
                {pickerTab === 'library' && (
                  <ExerciseLibrary
                    selectable
                    selectedIds={selectedIds}
                    onSelect={handleAdd}
                  />
                )}
                {pickerTab === 'mine' && (
                  <PickerList
                    exercises={myExs}
                    selectedIds={selectedIds}
                    onSelect={handleAdd}
                    emptyText={t('workoutBuilder.noOwnExercises')}
                    t={t}
                  />
                )}
                {pickerTab === 'friends' && (
                  <PickerList
                    exercises={friendExs}
                    selectedIds={selectedIds}
                    onSelect={handleAdd}
                    emptyText={t('workoutBuilder.noFriendExercises')}
                    t={t}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Builder Content */}
      <div className="container max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto px-5 pb-8 md:pb-10" style={{ paddingTop: '2rem' }}>

        {/* Summary stats */}
        <div className="flex items-center justify-between rounded-2xl px-2 py-3 mb-6" style={{ background: 'linear-gradient(135deg, rgba(212,175,55,0.06) 0%, rgba(212,175,55,0.02) 100%)', border: '1px solid rgba(212,175,55,0.12)' }}>
          <div className="flex-1 flex flex-col items-center gap-0.5">
            <span className="font-bold text-[18px] tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{routineExercises.length}</span>
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--color-text-subtle)' }}>{routineExercises.length !== 1 ? t('workoutBuilder.exercises') : t('workoutBuilder.exercise')}</span>
          </div>
          <div className="w-px h-8 rounded-full" style={{ background: 'rgba(212,175,55,0.15)' }} />
          <div className="flex-1 flex flex-col items-center gap-0.5">
            <span className="font-bold text-[18px] tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{routineExercises.reduce((sum, e) => sum + e.sets, 0)}</span>
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.totalSets')}</span>
          </div>
          <div className="w-px h-8 rounded-full" style={{ background: 'rgba(212,175,55,0.15)' }} />
          <div className="flex-1 flex flex-col items-center gap-0.5">
            <span className="font-bold text-[18px] tabular-nums" style={{ color: 'var(--color-text-primary)' }}>~{Math.round(routineExercises.reduce((sum, e) => sum + (e.sets * (e.restSeconds + 45)), 0) / 60)}</span>
            <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.minLabel', 'min')}</span>
          </div>
        </div>

        {/* Grouping toolbar — always visible when there are 2+ exercises so
            the Superset / Circuit affordance is discoverable without first
            knowing about the row checkboxes. Shows a hint when <2 selected
            and becomes actionable once the user picks at least two. */}
        {routineExercises.length >= 2 && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/25">
            <Link2 size={14} className="text-[#D4AF37] shrink-0" />
            {selectedIndices.size >= 2 ? (
              <>
                <span className="text-[12px] text-[#D4AF37] font-semibold flex-1">
                  {selectedIndices.size} {t('workoutBuilder.selectToGroup', 'selected — group as:')}
                </span>
                <button
                  onClick={() => handleGroup('superset')}
                  className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[11px] font-bold active:scale-95 transition-transform"
                >
                  {t('workoutBuilder.groupAsSuperset', 'Superset')}
                </button>
                <button
                  onClick={() => handleGroup('circuit')}
                  className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold active:scale-95 transition-transform"
                >
                  {t('workoutBuilder.groupAsCircuit', 'Circuit')}
                </button>
              </>
            ) : (
              <span className="text-[12px] text-[#D4AF37]/90 font-semibold flex-1 leading-snug">
                {t('workoutBuilder.supersetHint', {
                  defaultValue: 'Tap the checkbox on 2+ exercises to group them as a Superset or Circuit.',
                })}
              </span>
            )}
          </div>
        )}

        {/* Exercise list */}
        {routineExercises.length > 0 ? (
          <div className="flex flex-col gap-3 mb-5">
            {routineExercises.map((item, index) => {
              // Determine if this is the first in a group (show header)
              const isFirstInGroup = item.groupId && (index === 0 || routineExercises[index - 1]?.groupId !== item.groupId);
              const isLastInGroup = item.groupId && (index === routineExercises.length - 1 || routineExercises[index + 1]?.groupId !== item.groupId);
              const isInGroup = !!item.groupId;

              return (
                <React.Fragment key={`${item.id}-${index}`}>
                  {/* Group header badge */}
                  {isFirstInGroup && (
                    <div className="flex items-center gap-2 -mb-2">
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                        item.groupType === 'superset' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        <Link2 size={11} />
                        {item.groupType === 'superset' ? t('activeSession.superset') : t('activeSession.circuit')}
                      </div>
                      <button
                        onClick={() => handleUngroup(item.groupId)}
                        aria-label={t('workoutBuilder.ungroup')}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold hover:text-red-400 bg-white/[0.04] border border-white/[0.06] transition-colors"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        <Unlink size={10} />
                        {t('workoutBuilder.ungroup')}
                      </button>
                    </div>
                  )}
                  {/* Bracket wrapper for grouped exercises */}
                  <div className={`relative ${isInGroup ? 'pl-4' : ''}`}>
                    {isInGroup && (
                      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full ${
                        item.groupType === 'superset' ? 'bg-purple-500/40' : 'bg-blue-500/40'
                      } ${isFirstInGroup ? 'rounded-t-full' : ''} ${isLastInGroup ? 'rounded-b-full' : ''}`} />
                    )}
                    <ExerciseRow
                      item={item}
                      exercise={findExercise(item.id)}
                      index={index}
                      total={routineExercises.length}
                      onChange={handleChange}
                      onRemove={handleRemove}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                      onSwap={handleSwap}
                      isSelected={selectedIndices.has(index)}
                      onToggleSelect={handleToggleSelect}
                      t={t}
                      primaryGoal={profile?.primary_goal}
                    />
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-14 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
            <Dumbbell size={44} className="mx-auto mb-4 opacity-15" />
            <p className="text-[16px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('workoutBuilder.noExercisesYet')}</p>
            <p className="text-[13px] mt-1">{t('workoutBuilder.addFromLibrary')}</p>
          </div>
        )}

        {/* Add Exercise button — desktop only; mobile uses sticky bar */}
        <button
          onClick={() => setShowLibrary(true)}
          className="hidden md:flex w-full items-center justify-center gap-2 bg-[#D4AF37]/10 hover:bg-[#D4AF37]/18 border border-[#D4AF37]/25 hover:border-[#D4AF37]/45 text-[#D4AF37] font-semibold text-[14px] py-4 rounded-2xl transition-all"
        >
          <Plus size={19} strokeWidth={2.5} /> {t('workoutBuilder.addExercise')}
        </button>

        {/* Mobile: prominent add button when empty */}
        {routineExercises.length === 0 && (
          <button
            onClick={() => setShowLibrary(true)}
            className="md:hidden w-full flex items-center justify-center gap-2 bg-[#D4AF37]/10 border border-[#D4AF37]/25 text-[#D4AF37] font-semibold text-[14px] py-4 rounded-2xl transition-all active:scale-95"
          >
            <Plus size={19} strokeWidth={2.5} /> {t('workoutBuilder.addExercise')}
          </button>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-3 text-[13px] text-red-400 text-center">
            {error}
          </div>
        )}

        {/* Save & Done — desktop only; mobile uses sticky bar */}
        {routineExercises.length > 0 && (
          <button
            onClick={() => handleSave({ andExit: true })}
            disabled={saving}
            className="hidden md:flex w-full mt-4 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 text-black font-bold text-[14px] py-4 rounded-2xl transition-all items-center justify-center gap-2"
          >
            {saving ? '…' : t('workoutBuilder.saveAndDone')}
          </button>
        )}

        {/* Reset hint */}
        {routineExercises.length > 0 && (
          <button
            onClick={() => setRoutineExercises(originalExercises.map(e => ({ ...e })))}
            className="w-full flex items-center justify-center gap-2 text-[12px] mt-3 py-2 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <RotateCcw size={12} /> {t('workoutBuilder.resetToSaved')}
          </button>
        )}
      </div>

      </div>{/* end scrollable body */}

      {/* Mobile bottom bar — pinned just above the iOS home indicator.
          Was using `0.75rem + safe-area` which left a chunky empty band
          under the buttons; clamped to a tighter max so the bar hugs the
          bottom edge without overlapping system UI. */}
      <div
        className="md:hidden flex-shrink-0 px-5 pt-3 backdrop-blur-xl border-t border-white/[0.06]"
        style={{
          background: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)',
          paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex gap-3">
          <button
            onClick={() => setShowLibrary(true)}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] font-semibold text-[13px] py-2.5 rounded-xl active:scale-95 transition-all"
          >
            <Plus size={16} strokeWidth={2.5} /> {t('workoutBuilder.add')}
          </button>
          <button
            onClick={() => handleSave({ andExit: true })}
            disabled={saving}
            className="flex-1 bg-[#D4AF37] disabled:opacity-50 text-black font-bold text-[13px] py-2.5 rounded-xl active:scale-95 transition-all flex items-center justify-center"
          >
            {saving ? '…' : t('workoutBuilder.saveAndDone')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutBuilder;
