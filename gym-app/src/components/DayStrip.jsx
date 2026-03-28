import React from 'react';
import { startOfWeek, addDays, isSameDay, format, isBefore, startOfDay } from 'date-fns';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/* Normalise any date/string to a local YYYY-MM-DD key so comparisons
   are never tripped up by timezone offsets in ISO strings. */
const toLocalKey = (v) => {
  // If already a YYYY-MM-DD string, return as-is (don't parse — JS treats date-only strings as UTC)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DayStrip = ({ selectedDate, onSelectDate, onAssignDay, workoutDays = [], schedule = {} }) => {
  const { t } = useTranslation('pages');
  const DAYS = t('dayStrip.days', { returnObjects: true });
  const today = new Date();
  const todayStart = startOfDay(today);
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });

  // Pre-build a Set of local date keys for O(1) lookups
  const completedKeys = new Set(workoutDays.map(toLocalKey));

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const isToday = isSameDay(date, today);
    const isSelected = selectedDate ? isSameDay(date, selectedDate) : isToday;
    const isPast = isBefore(startOfDay(date), todayStart);
    const hasCompleted = completedKeys.has(toLocalKey(date));
    const assigned = schedule[i];
    const dayNum = format(date, 'd');

    // State: selected > completed > scheduled > rest
    let state = 'rest';
    if (isSelected) state = 'selected';
    else if (hasCompleted) state = 'completed';
    else if (assigned) state = isPast ? 'rest' : 'scheduled';

    return { date, dayIndex: i, label: DAYS[i], dayNum, isToday, isSelected, isPast, hasCompleted, state };
  });

  return (
    <div className="flex items-center justify-between">
      {days.map(({ date, dayIndex, label, dayNum, isToday, isSelected, isPast, hasCompleted, state }) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelectDate?.(date)}
          className="relative flex flex-col items-center flex-1 py-1 transition-all active:scale-95"
        >
          {/* Weekday label — small, quiet */}
          <span className={`text-[9px] font-medium uppercase tracking-[0.08em] mb-1 ${
            isSelected && hasCompleted ? 'text-[#D4AF37]'
            : isSelected ? 'text-[#10B981]'
            : hasCompleted ? 'text-[#D4AF37]/70'
            : 'text-[#3B3F4A]'
          }`}>
            {label}
          </span>

          {/* Date number + circle */}
          <div className="relative w-9 h-9 flex items-center justify-center">
            {/* Layer 1: Past day gray ring (lowest) */}
            {!isSelected && isPast && !hasCompleted && (
              <div className="absolute inset-0.5 rounded-full border border-[#4B5563]/40" />
            )}

            {/* Layer 2: Selected fill — gold if completed, otherwise subtle */}
            {isSelected && (
              <motion.div
                layoutId="dayPill"
                className={`absolute inset-0 rounded-full ${hasCompleted ? 'bg-[#D4AF37]' : 'bg-[#10B981]'}`}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}

            {/* Layer 3: Gold ring — shows on non-selected days that have workouts */}
            {hasCompleted && !isSelected && (
              <div className="absolute inset-[-2px] rounded-full border-[3px] border-[#D4AF37] z-20" />
            )}

            {/* Layer 4: Day number — highest z */}
            <span className={`relative z-30 text-[14px] font-bold ${
              isSelected && hasCompleted ? 'text-black'
              : isSelected ? 'text-white'
              : hasCompleted ? 'text-[#D4AF37]'
              : isToday ? 'text-[#E5E7EB]'
              : state === 'scheduled' ? 'text-[#9CA3AF]'
              : 'text-[#3B3F4A]'
            }`}>
              {dayNum}
            </span>
          </div>

          {/* Indicator dot */}
          <div className="h-2 flex items-center justify-center mt-1">
            {isSelected ? (
              /* No dot needed — the circle is enough */
              null
            ) : state === 'completed' ? (
              <div className="w-[3px] h-[3px] rounded-full bg-[#C9A227]/70" />
            ) : state === 'scheduled' ? (
              <div className="w-[3px] h-[3px] rounded-full bg-white/[0.15]" />
            ) : null}
          </div>
        </button>
      ))}
    </div>
  );
};

export default DayStrip;
