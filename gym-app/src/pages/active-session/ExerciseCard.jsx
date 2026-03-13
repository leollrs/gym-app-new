import React from 'react';
import { CheckCircle, Trophy, Plus, TrendingUp, MessageSquare, Activity } from 'lucide-react';
import BodyDiagram from '../../components/BodyDiagram';
import PlateCalculator from './PlateCalculator';

const ExerciseCard = ({
  exercise,
  currentSets,
  knownPR,
  showPlateCalc,
  onTogglePlateCalc,
  showHeatmap,
  onToggleHeatmap,
  workedRegions,
  completedSetsCount,
  expandedNotesSet,
  onSetExpandedNotesSet,
  showProgressChart,
  onShowProgressChart,
  // handlers
  onUpdateSet,
  onToggleComplete,
  onAddSet,
  onRemoveSet,
  onDuplicateLastSet,
  onFillSuggestion,
  // helpers
  isPRCheck,
  livePRs,
  touchStartXRef,
}) => {
  if (!exercise) return null;

  return (
    <div className="px-4 pt-5 pb-6">
      <div className="rounded-2xl bg-white dark:bg-slate-800 border border-black/5 dark:border-white/10 shadow-sm px-4 py-4 md:px-5 md:py-5">

        {/* Exercise header */}
        <div className="mb-5">
          <h2 className="font-bold tracking-tight leading-tight flex items-center gap-2.5 text-[#0F172A] dark:text-slate-100" style={{ fontSize: 'clamp(20px,5vw,26px)' }}>
            <button
              onClick={() => onShowProgressChart({ exerciseId: exercise.id, exerciseName: exercise.name })}
              className="text-left hover:opacity-80 active:opacity-60 transition-opacity"
            >
              {exercise.name}
            </button>
            <TrendingUp
              size={15}
              className="text-slate-300 dark:text-slate-600 flex-shrink-0 cursor-pointer hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
              onClick={() => onShowProgressChart({ exerciseId: exercise.id, exerciseName: exercise.name })}
            />
            {currentSets.some(s => s.isPR) && (
              <Trophy size={18} className="text-amber-500 dark:text-amber-400 flex-shrink-0" />
            )}
          </h2>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <p className="text-[13px] text-[#64748B] dark:text-slate-400">
              Target: {exercise.targetSets} × {exercise.targetReps} reps
            </p>
            {knownPR && (
              <p className="text-[12px] flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Trophy size={11} /> PR: {knownPR.weight} lbs × {knownPR.reps}
              </p>
            )}
          </div>
        </div>

        {/* Overload suggestion chip */}
        {exercise.suggestion && (() => {
          const s = exercise.suggestion;
          if (s.note === 'first_time') return (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-4 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700/50">
              <TrendingUp size={13} className="text-indigo-500 dark:text-indigo-400 flex-shrink-0" />
              <p className="text-[12px] text-indigo-700 dark:text-indigo-300">
                First time here. Find your working weight — go light.
              </p>
            </div>
          );
          return (
            <div className="mb-4">
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 cursor-pointer"
                onClick={() => onTogglePlateCalc()}
              >
                <TrendingUp size={14} className="text-amber-700 dark:text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider leading-none mb-0.5 text-amber-700 dark:text-amber-400">
                    {s.note === 'increase_weight' ? 'Increase weight \u2191' : 'Add reps \u2192'}
                  </p>
                  <p className="text-[14px] font-bold leading-tight text-[#0F172A] dark:text-slate-100">
                    {s.suggestedWeight} lbs × {s.suggestedReps} reps
                  </p>
                  <p className="text-[11px] mt-0.5 text-[#64748B] dark:text-slate-400">{s.label}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onFillSuggestion(exercise.id, s); }}
                  className="text-[12px] font-bold px-3 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-all bg-amber-100 dark:bg-amber-800/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-600"
                >
                  Fill
                </button>
              </div>
              {showPlateCalc && <PlateCalculator targetWeight={s.suggestedWeight} />}
            </div>
          );
        })()}

        {/* Muscles heatmap toggle + panel */}
        {completedSetsCount > 0 && (
          <div className="mb-4">
            <button
              onClick={() => onToggleHeatmap()}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all mb-2 ${
                showHeatmap
                  ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-600/60'
                  : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-transparent'
              }`}
            >
              <Activity size={11} />
              Muscles
            </button>
            {showHeatmap && (
              <BodyDiagram
                primaryRegions={workedRegions.primary}
                secondaryRegions={workedRegions.secondary}
                title="Muscles worked this session"
                compact
              />
            )}
          </div>
        )}

        {/* Column headers */}
        <div className="flex items-center gap-2 px-2 py-2 mb-2 text-[11px] font-semibold uppercase tracking-wider rounded-xl bg-slate-100 dark:bg-slate-700/80 text-[#64748B] dark:text-slate-400">
          <div className="w-8 text-center">Set</div>
          <div className="flex-1 min-w-[60px]">Previous</div>
          <div className="w-20 sm:w-24 text-center">lbs</div>
          <div className="w-16 sm:w-20 text-center">Reps</div>
          <div className="w-10 flex justify-center">
            <CheckCircle size={13} strokeWidth={2.5} />
          </div>
        </div>

        {/* Set rows */}
        <div className="flex flex-col gap-2">
          {currentSets.map((set, setIndex) => {
            const prev      = exercise.history[setIndex];
            const prPending = !set.completed && isPRCheck(
              exercise.id, set.weight, set.reps, livePRs
            );
            const notesKey = `${exercise.id}-${setIndex}`;

            return (
              <div key={setIndex}>
                {/* Main set row */}
                <div
                  className={`flex items-center gap-2 px-2 py-2.5 rounded-2xl transition-all duration-300 ${
                    set.isPR
                      ? 'bg-amber-100/80 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-600/60'
                      : set.completed
                      ? 'bg-emerald-100/80 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-700/60'
                      : 'bg-white dark:bg-slate-700/50 border border-slate-200 dark:border-white/10'
                  }`}
                  onTouchStart={e => {
                    if (e.touches?.[0]) touchStartXRef.current = e.touches[0].clientX;
                  }}
                  onTouchEnd={e => {
                    const endX = e.changedTouches?.[0]?.clientX ?? 0;
                    const deltaX = endX - touchStartXRef.current;
                    if (Math.abs(deltaX) > 40) {
                      onToggleComplete(
                        exercise.id,
                        setIndex,
                        exercise.name,
                        exercise.restSeconds
                      );
                    }
                  }}
                >
                  <div className="w-8 flex flex-col items-center justify-center gap-0.5">
                    <span className="font-bold text-[15px] text-[#64748B] dark:text-slate-400">
                      {set.isPR
                        ? <Trophy size={14} className="text-amber-500 mx-auto" />
                        : setIndex + 1
                      }
                    </span>
                    {!set.completed && currentSets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveSet(exercise.id, setIndex)}
                        className="text-[9px] font-bold text-red-400/70 hover:text-red-400 transition-colors leading-none"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Previous — gold arrow, visually distinct */}
                  <div className="flex-1 min-w-[60px] text-[12px] font-semibold truncate">
                    {prev ? (
                      <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                        ↑ {prev.weight}
                        <span className="opacity-50 text-[10px] mx-0.5">×</span>
                        {prev.reps}
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">—</span>
                    )}
                  </div>

                  <div className="w-20 sm:w-24">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={set.weight}
                      onChange={e => onUpdateSet(exercise.id, setIndex, 'weight', e.target.value)}
                      placeholder="—"
                      disabled={set.completed}
                      className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${
                        set.isPR
                          ? 'text-amber-700 dark:text-amber-400 bg-transparent'
                          : set.completed
                          ? 'text-emerald-700 dark:text-emerald-400 bg-transparent'
                          : 'text-[#0F172A] dark:text-slate-100 bg-slate-50 dark:bg-slate-600/50'
                      }`}
                    />
                  </div>

                  <div className="w-16 sm:w-20">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={set.reps}
                      onChange={e => onUpdateSet(exercise.id, setIndex, 'reps', e.target.value)}
                      placeholder="—"
                      disabled={set.completed}
                      className={`w-full text-center rounded-xl py-2 px-1 font-semibold text-[17px] focus:outline-none transition-colors ${
                        set.isPR
                          ? 'text-amber-700 dark:text-amber-400 bg-transparent'
                          : set.completed
                          ? 'text-emerald-700 dark:text-emerald-400 bg-transparent'
                          : 'text-[#0F172A] dark:text-slate-100 bg-slate-50 dark:bg-slate-600/50'
                      }`}
                    />
                  </div>

                  <div className="w-10 flex flex-col items-center gap-0.5">
                    <button
                      onClick={() => onToggleComplete(
                        exercise.id, setIndex,
                        exercise.name, exercise.restSeconds
                      )}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                        set.isPR
                          ? 'bg-amber-500 dark:bg-amber-500 text-white scale-110 shadow-lg shadow-amber-500/40'
                          : set.completed
                          ? 'bg-emerald-500 dark:bg-emerald-500 text-white scale-[1.08] shadow-lg shadow-emerald-500/40'
                          : prPending
                          ? 'bg-amber-100 dark:bg-amber-900/50 border-2 border-amber-500 dark:border-amber-400 text-amber-700 dark:text-amber-400'
                          : 'bg-slate-50 dark:bg-slate-600/50 border border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {set.completed
                        ? <CheckCircle size={18} strokeWidth={3} />
                        : <div className="w-3.5 h-3.5 rounded-sm border-2 border-slate-400 dark:border-slate-500 opacity-50" />
                      }
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onDuplicateLastSet(
                          exercise.id,
                          setIndex,
                          exercise.history
                        )
                      }
                      className="mt-0.5 text-[9px] font-semibold text-indigo-600 dark:text-indigo-300 disabled:opacity-40"
                      disabled={set.completed}
                    >
                      Use last
                    </button>
                    {prPending && (
                      <span className="text-[9px] font-bold uppercase tracking-wide leading-none text-amber-600 dark:text-amber-400">
                        PR!
                      </span>
                    )}
                  </div>
                </div>

                {/* RPE + Notes sub-row — appears after completing a set */}
                {set.completed && (
                  <div className="flex items-center gap-2 px-2 pt-1 pb-0.5">
                    {/* RPE picker */}
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-wider w-7 shrink-0">RPE</span>
                      <div className="flex gap-0.5">
                        {[6, 7, 8, 9, 10].map(v => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => onUpdateSet(exercise.id, setIndex, 'rpe', set.rpe === v ? null : v)}
                            className={`w-7 h-7 rounded-full text-[11px] font-bold transition-all active:scale-90 ${
                              set.rpe === v
                                ? 'bg-emerald-500 text-white shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-700/80 text-slate-500 dark:text-slate-300'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Notes toggle */}
                    <button
                      type="button"
                      onClick={() => onSetExpandedNotesSet(expandedNotesSet === notesKey ? null : notesKey)}
                      className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg transition-all ${
                        set.notes
                          ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      <MessageSquare size={10} />
                      {set.notes ? 'Note' : '+ Note'}
                    </button>
                  </div>
                )}

                {/* Notes input — expands inline */}
                {expandedNotesSet === notesKey && (
                  <div className="px-2 pb-1.5">
                    <input
                      type="text"
                      value={set.notes || ''}
                      onChange={e => onUpdateSet(exercise.id, setIndex, 'notes', e.target.value)}
                      placeholder="Add a note for this set..."
                      autoFocus
                      className="w-full text-[13px] bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none border border-slate-200 dark:border-white/10"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Add Set */}
        <button
          onClick={() => onAddSet(exercise.id)}
          className="mt-3 w-full py-3 text-[13px] font-semibold rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300"
        >
          <Plus size={14} /> Add Set
        </button>
      </div>
    </div>
  );
};

export default ExerciseCard;
