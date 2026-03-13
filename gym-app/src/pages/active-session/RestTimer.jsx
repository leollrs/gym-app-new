import React from 'react';
import { Timer } from 'lucide-react';

const RestTimer = ({ restTimer, currentRestDuration, formatTime, onSkip }) => (
  <div className="fixed inset-0 z-[115] flex flex-col items-center justify-center backdrop-blur-2xl bg-[#F8FAFC]/96 dark:bg-[#0F172A]/96">
    <p className="text-[11px] uppercase tracking-[0.22em] font-bold mb-4 text-amber-700 dark:text-amber-400">
      Rest
    </p>

    {/* Circular countdown */}
    <div className="relative w-40 h-40 mb-5">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          className="stroke-slate-300 dark:stroke-white/20"
          strokeWidth="6"
        />
        <circle
          cx="60"
          cy="60"
          r="48"
          fill="none"
          className="stroke-amber-500 dark:stroke-amber-400 transition-all duration-1000"
          strokeWidth="6"
          strokeDasharray={2 * Math.PI * 48}
          strokeDashoffset={2 * Math.PI * 48 * (1 - restTimer / currentRestDuration)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Timer size={18} className="text-amber-700 dark:text-amber-400" />
        <p className="mt-1 font-bold tabular-nums leading-none text-[#0F172A] dark:text-slate-100" style={{ fontSize: 'clamp(32px,8vw,40px)' }}>
          {formatTime(restTimer)}
        </p>
      </div>
    </div>

    <p className="text-[13px] mb-6 text-[#64748B] dark:text-slate-400">
      Next set when the timer hits zero.
    </p>

    <button
      onClick={onSkip}
      className="px-6 py-3 rounded-2xl font-semibold text-[14px] active:scale-95 transition-transform shadow-sm bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-400 border border-amber-300 dark:border-amber-600"
    >
      Skip rest
    </button>
  </div>
);

export default RestTimer;
