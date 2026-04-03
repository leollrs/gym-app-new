import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, ChevronDown, ChevronUp, Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Map muscle groups from exercises to relevant stretches
const STRETCH_DATABASE = {
  Chest: [
    { key: 'doorwayChestStretch', holdSec: 30 },
    { key: 'crossBodyChestStretch', holdSec: 25 },
  ],
  Back: [
    { key: 'childsPose', holdSec: 30 },
    { key: 'catCowStretch', holdSec: 25 },
  ],
  Shoulders: [
    { key: 'crossBodyShoulder', holdSec: 25 },
    { key: 'overheadTricepShoulder', holdSec: 25 },
  ],
  Biceps: [
    { key: 'wallBicepStretch', holdSec: 25 },
  ],
  Triceps: [
    { key: 'overheadTricepStretch', holdSec: 25 },
  ],
  Legs: [
    { key: 'standingQuadStretch', holdSec: 30 },
    { key: 'standingHamstringStretch', holdSec: 30 },
  ],
  Glutes: [
    { key: 'seatedFigureFour', holdSec: 30 },
  ],
  Core: [
    { key: 'cobraStretch', holdSec: 25 },
    { key: 'seatedSpinalTwist', holdSec: 25 },
  ],
  Calves: [
    { key: 'wallCalfStretch', holdSec: 25 },
  ],
  Forearms: [
    { key: 'wristExtensorStretch', holdSec: 20 },
  ],
  Traps: [
    { key: 'upperTrapStretch', holdSec: 25 },
  ],
  'Full Body': [
    { key: 'childsPose', holdSec: 30 },
    { key: 'standingHamstringStretch', holdSec: 30 },
  ],
};

// Universal fallback stretches when no muscle data
const FALLBACK_STRETCHES = [
  { key: 'childsPose', holdSec: 30 },
  { key: 'standingQuadStretch', holdSec: 30 },
  { key: 'standingHamstringStretch', holdSec: 30 },
  { key: 'crossBodyShoulder', holdSec: 25 },
  { key: 'cobraStretch', holdSec: 25 },
];

const formatTimer = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
};

const CoolDown = ({ muscleGroups = [] }) => {
  const { t } = useTranslation('pages');
  const [expanded, setExpanded] = useState(true);
  const [activeStretchIndex, setActiveStretchIndex] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef(null);

  // Determine stretches based on muscles worked
  const stretches = useMemo(() => {
    if (!muscleGroups || muscleGroups.length === 0) return FALLBACK_STRETCHES;

    const seen = new Set();
    const result = [];
    for (const muscle of muscleGroups) {
      const candidates = STRETCH_DATABASE[muscle] || [];
      for (const s of candidates) {
        if (!seen.has(s.key)) {
          seen.add(s.key);
          result.push(s);
        }
        if (result.length >= 6) break;
      }
      if (result.length >= 6) break;
    }

    // Pad to minimum 4 with fallbacks
    if (result.length < 4) {
      for (const fb of FALLBACK_STRETCHES) {
        if (!seen.has(fb.key)) {
          seen.add(fb.key);
          result.push(fb);
        }
        if (result.length >= 4) break;
      }
    }

    return result;
  }, [muscleGroups]);

  // Timer tick
  useEffect(() => {
    if (!isRunning) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  const handleStartTimer = useCallback((idx) => {
    clearInterval(intervalRef.current);
    if (activeStretchIndex === idx && isRunning) {
      setIsRunning(false);
      return;
    }
    setActiveStretchIndex(idx);
    setTimeLeft(stretches[idx].holdSec);
    setIsRunning(true);
  }, [activeStretchIndex, isRunning, stretches]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full max-w-sm md:max-w-lg rounded-2xl px-5 py-4 flex items-center gap-3 transition-colors"
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
      >
        <Wind size={18} className="text-blue-400 shrink-0" />
        <span className="text-[14px] font-semibold flex-1 text-left" style={{ color: 'var(--color-text-primary)' }}>
          {t('coolDown.title')}
        </span>
        <ChevronDown size={18} style={{ color: 'var(--color-text-muted)' }} />
      </button>
    );
  }

  return (
    <div
      className="w-full max-w-sm md:max-w-lg rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(false)}
        className="w-full flex items-center gap-3 px-5 py-4"
      >
        <Wind size={18} className="text-blue-400 shrink-0" />
        <div className="flex-1 text-left">
          <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('coolDown.title')}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
            {t('coolDown.subtitle')}
          </p>
        </div>
        <ChevronUp size={18} style={{ color: 'var(--color-text-muted)' }} />
      </button>

      {/* Stretch list */}
      <div className="px-4 pb-4 space-y-2">
        {stretches.map((stretch, idx) => {
          const isActive = activeStretchIndex === idx;
          const timerDone = isActive && timeLeft === 0 && !isRunning;

          return (
            <div
              key={stretch.key}
              className={`rounded-xl px-4 py-3 transition-all ${isActive ? 'ring-1' : ''}`}
              style={{
                backgroundColor: isActive ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-card))' : 'var(--color-bg-card)',
                border: `1px solid ${isActive ? 'color-mix(in srgb, var(--color-accent) 25%, transparent)' : 'var(--color-border-default)'}`,
                ringColor: isActive ? 'var(--color-accent)' : undefined,
              }}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-semibold ${timerDone ? 'line-through' : ''}`} style={{ color: timerDone ? 'var(--color-text-subtle)' : 'var(--color-text-primary)' }}>
                    {t(`coolDown.stretches.${stretch.key}.name`)}
                  </p>
                  <p className="text-[12px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-subtle)' }}>
                    {t(`coolDown.stretches.${stretch.key}.instruction`)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isActive && isRunning ? (
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: 'var(--color-accent)' }}>
                      {formatTimer(timeLeft)}
                    </span>
                  ) : (
                    <span className="text-[12px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                      {stretch.holdSec}s
                    </span>
                  )}
                  <button
                    onClick={() => handleStartTimer(idx)}
                    className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                    style={{
                      backgroundColor: timerDone ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                    aria-label={isActive && isRunning ? 'Pause' : 'Start timer'}
                  >
                    {timerDone ? (
                      <span className="text-green-400 text-[14px]">&#10003;</span>
                    ) : isActive && isRunning ? (
                      <Pause size={14} style={{ color: 'var(--color-text-muted)' }} />
                    ) : (
                      <Play size={14} fill="var(--color-text-muted)" style={{ color: 'var(--color-text-muted)' }} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CoolDown;
