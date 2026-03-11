import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, Plus, Trash2, Dumbbell,
  ChevronRight, RotateCcw
} from 'lucide-react';
import ExerciseLibrary from './ExerciseLibrary';
import { getExerciseById } from '../data/exercises';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const REST_OPTIONS = [30, 60, 90, 120, 180, 240];

const ExerciseRow = ({ item, exercise, index, total, onChange, onRemove, onMoveUp, onMoveDown }) => {
  if (!exercise) return null;

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/6 overflow-hidden">
      {/* Top: name + reorder + delete — all 44px touch targets */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#E5E7EB] text-[15px] truncate">{exercise.name}</p>
          <p className="text-[12px] text-[#6B7280] mt-0.5 truncate">{exercise.muscle} · {exercise.equipment}</p>
        </div>
        <div className="flex items-center flex-shrink-0 -mr-1">
          <button
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            className="w-11 h-11 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] disabled:opacity-20 transition-colors active:scale-90"
          >
            <ChevronLeft size={18} className="rotate-90" />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            className="w-11 h-11 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] disabled:opacity-20 transition-colors active:scale-90"
          >
            <ChevronRight size={18} className="rotate-90" />
          </button>
          <button
            onClick={() => onRemove(index)}
            className="w-11 h-11 flex items-center justify-center text-[#4B5563] hover:text-red-400 transition-colors active:scale-90"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Controls: sets / reps / rest */}
      <div className="grid grid-cols-3 border-t border-white/5">
        {/* Sets */}
        <div className="px-3 py-3">
          <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider mb-2">Sets</p>
          <div className="flex items-center justify-between">
            <button
              onClick={() => onChange(index, 'sets', Math.max(1, item.sets - 1))}
              className="w-9 h-9 rounded-xl bg-white/5 text-[#E5E7EB] text-xl flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all leading-none"
            >−</button>
            <span className="text-[#E5E7EB] font-bold text-[18px] tabular-nums">{item.sets}</span>
            <button
              onClick={() => onChange(index, 'sets', Math.min(10, item.sets + 1))}
              className="w-9 h-9 rounded-xl bg-white/5 text-[#E5E7EB] text-xl flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all leading-none"
            >+</button>
          </div>
        </div>

        {/* Reps */}
        <div className="px-3 py-3 border-l border-r border-white/5">
          <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider mb-2">Reps</p>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={item.reps}
            onChange={e => {
              const v = e.target.value;
              if (v === '' || v === '-') return onChange(index, 'reps', v);
              const n = parseInt(v, 10);
              onChange(index, 'reps', (!isNaN(n) && n < 0) ? '0' : v);
            }}
            className="w-full bg-[#111827] border border-white/8 rounded-xl px-2 py-2 text-[#E5E7EB] text-[14px] font-semibold text-center focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
          />
        </div>

        {/* Rest */}
        <div className="px-3 py-3">
          <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider mb-2">Rest</p>
          <select
            value={item.restSeconds}
            onChange={e => onChange(index, 'restSeconds', Number(e.target.value))}
            className="w-full bg-[#111827] border border-white/8 rounded-xl px-1 py-2 text-[#E5E7EB] text-[13px] font-semibold focus:outline-none focus:border-[#D4AF37]/40 transition-colors appearance-none text-center"
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
const PickerList = ({ exercises, selectedIds, onSelect, emptyText }) => {
  if (exercises.length === 0) {
    return (
      <div className="text-center py-16">
        <Dumbbell size={36} className="mx-auto mb-3 opacity-20 text-[#6B7280]" />
        <p className="text-[14px] text-[#6B7280]">{emptyText}</p>
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
            className="bg-[#0F172A] rounded-[14px] border border-white/8 flex items-center gap-4 px-4 py-3.5"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px] text-[#E5E7EB] truncate">{ex.name}</p>
              <p className="text-[12px] text-[#6B7280] mt-0.5 truncate">{ex.muscle} · {ex.equipment}</p>
            </div>
            {added ? (
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                style={{ background: 'rgba(16,185,129,0.1)', color: '#10B981' }}>
                Added
              </span>
            ) : (
              <button
                onClick={() => onSelect(ex)}
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
                style={{ background: 'rgba(212,175,55,0.18)', border: '1.5px solid rgba(212,175,55,0.5)' }}
              >
                <Plus size={18} strokeWidth={2.5} style={{ color: '#D4AF37' }} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

const WorkoutBuilder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [showLibrary, setShowLibrary] = useState(false);
  const [pickerTab, setPickerTab]     = useState('library');

  const [name, setName]                       = useState('New Workout');
  const [routineExercises, setRoutineExercises] = useState([]);
  const [originalExercises, setOriginalExercises] = useState([]);
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
          routine_exercises(id, exercise_id, position, target_sets, target_reps, rest_seconds)
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
      .select('id, name, muscle_group, equipment, category, default_sets, default_reps, rest_seconds, instructions, created_by')
      .eq('gym_id', profile.gym_id)
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) {
          setCustomExs(data.map(r => ({
            id:               r.id,
            name:             r.name,
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
          setFriendIds(new Set(data.map(f =>
            f.requester_id === user.id ? f.addressee_id : f.requester_id
          )));
        }
      });

    supabase
      .from('user_saved_exercises')
      .select('exercise_id')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) setSavedIds(new Set(data.map(r => r.exercise_id)));
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
      { id: exercise.id, sets: exercise.defaultSets, reps: exercise.defaultReps, restSeconds: 90 }
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
        }));
        const { error: insErr } = await supabase
          .from('routine_exercises')
          .insert(rows);
        if (insErr) throw insErr;
      }

      setOriginalExercises([...routineExercises]);

      if (andExit) {
        navigate('/workouts');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      setError(err.message || 'Save failed');
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
               ex.reps !== orig.reps || ex.restSeconds !== orig.restSeconds;
      });

    if (!isDirty) {
      navigate('/workouts');
      return;
    }

    // Save then exit
    await handleSave({ andExit: true });
  };

  const selectedIds = routineExercises.map(e => e.id);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#05070B] z-[90] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#05070B] z-[90] flex flex-col animate-fade-in">

      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3.5 border-b border-white/6 flex items-center gap-3 bg-[#05070B]/90 backdrop-blur-2xl">
        <button
          onClick={handleBack}
          disabled={saving}
          className="text-[#D4AF37] hover:text-[#E6C766] transition-colors flex items-center -ml-1 disabled:opacity-50 flex-shrink-0"
        >
          <ChevronLeft size={26} strokeWidth={2.5} />
          <span className="text-[16px] font-semibold -ml-0.5">Workouts</span>
        </button>

        <div className="flex-1 text-center">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="bg-transparent text-[#E5E7EB] font-semibold text-[16px] text-center focus:outline-none w-full max-w-[200px] border-b border-transparent focus:border-[#D4AF37]/30 transition-colors"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={`font-bold text-[14px] px-4 py-1.5 rounded-full transition-all disabled:opacity-50 flex-shrink-0 ${
            saved
              ? 'bg-[#10B981] text-white'
              : 'bg-[#D4AF37] hover:bg-[#E6C766] text-black'
          }`}
        >
          {saving ? '…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

      {error && (
        <div className="mx-auto max-w-2xl px-4 mt-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-[13px] text-red-400">
            {error}
          </div>
        </div>
      )}

      {/* Exercise Library Slide-in */}
      {showLibrary && (
        <div className="fixed inset-0 z-[95] bg-[#05070B] flex flex-col animate-fade-in">
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-white/6 bg-[#05070B]/90 backdrop-blur-2xl">
            <div className="px-4 py-3.5 flex items-center gap-3">
              <button
                onClick={() => setShowLibrary(false)}
                className="text-[#D4AF37] hover:text-[#E6C766] flex items-center gap-0.5 transition-colors"
              >
                <ChevronLeft size={24} strokeWidth={2.5} />
                <span className="font-semibold text-[16px]">Back</span>
              </button>
              <h2 className="flex-1 text-center font-semibold text-[16px] text-[#E5E7EB]">Add Exercise</h2>
              <div className="w-16" />
            </div>
            {/* Tabs */}
            <div className="flex px-4 gap-5">
              {[
                { key: 'library', label: 'Library' },
                { key: 'mine',    label: `Mine${myExs.length ? ` (${myExs.length})` : ''}` },
                { key: 'friends', label: `Friends${friendExs.length ? ` (${friendExs.length})` : ''}` },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setPickerTab(key)}
                  className={`pb-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                    pickerTab === key
                      ? 'border-[#D4AF37] text-[#D4AF37]'
                      : 'border-transparent text-[#6B7280] hover:text-[#9CA3AF]'
                  }`}
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
                emptyText="You haven't created any exercises yet. Go to the Exercise Library to add one."
              />
            )}
            {pickerTab === 'friends' && (
              <PickerList
                exercises={friendExs}
                selectedIds={selectedIds}
                onSelect={handleAdd}
                emptyText="No exercises from friends yet."
              />
            )}
          </div>
        </div>
      )}

      {/* Builder Content */}
      <div className="container max-w-2xl mx-auto px-4 pt-6 pb-6 md:pb-10">

        {/* Summary bar */}
        <div className="flex items-center gap-3 mb-8 text-[13px] text-[#6B7280]">
          <span className="flex items-center gap-1.5">
            <Dumbbell size={13} className="text-[#D4AF37]" />
            {routineExercises.length} exercise{routineExercises.length !== 1 ? 's' : ''}
          </span>
          <span className="text-[#4B5563]">·</span>
          <span>{routineExercises.reduce((sum, e) => sum + e.sets, 0)} total sets</span>
          <span className="text-[#4B5563]">·</span>
          <span>~{Math.round(routineExercises.reduce((sum, e) => sum + (e.sets * (e.restSeconds + 45)), 0) / 60)} min</span>
        </div>

        {/* Exercise list */}
        {routineExercises.length > 0 ? (
          <div className="flex flex-col gap-4 mb-5">
            {routineExercises.map((item, index) => (
              <ExerciseRow
                key={`${item.id}-${index}`}
                item={item}
                exercise={findExercise(item.id)}
                index={index}
                total={routineExercises.length}
                onChange={handleChange}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-14 text-[#6B7280] mb-5">
            <Dumbbell size={44} className="mx-auto mb-4 opacity-15" />
            <p className="text-[16px] font-medium text-[#9CA3AF]">No exercises yet</p>
            <p className="text-[13px] mt-1">Add exercises from the library below</p>
          </div>
        )}

        {/* Add Exercise button — desktop only; mobile uses sticky bar */}
        <button
          onClick={() => setShowLibrary(true)}
          className="hidden md:flex w-full items-center justify-center gap-2 bg-[#D4AF37]/10 hover:bg-[#D4AF37]/18 border border-[#D4AF37]/25 hover:border-[#D4AF37]/45 text-[#D4AF37] font-semibold text-[14px] py-4 rounded-[14px] transition-all"
        >
          <Plus size={19} strokeWidth={2.5} /> Add Exercise
        </button>

        {/* Mobile: prominent add button when empty */}
        {routineExercises.length === 0 && (
          <button
            onClick={() => setShowLibrary(true)}
            className="md:hidden w-full flex items-center justify-center gap-2 bg-[#D4AF37]/10 border border-[#D4AF37]/25 text-[#D4AF37] font-semibold text-[14px] py-4 rounded-[14px] transition-all active:scale-95"
          >
            <Plus size={19} strokeWidth={2.5} /> Add Exercise
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
            className="hidden md:flex w-full mt-4 bg-[#D4AF37] hover:bg-[#E6C766] disabled:opacity-50 text-black font-bold text-[16px] py-4 rounded-[14px] transition-all items-center justify-center gap-2"
          >
            {saving ? '…' : 'Save & Done'}
          </button>
        )}

        {/* Reset hint */}
        {routineExercises.length > 0 && (
          <button
            onClick={() => setRoutineExercises(originalExercises.map(e => ({ ...e })))}
            className="w-full flex items-center justify-center gap-2 text-[#4B5563] hover:text-[#9CA3AF] text-[12px] mt-3 py-2 transition-colors"
          >
            <RotateCcw size={12} /> Reset to saved
          </button>
        )}
      </div>

      </div>{/* end scrollable body */}

      {/* Mobile bottom bar — flex-shrink-0 so it stays pinned at the bottom */}
      <div className="md:hidden flex-shrink-0 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-[#05070B]/95 backdrop-blur-xl border-t border-white/6">
        <div className="flex gap-3">
          <button
            onClick={() => setShowLibrary(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] font-semibold text-[14px] py-3.5 rounded-[14px] active:scale-95 transition-all"
          >
            <Plus size={18} strokeWidth={2.5} /> Add
          </button>
          <button
            onClick={() => handleSave({ andExit: true })}
            disabled={saving}
            className="flex-1 bg-[#D4AF37] disabled:opacity-50 text-black font-bold text-[15px] py-3.5 rounded-[14px] active:scale-95 transition-all flex items-center justify-center"
          >
            {saving ? '…' : 'Save & Done'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorkoutBuilder;
