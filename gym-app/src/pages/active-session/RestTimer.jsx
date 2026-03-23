import React from 'react';
import { Timer, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const RestTimer = ({ restTimer, currentRestDuration, formatTime, onSkip }) => {
  const { t } = useTranslation('pages');
  const progress = currentRestDuration > 0
    ? ((currentRestDuration - restTimer) / currentRestDuration) * 100
    : 100;

  const circumference = 2 * Math.PI * 54; // radius 54
  const strokeDash = (progress / 100) * circumference;

  return (
    <div className="fixed inset-0 z-[115] flex flex-col items-center justify-center bg-[#05070B]/97 backdrop-blur-xl">

      {/* Label */}
      <p className="text-[11px] font-bold text-[#D4AF37] uppercase tracking-[0.25em] mb-8">
        {t('activeSession.rest')}
      </p>

      {/* Circular timer */}
      <div className="relative w-[140px] h-[140px] mb-8">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          {/* Background ring */}
          <circle
            cx="60" cy="60" r="54"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="6"
          />
          {/* Progress ring */}
          <circle
            cx="60" cy="60" r="54"
            fill="none"
            stroke="#D4AF37"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - strokeDash}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[36px] font-black text-[#E5E7EB] tabular-nums tracking-tight">
            {formatTime(restTimer)}
          </span>
        </div>
      </div>

      {/* Info */}
      <p className="text-[13px] text-[#6B7280] mb-8">
        {t('activeSession.nextSetWhenZero')}
      </p>

      {/* Skip button */}
      <button
        onClick={onSkip}
        className="flex items-center gap-2 px-6 py-3 rounded-2xl border border-[#D4AF37]/30 text-[#D4AF37] font-bold text-[14px] active:scale-[0.97] transition-all hover:bg-[#D4AF37]/10"
      >
        <SkipForward size={16} />
        {t('activeSession.skipRest')}
      </button>
    </div>
  );
};

export default RestTimer;
