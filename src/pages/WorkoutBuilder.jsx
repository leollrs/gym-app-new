import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, Plus, GripVertical, Trash2, Dumbbell,
  ChevronRight, RotateCcw
} from 'lucide-react';
import ExerciseLibrary from './ExerciseLibrary';
import { getExerciseById } from '../data/exercises';

// Mock routine data — in production this would come from Supabase
const MOCK_ROUTINES = {
  cw1: {
    id: 'cw1',
    name: 'Push Day (Hypertrophy)',
    exercises: [
      { id: 'ex_bp',   sets: 4, reps: '8-10', restSeconds: 120 },
      { id: 'ex_idbp', sets: 3, reps: '10-12', restSeconds: 90  },
      { id: 'ex_tpd',  sets: 4, reps: '12-15', restSeconds: 60  },
    ]
  },
  cw2: {
    id: 'cw2',
    name: 'Pull & Abs',
    exercises: [
      { id: 'ex_dl',  sets: 4, reps: '3-5',   restSeconds: 180 },
      { id: 'ex_bbr', sets: 4, reps: '6-8',   restSeconds: 120 },
      { id: 'ex_lp',  sets: 3, reps: '10-12', restSeconds: 90  },
      { id: 'ex_llr', sets: 3, reps: '12-15', restSeconds: 60  },
    ]
  },
  cw3: {
    id: 'cw3',
    name: 'Leg Day Annihilation',
    exercises: [
      { id: 'ex_sq',   sets: 5, reps: '5',     restSeconds: 180 },
      { id: 'ex_lp_l', sets: 4, reps: '10-12', restSeconds: 120 },
      { id: 'ex_lc',   sets: 3, reps: '12-15', restSeconds: 90  },
      { id: 'ex_hth',  sets: 4, reps: '8-12',  restSeconds: 90  },
      { id: 'ex_scr',  sets: 4, reps: '15-20', restSeconds: 60  },
    ]
  }
};

const REST_OPTIONS = [30, 60, 90, 120, 180, 240];

