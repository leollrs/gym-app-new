import React, { useState, useCallback, useMemo, memo } from 'react';
import { startOfWeek, addDays, addWeeks, isSameDay, format, isBefore, isAfter, startOfDay } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';

/* Normalise any date/string to a local YYYY-MM-DD key so comparisons
   are never tripped up by timezone offsets in ISO strings. */
const toLocalKey = (v) => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DayStrip = ({ selectedDate, onSelectDate, onAssignDay, workoutDays = [], schedule = {}, dayOverrides = {}, earliestDate, programStart }) => {
  const { t, i18n } = useTranslation('pages');
  const DAYS = t('dayStrip.days', { returnObjects: true });
  const today = new Date();
  const todayStart = startOfDay(today);
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 0 });

  // Track which week offset we're viewing (0 = this week, -1 = last week, etc.)
  const [weekOffset, setWeekOffset] = useState(0);
  const viewingWeekStart = addWeeks(thisWeekStart, weekOffset);

  // Reset to current week if selectedDate is set to today externally
  const handleSelectDate = useCallback((date) => {
    onSelectDate?.(date);
  }, [onSelectDate]);

  // Navigation limits
  const earliestWeekStart = earliestDate
    ? startOfWeek(new Date(earliestDate), { weekStartsOn: 0 })
    : addWeeks(thisWeekStart, -52); // default: 1 year back
  const canGoBack = !isBefore(addWeeks(viewingWeekStart, -1), earliestWeekStart);
  const canGoForward = weekOffset < 0;
  const isCurrentWeek = weekOffset === 0;

  // Week label
  const weekLabel = useMemo(() => {
    if (isCurrentWeek) return t('dayStrip.thisWeek', 'This Week');
    const weekEnd = addDays(viewingWeekStart, 6);
    const locale = i18n.language === 'es' ? 'es-ES' : 'en-US';
    const startStr = viewingWeekStart.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const endStr = weekEnd.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    return `${startStr} – ${endStr}`;
  }, [isCurrentWeek, viewingWeekStart, t, i18n.language]);

  // Un día que ya pasó no se planifica.
  const isPastSelection = isBefore(startOfDay(selectedDate), startOfDay(new Date()));

  // Pre-build a Set of local date keys for O(1) lookups
  const completedKeys = useMemo(() => new Set(workoutDays.map(toLocalKey)), [workoutDays]);

  // Only days on/after the program actually started can be "missed" — days
  // before it began (or before a near-future 'normal' start) are just rest.
  const programStartDay = programStart ? startOfDay(new Date(programStart)) : null;

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(viewingWeekStart, i);
    const isToday = isSameDay(date, today);
    const isSelected = selectedDate ? isSameDay(date, selectedDate) : isToday;
    const isPast = isBefore(startOfDay(date), todayStart);
    const isFuture = isAfter(startOfDay(date), todayStart);
    const hasCompleted = completedKeys.has(toLocalKey(date));
    // La excepción de esa FECHA gana sobre la semana, igual que en la tarjeta
    // de arriba. Leyendo solo el mapa recurrente, la píldora decía «descanso»
    // el mismo día en que la tarjeta enseñaba la rutina del reto.
    const assigned = dayOverrides[toLocalKey(date)] || schedule[i];
    const dayNum = format(date, 'd');

    let state = 'rest';
    if (isSelected) state = 'selected';
    else if (hasCompleted) state = 'completed';
    else if (assigned) {
      if (!isPast) state = 'scheduled';
      else if (programStartDay && isBefore(startOfDay(date), programStartDay)) state = 'rest'; // before the program began — not a miss
      else state = 'missed';
    }

    return { date, dayIndex: i, label: DAYS[i], dayNum, isToday, isSelected, isPast, isFuture, hasCompleted, state };
  });

  return (
    <div>
      {/* Week navigation header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={() => { setWeekOffset(w => w - 1); }}
          disabled={!canGoBack}
          aria-label={t('dayStrip.previousWeek', 'Previous week')}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors active:scale-95 disabled:opacity-20"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ChevronLeft size={16} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (!isCurrentWeek) {
              setWeekOffset(0);
              onSelectDate?.(today);
            }
          }}
          className={`text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors px-3 py-1 rounded-lg ${
            isCurrentWeek ? '' : 'active:scale-95'
          }`}
          style={{ color: isCurrentWeek ? 'var(--color-text-muted)' : 'var(--color-accent)' }}
        >
          {weekLabel}
        </button>

        <button
          type="button"
          onClick={() => { setWeekOffset(w => w + 1); }}
          disabled={!canGoForward}
          aria-label={t('dayStrip.nextWeek', 'Next week')}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors active:scale-95 disabled:opacity-20"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day pills */}
      <div className="flex items-center justify-between">
        {days.map(({ date, dayIndex, label, dayNum, isToday, isSelected, isPast, isFuture, hasCompleted, state }) => (
          <button
            key={`${weekOffset}-${label}`}
            type="button"
            onClick={() => handleSelectDate(date)}
            disabled={isFuture && !isCurrentWeek}
            aria-label={`${label} ${dayNum}`}
            className="relative flex flex-col items-center flex-1 py-1 transition-all active:scale-95 min-h-[44px] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none rounded-lg disabled:opacity-30"
          >
            {/* Weekday label */}
            <span
              className="text-[10px] font-bold uppercase mb-1.5"
              style={{
                color: isSelected ? 'var(--color-accent)'
                  : hasCompleted ? 'color-mix(in srgb, var(--color-accent) 70%, transparent)'
                  : 'var(--color-text-muted)',
                letterSpacing: 0.6,
              }}
            >
              {label}
            </span>

            {/* Date number + circle */}
            <div className="relative w-9 h-9 flex items-center justify-center">
              {!isSelected && !hasCompleted && (
                <div className="absolute inset-0 rounded-full" style={{ border: '1.5px solid var(--color-border-subtle, rgba(15,20,25,0.07))' }} />
              )}

              {isSelected && (
                <motion.div
                  layoutId="dayPill"
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'var(--color-accent)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}

              {hasCompleted && !isSelected && (
                <div className="absolute inset-[-2px] rounded-full border-[3px] z-20" style={{ borderColor: 'var(--color-accent)' }} />
              )}

              <span
                className={`relative z-30 text-[15px] font-extrabold ${
                  isSelected ? 'text-[var(--color-text-on-accent,#fff)]'
                  : hasCompleted ? 'text-[var(--color-accent)]'
                  : ''
                }`}
                style={{
                  ...(!(isSelected || hasCompleted) ? { color: 'var(--color-text-primary)' } : {}),
                  fontFamily: 'var(--font-display, "Barlow Condensed", system-ui)',
                }}
              >
                {dayNum}
              </span>
            </div>

            {/* Indicator dot — teal for scheduled */}
            <div className="h-2 flex items-center justify-center mt-1">
              {isSelected ? null
                : state === 'completed' ? (
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 70%, transparent)' }} />
                ) : state === 'scheduled' ? (
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--color-accent, #2EC4C4)' }} />
                ) : state === 'missed' ? (
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--color-danger, #EF4444)' }} />
                ) : null}
            </div>
          </button>
        ))}
      </div>

      {/* Poner un entreno en el día seleccionado.
          `onAssignDay` llevaba aquí desde siempre —Dashboard la pasa— y nunca se
          llamaba: era una prop muerta.
          Va FUERA de la tira y no dentro de la píldora por dos razones: un
          control interactivo dentro de un <button> es HTML inválido y su
          aria-label competía con el del padre; y la primera versión lo escondía
          con `!isFuture`, o sea que faltaba justo en el viernes que uno quiere
          preparar y sobraba en el domingo que ya pasó. */}
      {onAssignDay && !isPastSelection && (
        <button
          type="button"
          onClick={() => onAssignDay(selectedDate.getDay())}
          className="w-full mt-2 py-1.5 rounded-lg text-[11.5px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Plus size={12} strokeWidth={2.6} />
          {t('dayStrip.assignDay', 'Assign a workout to this day')}
        </button>
      )}
    </div>
  );
};

export default memo(DayStrip);
