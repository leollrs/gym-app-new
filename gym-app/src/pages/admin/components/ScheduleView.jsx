import { useMemo, useState } from 'react';
import { Calendar, CalendarDays, Repeat, Edit3, Trash2, Users, Clock, ChevronLeft, ChevronRight } from 'lucide-react';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';
const fmtISO = (d) => d.toISOString().slice(0, 10);

/** Pill segmented control (Día / Semana / Mes). */
function Segmented({ items, active, onSelect }) {
  return (
    <div className="inline-flex" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', borderRadius: 999, padding: 4, gap: 2 }}>
      {items.map(it => {
        const on = it.key === active;
        return (
          <button key={it.key} onClick={() => onSelect(it.key)}
            style={{ height: 34, padding: '0 16px', borderRadius: 999, fontSize: 13, fontWeight: 700,
              color: on ? 'var(--color-accent)' : 'var(--color-admin-text-muted)',
              background: on ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'transparent' }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** Circular nav button (chevrons) or the accent "Hoy" pill. */
function NavBtn({ icon: Icon, label, accent, onClick, ariaLabel }) {
  if (label) {
    return (
      <button onClick={onClick} aria-label={ariaLabel}
        style={{ height: 38, padding: '0 16px', borderRadius: 999, fontSize: 13, fontWeight: 800,
          background: accent ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-card)',
          border: `1px solid ${accent ? 'color-mix(in srgb, var(--color-accent) 24%, transparent)' : 'var(--color-admin-border)'}`,
          color: accent ? 'var(--color-accent)' : 'var(--color-admin-text-sub)' }}>
        {label}
      </button>
    );
  }
  return (
    <button onClick={onClick} aria-label={ariaLabel} className="grid place-items-center"
      style={{ width: 38, height: 38, borderRadius: 999, background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
      <Icon size={16} strokeWidth={2.2} />
    </button>
  );
}

// ── Slot card — white card, accent bar, Archivo name, mono time, capacity ──
function SlotCard({ slot, onEditClass, onDeleteSlot, t }) {
  const isSpecific = !!slot.specific_date;
  return (
    <div className="group relative flex items-center gap-3.5 transition-shadow hover:shadow-md"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 14, padding: '14px 18px 14px 15px', overflow: 'hidden' }}>
      <span className="absolute left-0 top-0 bottom-0" style={{ width: 4, background: slot.class.accent_color || 'var(--color-accent)' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="truncate" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 15.5, letterSpacing: '-0.2px', color: 'var(--color-admin-text)' }}>{slot.class.name}</p>
          <span className="inline-flex items-center gap-1" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, background: isSpecific ? 'var(--color-info-soft)' : 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: isSpecific ? 'var(--color-info)' : 'var(--color-accent)' }}>
            {isSpecific ? <CalendarDays size={9} /> : <Repeat size={9} />}
            {isSpecific ? t('admin.classes.specificShort', 'One-off') : t('admin.classes.recurringShort', 'Weekly')}
          </span>
          {!slot.class.is_active && (
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999, background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}>{t('admin.classes.inactive')}</span>
          )}
        </div>
        <div className="inline-flex items-center gap-1.5 mt-1.5" style={{ fontFamily: MONO_FONT, fontSize: 13, fontWeight: 600, color: 'var(--color-admin-text-sub)' }}>
          <Clock size={13} strokeWidth={2} style={{ color: 'var(--color-admin-text-muted)' }} />
          {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
          {slot.class.instructor && <span style={{ color: 'var(--color-admin-text-muted)', fontFamily: DISPLAY_FONT, fontWeight: 600 }}>· {slot.class.instructor}</span>}
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 flex-shrink-0" style={{ fontFamily: MONO_FONT, fontSize: 13, color: 'var(--color-admin-text-muted)' }}>
        <Users size={14} strokeWidth={2} /> {slot.class.max_capacity}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEditClass(slot.class)} aria-label={t('admin.classes.editClass', 'Edit class')}
          className="grid place-items-center hover:bg-[var(--color-bg-hover)] transition-colors"
          style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-muted)' }}>
          <Edit3 size={13} />
        </button>
        <button onClick={() => onDeleteSlot(slot.id)} aria-label={t('admin.classes.deleteSlot', 'Delete schedule slot')}
          className="grid place-items-center hover:bg-[var(--color-bg-hover)] transition-colors"
          style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--color-admin-border)', color: 'var(--color-danger)' }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * "Schedule" tab — the class timetable, filterable by Día / Semana / Mes with
 * date navigation (mirrors the Reservas tab). For each date in scope it lists
 * the sessions that actually run: recurring slots whose day_of_week matches +
 * any specific-date slots on that exact date. Slots edit → ClassFormModal and
 * delete → the parent slot-delete mutation (recurring delete removes the whole
 * weekly slot, since that's the template).
 */
export default function ScheduleView({ classes, onEditClass, onDeleteSlot, t, tc, lang }) {
  const todayStr = fmtISO(new Date());
  const [viewMode, setViewMode] = useState('week'); // 'day' | 'week' | 'month'
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [monthSelectedDate, setMonthSelectedDate] = useState(null); // tapped day in month calendar

  // Flatten every slot across every class, split recurring vs specific-date.
  const { recurring, specific, isEmpty } = useMemo(() => {
    const rec = [], spec = [];
    for (const cls of classes) {
      for (const sched of (cls.gym_class_schedules || [])) {
        const slot = { ...sched, class: cls };
        if (sched.specific_date) spec.push(slot); else rec.push(slot);
      }
    }
    return { recurring: rec, specific: spec, isEmpty: rec.length === 0 && spec.length === 0 };
  }, [classes]);

  const slotsForDate = (dateObj) => {
    const dow = dateObj.getDay();
    const iso = fmtISO(dateObj);
    const rows = [
      ...recurring.filter(s => s.day_of_week === dow),
      ...specific.filter(s => s.specific_date === iso),
    ];
    return rows.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  };

  // Dates in scope for the current view.
  const dates = useMemo(() => {
    if (viewMode === 'day') return [new Date(selectedDate + 'T00:00:00')];
    if (viewMode === 'week') {
      const s = new Date(anchor); s.setDate(s.getDate() - s.getDay());
      return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d; });
    }
    const y = anchor.getFullYear(), m = anchor.getMonth(), total = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: total }, (_, i) => new Date(y, m, i + 1));
  }, [viewMode, anchor, selectedDate]);

  const shift = (dir) => {
    setMonthSelectedDate(null);
    if (viewMode === 'day') {
      const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + dir);
      setSelectedDate(fmtISO(d)); setAnchor(d);
    } else {
      setAnchor(prev => { const d = new Date(prev); if (viewMode === 'week') d.setDate(d.getDate() + dir * 7); else d.setMonth(d.getMonth() + dir); return d; });
    }
  };
  const goToday = () => { setAnchor(new Date()); setSelectedDate(todayStr); setMonthSelectedDate(todayStr); };

  const headerLabel = useMemo(() => {
    if (viewMode === 'day') return new Date(selectedDate + 'T12:00:00').toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (viewMode === 'week') {
      const f = dates[0], l = dates[6];
      if (!f || !l) return '';
      return `${f.toLocaleDateString(lang, { day: 'numeric', month: 'short' })} – ${l.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return anchor.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  }, [viewMode, selectedDate, dates, anchor, lang]);

  // Total sessions in the current scope (for the summary line).
  const totalInScope = useMemo(() => dates.reduce((sum, d) => sum + slotsForDate(d).length, 0), [dates, recurring, specific]); // eslint-disable-line react-hooks/exhaustive-deps

  const VIEW_MODES = [
    { key: 'day', label: t('admin.classes.viewDay', 'Día') },
    { key: 'week', label: t('admin.classes.viewWeek', 'Semana') },
    { key: 'month', label: t('admin.classes.viewMonth', 'Mes') },
  ];

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center text-center" style={{ padding: '56px 24px 30px' }}>
        <div className="grid place-items-center" style={{ width: 62, height: 62, borderRadius: 18, background: 'var(--color-admin-panel)' }}>
          <Calendar size={28} strokeWidth={1.7} style={{ color: 'var(--color-admin-text-faint)' }} />
        </div>
        <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px', color: 'var(--color-admin-text)', marginTop: 16 }}>{t('admin.classes.noScheduleSlots')}</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-admin-text-muted)', marginTop: 5 }}>{t('admin.classes.addSlotsFromClasses')}</div>
      </div>
    );
  }

  const dowHeaders = [t('admin.classes.daySun', 'D'), t('admin.classes.dayMon', 'L'), t('admin.classes.dayTue', 'M'), t('admin.classes.dayWed', 'X'), t('admin.classes.dayThu', 'J'), t('admin.classes.dayFri', 'V'), t('admin.classes.daySat', 'S')];

  const monthGrid = useMemo(() => {
    if (viewMode !== 'month') return [];
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(y, m, d));
    return cells;
  }, [viewMode, anchor]);

  // One day's heading + its sessions (shared by day/week lists and the month detail).
  const daySection = (d, headerOpts) => {
    const slots = slotsForDate(d);
    const iso = fmtISO(d);
    const isToday = iso === todayStr;
    return (
      <div key={iso}>
        <div className="flex items-center gap-2 mb-2">
          <span style={{ fontFamily: MONO_FONT, fontSize: 11.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: isToday ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }}>
            {d.toLocaleDateString(lang, headerOpts)}
          </span>
          {isToday && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', color: 'var(--color-accent)', background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', padding: '1px 7px', borderRadius: 999 }}>{t('admin.classes.today', 'Hoy')}</span>}
        </div>
        {slots.length === 0 ? (
          <p className="text-[12.5px] italic px-1 py-2" style={{ color: 'var(--color-admin-text-faint)' }}>{t('admin.classes.noClassesShort', 'No classes')}</p>
        ) : (
          <div className="space-y-2">
            {slots.map(slot => (
              <SlotCard key={`${iso}-${slot.id}`} slot={slot} onEditClass={onEditClass} onDeleteSlot={onDeleteSlot} t={t} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented items={VIEW_MODES} active={viewMode} onSelect={(k) => { setViewMode(k); setMonthSelectedDate(null); }} />
        <div className="flex items-center gap-2 ml-auto">
          <NavBtn icon={ChevronLeft} onClick={() => shift(-1)} ariaLabel={t('admin.classes.previousPeriod', 'Previous')} />
          <NavBtn label={t('admin.classes.today', 'Hoy')} accent onClick={goToday} />
          <NavBtn icon={ChevronRight} onClick={() => shift(1)} ariaLabel={t('admin.classes.nextPeriod', 'Next')} />
        </div>
      </div>

      {/* Header + scope summary */}
      <div className="text-center">
        <p className="capitalize" style={{ fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--color-admin-text)' }}>{headerLabel}</p>
        <p style={{ fontFamily: MONO_FONT, fontSize: 12, color: 'var(--color-admin-text-muted)', marginTop: 3 }}>
          {totalInScope} {totalInScope === 1 ? t('admin.classes.sessionOne', 'session') : t('admin.classes.sessions', 'sessions')}
        </p>
      </div>

      {/* Month → calendar grid; Day/Week → day list */}
      {viewMode === 'month' ? (
        <>
          <div>
            <div className="grid grid-cols-7 mb-1">
              {dowHeaders.map((dh, i) => (
                <div key={i} className="text-center" style={{ fontFamily: MONO_FONT, fontSize: 11.5, fontWeight: 600, letterSpacing: '1px', color: 'var(--color-admin-text-faint)', padding: '4px 0' }}>{dh}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {monthGrid.map((d, i) => {
                if (!d) return <div key={`e-${i}`} />;
                const iso = fmtISO(d);
                const count = slotsForDate(d).length;
                const isToday = iso === todayStr;
                const sel = monthSelectedDate === iso;
                return (
                  <button key={iso} onClick={() => setMonthSelectedDate(prev => prev === iso ? null : iso)} className="flex flex-col items-center py-1">
                    <span className="grid place-items-center" style={{
                      minWidth: 34, height: 32, padding: '0 8px', borderRadius: 999,
                      fontFamily: MONO_FONT, fontSize: 14, fontWeight: (isToday || sel) ? 700 : 500,
                      color: sel ? '#fff' : isToday ? 'var(--color-accent)' : (count > 0 ? 'var(--color-admin-text)' : 'var(--color-admin-text-muted)'),
                      background: sel ? 'var(--color-accent)' : 'transparent',
                      border: `1.5px solid ${isToday && !sel ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'transparent'}`,
                      boxShadow: sel ? '0 2px 8px color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'none',
                    }}>{d.getDate()}</span>
                    <span style={{ height: 8, marginTop: 2 }}>
                      {count > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <span className="rounded-full" style={{ width: 4, height: 4, background: 'var(--color-accent)' }} />
                          <span style={{ fontFamily: MONO_FONT, fontSize: 8, fontWeight: 700, color: 'var(--color-admin-text-muted)' }}>{count}</span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {monthSelectedDate
            ? <div className="pt-1">{daySection(new Date(monthSelectedDate + 'T00:00:00'), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            : <p className="text-center py-6 text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.classes.tapDateToSeeClasses', 'Tap a date to see its classes')}</p>}
        </>
      ) : (
        <div className="space-y-5">
          {dates.map(d => daySection(d, viewMode === 'day' ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }))}
        </div>
      )}
    </div>
  );
}
