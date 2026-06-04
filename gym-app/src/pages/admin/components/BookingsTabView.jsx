import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { classImageUrl } from '../../../lib/classImageUrl';
import CoverPreview from './CoverPreview';

const DISPLAY_FONT = 'var(--admin-font-display, "Archivo", system-ui, sans-serif)';
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

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

/** Circular calendar nav button (chevrons) or the accent "Hoy" pill. */
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
    <button onClick={onClick} aria-label={ariaLabel}
      className="grid place-items-center"
      style={{ width: 38, height: 38, borderRadius: 999, background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text-sub)' }}>
      <Icon size={16} strokeWidth={2.2} />
    </button>
  );
}

/**
 * Top-level "Bookings" tab on the AdminClasses page.
 *
 * Three view modes (day / week / month) with a shared date-range query.
 * Day view shows every booking on the selected date; week view exposes a
 * 7-day strip with per-day dots that promote a date into the detail list;
 * month view renders a calendar grid with booking counts per day.
 *
 * Hard 2000-row limit on the booking query — a misconfigured date range or
 * a peak-week gym shouldn't be able to pull tens of thousands of rows
 * client-side. Admins who need broader windows export via Reports.
 */
export default function BookingsTabView({ classes, t, tc, locale = 'es' }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [viewMode, setViewMode] = useState('day');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [expandedClassId, setExpandedClassId] = useState(null);
  const [monthSelectedDate, setMonthSelectedDate] = useState(null); // date tapped in month view

  const shift = (dir) => {
    setAnchorDate(prev => {
      const d = new Date(prev);
      if (viewMode === 'day') d.setDate(d.getDate() + dir);
      else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
    if (viewMode === 'day') {
      setSelectedDate(prev => {
        const d = new Date(prev + 'T12:00:00');
        d.setDate(d.getDate() + dir);
        return d.toISOString().slice(0, 10);
      });
    }
    setMonthSelectedDate(null);
    setExpandedClassId(null);
  };

  const goToday = () => { setAnchorDate(new Date()); setSelectedDate(todayStr); setMonthSelectedDate(null); };

  // Week days for week view
  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return [];
    const base = new Date(anchorDate);
    base.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return { iso, day: d.toLocaleDateString(locale, { weekday: 'short' }), num: d.getDate(), isToday: iso === todayStr };
    });
  }, [anchorDate, viewMode, todayStr, locale]);

  // Month grid
  const monthDays = useMemo(() => {
    if (viewMode !== 'month') return [];
    const y = anchorDate.getFullYear(), m = anchorDate.getMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const total = new Date(y, m + 1, 0).getDate();
    const result = [];
    for (let i = 0; i < firstDay; i++) result.push(null);
    for (let d = 1; d <= total; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push({ iso, num: d, isToday: iso === todayStr });
    }
    return result;
  }, [anchorDate, viewMode, todayStr]);

  // Date range for query
  const { dateFrom, dateTo } = useMemo(() => {
    if (viewMode === 'day') return { dateFrom: selectedDate, dateTo: selectedDate };
    if (viewMode === 'week' && weekDays.length) return { dateFrom: weekDays[0].iso, dateTo: weekDays[6].iso };
    const y = anchorDate.getFullYear(), m = anchorDate.getMonth();
    return {
      dateFrom: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      dateTo: `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`,
    };
  }, [viewMode, selectedDate, weekDays, anchorDate]);

  // Header
  const headerLabel = useMemo(() => {
    if (viewMode === 'day') {
      const d = new Date(selectedDate + 'T12:00:00');
      return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (viewMode === 'week' && weekDays.length) {
      const f = new Date(weekDays[0].iso + 'T12:00:00');
      const l = new Date(weekDays[6].iso + 'T12:00:00');
      return `${f.getDate()} – ${l.getDate()} ${f.toLocaleDateString(locale, { month: 'short', year: 'numeric' })}`;
    }
    return anchorDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }, [viewMode, selectedDate, weekDays, anchorDate, locale]);

  // Fetch bookings — bounded by a hard 2000-row cap so a busy gym (or a misconfigured
  // date window) can't accidentally pull tens of thousands of rows and freeze the UI.
  // 2000 covers a full month of every-class-full at 60+ bookings per day; admins who
  // need more should narrow the date range or use the Reports CSV export.
  const BOOKINGS_LIMIT = 2000;
  const classIds = classes.map(c => c.id);
  const { data: bookingsResult = { rows: [], truncated: false }, isLoading } = useQuery({
    queryKey: adminKeys.classes.bookingsTab(viewMode, dateFrom, dateTo),
    queryFn: async () => {
      if (!classIds.length) return { rows: [], truncated: false };
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, class_id, status, attended, rating, booking_date, booked_at, waitlist_position, profiles(id, full_name, avatar_url)')
        .in('class_id', classIds)
        .gte('booking_date', dateFrom)
        .lte('booking_date', dateTo)
        .order('booked_at')
        .limit(BOOKINGS_LIMIT);
      const rows = data || [];
      return { rows, truncated: rows.length >= BOOKINGS_LIMIT };
    },
    enabled: classIds.length > 0,
    staleTime: 30_000,
  });
  const allBookings = bookingsResult.rows;
  // bookingsTruncated flag is computed but not currently surfaced in the UI;
  // keeping the calculation so a future banner can warn when the cap was hit.
  // eslint-disable-next-line no-unused-vars
  const bookingsTruncated = bookingsResult.truncated;

  // Visible bookings: day = just that day, week = tapped day or all, month = tapped day or none
  const displayDate = viewMode === 'month' ? monthSelectedDate : viewMode === 'week' ? selectedDate : selectedDate;
  const visibleBookings = useMemo(() => {
    if (viewMode === 'day') return allBookings;
    if (displayDate) return allBookings.filter(b => b.booking_date === displayDate);
    return [];
  }, [allBookings, viewMode, displayDate]);

  // Group by class
  const classBookings = useMemo(() => {
    return classes
      .map(cls => {
        const bookings = visibleBookings.filter(b => b.class_id === cls.id);
        const confirmed = bookings.filter(b => b.status === 'confirmed').length;
        const waitlisted = bookings.filter(b => b.status === 'waitlisted').length;
        return { cls, bookings, confirmed, waitlisted, total: bookings.length };
      })
      .filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [classes, visibleBookings]);

  // Bookings per date (for dots)
  const bookingsByDate = useMemo(() => {
    const m = {};
    allBookings.forEach(b => { m[b.booking_date] = (m[b.booking_date] || 0) + 1; });
    return m;
  }, [allBookings]);

  const statusStyle = (b) => {
    const styles = {
      confirmed: { bg: 'var(--color-success-soft)', color: 'var(--color-success-ink)' },
      waitlisted: { bg: 'var(--color-info-soft)', color: 'var(--color-info)' },
      cancelled: { bg: 'var(--color-danger-soft)', color: 'var(--color-danger-ink)' },
      attended: { bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' },
    };
    return styles[b.attended ? 'attended' : b.status] || styles.confirmed;
  };

  const statusLabel = (b) => b.attended ? t('admin.classes.attended', 'Asistió') : t(`admin.classes.status_${b.status}`, b.status);

  const VIEW_MODES = [
    { key: 'day', label: t('admin.classes.viewDay', 'Día') },
    { key: 'week', label: t('admin.classes.viewWeek', 'Semana') },
    { key: 'month', label: t('admin.classes.viewMonth', 'Mes') },
  ];

  // Day label for the bookings section below calendar
  const detailDateLabel = displayDate
    ? new Date(displayDate + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  const dowHeaders = [t('admin.classes.daySun', 'D'), t('admin.classes.dayMon', 'L'), t('admin.classes.dayTue', 'M'), t('admin.classes.dayWed', 'X'), t('admin.classes.dayThu', 'J'), t('admin.classes.dayFri', 'V'), t('admin.classes.daySat', 'S')];

  return (
    <div className="space-y-4">
      {/* View toggle + nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented items={VIEW_MODES} active={viewMode}
          onSelect={(k) => { setViewMode(k); setMonthSelectedDate(null); setExpandedClassId(null); }} />
        <div className="flex items-center gap-2 ml-auto">
          <NavBtn icon={ChevronLeft} onClick={() => shift(-1)} ariaLabel={t('admin.classes.previousPeriod', 'Previous period')} />
          <NavBtn label={t('admin.classes.today', 'Hoy')} accent onClick={goToday} />
          <NavBtn icon={ChevronRight} onClick={() => shift(1)} ariaLabel={t('admin.classes.nextPeriod', 'Next period')} />
        </div>
      </div>

      {/* Header */}
      <p className="text-center capitalize" style={{ fontFamily: DISPLAY_FONT, fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--color-admin-text)' }}>{headerLabel}</p>

      {/* Week strip (week view only) */}
      {viewMode === 'week' && (
        <div className="flex gap-2.5">
          {weekDays.map(d => {
            const hasBookings = (bookingsByDate[d.iso] || 0) > 0;
            const isSelected = selectedDate === d.iso;
            return (
              <button key={d.iso} onClick={() => { setSelectedDate(d.iso); setExpandedClassId(null); }}
                className="flex-1 flex flex-col items-center transition-all"
                style={{ padding: '12px 0 12px', borderRadius: 14,
                  background: isSelected ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'var(--color-bg-card)',
                  border: `1px solid ${isSelected ? 'transparent' : 'var(--color-admin-border)'}` }}>
                <span style={{ fontFamily: MONO_FONT, fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: isSelected ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }}>{d.day}</span>
                <span style={{ fontFamily: DISPLAY_FONT, fontSize: 22, fontWeight: 800, letterSpacing: '-0.8px', marginTop: 4, color: isSelected ? 'var(--color-accent)' : 'var(--color-admin-text)' }}>{d.num}</span>
                <span style={{ height: 6, marginTop: 5 }}>
                  {d.isToday ? <span className="block rounded-full" style={{ width: 5, height: 5, background: 'var(--color-accent)' }} />
                    : hasBookings ? <span className="block rounded-full" style={{ width: 5, height: 5, background: 'var(--color-success)' }} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Month grid */}
      {viewMode === 'month' && (
        <div>
          <div className="grid grid-cols-7 mb-1">
            {dowHeaders.map((d, i) => (
              <div key={i} className="text-center" style={{ fontFamily: MONO_FONT, fontSize: 11.5, fontWeight: 600, letterSpacing: '1px', color: 'var(--color-admin-text-faint)', padding: '4px 0' }}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {monthDays.map((d, i) => d ? (
              <button key={d.iso}
                onClick={() => { setMonthSelectedDate(prev => prev === d.iso ? null : d.iso); setExpandedClassId(null); }}
                className="flex flex-col items-center py-1">
                <span className="grid place-items-center" style={{
                  minWidth: 34, height: 32, padding: '0 8px', borderRadius: 999,
                  fontFamily: MONO_FONT, fontSize: 14, fontWeight: (d.isToday || monthSelectedDate === d.iso) ? 700 : 500,
                  color: monthSelectedDate === d.iso ? '#fff' : d.isToday ? 'var(--color-accent)' : 'var(--color-admin-text-sub)',
                  background: monthSelectedDate === d.iso ? 'var(--color-accent)' : 'transparent',
                  border: `1.5px solid ${d.isToday && monthSelectedDate !== d.iso ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'transparent'}`,
                  boxShadow: monthSelectedDate === d.iso ? '0 2px 8px color-mix(in srgb, var(--color-accent) 32%, transparent)' : 'none',
                }}>{d.num}</span>
                <span style={{ height: 8, marginTop: 2 }}>
                  {(bookingsByDate[d.iso] || 0) > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <span className="rounded-full" style={{ width: 4, height: 4, background: 'var(--color-success)' }} />
                      <span style={{ fontFamily: MONO_FONT, fontSize: 8, fontWeight: 700, color: 'var(--color-admin-text-muted)' }}>{bookingsByDate[d.iso]}</span>
                    </span>
                  )}
                </span>
              </button>
            ) : <div key={`e-${i}`} />)}
          </div>
        </div>
      )}

      {/* Subhead: selected day + counts */}
      {(viewMode === 'day' || displayDate) && (
        <div>
          {viewMode !== 'day' && detailDateLabel && (
            <p className="capitalize" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px', color: 'var(--color-accent)' }}>{detailDateLabel}</p>
          )}
          <div className="flex items-center gap-2 mt-1" style={{ fontFamily: MONO_FONT, fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: 'var(--color-admin-text)' }}>{visibleBookings.length} {t('admin.classes.bookingsTotal', 'reservas')}</span>
            <span style={{ color: 'var(--color-admin-text-faint)' }}>·</span>
            <span style={{ color: 'var(--color-admin-text-muted)' }}>{classBookings.length} {classBookings.length === 1 ? t('admin.classes.classLabel', 'clase') : t('admin.classes.classesLabel', 'clases')}</span>
          </div>
        </div>
      )}

      {/* Month view: no date selected prompt */}
      {viewMode === 'month' && !monthSelectedDate && !isLoading && (
        <div className="text-center py-6">
          <CalendarDays size={24} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-faint)' }} />
          <p className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.classes.tapDateToSee', 'Toca una fecha para ver las reservas')}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <span className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>{tc('loading')}</span>
        </div>
      ) : classBookings.length === 0 && (viewMode === 'day' || displayDate) ? (
        <div className="flex flex-col items-center text-center" style={{ padding: '44px 24px 26px' }}>
          <div className="grid place-items-center" style={{ width: 62, height: 62, borderRadius: 18, background: 'var(--color-admin-panel)' }}>
            <Users size={28} strokeWidth={1.7} style={{ color: 'var(--color-admin-text-faint)' }} />
          </div>
          <div style={{ fontFamily: DISPLAY_FONT, fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px', color: 'var(--color-admin-text)', marginTop: 16 }}>{t('admin.classes.noBookingsTitle', 'No hay reservas')}</div>
          <div style={{ fontSize: 13.5, color: 'var(--color-admin-text-muted)', marginTop: 5 }}>{t('admin.classes.noBookingsForDate', 'No bookings for this date')}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {classBookings.map(({ cls, bookings, confirmed, waitlisted, total }) => {
            const isExpanded = expandedClassId === cls.id;
            const capacityPct = cls.max_capacity ? Math.min((confirmed / cls.max_capacity) * 100, 100) : 0;

            return (
              <div key={cls.id} className="overflow-hidden transition-all"
                style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)', borderRadius: 14 }}>
                {/* Class header — tap to expand */}
                <button className="w-full flex items-center gap-3 p-3.5 text-left"
                  onClick={() => setExpandedClassId(isExpanded ? null : cls.id)}>
                  {cls.cover_preset ? (
                    <CoverPreview preset={cls.cover_preset} size="sm" className="flex-shrink-0" />
                  ) : classImageUrl(cls.image_path) ? (
                    <img src={classImageUrl(cls.image_path)} alt={cls.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
                      <CalendarDays size={16} style={{ color: cls.accent_color || 'var(--color-accent)' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontFamily: DISPLAY_FONT, fontSize: 14.5, fontWeight: 700, color: 'var(--color-admin-text)' }}>{cls.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.3px', padding: '2px 8px', borderRadius: 999, background: 'var(--color-success-soft)', color: 'var(--color-success-ink)' }}>{confirmed} {t('admin.classes.confirmed', 'confirmed')}</span>
                      {waitlisted > 0 && <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.3px', padding: '2px 8px', borderRadius: 999, background: 'var(--color-info-soft)', color: 'var(--color-info)' }}>{waitlisted} {t('admin.classes.waitlisted', 'waitlist')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span style={{ fontFamily: DISPLAY_FONT, fontSize: 15, fontWeight: 800, color: 'var(--color-admin-text)' }}>{total}</span>
                    {isExpanded ? <ChevronUp size={15} style={{ color: 'var(--color-admin-text-muted)' }} /> : <ChevronDown size={15} style={{ color: 'var(--color-admin-text-muted)' }} />}
                  </div>
                </button>

                {/* Capacity bar */}
                {cls.max_capacity > 0 && (
                  <div className="px-3.5 pb-2.5">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-admin-panel)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${capacityPct}%`, background: capacityPct >= 90 ? 'var(--color-danger)' : capacityPct >= 70 ? 'var(--color-warning)' : 'var(--color-success)' }} />
                    </div>
                    <p className="mt-1 text-right" style={{ fontFamily: MONO_FONT, fontSize: 9.5, color: 'var(--color-admin-text-muted)' }}>{confirmed}/{cls.max_capacity}</p>
                  </div>
                )}

                {/* Expanded member list */}
                {isExpanded && (
                  <div className="px-3.5 pb-3 space-y-1.5" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                    <div className="pt-2" />
                    {bookings.map(b => {
                      const sc = statusStyle(b);
                      return (
                        <div key={b.id} className="flex items-center gap-2.5 py-1.5">
                          {b.profiles?.avatar_url ? (
                            <img src={b.profiles.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ background: 'var(--color-admin-panel)' }}>
                              <span className="text-[10px] font-bold" style={{ color: 'var(--color-admin-text-sub)' }}>{b.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                            </div>
                          )}
                          <p className="text-[12px] font-medium truncate flex-1" style={{ color: 'var(--color-admin-text)' }}>{b.profiles?.full_name || '?'}</p>
                          <span className="flex-shrink-0" style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.3px', padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.color }}>
                            {statusLabel(b)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
