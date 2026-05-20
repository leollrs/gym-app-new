import { useMemo } from 'react';
import { Calendar, CalendarDays, Repeat, Edit3, Trash2, Users } from 'lucide-react';
import { DAYS_OF_WEEK } from '../../../lib/admin/classScheduleHelpers';

// ── Slot Card (shared between ScheduleView sections) ──
function SlotCard({ slot, onEditClass, onDeleteSlot, t }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group hover:shadow-sm"
      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
      <div className="w-1 h-8 rounded-full flex-shrink-0 transition-all duration-200 group-hover:h-10" style={{ backgroundColor: slot.class.accent_color || 'var(--color-accent)' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{slot.class.name}</p>
          {!slot.class.is_active && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>{t('admin.classes.inactive')}</span>
          )}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
          {slot.class.instructor && ` · ${slot.class.instructor}`}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
          <Users size={11} /> {slot.class.max_capacity}
        </span>
        <button onClick={() => onEditClass(slot.class)}
          aria-label={t('admin.classes.editClass', 'Edit class')}
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
          style={{ color: 'var(--color-text-muted)' }}>
          <Edit3 size={13} />
        </button>
        <button onClick={() => onDeleteSlot(slot.id)}
          aria-label={t('admin.classes.deleteSlot', 'Delete schedule slot')}
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
          style={{ color: 'var(--color-danger, #EF4444)' }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * "Schedule" tab on the AdminClasses page — flattens every slot across
 * every class into one calendar view, split into recurring (grouped by
 * day-of-week) and specific-date (grouped by date) sections.
 *
 * Slots in this view delegate edit → ClassFormModal (via `onEditClass`)
 * and delete → the parent's slot-delete mutation. Adding new slots is
 * done from within ClassFormModal on a per-class basis.
 */
export default function ScheduleView({ classes, onEditClass, onDeleteSlot, t, tc, lang }) {
  const { recurringSlots, specificSlots } = useMemo(() => {
    const recurring = [];
    const specific = [];
    for (const cls of classes) {
      for (const sched of (cls.gym_class_schedules || [])) {
        const slot = { ...sched, class: cls };
        if (sched.specific_date) specific.push(slot);
        else recurring.push(slot);
      }
    }
    recurring.sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || (a.start_time || '').localeCompare(b.start_time || ''));
    specific.sort((a, b) => a.specific_date.localeCompare(b.specific_date) || (a.start_time || '').localeCompare(b.start_time || ''));
    return { recurringSlots: recurring, specificSlots: specific };
  }, [classes]);

  // Group recurring by day
  const groupedRecurring = useMemo(() => {
    const map = {};
    for (const slot of recurringSlots) {
      const key = slot.day_of_week;
      if (!map[key]) map[key] = [];
      map[key].push(slot);
    }
    return map;
  }, [recurringSlots]);

  // Group specific by date
  const groupedSpecific = useMemo(() => {
    const map = {};
    for (const slot of specificSlots) {
      const key = slot.specific_date;
      if (!map[key]) map[key] = [];
      map[key].push(slot);
    }
    return map;
  }, [specificSlots]);

  if (recurringSlots.length === 0 && specificSlots.length === 0) {
    return (
      <div className="text-center py-16">
        <Calendar size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
        <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('admin.classes.noScheduleSlots')}</p>
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.addSlotsFromClasses')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Recurring weekly slots */}
      {recurringSlots.length > 0 && (
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
            style={{ color: 'var(--color-accent)' }}>
            <Repeat size={12} /> {t('admin.classes.recurringWeekly', 'Recurring Weekly')}
          </p>
          {DAYS_OF_WEEK.map(day => {
            const daySlots = groupedRecurring[day.value];
            if (!daySlots?.length) return null;
            return (
              <div key={day.value}>
                <p className="text-[12px] font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>{tc(day.labelKey)}</p>
                <div className="space-y-1.5">
                  {daySlots.map(slot => (
                    <SlotCard key={slot.id} slot={slot} onEditClass={onEditClass} onDeleteSlot={onDeleteSlot} t={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Specific-date slots */}
      {specificSlots.length > 0 && (
        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
            style={{ color: 'var(--color-info, #3B82F6)' }}>
            <CalendarDays size={12} /> {t('admin.classes.specificDates', 'Specific Dates')}
          </p>
          {Object.entries(groupedSpecific).map(([date, dateSlots]) => {
            const d = new Date(date + 'T00:00:00');
            const label = d.toLocaleDateString(lang, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            return (
              <div key={date}>
                <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
                <div className="space-y-1.5">
                  {dateSlots.map(slot => (
                    <SlotCard key={slot.id} slot={slot} onEditClass={onEditClass} onDeleteSlot={onDeleteSlot} t={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
