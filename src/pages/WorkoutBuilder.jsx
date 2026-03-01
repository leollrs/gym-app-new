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
    <div className="bg-[#0F172A] rounded-[14px] border border-white/6 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button className="text-[#4B5563] touch-none cursor-grab active:cursor-grabbing hover:text-[#9CA3AF] transition-colors">
          <GripVertical size={17} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#E5E7EB] text-[15px] truncate">{ex.name}</p>
          <p className="text-[12px] text-[#6B7280]">{ex.muscle} · {ex.equipment}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onMoveUp(index)}
            disabled={index === 0}
            className="w-7 h-7 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={15} className="rotate-90" />
          </button>
          <button
            onClick={() => onMoveDown(index)}
            disabled={index === total - 1}
            className="w-7 h-7 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={15} className="rotate-90" />
          </button>
          <button
            onClick={() => onRemove(index)}
            className="w-7 h-7 flex items-center justify-center text-[#4B5563] hover:text-red-400 transition-colors ml-1"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Config row */}
      <div className="flex items-center gap-3 px-4 pb-3.5 border-t border-white/5 pt-3">
        {/* Sets */}
        <div className="flex-1">
          <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider mb-1.5">Sets</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange(index, 'sets', Math.max(1, item.sets - 1))}
              className="w-7 h-7 rounded-lg bg-white/5 text-[#E5E7EB] text-lg flex items-center justify-center hover:bg-white/10 transition-colors leading-none"
            >−</button>
            <span className="text-[#E5E7EB] font-bold text-[17px] w-6 text-center tabular-nums">{item.sets}</span>
            <button
              onClick={() => onChange(index, 'sets', Math.min(10, item.sets + 1))}
              className="w-7 h-7 rounded-lg bg-white/5 text-[#E5E7EB] text-lg flex items-center justify-center hover:bg-white/10 transition-colors leading-none"
            >+</button>
          </div>
        </div>

        {/* Reps */}
        <div className="flex-1">
          <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider mb-1.5">Reps</p>
          <input
            type="text"
            value={item.reps}
            onChange={e => onChange(index, 'reps', e.target.value)}
            className="w-full bg-[#111827] border border-white/8 rounded-lg px-2 py-1.5 text-[#E5E7EB] text-[14px] font-semibold text-center focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
          />
        </div>

        {/* Rest */}
        <div className="flex-1">
          <p className="text-[10px] text-[#6B7280] uppercase font-bold tracking-wider mb-1.5">Rest</p>
          <select
            value={item.restSeconds}
            onChange={e => onChange(index, 'restSeconds', Number(e.target.value))}
            className="w-full bg-[#111827] border border-white/8 rounded-lg px-2 py-1.5 text-[#E5E7EB] text-[13px] font-semibold focus:outline-none focus:border-[#D4AF37]/40 transition-colors appearance-none text-center"
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

const WorkoutBuilder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showLibrary, setShowLibrary] = useState(false);

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

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectedIds = routineExercises.map(e => e.id);

  return (
    <div className="fixed inset-0 bg-[#05070B] z-[90] overflow-y-auto pb-32 animate-fade-in">

      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-3.5 border-b border-white/6 flex items-center gap-3 bg-[#05070B]/90 backdrop-blur-2xl">
        <button
          onClick={() => navigate(-1)}
          className="text-[#D4AF37] hover:text-[#E6C766] transition-colors flex items-center -ml-1"
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
          className={`font-bold text-[14px] px-4 py-1.5 rounded-full transition-all ${
            saved
              ? 'bg-[#10B981] text-white'
              : 'bg-[#D4AF37] hover:bg-[#E6C766] text-black'
          }`}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </header>

      {/* Exercise Library Slide-in */}
      {showLibrary && (
        <div className="fixed inset-0 z-[95] bg-[#05070B] flex flex-col animate-fade-in">
          <div className="sticky top-0 z-10 px-4 py-3.5 border-b border-white/6 flex items-center gap-3 bg-[#05070B]/90 backdrop-blur-2xl">
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

        {/* Add Exercise button */}
        <button
          onClick={() => setShowLibrary(true)}
          className="w-full flex items-center justify-center gap-2 bg-[#D4AF37]/10 hover:bg-[#D4AF37]/18 border border-[#D4AF37]/25 hover:border-[#D4AF37]/45 text-[#D4AF37] font-semibold text-[14px] py-4 rounded-[14px] transition-all"
        >
          <Plus size={19} strokeWidth={2.5} /> Add Exercise
        </button>

        {/* Reset hint */}
        {routineExercises.length > 0 && (
          <button
            onClick={() => setRoutineExercises(raw.exercises.map(e => ({ ...e })))}
            className="w-full flex items-center justify-center gap-2 text-[#4B5563] hover:text-[#9CA3AF] text-[12px] mt-3 py-2 transition-colors"
          >
            <RotateCcw size={12} /> Reset to original
          </button>
        )}
      </div>
    </div>
  );
};

export default WorkoutBuilder;
