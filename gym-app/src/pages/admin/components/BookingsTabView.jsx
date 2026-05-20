import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { classImageUrl } from '../../../lib/classImageUrl';
import CoverPreview from './CoverPreview';

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
        .select('id, class_id, status, attended, rating, booking_date, created_at, waitlist_position, profiles(id, full_name, avatar_url)')
        .in('class_id', classIds)
        .gte('booking_date', dateFrom)
        .lte('booking_date', dateTo)
        .order('created_at')
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
      confirmed: { bg: 'var(--color-success-soft)', color: 'var(--color-success)' },
      waitlisted: { bg: 'var(--color-info-soft)', color: 'var(--color-info)' },
      cancelled: { bg: 'var(--color-danger-soft)', color: 'var(--color-danger)' },
      attended: { bg: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)' },
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

  return (
    <div className="space-y-3">
      {/* View toggle + nav */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 p-1 rounded-xl flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          {VIEW_MODES.map(v => (
            <button key={v.key} onClick={() => { setViewMode(v.key); setMonthSelectedDate(null); setExpandedClassId(null); }}
              className="px-3 sm:px-3.5 py-2 rounded-lg text-[12px] sm:text-[13px] font-semibold transition-colors"
              style={viewMode === v.key
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
                : { color: 'var(--color-text-muted)' }
              }>{v.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <button onClick={() => shift(-1)} aria-label={t('admin.classes.previousPeriod', 'Previous period')} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
            <ChevronDown size={16} className="rotate-90" />
          </button>
          <button onClick={goToday} className="px-3 sm:px-3.5 py-2 rounded-xl text-[12px] font-bold"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}>
            {t('admin.classes.today', 'Hoy')}
          </button>
          <button onClick={() => shift(1)} aria-label={t('admin.classes.nextPeriod', 'Next period')} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
            <ChevronDown size={16} className="-rotate-90" />
          </button>
        </div>
      </div>

      {/* Header */}
      <p className="text-[13px] font-semibold text-center capitalize" style={{ color: 'var(--color-text-primary)' }}>{headerLabel}</p>

      {/* Week strip (week view only) */}
      {viewMode === 'week' && (
        <div className="flex justify-between gap-1">
          {weekDays.map(d => {
            const hasBookings = (bookingsByDate[d.iso] || 0) > 0;
            const isSelected = selectedDate === d.iso;
            return (
              <button key={d.iso} onClick={() => { setSelectedDate(d.iso); setExpandedClassId(null); }}
                className="flex-1 flex flex-col items-center py-2 rounded-xl transition-all"
                style={isSelected
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' }
                  : { backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }
                }>
                <span className="text-[9px] font-medium uppercase" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>{d.day}</span>
                <span className="text-[15px] font-bold" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{d.num}</span>
                {d.isToday && <div className="w-1 h-1 rounded-full mt-0.5" style={{ backgroundColor: 'var(--color-accent)' }} />}
                {hasBookings && !d.isToday && <div className="w-1 h-1 rounded-full mt-0.5" style={{ backgroundColor: 'var(--color-success)' }} />}
              </button>
            );
          })}
        </div>
      )}

      {/* Month grid */}
      {viewMode === 'month' && (
        <div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {[t('admin.classes.daySun', 'D'), t('admin.classes.dayMon', 'L'), t('admin.classes.dayTue', 'M'), t('admin.classes.dayWed', 'X'), t('admin.classes.dayThu', 'J'), t('admin.classes.dayFri', 'V'), t('admin.classes.daySat', 'S')].map((d, i) => (
              <div key={i} className="text-center text-[9px] font-semibold py-1" style={{ color: 'var(--color-text-muted)' }}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {monthDays.map((d, i) => d ? (
              <button key={d.iso}
                onClick={() => { setMonthSelectedDate(prev => prev === d.iso ? null : d.iso); setExpandedClassId(null); }}
                className="flex flex-col items-center py-1.5 rounded-lg transition-all"
                style={monthSelectedDate === d.iso
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' }
                  : d.isToday ? { backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' } : { border: '1px solid transparent' }
                }>
                <span className="text-[12px] font-medium" style={{ color: d.isToday ? 'var(--color-accent)' : monthSelectedDate === d.iso ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>{d.num}</span>
                {(bookingsByDate[d.iso] || 0) > 0 && (
                  <div className="flex items-center gap-0.5 mt-0.5">
                    <div className="w-1 h-1 rounded-full" style={{ backgroundColor: 'var(--color-success)' }} />
                    <span className="text-[8px] font-bold" style={{ color: 'var(--color-text-muted)' }}>{bookingsByDate[d.iso]}</span>
                  </div>
                )}
              </button>
            ) : <div key={`e-${i}`} />)}
          </div>
        </div>
      )}

      {/* Detail date label (week/month when a day is selected) */}
      {viewMode !== 'day' && detailDateLabel && (
        <p className="text-[12px] font-semibold capitalize px-1 pt-1" style={{ color: 'var(--color-accent)' }}>{detailDateLabel}</p>
      )}

      {/* Summary */}
      {(viewMode === 'day' || displayDate) && (
        <div className="flex items-center gap-3 px-1">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {visibleBookings.length} {t('admin.classes.bookingsTotal', 'reservas')}
          </p>
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {classBookings.length} {classBookings.length === 1 ? t('admin.classes.classLabel', 'clase') : t('admin.classes.classesLabel', 'clases')}
          </span>
        </div>
      )}

      {/* Month view: no date selected prompt */}
      {viewMode === 'month' && !monthSelectedDate && !isLoading && (
        <div className="text-center py-6">
          <CalendarDays size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-faint)' }} />
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.tapDateToSee', 'Toca una fecha para ver las reservas')}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{tc('loading')}</span>
        </div>
      ) : classBookings.length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
          <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('admin.classes.noBookingsTitle', 'No hay reservas')}</p>
          <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noBookingsForDate', 'No bookings for this date')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {classBookings.map(({ cls, bookings, confirmed, waitlisted, total }) => {
            const isExpanded = expandedClassId === cls.id;
            const capacityPct = cls.max_capacity ? Math.min((confirmed / cls.max_capacity) * 100, 100) : 0;

            return (
              <div key={cls.id} className="rounded-xl overflow-hidden transition-all"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                {/* Class header — tap to expand */}
                <button className="w-full flex items-center gap-3 p-3.5 text-left"
                  onClick={() => setExpandedClassId(isExpanded ? null : cls.id)}>
                  {cls.cover_preset ? (
                    <CoverPreview preset={cls.cover_preset} size="sm" className="flex-shrink-0" />
                  ) : classImageUrl(cls.image_path) ? (
                    <img src={classImageUrl(cls.image_path)} alt={cls.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${cls.accent_color || 'var(--color-accent)'}15` }}>
                      <CalendarDays size={16} style={{ color: cls.accent_color || 'var(--color-accent)' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-success-soft)', color: 'var(--color-success)' }}>{confirmed} {t('admin.classes.confirmed', 'confirmed')}</span>
                      {waitlisted > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-info-soft)', color: 'var(--color-info)' }}>{waitlisted} {t('admin.classes.waitlisted', 'waitlist')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{total}</span>
                    {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--color-text-muted)' }} /> : <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />}
                  </div>
                </button>

                {/* Capacity bar */}
                {cls.max_capacity > 0 && (
                  <div className="px-3.5 pb-2">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-hover)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${capacityPct}%`, backgroundColor: capacityPct >= 90 ? 'var(--color-danger)' : capacityPct >= 70 ? 'var(--color-warning)' : 'var(--color-success)' }} />
                    </div>
                    <p className="text-[9px] mt-0.5 text-right" style={{ color: 'var(--color-text-muted)' }}>{confirmed}/{cls.max_capacity}</p>
                  </div>
                )}

                {/* Expanded member list */}
                {isExpanded && (
                  <div className="px-3.5 pb-3 space-y-1.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    <div className="pt-2" />
                    {bookings.map(b => {
                      const sc = statusStyle(b);
                      return (
                        <div key={b.id} className="flex items-center gap-2.5 py-1.5">
                          {b.profiles?.avatar_url ? (
                            <img src={b.profiles.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                              style={{ backgroundColor: 'var(--color-bg-hover)' }}>
                              <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{b.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                            </div>
                          )}
                          <p className="text-[12px] font-medium truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>{b.profiles?.full_name || '?'}</p>
                          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: sc.bg, color: sc.color }}>
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
