import React from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Timer, X } from 'lucide-react';

const SessionHeader = ({
  routineName,
  isPaused,
  elapsedTime,
  formatTime,
  completedSets,
  totalSets,
  exercises,
  currentExerciseIndex,
  showResumedBanner,
  savedSession,
  sessionKey,
  onNavigateBack,
  onPause,
  onResume,
  onEndWorkout,
  onSetCurrentExerciseIndex,
  onDismissResumedBanner,
  onDiscardSession,
}) => (
  <>
    {/* Pause Overlay */}
    {isPaused && (
      <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center backdrop-blur-2xl bg-[#F8FAFC]/97 dark:bg-[#0F172A]/97">
        <p className="text-[11px] uppercase tracking-[0.22em] font-bold mb-5 text-[#64748B] dark:text-slate-400">
          Workout Paused
        </p>
        <p className="font-bold tabular-nums leading-none mb-2 text-[#0F172A] dark:text-slate-100"
          style={{ fontSize: 'clamp(60px,18vw,80px)' }}>
          {formatTime(elapsedTime)}
        </p>
        <p className="text-[13px] mb-16 text-[#64748B] dark:text-slate-400">Timer stopped</p>

        <button
          onClick={onResume}
          className="w-24 h-24 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform mb-10 bg-[#D4AF37] dark:bg-amber-500"
        >
          <Play size={34} fill="black" className="text-black ml-2" />
        </button>

        <button
          onClick={onEndWorkout}
          className="font-semibold text-[15px] hover:opacity-80 transition-opacity text-red-500 dark:text-red-400"
        >
          End Workout
        </button>
      </div>
    )}

    {/* Header */}
    <header
      className="flex-shrink-0 px-4 pb-3 border-b border-white/10 bg-[#05070B]"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onNavigateBack}
          className="flex items-center gap-0.5 transition-opacity hover:opacity-70 -ml-1 p-1 text-[#9CA3AF]"
        >
          <ChevronLeft size={24} strokeWidth={2.5} />
          <span className="text-[15px] font-semibold -ml-1">Back</span>
        </button>
        <button
          onClick={onPause}
          className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-sm bg-white/90 dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300"
        >
          <Pause size={16} />
        </button>
      </div>

      <div className="text-center">
        <h1 className="font-bold text-[17px] tracking-tight leading-none text-[#E5E7EB]">
          {routineName}
        </h1>
      </div>
    </header>

    {/* Progress bar */}
    <div className="flex-shrink-0 h-0.5 bg-slate-200 dark:bg-white/10">
      <div
        className="h-full transition-all duration-500 bg-amber-500 dark:bg-amber-400"
        style={{ width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }}
      />
    </div>

    {/* Resumed banner */}
    {showResumedBanner && savedSession?.loggedSets && (
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between gap-3 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300">
            <Timer size={14} />
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-blue-700 dark:text-blue-200">
              Session resumed
            </span>
            <span className="text-[12px] text-blue-600/80 dark:text-blue-300/80">
              Your progress from last time was restored.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onDiscardSession}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 bg-red-50/70 dark:bg-red-900/30"
          >
            Discard
          </button>
          <button
            onClick={onDismissResumedBanner}
            className="w-7 h-7 flex items-center justify-center rounded-full text-blue-500 hover:bg-blue-100/80 dark:text-blue-300 dark:hover:bg-blue-800/60"
            aria-label="Dismiss resumed session message"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    )}

    {/* Exercise Navigator */}
    <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
      <button
        onClick={() => onSetCurrentExerciseIndex(i => Math.max(0, i - 1))}
        disabled={currentExerciseIndex === 0}
        className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-25 active:scale-90 transition-all bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400"
      >
        <ChevronLeft size={22} />
      </button>

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5">
          {exercises.map((_, i) => (
            <button
              key={i}
              onClick={() => onSetCurrentExerciseIndex(i)}
              className={`rounded-full transition-all duration-300 h-2 ${
                i === currentExerciseIndex ? 'w-5 bg-amber-500 dark:bg-amber-400' : 'w-2 bg-black/12 dark:bg-white/20'
              }`}
            />
          ))}
        </div>
        <p className="text-[11px] font-semibold tabular-nums text-[#64748B] dark:text-slate-400">
          {currentExerciseIndex + 1} / {exercises.length}
        </p>
      </div>

      <button
        onClick={() => onSetCurrentExerciseIndex(i => Math.min(exercises.length - 1, i + 1))}
        disabled={currentExerciseIndex === exercises.length - 1}
        className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-25 active:scale-90 transition-all bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-400"
      >
        <ChevronRight size={22} />
      </button>
    </div>
  </>
);

export default SessionHeader;