const ExerciseRow = ({ item, index, total, onChange, onRemove, onMoveUp, onMoveDown }) => {
  const ex = getExerciseById(item.id);
  if (!ex) return null;

  return (
    <div className="bg-[#1C1C1E]/80 rounded-2xl border border-white/5 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button className="text-slate-600 touch-none cursor-grab active:cursor-grabbing">
          <GripVertical size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-[15px] truncate">{ex.name}</p>
          <p className="text-[12px] text-slate-500">{ex.muscle} · {ex.equipment}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={16} className="rotate-90" />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={16} className="rotate-90" />
          </button>
          <button
            onClick={() => onRemove(index)}
            className="w-7 h-7 flex items-center justify-center text-slate-600 hover:text-red-400 transition-colors ml-1"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Config row */}
      <div className="flex items-center gap-3 px-4 pb-3 border-t border-white/5 pt-3">
        {/* Sets */}
        <div className="flex-1">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Sets</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange(index, 'sets', Math.max(1, item.sets - 1))}
              className="w-7 h-7 rounded-lg bg-white/5 text-white text-lg flex items-center justify-center hover:bg-white/10 transition-colors leading-none pb-0.5"
            >−</button>
            <span className="text-white font-bold text-[17px] w-6 text-center tabular-nums">{item.sets}</span>
            <button
              onClick={() => onChange(index, 'sets', Math.min(10, item.sets + 1))}
              className="w-7 h-7 rounded-lg bg-white/5 text-white text-lg flex items-center justify-center hover:bg-white/10 transition-colors leading-none pb-0.5"
            >+</button>
          </div>
        </div>

        {/* Reps */}
        <div className="flex-1">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Reps</p>
          <input
            type="text"
            value={item.reps}
            onChange={e => onChange(index, 'reps', e.target.value)}
            className="w-full bg-[#2C2C2E] border border-white/8 rounded-lg px-2 py-1.5 text-white text-[14px] font-semibold text-center focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>

        {/* Rest */}
        <div className="flex-1">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Rest</p>
          <select
            value={item.restSeconds}
            onChange={e => onChange(index, 'restSeconds', Number(e.target.value))}
            className="w-full bg-[#2C2C2E] border border-white/8 rounded-lg px-2 py-1.5 text-white text-[13px] font-semibold focus:outline-none focus:border-blue-500/50 transition-colors appearance-none text-center"
          >
            {REST_OPTIONS.map(s => (
              <option key={s} value={s}>{s < 60 ? `${s}s` : `${s / 60}m`}{s === 90 ? '' : ''}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

const WorkoutBuilder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showLibrary, setShowLibrary] = useState(false);

  // Load routine (mock — would be from Supabase)
  const raw = MOCK_ROUTINES[id] || { id, name: 'New Workout', exercises: [] };
  const [name, setName] = useState(raw.name);
  const [routineExercises, setRoutineExercises] = useState(
    raw.exercises.map(e => ({ ...e }))
  );
  const [saved, setSaved] = useState(false);

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

  const handleRemove = (index) => {
    setRoutineExercises(prev => prev.filter((_, i) => i !== index));
  };

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

  const handleSave = () => {
    // In production: upsert to Supabase
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedIds = routineExercises.map(e => e.id);

  return (
    <div className="fixed inset-0 bg-[#0A0D14] z-[90] overflow-y-auto pb-32 animate-fade-in">
      {/* Ambient glow */}
      <div className="fixed top-0 inset-x-0 h-48 bg-gradient-to-b from-violet-900/15 to-transparent pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-4 border-b border-white/5 flex items-center gap-3 bg-[#0A0D14]/80 backdrop-blur-2xl">
        <button
          onClick={() => navigate(-1)}
          className="text-blue-500 hover:text-blue-400 transition-colors flex items-center p-1 -ml-1"
        >
          <ChevronLeft size={28} strokeWidth={2.5} />
          <span className="text-[17px] font-semibold -ml-1">Workouts</span>
        </button>

        <div className="flex-1 text-center">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="bg-transparent text-white font-semibold text-[17px] text-center focus:outline-none w-full max-w-[200px] border-b border-transparent focus:border-white/20 transition-colors"
          />
        </div>

        <button
          onClick={handleSave}
          className={`font-semibold text-[15px] px-4 py-1.5 rounded-full transition-all ${
            saved
              ? 'bg-emerald-500 text-white'
              : 'bg-blue-500 hover:bg-blue-400 text-white'
          }`}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </header>

      {/* Exercise Library Slide-in */}
      {showLibrary && (
        <div className="fixed inset-0 z-[95] bg-[#0A0D14] flex flex-col animate-fade-in">
          <div className="sticky top-0 z-10 px-4 py-4 border-b border-white/5 flex items-center gap-3 bg-[#0A0D14]/90 backdrop-blur-2xl">
            <button
              onClick={() => setShowLibrary(false)}
              className="text-blue-500 flex items-center gap-1"
            >
              <ChevronLeft size={24} strokeWidth={2.5} />
              <span className="font-semibold text-[17px]">Back</span>
            </button>
            <h2 className="flex-1 text-center font-semibold text-[17px] text-white">Add Exercise</h2>
            <div className="w-16" />
          </div>
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
            <ExerciseLibrary
              selectable
              selectedIds={selectedIds}
              onSelect={handleAdd}
            />
          </div>
        </div>
      )}

      {/* Builder Content */}
      <div className="container max-w-2xl mx-auto px-4 pt-6">
        {/* Summary bar */}
        <div className="flex items-center gap-4 mb-6 text-[13px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Dumbbell size={14} className="text-blue-400" />
            {routineExercises.length} exercise{routineExercises.length !== 1 ? 's' : ''}
          </span>
          <span>·</span>
          <span>{routineExercises.reduce((sum, e) => sum + e.sets, 0)} total sets</span>
          <span>·</span>
          <span>~{Math.round(routineExercises.reduce((sum, e) => sum + (e.sets * (e.restSeconds + 45)), 0) / 60)} min</span>
        </div>

        {/* Exercise list */}
        {routineExercises.length > 0 ? (
          <div className="flex flex-col gap-3 mb-6">
            {routineExercises.map((item, index) => (
              <ExerciseRow
                key={`${item.id}-${index}`}
                item={item}
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
          <div className="text-center py-16 text-slate-500 mb-6">
            <Dumbbell size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-[17px] font-medium text-slate-400">No exercises yet</p>
            <p className="text-[13px] mt-1">Add exercises from the library below</p>
          </div>
        )}

        {/* Add Exercise button */}
        <button
          onClick={() => setShowLibrary(true)}
          className="w-full flex items-center justify-center gap-2 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 hover:border-blue-500/50 text-blue-400 font-semibold text-[15px] py-4 rounded-2xl transition-all"
        >
          <Plus size={20} strokeWidth={2.5} /> Add Exercise
        </button>

        {/* Reset hint */}
        {routineExercises.length > 0 && (
          <button
            onClick={() => setRoutineExercises(raw.exercises.map(e => ({ ...e })))}
            className="w-full flex items-center justify-center gap-2 text-slate-600 hover:text-slate-400 text-[13px] mt-4 py-2 transition-colors"
          >
            <RotateCcw size={13} /> Reset to original
          </button>
        )}
      </div>
    </div>
  );
};

export default WorkoutBuilder;
