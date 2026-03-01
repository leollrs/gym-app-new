import React, { useState, useMemo } from 'react';
import { Search, X, ChevronDown, Dumbbell, Info } from 'lucide-react';
import { exercises, MUSCLE_GROUPS, EQUIPMENT } from '../data/exercises';

const MUSCLE_COLORS = {
  Chest: 'text-rose-400 bg-rose-500/10',
  Back: 'text-blue-400 bg-blue-500/10',
  Shoulders: 'text-violet-400 bg-violet-500/10',
  Biceps: 'text-amber-400 bg-amber-500/10',
  Triceps: 'text-orange-400 bg-orange-500/10',
  Legs: 'text-emerald-400 bg-emerald-500/10',
  Glutes: 'text-pink-400 bg-pink-500/10',
  Core: 'text-cyan-400 bg-cyan-500/10',
  Calves: 'text-lime-400 bg-lime-500/10',
  'Full Body': 'text-slate-400 bg-slate-500/10',
};

const ExerciseCard = ({ exercise, onSelect, selectable }) => {
  const [expanded, setExpanded] = useState(false);
  const colorClass = MUSCLE_COLORS[exercise.muscle] || 'text-blue-400 bg-blue-500/10';

  return (
    <div className="bg-[#131929] backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden transition-all duration-200 hover:border-white/10">
      <div
        className="flex items-center gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Icon */}
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
          <Dumbbell size={20} strokeWidth={2} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-[15px] truncate">{exercise.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
              {exercise.muscle}
            </span>
            <span className="text-[11px] text-slate-500">{exercise.equipment}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <ChevronDown
            size={16}
            className={`text-slate-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {selectable && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
              className="bg-blue-500 hover:bg-blue-400 text-white text-[13px] font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Add
            </button>
          )}
        </div>
      </div>

      {/* Expanded Instructions */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/5">
          <div className="flex gap-2 text-slate-400 text-[13px] leading-relaxed">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-blue-400" />
            <p>{exercise.instructions}</p>
          </div>
          <div className="flex gap-4 mt-3 text-[12px] text-slate-500">
            <span>Default: <span className="text-slate-300 font-medium">{exercise.defaultSets} sets</span></span>
            <span>Reps: <span className="text-slate-300 font-medium">{exercise.defaultReps}</span></span>
            <span>Category: <span className="text-slate-300 font-medium">{exercise.category}</span></span>
          </div>
        </div>
      )}
    </div>
  );
};

const ExerciseLibrary = ({ onSelect, selectable = false, selectedIds = [] }) => {
  const [query, setQuery] = useState('');
  const [activeMuscle, setActiveMuscle] = useState('All');
  const [activeEquipment, setActiveEquipment] = useState('All');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return exercises.filter(e => {
      const matchesQuery = !q ||
        e.name.toLowerCase().includes(q) ||
        e.muscle.toLowerCase().includes(q) ||
        e.equipment.toLowerCase().includes(q);
      const matchesMuscle = activeMuscle === 'All' || e.muscle === activeMuscle;
      const matchesEquipment = activeEquipment === 'All' || e.equipment === activeEquipment;
      return matchesQuery && matchesMuscle && matchesEquipment;
    });
  }, [query, activeMuscle, activeEquipment]);

  const grouped = useMemo(() => {
    if (activeMuscle !== 'All') return { [activeMuscle]: filtered };
    return filtered.reduce((acc, ex) => {
      if (!acc[ex.muscle]) acc[ex.muscle] = [];
      acc[ex.muscle].push(ex);
      return acc;
    }, {});
  }, [filtered, activeMuscle]);

  return (
    <div className="animate-fade-in">
      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full bg-[#0e1420] border border-white/8 rounded-xl pl-9 pr-9 py-2.5 text-[15px] text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-colors"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Muscle group filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none mb-3">
        {['All', ...MUSCLE_GROUPS].map(m => (
          <button
            key={m}
            onClick={() => setActiveMuscle(m)}
            className={`flex-shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
              activeMuscle === m
                ? 'bg-blue-500 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Equipment filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none mb-4">
        {['All', ...EQUIPMENT].map(eq => (
          <button
            key={eq}
            onClick={() => setActiveEquipment(eq)}
            className={`flex-shrink-0 text-[12px] font-medium px-3 py-1 rounded-full transition-colors ${
              activeEquipment === eq
                ? 'bg-violet-500/80 text-white'
                : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-white'
            }`}
          >
            {eq}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-[12px] text-slate-500 mb-4">
        {filtered.length} exercise{filtered.length !== 1 ? 's' : ''}
        {query && ` for "${query}"`}
      </p>

      {/* Exercise groups */}
      <div className="flex flex-col gap-6">
        {Object.entries(grouped).map(([muscle, exs]) => (
          <section key={muscle}>
            {activeMuscle === 'All' && (
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2 px-1">
                {muscle}
              </h3>
            )}
            <div className="flex flex-col gap-2">
              {exs.map(ex => (
                <ExerciseCard
                  key={ex.id}
                  exercise={ex}
                  selectable={selectable && !selectedIds.includes(ex.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <Dumbbell size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-[15px]">No exercises found</p>
            <p className="text-[13px] mt-1">Try a different search or filter</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Full-page wrapper (used when navigating to /exercises)
export const ExerciseLibraryPage = () => (
  <div className="container main-content pb-24 md:pb-8">
    <header className="mb-6">
      <h1 className="text-h2 font-bold mb-1">Exercise Library</h1>
      <p className="text-muted text-small">{exercises.length} exercises across all muscle groups</p>
    </header>
    <ExerciseLibrary />
  </div>
);

export default ExerciseLibrary;
