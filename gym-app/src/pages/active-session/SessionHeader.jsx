import React from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X, Clock, ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const SessionHeader = ({
  routineName,
  className: classLabel,
  isPaused,
  elapsedTime,
  formatTime,
  completedSets,
  totalSets,
  exercises,
  loggedSets,
  currentExerciseIndex,
  showResumedBanner,
  onNavigateBack,
  onPause,
  onResume,
  onEndWorkout,
  onSetCurrentExerciseIndex,
  onOpenListManager,
  onDismissResumedBanner,
  onDiscardSession,
  watchHeartRate,
  // unused but accepted for compat
  savedSession,
  sessionKey,
}) => {
  const exerciseCount = exercises.length;
  const { t } = useTranslation('pages');

  // Per-pill tint follows the SAME per-set snapshot rule as the in-card
  // chips: if at least one logged set on this exercise was completed while
  // the exercise was inside a superset/circuit, the pill takes the group
  // tone. Pills for exercises without any supersetted set fall back to the
  // gym brand accent. Falls back to the exercise's *current* groupType when
  // no sets have been logged yet so a freshly-paired exercise still shows
  // the group color on its NOW pill.
  const segmentStates = exercises.map((ex, i) => {
    let pillGroupType = null;
    const sets = (loggedSets && ex?.id) ? loggedSets[ex.id] || [] : [];
    for (const s of sets) {
      if (s?.completed && !s?.skipped && s.groupType) {
        pillGroupType = s.groupType;
        break;
      }
    }
    if (!pillGroupType && ex?.groupType) pillGroupType = ex.groupType;
    const base = { groupType: pillGroupType };
    if (i < currentExerciseIndex) return { ...base, done: true, pct: 1 };
    if (i === currentExerciseIndex) return { ...base, active: true, pct: 0.4 };
    return { ...base, done: false, pct: 0 };
  });

  // Clearly distinct from the blue circuit tone — old #6D5FDB read as blue
  // on some panels, especially when the gym brand accent skews violet.
  const SEGMENT_TONE = {
    superset: '#8B5CF6',
    circuit: '#3B82F6',
  };

  return (
    <>
      {/* ── Pause overlay ──────────────────────────────────────── */}
      {isPaused && (
        <div
          className="fixed inset-0 z-[150] backdrop-blur-md flex flex-col items-center justify-center gap-8 animate-fade-in"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-bg-primary) 95%, transparent)' }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-subtle)' }}>{t('activeSession.paused')}</p>
          <p className="text-[56px] font-black tabular-nums tracking-tight" style={{ color: 'var(--color-text-primary)', fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif' }}>
            {formatTime(elapsedTime)}
          </p>
          <div className="flex flex-col items-center gap-3 w-48">
            <button
              onClick={onResume}
              className="w-full py-4 rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform duration-200 focus:outline-none"
              style={{ backgroundColor: 'var(--color-accent)', color: '#001512' }}
            >
              <Play size={18} fill="#001512" strokeWidth={0} />
              {t('activeSession.resume')}
            </button>
            <button
              onClick={onEndWorkout}
              className="w-full py-3 rounded-2xl font-semibold text-[14px] active:scale-[0.97] transition-colors duration-200 focus:outline-none"
              style={{
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {t('activeSession.endWorkout')}
            </button>
          </div>
        </div>
      )}

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0"
        style={{
          backgroundColor: 'var(--color-bg-primary)',
          paddingTop: 'var(--safe-area-top, env(safe-area-inset-top))',
        }}
      >
        <div className="flex items-center gap-2 px-4 pt-2 pb-1">
          {/* Back */}
          <button
            onClick={onNavigateBack}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 focus:outline-none shrink-0"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
            aria-label={t('activeSession.backAria', 'Back')}
          >
            <ChevronLeft size={20} strokeWidth={2.2} />
          </button>

          {/* Exercise counter + workout name stacked, center */}
          <div className="flex-1 min-w-0 text-center px-1">
            {classLabel ? (
              <div className="inline-block text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full mb-0.5 truncate max-w-[180px]"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}
              >
                {classLabel}
              </div>
            ) : exerciseCount > 0 ? (
              <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
                {t('activeSession.exerciseXofY', {
                  current: currentExerciseIndex + 1,
                  total: exerciseCount,
                  defaultValue: `EXERCISE ${currentExerciseIndex + 1} OF ${exerciseCount}`,
                })}
              </div>
            ) : null}
            <div
              className="text-[15px] font-bold leading-tight truncate"
              style={{
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.3px',
                fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
              }}
            >
              {routineName}
            </div>
          </div>

          {/* Clock pill — black, shows elapsed */}
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('activeSession.elapsedAria', { defaultValue: 'Elapsed {{time}}', time: formatTime(elapsedTime) })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl shrink-0"
            style={{
              backgroundColor: '#0A0D10',
              color: '#FFFFFF',
              fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 13,
              fontVariantNumeric: 'tabular-nums',
              cursor: 'default',
            }}
          >
            <Clock size={13} color="#FFFFFF" strokeWidth={2.2} />
            {formatTime(elapsedTime)}
          </button>

          {/* HR badge (optional) */}
          {watchHeartRate?.bpm > 0 && (
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg shrink-0" style={{ backgroundColor: 'rgba(239,68,68,0.12)' }}>
              <span className="text-[10px]">❤️</span>
              <span className="text-[12px] font-bold tabular-nums" style={{ color: '#EF4444' }}>
                {watchHeartRate.bpm}
              </span>
            </div>
          )}

          {/* Pause */}
          <button
            onClick={onPause}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 focus:outline-none shrink-0"
            style={{
              backgroundColor: 'var(--color-bg-card)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
            aria-label={t('activeSession.pauseAria', 'Pause')}
          >
            <Pause size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </div>

        {/* Segmented exercise progress bar with prev/next nav */}
        {exerciseCount > 0 && (
          <div className="flex items-center gap-2 px-4 pt-2 pb-1">
            {/* Prev exercise — tap target large enough to hit on a phone */}
            <button
              type="button"
              onClick={() => onSetCurrentExerciseIndex(Math.max(0, currentExerciseIndex - 1))}
              disabled={currentExerciseIndex <= 0}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100 focus:outline-none"
              style={{
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
              aria-label={t('activeSession.prevExerciseAria', 'Previous exercise')}
            >
              <ChevronLeft size={18} strokeWidth={2.4} />
            </button>

            <div className="flex items-center gap-1.5 flex-1">
              {segmentStates.map((s, i) => {
                const tone = SEGMENT_TONE[s.groupType] || 'var(--color-accent)';
                const baseBg = s.done
                  ? tone
                  : s.active
                    ? `color-mix(in srgb, ${tone} 100%, transparent)`
                    : 'var(--color-surface-hover, rgba(255,255,255,0.12))';
                const activeFill = `color-mix(in srgb, ${tone} 65%, #000 35%)`;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSetCurrentExerciseIndex(i)}
                    className="flex-1 h-2.5 rounded-full relative overflow-hidden active:scale-y-90 transition-transform focus:outline-none"
                    style={{ backgroundColor: baseBg }}
                    aria-label={t('activeSession.goToExerciseAria', { defaultValue: 'Go to exercise {{n}}', n: i + 1 })}
                  >
                    {s.active && (
                      <span
                        className="absolute inset-y-0 left-0 block rounded-full"
                        style={{
                          width: `${Math.max(20, s.pct * 100)}%`,
                          backgroundColor: activeFill,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Next exercise */}
            <button
              type="button"
              onClick={() => onSetCurrentExerciseIndex(Math.min(exerciseCount - 1, currentExerciseIndex + 1))}
              disabled={currentExerciseIndex >= exerciseCount - 1}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100 focus:outline-none"
              style={{
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
              aria-label={t('activeSession.nextExerciseAria', 'Next exercise')}
            >
              <ChevronRight size={18} strokeWidth={2.4} />
            </button>

            {/* All exercises list — opens the list manager */}
            {onOpenListManager && (
              <button
                type="button"
                onClick={onOpenListManager}
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform focus:outline-none"
                style={{
                  backgroundColor: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
                aria-label={t('activeSession.openExerciseList', 'See all exercises')}
              >
                <ListOrdered size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
        )}

        {/* Overall fine progress line (sets completed) */}
        <div className="h-[2px] mt-1" style={{ backgroundColor: 'var(--color-surface-hover, rgba(255,255,255,0.04))' }}>
          <div
            className="h-full transition-all duration-300 ease-out"
            style={{
              width: totalSets > 0 ? `${(completedSets / totalSets) * 100}%` : '0%',
              backgroundColor: 'var(--color-accent)',
              opacity: 0.35,
            }}
          />
        </div>
      </div>

      {/* ── Resumed banner ─────────────────────────────────────── */}
      {showResumedBanner && (
        <div
          className="mx-4 mt-3 flex items-center gap-3 px-4 py-3 rounded-2xl animate-fade-in"
          style={{
            backgroundColor: 'color-mix(in srgb, #60A5FA 10%, transparent)',
            border: '1px solid color-mix(in srgb, #60A5FA 25%, transparent)',
          }}
        >
          <Clock size={16} style={{ color: '#60A5FA' }} className="shrink-0" />
          <p className="text-[12px] flex-1" style={{ color: '#93C5FD' }}>{t('activeSession.sessionResumed')}</p>
          <div className="flex items-center gap-2">
            <button onClick={onDiscardSession} className="text-[11px] font-semibold hover:text-red-400 transition-colors" style={{ color: 'rgba(96,165,250,0.6)' }}>
              {t('activeSession.discard')}
            </button>
            <button
              onClick={onDismissResumedBanner}
              aria-label={t('activeSession.dismissBannerAria', 'Dismiss banner')}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded focus:outline-none"
              style={{ color: 'rgba(96,165,250,0.6)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default SessionHeader;
