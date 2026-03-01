import React, { useState, useMemo } from 'react';
import { Search, X, ChevronDown, Dumbbell, Info } from 'lucide-react';
import { exercises, MUSCLE_GROUPS, EQUIPMENT } from '../data/exercises';

// Simplified palette — no purple/pink/neon
const MUSCLE_COLORS = {
  Chest:      'text-red-400 bg-red-500/10',
  Back:       'text-blue-400 bg-blue-500/10',
  Shoulders:  'text-[#D4AF37] bg-[#D4AF37]/10',
  Biceps:     'text-amber-400 bg-amber-500/10',
  Triceps:    'text-orange-400 bg-orange-500/10',
  Legs:       'text-emerald-400 bg-emerald-500/10',
  Glutes:     'text-orange-300 bg-orange-500/8',
  Core:       'text-sky-400 bg-sky-500/10',
  Calves:     'text-green-400 bg-green-500/10',
  'Full Body':'text-[#9CA3AF] bg-white/6',
};

const ExerciseCard = ({ exercise, onSelect, selectable }) => {
  const [expanded, setExpanded] = useState(false);
  const colorClass = MUSCLE_COLORS[exercise.muscle] || 'text-[#D4AF37] bg-[#D4AF37]/10';

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/6 overflow-hidden transition-colors hover:border-white/12">
      <div
        className="flex items-center gap-4 px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Icon */}
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
          <Dumbbell size={19} strokeWidth={2} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#E5E7EB] text-[15px] truncate">{exercise.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
              {exercise.muscle}
            </span>
            <span className="text-[11px] text-[#6B7280]">{exercise.equipment}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <ChevronDown
            size={15}
            className={`text-[#6B7280] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {selectable && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(exercise); }}
              className="bg-[#D4AF37] hover:bg-[#E6C766] text-black text-[12px] font-bold px-3.5 py-1.5 rounded-lg transition-colors"
            >
              Add
            </button>
          )}
        </div>
      </div>

      {/* Expanded instructions */}
      {expanded && (
        <div className="px-5 pb-5 pt-1 border-t border-white/5">
          <div className="flex gap-2.5 text-[#9CA3AF] text-[13px] leading-relaxed mt-3">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-[#D4AF37]" />
            <p>{exercise.instructions}</p>
          </div>
          <div className="flex gap-5 mt-4 text-[12px] text-[#6B7280]">
            <span>Default: <span className="text-[#E5E7EB] font-medium">{exercise.defaultSets} sets</span></span>
            <span>Reps: <span className="text-[#E5E7EB] font-medium">{exercise.defaultReps}</span></span>
            <span>Category: <span className="text-[#E5E7EB] font-medium">{exercise.category}</span></span>
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
      const matchesMuscle    = activeMuscle    === 'All' || e.muscle    === activeMuscle;
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
      <div className="relative mb-5">
        <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search exercises…"
          className="w-full bg-[#0B1220] border border-white/8 rounded-xl pl-10 pr-10 py-3 text-[14px] text-[#E5E7EB] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/40 transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Muscle group filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none mb-3">
        {['All', ...MUSCLE_GROUPS].map(m => (
          <button
            key={m}
            onClick={() => setActiveMuscle(m)}
            className={`flex-shrink-0 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition-colors ${
              activeMuscle === m
                ? 'bg-[#D4AF37] text-black'
                : 'bg-white/5 text-[#9CA3AF] hover:bg-white/10 hover:text-[#E5E7EB]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Equipment filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none mb-6">
        {['All', ...EQUIPMENT].map(eq => (
          <button
            key={eq}
            onClick={() => setActiveEquipment(eq)}
            className={`flex-shrink-0 text-[12px] font-medium px-3.5 py-1.5 rounded-full transition-colors ${
              activeEquipment === eq
                ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/30'
                : 'bg-white/4 text-[#6B7280] hover:bg-white/8 hover:text-[#E5E7EB] border border-transparent'
            }`}
          >
            {eq}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-[12px] text-[#6B7280] mb-6">
        {filtered.length} exercise{filtered.length !== 1 ? 's' : ''}
        {query && ` matching "${query}"`}
      </p>

      {/* Exercise groups */}
      <div className="flex flex-col gap-8">
        {Object.entries(grouped).map(([muscle, exs]) => (
          <section key={muscle}>
            {activeMuscle === 'All' && (
              <h3 className="section-label mb-3">{muscle}</h3>
            )}
            <div className="flex flex-col gap-3">
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
          <div className="text-center py-20 text-[#6B7280]">
            <Dumbbell size={40} className="mx-auto mb-4 opacity-20" />
            <p className="text-[15px]">No exercises found</p>
            <p className="text-[13px] mt-1">Try a different search or filter</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Full-page wrapper
export const ExerciseLibraryPage = () => (
  <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">
    <header className="mb-8">
      <h1 className="text-[24px] font-bold text-[#E5E7EB]">Exercise Library</h1>
      <p className="text-[13px] text-[#6B7280] mt-1">{exercises.length} exercises across all muscle groups</p>
    </header>
    <ExerciseLibrary />
  </div>
);

export default ExerciseLibrary;
