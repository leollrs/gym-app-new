import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { exName } from '../../lib/exerciseName';

const DISPLAY_FONT = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

const RestTimer = ({ restTimer, currentRestDuration, formatTime, onSkip, onAdjustRest, upcomingExercise }) => {
  const { t } = useTranslation('pages');

  // Body scroll lock while rest overlay is visible
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const total = currentRestDuration > 0 ? currentRestDuration : 1;
  const pct = Math.max(0, Math.min(1, 1 - restTimer / total));

  // 260px ring dimensions
  const RING_SIZE = 260;
  const R = 110;
  const C = 2 * Math.PI * R;
  const dash = `${C * pct} ${C}`;

  const mins = Math.floor(Math.max(0, restTimer) / 60);
  const secs = Math.max(0, restTimer) % 60;

  return (
    <div
      className="fixed inset-0 z-[115] flex flex-col animate-fade-in"
      style={{
        backgroundColor: 'rgba(10, 13, 16, 0.62)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      role="dialog"
      aria-label={t('activeSession.rest', 'Rest')}
    >
      {/* Ring + time */}
      <div className="flex-1 flex flex-col items-center justify-center px-6" style={{ paddingTop: 'var(--safe-area-top, env(safe-area-inset-top, 0px))' }}>
        <div
          className="text-[11px] font-bold uppercase tracking-[0.22em] mb-3"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          {t('activeSession.rest', 'REST')}
        </div>

        <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg width={RING_SIZE} height={RING_SIZE} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
            <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={10} />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={R}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={dash}
              style={{ transition: 'stroke-dasharray 1s linear' }}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                fontSize: 64,
                color: '#fff',
                letterSpacing: -2,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {String(mins).padStart(1, '0')}:{String(secs).padStart(2, '0')}
            </div>
            {upcomingExercise && (
              <div
                className="mt-2 px-3 text-center"
                style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: 0.4 }}
              >
                {t('activeSession.upcomingExercise', 'Up Next')} · {exName(upcomingExercise)}
              </div>
            )}
          </div>
        </div>

        {/* ±15s pill buttons */}
        {onAdjustRest && (
          <div className="mt-7 flex items-center gap-2">
            <button
              onClick={() => onAdjustRest(-15)}
              className="px-4 py-2.5 rounded-xl active:scale-95 transition-transform focus:outline-none"
              style={{
                border: '1px solid rgba(255,255,255,0.2)',
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: '#fff',
                fontFamily: DISPLAY_FONT,
                fontSize: 13,
                fontWeight: 700,
              }}
              aria-label="Reduce rest by 15 seconds"
            >
              −15s
            </button>
            <button
              onClick={() => onAdjustRest(15)}
              className="px-4 py-2.5 rounded-xl active:scale-95 transition-transform focus:outline-none"
              style={{
                border: '1px solid rgba(255,255,255,0.2)',
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: '#fff',
                fontFamily: DISPLAY_FONT,
                fontSize: 13,
                fontWeight: 700,
              }}
              aria-label="Add 15 seconds rest"
            >
              +15s
            </button>
          </div>
        )}
      </div>

      {/* Bottom: Skip rest (white) */}
      <div className="px-4 pb-10" style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }}>
        <button
          onClick={onSkip}
          className="w-full h-14 rounded-[18px] active:scale-[0.97] transition-transform focus:outline-none"
          style={{
            backgroundColor: '#fff',
            color: '#0A0D10',
            fontFamily: DISPLAY_FONT,
            fontSize: 15,
            fontWeight: 700,
            border: 'none',
          }}
        >
          {t('activeSession.skipRest', 'Skip rest')}
        </button>
      </div>
    </div>
  );
};

export default RestTimer;
