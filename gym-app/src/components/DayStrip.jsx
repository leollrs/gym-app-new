import React from 'react';
import { startOfWeek, addDays, isSameDay, format, isBefore, startOfDay } from 'date-fns';
import { motion } from 'framer-motion';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const DayStrip = ({ selectedDate, onSelectDate, onAssignDay, workoutDays = [], schedule = {} }) => {
  const today = new Date();
  const todayStart = startOfDay(today);
  const weekStart = startOfWeek(today, { weekStartsOn: 0 });

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const isToday = isSameDay(date, today);
    const isSelected = selectedDate ? isSameDay(date, selectedDate) : isToday;
    const isPast = isBefore(startOfDay(date), todayStart);
    const hasCompleted = workoutDays.some(d => isSameDay(new Date(d), date));
    const assigned = schedule[i];
    const dayNum = format(date, 'd');

    // State: selected > completed > scheduled > rest
    let state = 'rest';
    if (isSelected) state = 'selected';
    else if (hasCompleted) state = 'completed';
    else if (assigned) state = isPast ? 'rest' : 'scheduled';

    return { date, dayIndex: i, label: DAYS[i], dayNum, isToday, isSelected, state };
  });

  return (
    <div className="flex items-center justify-between">
      {days.map(({ date, dayIndex, label, dayNum, isToday, isSelected, state }) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            onSelectDate?.(date);
            if (isSelected && onAssignDay) onAssignDay(dayIndex);
          }}
          className="relative flex flex-col items-center flex-1 py-1 transition-all active:scale-95"
        >
          {/* Weekday label — small, quiet */}
          <span className={`text-[9px] font-medium uppercase tracking-[0.08em] mb-1 ${
            isSelected ? 'text-[#10B981]'
            : state === 'completed' ? 'text-[#C9A227]/70'
            : 'text-[#3B3F4A]'
          }`}>
            {label}
          </span>

          {/* Date number + circle */}
          <div className="relative w-8 h-8 flex items-center justify-center">
            {/* Selected: green filled circle */}
            {isSelected && (
              <motion.div
                layoutId="dayPill"
                className="absolute inset-0 rounded-full bg-[#10B981]"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}

            {/* Completed: thin gold ring */}
            {state === 'completed' && (
              <div className="absolute inset-0.5 rounded-full border border-[#C9A227]/50" />
            )}

            <span className={`relative z-10 text-[14px] font-bold ${
              isSelected ? 'text-white'
              : state === 'completed' ? 'text-[#C9A227]'
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
