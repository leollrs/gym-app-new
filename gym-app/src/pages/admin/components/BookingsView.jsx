import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';

/**
 * Per-class bookings drill-down used inside the ClassDetailModal's
 * "Bookings" tab. Three sub-components wired together:
 *
 *  - `BookingsView`: top-level wrapper that computes the set of valid
 *    class dates (recurring DOWs ± 8 weeks plus specific_date one-offs)
 *    and picks an initial date (today if valid, else next future, else
 *    most recent past).
 *  - `BookingsViewer`: day / week / month switcher with calendar nav.
 *  - `ScheduleAttendees`: numbered roster for one schedule slot on one
 *    date, with inline cancel buttons (calls `admin_cancel_class_booking`
 *    RPC which auto-promotes the next waitlisted person if a confirmed
 *    booking is cancelled).
 *
 * Lets the admin pick any past or future date and see who's signed up,
 * per schedule slot, with a "X / capacity" header. Uses the
 * `get_class_attendees` RPC (migration 0377) so it works regardless of
 * bookings RLS.
 */
export default function BookingsView({ classItem, gymId, t, tc }) {
  const { i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  // Build a list of valid class dates (recurring DOWs ± 8 weeks, plus
  // any specific_date one-offs). The admin can only pick from these —
  // no point letting them browse to a Tuesday for a Monday-only class.
  const validDates = useMemo(() => {
    const schedules = classItem?.gym_class_schedules || [];
    if (!schedules.length) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizonStart = new Date(today);
    horizonStart.setDate(horizonStart.getDate() - 14); // 2 weeks of history
    const horizonEnd = new Date(today);
    horizonEnd.setDate(horizonEnd.getDate() + 8 * 7);  // 8 weeks ahead
    const set = new Set();

    schedules.forEach((s) => {
      if (s.specific_date) {
        set.add(s.specific_date);
        return;
      }
      if (typeof s.day_of_week !== 'number') return;
      // Walk every day in the horizon and collect ones matching this DOW.
      const cursor = new Date(horizonStart);
      while (cursor <= horizonEnd) {
        if (cursor.getDay() === s.day_of_week) {
          set.add(cursor.toISOString().slice(0, 10));
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return Array.from(set).sort();
  }, [classItem]);

  // Default selection: today if it's valid, else the next future valid date,
  // else the most recent past valid date.
  const todayStr = new Date().toISOString().slice(0, 10);
  const initialDate = useMemo(() => {
    if (!validDates.length) return todayStr;
    if (validDates.includes(todayStr)) return todayStr;
    const future = validDates.find((d) => d > todayStr);
    if (future) return future;
    return validDates[validDates.length - 1];
  }, [validDates, todayStr]);
  const [date, setDate] = useState(initialDate);

  // If the class data changes (different schedule), re-anchor the date.
  useEffect(() => { setDate(initialDate); }, [initialDate]);

  const schedulesForDate = useMemo(() => {
    if (!classItem?.gym_class_schedules?.length) return [];
    const dow = new Date(`${date}T00:00:00`).getDay();
    return classItem.gym_class_schedules
      .filter(s => (s.specific_date ? s.specific_date === date : s.day_of_week === dow))
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  }, [classItem, date]);

  // Render label like "Lunes 6 May" using date-fns + the active locale.
  const formatPickerLabel = (d) => {
    try {
      // We avoid pulling in another locale import — use Intl, capitalised.
      const dt = new Date(`${d}T00:00:00`);
      const opts = { weekday: 'short', day: 'numeric', month: 'short' };
      const lang = isEs ? 'es-ES' : 'en-US';
      const s = dt.toLocaleDateString(lang, opts);
      // Capitalise the first letter (es spelling has lowercase weekdays).
      return s.charAt(0).toUpperCase() + s.slice(1);
    } catch { return d; }
  };

  if (validDates.length === 0) {
    return (
      <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.classes.noSchedules', 'Esta clase no tiene horarios configurados.')}
      </p>
    );
  }

  return (
    <BookingsViewer
      classItem={classItem}
      gymId={gymId}
      validDates={validDates}
      date={date}
      setDate={setDate}
      schedulesForDate={schedulesForDate}
      formatPickerLabel={formatPickerLabel}
      todayStr={todayStr}
      isEs={isEs}
      t={t}
      tc={tc}
    />
  );
}

// ── Day / Week / Month view-switcher for the bookings tab ──
function BookingsViewer({ classItem, gymId, validDates, date, setDate, schedulesForDate, formatPickerLabel, todayStr, isEs, t, tc }) {
  const [viewMode, setViewMode] = useState('day');
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const d = new Date(`${date}T00:00:00`);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Anchor the month view on the selected date when it changes externally.
  useEffect(() => {
    const d = new Date(`${date}T00:00:00`);
    setMonthAnchor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [date]);

  // Index validDates as a Set for O(1) lookup.
  const validSet = useMemo(() => new Set(validDates), [validDates]);

  // Week start = Sunday of the selected date.
  const weekStart = useMemo(() => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() - d.getDay()); // back to Sunday
    return d;
  }, [date]);
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const dayLabelsShort = isEs
    ? ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']
    : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const monthLabel = (() => {
    const lang = isEs ? 'es-ES' : 'en-US';
    const s = monthAnchor.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  // Build month grid (Sunday-leading, padded to multiples of 7).
  const monthCells = useMemo(() => {
    const start = new Date(monthAnchor);
    const end = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
    const cells = [];
    for (let i = 0; i < start.getDay(); i += 1) cells.push(null);
    for (let d = 1; d <= end.getDate(); d += 1) {
      cells.push(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [monthAnchor]);

  const shiftMonth = (delta) => {
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  // ── Unified prev/next/today nav, view-mode aware ──────────────
  const shiftDay = (delta) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };
  const shiftWeek = (delta) => {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + delta * 7);
    setDate(d.toISOString().slice(0, 10));
  };
  const goToToday = () => {
    setDate(todayStr);
    const t0 = new Date(`${todayStr}T00:00:00`);
    setMonthAnchor(new Date(t0.getFullYear(), t0.getMonth(), 1));
  };

  // Header label depends on viewMode.
  const navLabel = (() => {
    const lang = isEs ? 'es-ES' : 'en-US';
    if (viewMode === 'day') return formatPickerLabel(date);
    if (viewMode === 'month') return monthLabel;
    // week
    const ws = weekStart;
    const we = new Date(weekStart); we.setDate(we.getDate() + 6);
    const a = ws.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    const b = we.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    return `${a} – ${b}`;
  })();

  const onPrev = () => {
    if (viewMode === 'day') shiftDay(-1);
    else if (viewMode === 'week') shiftWeek(-1);
    else shiftMonth(-1);
  };
  const onNext = () => {
    if (viewMode === 'day') shiftDay(1);
    else if (viewMode === 'week') shiftWeek(1);
    else shiftMonth(1);
  };
  const isOnToday = (() => {
    if (viewMode === 'day') return date === todayStr;
    if (viewMode === 'month') {
      const t0 = new Date(`${todayStr}T00:00:00`);
      return monthAnchor.getFullYear() === t0.getFullYear() && monthAnchor.getMonth() === t0.getMonth();
    }
    // week
    const ws = weekStart;
    const we = new Date(weekStart); we.setDate(we.getDate() + 7);
    const t0 = new Date(`${todayStr}T00:00:00`);
    return t0 >= ws && t0 < we;
  })();

  return (
    <div className="space-y-3">
      {/* Day / Semana / Mes segmented */}
      <div
        className="grid grid-cols-3 gap-1 p-1 rounded-2xl"
        style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
      >
        {[
          { key: 'day',   label: t('classes.viewDay',   'Día') },
          { key: 'week',  label: t('classes.viewWeek',  'Semana') },
          { key: 'month', label: t('classes.viewMonth', 'Mes') },
        ].map(opt => {
          const active = viewMode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setViewMode(opt.key)}
              className="py-1.5 rounded-xl text-[12px] font-bold transition-all min-h-[34px]"
              style={{
                background: active ? 'var(--color-accent)' : 'transparent',
                color: active ? 'var(--color-text-on-accent, #fff)' : 'var(--color-text-secondary)',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Unified prev / label / next + Today button (visible whenever
          the user has navigated away from today). */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04]"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
          aria-label={t('admin.classes.prevNav', 'Anterior')}
        >
          ‹
        </button>
        <div className="flex-1 text-center text-[13px] font-bold capitalize truncate" style={{ color: 'var(--color-text-primary)' }}>
          {navLabel}
        </div>
        {!isOnToday && (
          <button
            type="button"
            onClick={goToToday}
            className="px-3 h-9 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors"
            style={{
              background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
              color: 'var(--color-accent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
            }}
            aria-label={t('admin.classes.today', 'Hoy')}
          >
            {t('admin.classes.today', 'Hoy')}
          </button>
        )}
        <button
          type="button"
          onClick={onNext}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.04]"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
          aria-label={t('admin.classes.nextNav', 'Siguiente')}
        >
          ›
        </button>
      </div>

      {/* DAY VIEW */}
      {viewMode === 'day' && (
        <>
          {schedulesForDate.length === 0 ? (
            <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.classes.noSlotsThatDay', 'Esta clase no se imparte ese día.')}
            </p>
          ) : (
            <div className="space-y-3">
              {schedulesForDate.map(s => (
                <ScheduleAttendees key={s.id} schedule={s} date={date} classItem={classItem} gymId={gymId} t={t} tc={tc} />
              ))}
            </div>
          )}
        </>
      )}

      {/* WEEK VIEW — list of valid class dates this week with their slots. */}
      {viewMode === 'week' && (
        <div className="space-y-3">
          {weekDays.map((d) => {
            const dateStr = d.toISOString().slice(0, 10);
            const isValid = validSet.has(dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === date;
            const dow = d.getDay();
            const slots = (classItem?.gym_class_schedules || [])
              .filter(s => (s.specific_date ? s.specific_date === dateStr : s.day_of_week === dow))
              .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
            return (
              <div
                key={dateStr}
                className="rounded-xl p-3"
                style={{
                  backgroundColor: 'var(--color-bg-deep)',
                  border: isSelected
                    ? '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)'
                    : '1px solid var(--color-border-subtle)',
                  opacity: isValid ? 1 : 0.4,
                }}
              >
                <button
                  type="button"
                  onClick={() => isValid && (setDate(dateStr), setViewMode('day'))}
                  disabled={!isValid}
                  className="w-full flex items-center justify-between text-left disabled:cursor-default"
                >
                  <p
                    className="text-[13px] font-bold capitalize"
                    style={{ color: isToday ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                  >
                    {formatPickerLabel(dateStr)}
                  </p>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {isValid ? `${slots.length} ${t('admin.classes.slot', 'horario')}${slots.length === 1 ? '' : 's'}` : t('admin.classes.noSlotsShort', '—')}
                  </span>
                </button>
                {isValid && slots.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {slots.map((s) => (
                      <ScheduleAttendees
                        key={s.id}
                        schedule={s}
                        date={dateStr}
                        classItem={classItem}
                        gymId={gymId}
                        t={t}
                        tc={tc}
                        compact
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MONTH VIEW — compact calendar grid (cell height fixed so the
          whole grid fits inside the modal without scroll on a phone). */}
      {viewMode === 'month' && (
        <div
          className="rounded-2xl p-3 space-y-2"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
        >
          {/* DOW header */}
          <div className="grid grid-cols-7 gap-1 px-1">
            {dayLabelsShort.map((lbl) => (
              <div key={lbl} className="text-[9px] font-bold uppercase tracking-[0.06em] text-center" style={{ color: 'var(--color-text-subtle)' }}>
                {lbl}
              </div>
            ))}
          </div>

          {/* Cells — fixed 36px tall so 6 rows + header fit ~270px total. */}
          <div className="grid grid-cols-7 gap-1 px-1">
            {monthCells.map((d, i) => {
              if (!d) return <div key={`pad-${i}`} style={{ height: 36 }} />;
              const dateStr = d.toISOString().slice(0, 10);
              const isValid = validSet.has(dateStr);
              const isSelected = dateStr === date;
              const isToday = dateStr === todayStr;
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => isValid && (setDate(dateStr), setViewMode('day'))}
                  disabled={!isValid}
                  className="relative rounded-lg flex items-center justify-center transition-all disabled:cursor-default"
                  style={{
                    height: 36,
                    background: isSelected
                      ? 'color-mix(in srgb, var(--color-accent) 25%, transparent)'
                      : 'transparent',
                    border: isSelected
                      ? '1px solid color-mix(in srgb, var(--color-accent) 60%, transparent)'
                      : isToday
                        ? '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)'
                        : '1px solid transparent',
                  }}
                >
                  <span
                    className="text-[12px] font-bold tabular-nums"
                    style={{
                      color: isSelected || isToday ? 'var(--color-accent)' : 'var(--color-text-primary)',
                      opacity: isValid ? 1 : 0.35,
                    }}
                  >
                    {d.getDate()}
                  </span>
                  {isValid && (
                    <span
                      className="absolute w-1 h-1 rounded-full"
                      style={{ bottom: 4, background: isSelected ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* MONTH VIEW: full attendee list per valid class date in the visible
          month, rendered below the calendar so the admin doesn't have to
          jump into Day or Week to read names. */}
      {viewMode === 'month' && (() => {
        const monthDates = monthCells
          .filter(Boolean)
          .map(d => d.toISOString().slice(0, 10))
          .filter(ds => validSet.has(ds));
        if (monthDates.length === 0) return null;
        return (
          <div className="space-y-3">
            {monthDates.map((ds) => {
              const dow = new Date(`${ds}T00:00:00`).getDay();
              const slots = (classItem?.gym_class_schedules || [])
                .filter(s => (s.specific_date ? s.specific_date === ds : s.day_of_week === dow))
                .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
              if (slots.length === 0) return null;
              return (
                <div
                  key={ds}
                  className="rounded-xl p-3"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
                >
                  <p className="text-[12px] font-bold capitalize mb-2" style={{ color: ds === todayStr ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                    {formatPickerLabel(ds)}
                  </p>
                  <div className="space-y-2">
                    {slots.map(s => (
                      <ScheduleAttendees
                        key={s.id}
                        schedule={s}
                        date={ds}
                        classItem={classItem}
                        gymId={gymId}
                        t={t}
                        tc={tc}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// Per-schedule numbered attendee list + capacity header.
// Admin can cancel any attendee's booking inline (×) — uses the
// cancel_class_booking RPC, which also auto-promotes the next
// waitlisted person if the cancelled row was confirmed.
function ScheduleAttendees({ schedule, date, classItem, gymId, t, tc }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [cancellingId, setCancellingId] = useState(null);

  const { data: attendees = [], isLoading } = useQuery({
    queryKey: ['admin', 'class-attendees', schedule.id, date],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_class_attendees', {
        p_gym_id: gymId,
        p_schedule_id: schedule.id,
        p_booking_date: date,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!schedule.id && !!gymId,
    staleTime: 30_000,
  });

  const cap = schedule.override_capacity || classItem?.max_capacity || 20;
  const confirmedCount = attendees.filter(a => a.status === 'confirmed' || a.status === 'attended').length;
  const waitlistCount = attendees.filter(a => a.status === 'waitlisted').length;

  const adminCancel = async (booking) => {
    if (!window.confirm(t('admin.classes.confirmCancel', { defaultValue: '¿Cancelar la reserva de {{name}}?', name: booking.full_name || '' }))) return;
    setCancellingId(booking.booking_id);
    // admin_cancel_class_booking lets staff cancel any booking in their
    // gym (member RPC requires profile_id = auth.uid()). Migration 0378.
    const { error } = await supabase.rpc('admin_cancel_class_booking', { p_booking_id: booking.booking_id });
    setCancellingId(null);
    if (error) {
      showToast(error.message || t('admin.classes.cancelFailed', 'No se pudo cancelar'), 'error');
      return;
    }
    showToast(t('admin.classes.cancelled', 'Reserva cancelada'), 'success');
    queryClient.invalidateQueries({ queryKey: ['admin', 'class-attendees', schedule.id, date] });
  };

  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {schedule.start_time?.slice(0, 5)} – {schedule.end_time?.slice(0, 5)}
        </p>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: confirmedCount >= cap ? 'var(--color-danger)' : 'var(--color-accent)' }}>
          {confirmedCount} / {cap}
          {waitlistCount > 0 && (
            <span className="ml-1.5" style={{ color: 'var(--color-warning)' }}>
              · +{waitlistCount} {t('admin.classes.waitlist', 'lista')}
            </span>
          )}
        </span>
      </div>
      {isLoading ? (
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{tc('loading')}</p>
      ) : attendees.length === 0 ? (
        <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noBookings', 'Sin reservas')}</p>
      ) : (
        <ol className="space-y-1.5">
          {attendees.map((a, i) => {
            const isWait = a.status === 'waitlisted';
            const canCancel = a.status === 'confirmed' || a.status === 'waitlisted';
            return (
              <li
                key={a.booking_id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg"
                style={{ backgroundColor: 'var(--color-bg-card)' }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="text-[11px] font-bold tabular-nums w-6 text-right flex-shrink-0"
                    style={{ color: isWait ? 'var(--color-warning)' : 'var(--color-text-muted)' }}
                  >
                    {isWait ? `W${a.waitlist_position || ''}` : `${i + 1}.`}
                  </span>
                  <span className="text-[12.5px] truncate" style={{ color: 'var(--color-text-primary)' }}>
                    {a.full_name || t('admin.classes.unknown', 'Unknown')}
                  </span>
                </div>
                {a.status === 'attended' && (
                  <span className="text-[10px] uppercase tracking-wider font-bold flex-shrink-0" style={{ color: 'var(--color-success)' }}>
                    {t('admin.classes.attended', 'Asistió')}
                  </span>
                )}
                {isWait && (
                  <span className="text-[10px] uppercase tracking-wider font-bold flex-shrink-0" style={{ color: 'var(--color-warning)' }}>
                    {t('admin.classes.waitlistPill', 'Lista')}
                  </span>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => adminCancel(a)}
                    disabled={cancellingId === a.booking_id}
                    aria-label={t('admin.classes.cancelAttendee', 'Cancelar reserva')}
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50"
                    style={{
                      background: 'rgba(239,68,68,0.12)',
                      color: 'var(--color-danger)',
                      border: '1px solid rgba(239,68,68,0.3)',
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
