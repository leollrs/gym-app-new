import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft, Plus, Trash2, Dumbbell,
  ChevronRight, RotateCcw, Link2, Unlink
} from 'lucide-react';
import ExerciseLibrary from './ExerciseLibrary';
import { getExerciseById } from '../data/exercises';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { clearCache } from '../lib/queryCache';
import { exName } from '../lib/exerciseName';

const nanoid = (len = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

const REST_OPTIONS = [30, 60, 90, 120, 180, 240];

const ExerciseRow = ({ item, exercise, index, total, onChange, onRemove, onMoveUp, onMoveDown, isSelected, onToggleSelect, t }) => {
  if (!exercise) return null;

  return (
    <div className={`bg-white/[0.04] rounded-2xl border overflow-hidden hover:bg-white/[0.06] transition-colors duration-200 ${isSelected ? 'border-[#D4AF37]/50 bg-[#D4AF37]/[0.04]' : 'border-white/[0.06]'}`}>
      {/* Top: name + reorder + delete — all 44px touch targets */}
      <div className="flex items-center gap-2 px-5 py-3">
        {/* Select checkbox for grouping */}
        <button
          type="button"
          onClick={() => onToggleSelect(index)}
          aria-label={isSelected ? 'Deselect exercise' : 'Select exercise'}
          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
            isSelected
              ? 'bg-[#D4AF37] border-[#D4AF37] text-black'
              : 'border-white/[0.15] text-transparent hover:border-white/[0.3]'
          }`}
        >
          {isSelected && <span className="text-[12px] font-bold leading-none">&#10003;</span>}
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>{exName(exercise)}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[12px] truncate" style={{ color: 'var(--color-text-subtle)' }}>{exercise.muscle} · {exercise.equipment}</p>
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
            aria-label="Move exercise up"
            className="w-11 h-11 flex items-center justify-center disabled:opacity-20 transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ChevronLeft size={18} className="rotate-90" />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            aria-label="Move exercise down"
            className="w-11 h-11 flex items-center justify-center disabled:opacity-20 transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <ChevronRight size={18} className="rotate-90" />
          </button>
          <button
            onClick={() => onRemove(index)}
            aria-label="Remove exercise"
            className="w-11 h-11 flex items-center justify-center hover:text-red-400 transition-colors active:scale-90 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-xl"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Controls: sets / reps / rest */}
      <div className="grid grid-cols-3 border-t border-white/[0.06]">
        {/* Sets */}
        <div className="px-3 py-3">
          <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.sets')}</p>
          <div className="flex items-center justify-between">
            <button
              onClick={() => onChange(index, 'sets', Math.max(1, item.sets - 1))}
              aria-label="Decrease sets"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-white/[0.06] text-xl flex items-center justify-center hover:bg-white/[0.10] active:scale-90 transition-all leading-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >−</button>
            <span className="font-bold text-[18px] tabular-nums" style={{ color: 'var(--color-text-primary)' }}>{item.sets}</span>
            <button
              onClick={() => onChange(index, 'sets', Math.min(10, item.sets + 1))}
              aria-label="Increase sets"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-white/[0.06] text-xl flex items-center justify-center hover:bg-white/[0.10] active:scale-90 transition-all leading-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >+</button>
          </div>
        </div>

        {/* Reps */}
        <div className="px-3 py-3 border-l border-r border-white/[0.06]">
          <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.reps')}</p>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={item.reps}
            onChange={e => {
              const v = e.target.value;
              if (v === '' || v === '-') return onChange(index, 'reps', v);
              const n = parseInt(v, 10);
              if (!isNaN(n) && n > 999) return onChange(index, 'reps', '999');
              onChange(index, 'reps', (!isNaN(n) && n < 0) ? '0' : v);
            }}
            className="w-full border border-white/[0.06] rounded-xl px-2 py-2 text-[14px] font-semibold text-center focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
          />
        </div>

        {/* Rest */}
        <div className="px-3 py-3">
          <p className="text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: 'var(--color-text-subtle)' }}>{t('workoutBuilder.rest')}</p>
          <select
            value={item.restSeconds}
            onChange={e => onChange(index, 'restSeconds', Number(e.target.value))}
            className="w-full border border-white/[0.06] rounded-xl px-1 py-2 text-[13px] font-semibold focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors appearance-none text-center"
            style={{ background: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}
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
              <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-text-subtle)' }}>{ex.muscle} · {ex.equipment}</p>
            </div>
            {added ? (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--color-success)' }}>
                {t('workoutBuilder.added')}
              </span>
            ) : (
              <button
                onClick={() => onSelect(ex)}
                aria-label={`Add ${exName(ex)}`}
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

  const [name, setName]                       = useState('New Workout');
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
    setRoutineExercises(prev => [
      ...prev,
      { id: exercise.id, sets: exercise.defaultSets, reps: exercise.defaultReps, restSeconds: 90, groupId: null, groupType: null }
    ]);
    setShowLibrary(false);
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
        const rows = routineExercises.map((ex, i) => ({
          routine_id:   id,
          exercise_id:  ex.id,
          position:     i + 1,
          target_sets:  ex.sets,
          target_reps:  ex.reps,
          rest_seconds: ex.restSeconds,
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

      if (andExit) {
        navigate(returnTo);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        showToast(t('workoutBuilder.routineSaved'), 'success');
      }
    } catch (err) {
      setError(err.message || 'Save failed');
      showToast(err.message || 'Save failed', 'error');
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

      {/* Header — safe area aware */}
      <header
        className="flex-shrink-0 px-5 pb-3 border-b border-white/[0.06] flex items-center gap-3 backdrop-blur-xl"
        style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)', paddingTop: 'max(0.875rem, var(--safe-area-top, env(safe-area-inset-top)))' }}
      >
        <button
          onClick={handleBack}
          disabled={saving}
          aria-label="Back"
          className="w-11 h-11 rounded-xl flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.06] transition-colors disabled:opacity-50 flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
        >
          <ChevronLeft size={20} strokeWidth={2.5} style={{ color: 'var(--color-text-muted)' }} />
        </button>

        <div className="flex-1 text-center">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            aria-label="Workout name"
            className="bg-transparent font-bold text-[18px] text-center w-full max-w-[220px] border-b-2 border-transparent focus:ring-2 focus:ring-[#D4AF37] focus:outline-none transition-colors rounded"
            style={{ color: 'var(--color-text-primary)' }}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={`font-bold text-[13px] px-4 py-2 rounded-xl transition-all disabled:opacity-50 flex-shrink-0 ${
            saved
              ? 'bg-[#10B981] text-white'
              : 'bg-[#D4AF37] hover:bg-[#E6C766] text-black'
          }`}
        >
          {saving ? '…' : saved ? `${t('workoutBuilder.saved')} ✓` : t('workoutBuilder.save')}
        </button>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

      {error && (
        <div className="mx-auto max-w-[480px] md:max-w-4xl px-4 mt-4">
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
                onClick={() => setShowLibrary(false)}
                className="text-[#D4AF37] hover:text-[#E6C766] flex items-center gap-0.5 transition-colors"
              >
                <ChevronLeft size={24} strokeWidth={2.5} />
                <span className="font-semibold text-[14px]">{t('workoutBuilder.back')}</span>
              </button>
              <h2 className="flex-1 text-center font-semibold text-[16px] truncate" style={{ color: 'var(--color-text-primary)' }}>{t('workoutBuilder.addExercise')}</h2>
              <div className="w-16" />
            </div>
            {/* Tabs */}
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
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
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
          </div>
        </div>
      )}

      {/* Builder Content */}
      <div className="container max-w-[480px] md:max-w-4xl mx-auto px-4 pt-6 pb-6 md:pb-10">

        {/* Summary bar */}
        <div className="flex items-center gap-3 mb-8 text-[13px]" style={{ color: 'var(--color-text-subtle)' }}>
          <span className="flex items-center gap-1.5">
            <Dumbbell size={13} className="text-[#D4AF37]" />
            {routineExercises.length} {routineExercises.length !== 1 ? t('workoutBuilder.exercises') : t('workoutBuilder.exercise')}
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>·</span>
          <span>{routineExercises.reduce((sum, e) => sum + e.sets, 0)} {t('workoutBuilder.totalSets')}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>·</span>
          <span>~{Math.round(routineExercises.reduce((sum, e) => sum + (e.sets * (e.restSeconds + 45)), 0) / 60)} min</span>
        </div>

        {/* Grouping toolbar */}
        {selectedIndices.size >= 2 && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-2xl bg-[#D4AF37]/10 border border-[#D4AF37]/25">
            <Link2 size={14} className="text-[#D4AF37] shrink-0" />
            <span className="text-[12px] text-[#D4AF37] font-semibold flex-1">{selectedIndices.size} {t('workoutBuilder.selectToGroup')}</span>
            <button
              onClick={() => handleGroup('superset')}
              className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[11px] font-bold active:scale-95 transition-transform"
            >
              {t('workoutBuilder.groupAsSuperset')}
            </button>
            <button
              onClick={() => handleGroup('circuit')}
              className="px-3 py-1.5 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold active:scale-95 transition-transform"
            >
              {t('workoutBuilder.groupAsCircuit')}
            </button>
          </div>
        )}

        {/* Exercise list */}
        {routineExercises.length > 0 ? (
          <div className="flex flex-col gap-4 mb-5">
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
                      isSelected={selectedIndices.has(index)}
                      onToggleSelect={handleToggleSelect}
                      t={t}
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

      {/* Mobile bottom bar — flex-shrink-0 so it stays pinned at the bottom */}
      <div className="md:hidden flex-shrink-0 px-4 pt-3 pb-[calc(0.75rem+var(--safe-area-bottom,env(safe-area-inset-bottom)))] backdrop-blur-xl border-t border-white/[0.06]" style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)' }}>
        <div className="flex gap-3">
          <button
            onClick={() => setShowLibrary(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] font-semibold text-[14px] py-3.5 rounded-2xl active:scale-95 transition-all"
          >
            <Plus size={18} strokeWidth={2.5} /> {t('workoutBuilder.add')}
          </button>
          <button
            onClick={() => handleSave({ andExit: true })}
            disabled={saving}
            className="flex-1 bg-[#D4AF37] disabled:opacity-50 text-black font-bold text-[14px] py-3.5 rounded-2xl active:scale-95 transition-all flex items-center justify-center"
          >
            {saving ? '…' : t('workoutBuilder.saveAndDone')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutBuilder;
