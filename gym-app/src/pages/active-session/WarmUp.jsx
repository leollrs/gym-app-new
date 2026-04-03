import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipForward, ChevronRight, Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const WARM_UP_MOVEMENTS = [
  { key: 'jumpingJacks',  icon: '🏃', durationSec: 45 },
  { key: 'armCircles',    icon: '🔄', durationSec: 30 },
  { key: 'legSwings',     icon: '🦵', durationSec: 30 },
  { key: 'hipCircles',    icon: '🔁', durationSec: 30 },
  { key: 'lightCardio',   icon: '❤️', durationSec: 60 },
];

const formatTimer = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const WarmUp = ({ onComplete, onSkip }) => {
  const { t } = useTranslation('pages');
  const [activeIndex, setActiveIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(WARM_UP_MOVEMENTS[0].durationSec);
  const [isRunning, setIsRunning] = useState(false);
  const [completedIndices, setCompletedIndices] = useState([]);
  const intervalRef = useRef(null);

  const currentMovement = WARM_UP_MOVEMENTS[activeIndex];
  const allDone = completedIndices.length === WARM_UP_MOVEMENTS.length;

  // Timer tick
  useEffect(() => {
    if (!isRunning) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          setIsRunning(false);
          setCompletedIndices(ci => ci.includes(activeIndex) ? ci : [...ci, activeIndex]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [isRunning, activeIndex]);

  const handlePlayPause = useCallback(() => {
    if (timeLeft === 0) return;
    setIsRunning(r => !r);
  }, [timeLeft]);

  const handleSkipMovement = useCallback(() => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    setCompletedIndices(ci => ci.includes(activeIndex) ? ci : [...ci, activeIndex]);
    if (activeIndex < WARM_UP_MOVEMENTS.length - 1) {
      const next = activeIndex + 1;
      setActiveIndex(next);
      setTimeLeft(WARM_UP_MOVEMENTS[next].durationSec);
    } else {
      setTimeLeft(0);
    }
  }, [activeIndex]);

  const handleSelectMovement = useCallback((idx) => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    setActiveIndex(idx);
    setTimeLeft(WARM_UP_MOVEMENTS[idx].durationSec);
  }, []);

  // Progress ring
  const progress = currentMovement ? 1 - (timeLeft / currentMovement.durationSec) : 1;
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)] pb-3">
        <div className="flex items-center gap-2">
          <Flame size={20} className="text-orange-400" />
          <h2 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('warmUp.title')}
          </h2>
        </div>
        <button
          onClick={onSkip}
          className="px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
        >
          {t('warmUp.skip')}
        </button>
      </div>

      {/* Subtitle */}
      <p className="px-4 text-[13px] mb-4" style={{ color: 'var(--color-text-subtle)' }}>
        {t('warmUp.subtitle')}
      </p>

      {/* Main timer area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Timer ring */}
        <div className="relative w-36 h-36 mb-5">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
            <circle
              cx="60" cy="60" r="54" fill="none"
              stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={dashOffset}
              className="transition-all duration-300"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[32px] font-black tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {formatTimer(timeLeft)}
            </span>
          </div>
        </div>

        {/* Current movement name */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[20px]">{currentMovement.icon}</span>
          <h3 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t(`warmUp.movements.${currentMovement.key}`)}
          </h3>
        </div>
        <p className="text-[13px] mb-6" style={{ color: 'var(--color-text-subtle)' }}>
          {t(`warmUp.movementTips.${currentMovement.key}`)}
        </p>

        {/* Play / Pause + Skip controls */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handlePlayPause}
            disabled={timeLeft === 0}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-accent)', color: '#000' }}
            aria-label={isRunning ? 'Pause' : 'Play'}
          >
            {isRunning ? <Pause size={24} fill="#000" strokeWidth={0} /> : <Play size={24} fill="#000" strokeWidth={0} />}
          </button>
          <button
            onClick={handleSkipMovement}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            aria-label="Skip movement"
          >
            <SkipForward size={18} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>
      </div>

      {/* Movement list */}
      <div className="px-4 pb-6 space-y-2">
        {WARM_UP_MOVEMENTS.map((m, idx) => {
          const done = completedIndices.includes(idx);
          const active = idx === activeIndex;
          return (
            <button
              key={m.key}
              onClick={() => handleSelectMovement(idx)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'ring-1' : ''}`}
              style={{
                backgroundColor: active ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'var(--color-bg-card)',
                border: `1px solid ${active ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)' : 'var(--color-border-default)'}`,
                ringColor: active ? 'var(--color-accent)' : undefined,
              }}
            >
              <span className="text-[16px]">{m.icon}</span>
              <span className={`flex-1 text-left text-[14px] font-semibold ${done ? 'line-through' : ''}`} style={{ color: done ? 'var(--color-text-subtle)' : 'var(--color-text-primary)' }}>
                {t(`warmUp.movements.${m.key}`)}
              </span>
              <span className="text-[12px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {formatTimer(m.durationSec)}
              </span>
              {done && (
                <span className="text-[14px] text-green-400">&#10003;</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Start Workout button */}
      <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
        <button
          onClick={onComplete}
          className="w-full py-4 rounded-2xl font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.97] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          style={{
            backgroundColor: allDone ? 'var(--color-accent)' : 'rgba(255,255,255,0.06)',
            color: allDone ? '#000' : 'var(--color-text-primary)',
            border: allDone ? 'none' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {allDone ? t('warmUp.startWorkout') : t('warmUp.startWorkoutEarly')}
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
};

export default WarmUp;
