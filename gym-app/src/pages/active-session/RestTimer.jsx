import React from 'react';
import { SkipForward, Plus, Minus, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { exName } from '../../lib/exerciseName';

const RestTimer = ({ restTimer, currentRestDuration, formatTime, onSkip, onAdjustRest, upcomingExercise }) => {
  const { t } = useTranslation('pages');
  const progress = currentRestDuration > 0
    ? ((currentRestDuration - restTimer) / currentRestDuration) * 100
    : 100;

  const circumference = 2 * Math.PI * 54;
  const strokeDash = (progress / 100) * circumference;

  return (
    <div
      className="fixed inset-0 z-[115] flex flex-col items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
      role="dialog"
      aria-label="Rest timer"
    >
      {/* Label */}
      <p className="text-[11px] font-bold uppercase tracking-[0.25em] mb-8" style={{ color: 'var(--color-accent)' }}>
        {t('activeSession.rest')}
      </p>

      {/* Circular timer */}
      <div className="relative w-[140px] h-[140px] mb-6">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-border-default))" strokeWidth="6" />
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference - strokeDash}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[36px] font-black tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
            {formatTime(restTimer)}
          </span>
        </div>
      </div>

      {/* Adjust rest time — +/- 15s buttons */}
      {onAdjustRest && (
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => onAdjustRest(-15)}
            className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
            style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            aria-label="Reduce rest 15s"
          >
            <Minus size={16} style={{ color: 'var(--color-text-muted)' }} />
          </button>
          <span className="text-[12px] font-semibold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            {Math.floor(currentRestDuration / 60)}:{String(currentRestDuration % 60).padStart(2, '0')} {t('activeSession.restTotal', 'total')}
          </span>
          <button
            onClick={() => onAdjustRest(15)}
            className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
            style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            aria-label="Add rest 15s"
          >
            <Plus size={16} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>
      )}

      {/* Info */}
      <p className="text-[13px] mb-6" style={{ color: 'var(--color-text-muted)' }}>
        {t('activeSession.nextSetWhenZero')}
      </p>

      {/* Skip button */}
      <button
        onClick={onSkip}
        className="flex items-center gap-2 px-6 py-3 min-h-[44px] rounded-2xl font-bold text-[14px] active:scale-[0.97] transition-all focus:ring-2 focus:outline-none"
        style={{
          color: 'var(--color-accent)',
          borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
          borderWidth: '1px',
          borderStyle: 'solid',
        }}
      >
        <SkipForward size={16} />
        {t('activeSession.skipRest')}
      </button>

      {/* Upcoming exercise preview — shown on last set of current exercise */}
      {upcomingExercise && (
        <div
          className="mt-6 mx-6 w-[calc(100%-48px)] max-w-sm rounded-2xl px-4 py-3"
          style={{
            backgroundColor: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-default)',
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <ChevronRight size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--color-accent)' }}>
              {t('activeSession.upcomingExercise', 'Up Next')}
            </span>
          </div>
          <p className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {exName(upcomingExercise)}
          </p>
          {upcomingExercise.suggestion?.suggestedWeight && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {upcomingExercise.targetSets} x {upcomingExercise.suggestion.suggestedReps ?? upcomingExercise.targetReps} @ {upcomingExercise.suggestion.suggestedWeight} lbs
            </p>
          )}
          {!upcomingExercise.suggestion?.suggestedWeight && (
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {upcomingExercise.targetSets} x {upcomingExercise.targetReps} reps
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default RestTimer;
