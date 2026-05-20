import { useState } from 'react';
import { Repeat, CalendarDays, Plus, X } from 'lucide-react';
import { addMinutes, format12h, DAYS_OF_WEEK } from '../../../lib/admin/classScheduleHelpers';

/**
 * Sub-form used inside ClassFormModal to add new schedule slots — either
 * recurring (a set of weekly days at a fixed start time) or specific
 * dates. Each click of "Add Schedule" fires `onAdd` once per selected
 * day/date, so multi-day recurring or multi-date specific are submitted
 * as one batch.
 *
 * End time is derived from the parent class's duration (`durationMinutes`)
 * — there's no end-time input here so changing the duration on the parent
 * class re-syncs every slot at once.
 */
export default function ScheduleSlotForm({ onAdd, durationMinutes = 60, t, tc, lang }) {
  const [mode, setMode] = useState('recurring'); // 'recurring' | 'specific'
  const [selectedDays, setSelectedDays] = useState([1]); // multiple days for recurring
  const [selectedDates, setSelectedDates] = useState([]); // multiple dates for specific
  const [dateInput, setDateInput] = useState('');
  const [startTime, setStartTime] = useState('09:00');

  const endTime = addMinutes(startTime, durationMinutes).slice(0, 5);

  const toggleDay = (dayVal) => {
    setSelectedDays(prev =>
      prev.includes(dayVal) ? prev.filter(d => d !== dayVal) : [...prev, dayVal].sort(),
    );
  };

  const addDate = () => {
    if (!dateInput || selectedDates.includes(dateInput)) return;
    setSelectedDates(prev => [...prev, dateInput].sort());
    setDateInput('');
  };

  const removeDate = (date) => {
    setSelectedDates(prev => prev.filter(d => d !== date));
  };

  const handleAdd = () => {
    const computedEnd = addMinutes(startTime, durationMinutes);
    if (mode === 'recurring') {
      for (const day of selectedDays) {
        onAdd({
          day_of_week: day,
          specific_date: null,
          start_time: startTime,
          end_time: computedEnd,
        });
      }
    } else {
      for (const date of selectedDates) {
        onAdd({
          day_of_week: null,
          specific_date: date,
          start_time: startTime,
          end_time: computedEnd,
        });
      }
      setSelectedDates([]);
    }
  };

  const canAdd = mode === 'recurring' ? selectedDays.length > 0 : selectedDates.length > 0;

  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-2.5">
      {/* Mode toggle */}
      <div className="flex gap-1">
        <button type="button" onClick={() => setMode('recurring')}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
          style={mode === 'recurring'
            ? { backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 15%, transparent)', color: 'var(--color-accent, #D4AF37)', border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 30%, transparent)' }
            : { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
          }>
          <Repeat size={11} /> {t('admin.classes.recurring', 'Recurring')}
        </button>
        <button type="button" onClick={() => setMode('specific')}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
          style={mode === 'specific'
            ? { backgroundColor: 'var(--color-info-soft)', color: 'var(--color-info)', border: '1px solid var(--color-info-soft)' }
            : { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
          }>
          <CalendarDays size={11} /> {t('admin.classes.specificDate', 'Specific Date')}
        </button>
      </div>

      {/* Day/Date selector */}
      {mode === 'recurring' ? (
        <div>
          <label className="block text-[10px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.selectDays', 'Select days')}</label>
          {/* Week strip — Mon → Sun grid so days line up visually */}
          <div className="grid grid-cols-7 gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map(dayVal => {
              const d = DAYS_OF_WEEK.find(x => x.value === dayVal);
              const selected = selectedDays.includes(dayVal);
              return (
                <button key={dayVal} type="button" onClick={() => toggleDay(dayVal)}
                  className="py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-all"
                  style={selected
                    ? { backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 18%, transparent)', color: 'var(--color-accent, #D4AF37)', border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 40%, transparent)' }
                    : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                  }>
                  {tc(d.labelKey)?.slice(0, 1)}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.pickDates', 'Pick dates')}</label>
          <div className="flex items-center gap-2 mb-1.5">
            <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              aria-label={t('admin.classes.pickDates', 'Pick dates')}
              className="flex-1 rounded-lg px-2 py-2 text-[12px] outline-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            <button type="button" onClick={addDate} disabled={!dateInput}
              aria-label={t('admin.classes.addDate', 'Add date')}
              className="p-2 rounded-lg disabled:opacity-30 transition-colors"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-info) 12%, transparent)',
                color: 'var(--color-info)',
              }}>
              <Plus size={14} />
            </button>
          </div>
          {selectedDates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedDates.map(date => (
                <span key={date} className="admin-pill admin-pill--info inline-flex items-center gap-1">
                  {fmtDate(date)}
                  <button type="button" onClick={() => removeDate(date)} aria-label={t('admin.classes.removeDate', 'Remove date')} className="hover:text-red-400 transition-colors"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Start time only — end is derived from class duration so changing
          the duration updates every slot at once. iOS shows the wheel
          picker with AM/PM. */}
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.startTime')}</label>
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="w-full rounded-lg px-2 py-2 text-[13px] outline-none tabular-nums"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
        />
      </div>
      <p className="text-[11px] tabular-nums text-center mb-2" style={{ color: 'var(--color-text-muted)' }}>
        {format12h(startTime)} <span style={{ opacity: 0.6 }}>–</span> {format12h(endTime)}
        <span className="ml-1" style={{ opacity: 0.6 }}>({durationMinutes} {tc('min') || 'min'})</span>
      </p>
      {/* Add button */}
      <button onClick={handleAdd} disabled={!canAdd}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-semibold disabled:opacity-30 transition-colors" aria-label={t('admin.classes.addSchedule')}
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 12%, transparent)', color: 'var(--color-accent, #D4AF37)' }}>
        <Plus size={14} /> {t('admin.classes.addSchedule', 'Add Schedule')}
      </button>
    </div>
  );
}
