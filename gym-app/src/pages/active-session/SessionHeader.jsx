import React from 'react';
import { ChevronLeft, Pause, Play, X, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  onNavigateBack,
  onPause,
  onResume,
  onEndWorkout,
  onSetCurrentExerciseIndex,
  onDismissResumedBanner,
  onDiscardSession,
  watchHeartRate,
  // unused but accepted for compat
  savedSession,
  sessionKey,
}) => {
  const exerciseCount = exercises.length;
  const { t } = useTranslation('pages');

  return (
    <>
      {/* ── Pause overlay ──────────────────────────────────────── */}
      {isPaused && (
        <div className="fixed inset-0 z-[150] bg-[#05070B]/95 backdrop-blur-md flex flex-col items-center justify-center gap-8">
          <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-[0.2em]">{t('activeSession.paused')}</p>
          <p className="text-[56px] font-black text-[#E5E7EB] tabular-nums tracking-tight">
            {formatTime(elapsedTime)}
          </p>
          <div className="flex flex-col items-center gap-3 w-48">
            <button
              onClick={onResume}
              className="w-full py-4 rounded-2xl bg-[#D4AF37] text-black font-bold text-[16px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform duration-200"
            >
              <Play size={18} fill="black" strokeWidth={0} />
              {t('activeSession.resume')}
            </button>
            <button
              onClick={onEndWorkout}
              className="w-full py-3 rounded-2xl border border-white/[0.06] text-[#9CA3AF] font-semibold text-[14px] active:scale-[0.97] transition-colors duration-200"
            >
              {t('activeSession.endWorkout')}
            </button>
          </div>
        </div>
      )}

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-[#05070B]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="relative flex items-center justify-between px-4 h-12">
          {/* Back */}
          <button
            onClick={onNavigateBack}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors duration-200 z-10"
            aria-label="Back"
          >
            <ChevronLeft size={22} />
          </button>

          {/* Exercise counter — absolutely centered on the page */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1">
              <span className="text-[18px] font-black text-[#E5E7EB] tabular-nums">
                {currentExerciseIndex + 1}
              </span>
              <span className="text-[18px] font-bold text-[#4B5563]">/</span>
              <span className="text-[18px] font-black text-[#4B5563] tabular-nums">
                {exerciseCount}
              </span>
            </div>
          </div>

          {/* HR + Timer + Pause */}
          <div className="flex items-center gap-1.5 z-10">
            {watchHeartRate?.bpm > 0 && (
              <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-500/10">
                <span className="text-[10px]">❤️</span>
                <span className="text-[12px] font-bold text-red-400 tabular-nums">
                  {watchHeartRate.bpm}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04]">
              <Timer size={12} className="text-[#6B7280]" />
              <span className="text-[13px] font-bold text-[#E5E7EB] tabular-nums tracking-tight">
                {formatTime(elapsedTime)}
              </span>
            </div>
            <button
              onClick={onPause}
              className="w-11 h-11 rounded-xl flex items-center justify-center text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors duration-200"
              aria-label="Pause"
            >
              <Pause size={18} />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] bg-white/[0.04]">
          <div
            className="h-full bg-[#D4AF37] transition-all duration-300 ease-out"
            style={{ width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* ── Resumed banner ─────────────────────────────────────── */}
      {showResumedBanner && (
        <div className="mx-4 mt-3 flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-500/[0.08] border border-blue-500/20">
          <Timer size={16} className="text-blue-400 shrink-0" />
          <p className="text-[12px] text-blue-300 flex-1">{t('activeSession.sessionResumed')}</p>
          <div className="flex items-center gap-2">
            <button onClick={onDiscardSession} className="text-[11px] font-semibold text-blue-400/60 hover:text-red-400">
              {t('activeSession.discard')}
            </button>
            <button onClick={onDismissResumedBanner} className="text-blue-400/60 hover:text-blue-300">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Exercise nav dots ──────────────────────────────────── */}
      <div className="flex items-center justify-center gap-1.5 py-3 px-4">
        {exercises.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSetCurrentExerciseIndex(i)}
            className={`rounded-full transition-all duration-300 ${
              i === currentExerciseIndex
                ? 'w-6 h-2 bg-[#D4AF37]'
                : i < currentExerciseIndex
                ? 'w-2 h-2 bg-[#D4AF37]/40'
                : 'w-2 h-2 bg-white/[0.10]'
            }`}
            aria-label={`Exercise ${i + 1}`}
          />
        ))}
      </div>
    </>
  );
};

export default SessionHeader;
