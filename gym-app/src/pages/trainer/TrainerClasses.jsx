import { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays, Users, Clock, Dumbbell, BarChart3, Star, Plus,
  Trash2, Search, Check, UserCheck, X, ChevronRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { format, addDays, startOfDay } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import UnderlineTabs from '../../components/UnderlineTabs';

const DAYS_OF_WEEK = [
  { value: 0, labelKey: 'days.sunday' },
  { value: 1, labelKey: 'days.monday' },
  { value: 2, labelKey: 'days.tuesday' },
  { value: 3, labelKey: 'days.wednesday' },
  { value: 4, labelKey: 'days.thursday' },
  { value: 5, labelKey: 'days.friday' },
  { value: 6, labelKey: 'days.saturday' },
];

const TABS = ['myClasses', 'bookings', 'analytics'];

// ── Shared spinner ──
function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center">
      <div className="w-4 h-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      <span className="text-[12px] text-[var(--color-text-muted)]">{label}</span>
    </div>
  );
}

// ── Class Detail Drawer (for My Classes tab) ──
function ClassDetailDrawer({ cls, gymId, onClose, t, tc }) {
  const [adding, setAdding] = useState(false);
  const [newSlot, setNewSlot] = useState({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const schedules = (cls.gym_class_schedules || [])
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));

  const handleAddSlot = async () => {
    const { error } = await supabase.from('gym_class_schedules').insert({
      class_id: cls.id,
      gym_id: gymId,
      ...newSlot,
    });
    if (error) {
      logger.error('TrainerClasses: add slot error', error);
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
      setAdding(false);
      setNewSlot({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
    }
  };

  const handleDeleteSlot = async (slotId) => {
    const { error } = await supabase.from('gym_class_schedules').delete().eq('id', slotId);
    if (error) {
      showToast(t('trainerClasses.errorDeleteSlot', 'Failed to delete slot'), 'error');
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-[480px] max-h-[85vh] bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border-default)] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[var(--color-bg-card)] border-b border-[var(--color-border-subtle)] px-4 py-3 flex items-center justify-between z-10">
          <h3 className="text-[15px] font-bold text-[var(--color-text-primary)]">{t('trainerClasses.classDetails')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
            <X size={18} className="text-[var(--color-text-muted)]" />
          </button>
        </div>

        <div className="p-4 space-y-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {/* Class info */}
          <div className="flex items-center gap-3">
            {cls.image_url ? (
              <img src={cls.image_url} alt={cls.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-[var(--color-border-subtle)]" />
            ) : (
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 border border-[var(--color-border-subtle)]"
                style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
              >
                <CalendarDays size={22} style={{ color: cls.accent_color || '#D4AF37' }} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h4 className="text-[15px] font-bold text-[var(--color-text-primary)] truncate">{cls.name}</h4>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                  <Clock size={12} /> {cls.duration_minutes} min
                </span>
                <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                  <Users size={12} /> {cls.max_capacity}
                </span>
              </div>
            </div>
          </div>

          {/* Schedule slots */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h5 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                {t('trainerClasses.schedule')} ({schedules.length})
              </h5>
              {!adding && (
                <button
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-1 text-[12px] text-[var(--color-accent)] hover:text-[#C4A030] transition-colors font-medium min-h-[44px] px-1"
                >
                  <Plus size={13} /> {t('trainerClasses.addSlot')}
                </button>
              )}
            </div>

            {schedules.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {schedules.map(slot => (
                  <div key={slot.id} className="flex items-center justify-between gap-2 p-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border-subtle)]">
                    <span className="text-[12px] text-[var(--color-text-primary)] flex-shrink-0">
                      {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey || '')}
                    </span>
                    <span className="text-[12px] text-[var(--color-text-secondary)] flex-1 text-right">
                      {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
                    </span>
                    <button
                      onClick={() => handleDeleteSlot(slot.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {adding && (
              <div className="p-3 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.day')}</label>
                  <select
                    value={newSlot.day_of_week}
                    onChange={e => setNewSlot(s => ({ ...s, day_of_week: Number(e.target.value) }))}
                    className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                  >
                    {DAYS_OF_WEEK.map(d => (
                      <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.start')}</label>
                    <input
                      type="time"
                      value={newSlot.start_time}
                      onChange={e => setNewSlot(s => ({ ...s, start_time: e.target.value }))}
                      className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.end')}</label>
                    <input
                      type="time"
                      value={newSlot.end_time}
                      onChange={e => setNewSlot(s => ({ ...s, end_time: e.target.value }))}
                      className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddSlot}
                    className="px-3 py-3 sm:py-2.5 bg-[var(--color-accent)] text-[var(--color-text-on-accent)] text-[12px] font-semibold rounded-xl hover:bg-[var(--color-accent-dark)] transition-colors min-h-[44px]"
                  >
                    {t('trainerClasses.save')}
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="px-3 py-3 sm:py-2.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors min-h-[44px]"
                  >
                    {t('trainerClasses.cancel')}
                  </button>
                </div>
              </div>
            )}

            {schedules.length === 0 && !adding && (
              <p className="text-[12px] text-[var(--color-text-muted)] italic">{t('trainerClasses.noScheduleSlots')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 1: My Classes ──
function MyClassesTab({ classes, gymId, t, tc, dateLocale }) {
  const [selectedClass, setSelectedClass] = useState(null);

  // Compute next upcoming date for each class
  const getNextDate = (cls) => {
    const schedules = cls.gym_class_schedules || [];
    if (schedules.length === 0) return null;
    const today = new Date();
    const todayDay = today.getDay();
    let minDaysAhead = 8;
    for (const s of schedules) {
      let diff = s.day_of_week - todayDay;
      if (diff < 0) diff += 7;
      if (diff === 0) diff = 0; // today counts
      if (diff < minDaysAhead) minDaysAhead = diff;
    }
    if (minDaysAhead > 7) return null;
    return addDays(startOfDay(today), minDaysAhead);
  };

  return (
    <>
      {classes.length === 0 ? (
        <div className="text-center py-16">
          <CalendarDays size={40} className="mx-auto text-[var(--color-text-muted)] mb-3" />
          <p className="text-[15px] text-[var(--color-text-muted)]">{t('trainerClasses.noClasses')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {classes.map(cls => {
            const nextDate = getNextDate(cls);
            return (
              <button
                key={cls.id}
                onClick={() => setSelectedClass(cls)}
                className="w-full bg-[var(--color-bg-secondary)] rounded-2xl border border-[var(--color-border-subtle)] p-3.5 sm:p-4 hover:border-white/12 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  {cls.image_url ? (
                    <img src={cls.image_url} alt={cls.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-[var(--color-border-subtle)]" />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-[var(--color-border-subtle)]"
                      style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
                    >
                      <CalendarDays size={20} style={{ color: cls.accent_color || '#D4AF37' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-bold text-[var(--color-text-primary)] truncate">{cls.name}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                        <Clock size={11} /> {cls.duration_minutes} min
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                        <Users size={11} /> {cls.max_capacity}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                        <CalendarDays size={11} /> {cls.gym_class_schedules?.length || 0} {t('trainerClasses.slots')}
                      </span>
                    </div>
                    {nextDate && (
                      <p className="text-[10px] text-[var(--color-accent)] mt-1.5 font-medium">
                        {t('trainerClasses.nextDate')}: {format(nextDate, 'EEE, MMM d', { locale: dateLocale })}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors flex-shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedClass && (
        <ClassDetailDrawer
          cls={selectedClass}
          gymId={gymId}
          onClose={() => setSelectedClass(null)}
          t={t}
          tc={tc}
        />
      )}
    </>
  );
}

// ── Tab 2: Bookings ──
function BookingsTab({ classes, t, dateLocale }) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [selectedDate, setSelectedDate] = useState(format(today, 'yyyy-MM-dd'));
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const classIds = classes.map(c => c.id);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['trainer', 'all-class-bookings', selectedDate, classIds],
    queryFn: async () => {
      if (classIds.length === 0) return [];
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, status, attended, booked_date, class_id, profiles(id, full_name, avatar_url)')
        .in('class_id', classIds)
        .eq('booked_date', selectedDate)
        .order('booked_date');
      return data || [];
    },
    enabled: classIds.length > 0,
    staleTime: 30 * 1000,
  });

  const handleMarkAttended = async (bookingId) => {
    const { error } = await supabase
      .from('gym_class_bookings')
      .update({ attended: true, attended_at: new Date().toISOString() })
      .eq('id', bookingId);
    if (error) {
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'all-class-bookings'] });
    }
  };

  // Group by class
  const classMap = {};
  for (const c of classes) classMap[c.id] = c;
  const grouped = bookings.reduce((acc, b) => {
    const cId = b.class_id;
    if (!acc[cId]) acc[cId] = [];
    acc[cId].push(b);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Day pills */}
      <div className="relative -mx-3 sm:-mx-0">
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 px-3 sm:px-1 scrollbar-hide">
          {days.map(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const isActive = dayStr === selectedDate;
            return (
              <button
                key={dayStr}
                onClick={() => setSelectedDate(dayStr)}
                className={`flex-shrink-0 flex flex-col items-center px-2.5 sm:px-3 py-2 rounded-xl min-w-[46px] sm:min-w-[52px] min-h-[52px] transition-all ${
                  isActive
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                    : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] hover:border-white/12'
                }`}
              >
                <span className="text-[10px] font-medium uppercase">{format(day, 'EEE', { locale: dateLocale })}</span>
                <span className={`text-[15px] font-bold ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}>
                  {format(day, 'd')}
                </span>
              </button>
            );
          })}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--color-bg-primary)] to-transparent pointer-events-none sm:hidden" />
      </div>

      {/* Bookings content */}
      {isLoading ? (
        <Spinner label={t('trainerClasses.loading')} />
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="mx-auto text-[var(--color-text-muted)] mb-2" />
          <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerClasses.noBookings')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([classId, classBookings]) => {
            const cls = classMap[classId];
            return (
              <div key={classId}>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: (cls?.accent_color || '#D4AF37') + '20' }}
                  >
                    <CalendarDays size={12} style={{ color: cls?.accent_color || '#D4AF37' }} />
                  </div>
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{cls?.name || t('trainerClasses.unknown')}</span>
                  <span className="text-[11px] text-[var(--color-text-muted)] ml-auto">{classBookings.length}</span>
                </div>
                <div className="space-y-1.5">
                  {classBookings.map(b => (
                    <div key={b.id} className="flex items-center gap-2 sm:gap-2.5 p-2.5 sm:p-3 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] overflow-hidden">
                      {b.profiles?.avatar_url ? (
                        <img src={b.profiles.avatar_url} alt={b.profiles?.full_name || t('trainerClasses.members')} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-bold text-[var(--color-accent)]">
                            {b.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                          </span>
                        </div>
                      )}
                      <span className="flex-1 text-[13px] text-[var(--color-text-primary)] truncate">
                        {b.profiles?.full_name || t('trainerClasses.unknown')}
                      </span>
                      {b.attended ? (
                        <span className="flex items-center gap-1 text-[11px] text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full font-medium">
                          <Check size={11} /> {t('trainerClasses.attended')}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleMarkAttended(b.id)}
                          className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-2.5 py-2 sm:py-1.5 rounded-full font-medium hover:bg-[var(--color-accent)]/20 transition-colors min-h-[44px] sm:min-h-[32px]"
                        >
                          <UserCheck size={11} /> {t('trainerClasses.markAttended')}
                        </button>
                      )}
                    </div>
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

// ── Tab 3: Analytics ──
function AnalyticsTab({ classes, t, dateLocale }) {
  const [selectedClassId, setSelectedClassId] = useState(classes[0]?.id || null);
  const selectedClass = classes.find(c => c.id === selectedClassId);
  const hasTemplate = !!selectedClass?.workout_template_id;

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['trainer', 'class-analytics', selectedClassId],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();

      const { data: allBookings } = await supabase
        .from('gym_class_bookings')
        .select('id, attended, rating')
        .eq('class_id', selectedClassId)
        .gte('created_at', since);

      const bookings = allBookings || [];
      const total = bookings.length;
      const attended = bookings.filter(b => b.attended).length;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;

      const rated = bookings.filter(b => b.rating != null && b.attended);
      const avgRating = rated.length > 0
        ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
        : null;

      const starDist = [0, 0, 0, 0, 0];
      rated.forEach(b => {
        const idx = Math.max(0, Math.min(4, Math.round(b.rating) - 1));
        starDist[idx]++;
      });

      let recentResults = [];
      if (hasTemplate) {
        const { data: resultBookings } = await supabase
          .from('gym_class_bookings')
          .select('profile_id, rating, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs, completed_at)')
          .eq('class_id', selectedClassId)
          .eq('attended', true)
          .order('attended_at', { ascending: false })
          .limit(20);
        recentResults = resultBookings || [];
      }

      return { total, attended, attendanceRate, avgRating, starDist, recentResults };
    },
    enabled: !!selectedClassId,
    staleTime: 60 * 1000,
  });

  if (classes.length === 0) {
    return (
      <div className="text-center py-16">
        <BarChart3 size={40} className="mx-auto text-[var(--color-text-muted)] mb-3" />
        <p className="text-[15px] text-[var(--color-text-muted)]">{t('trainerClasses.noClasses')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Class selector */}
      <div className="mb-5">
        <UnderlineTabs
          tabs={classes.map(cls => ({ key: cls.id, label: cls.name }))}
          activeIndex={Math.max(0, classes.findIndex(cls => cls.id === selectedClassId))}
          onChange={(i) => setSelectedClassId(classes[i].id)}
          scrollable
        />
      </div>

      {/* Analytics content */}
      {isLoading ? (
        <Spinner label={t('trainerClasses.loading')} />
      ) : !analytics || analytics.total === 0 ? (
        <div className="text-center py-12">
          <BarChart3 size={32} className="mx-auto text-[var(--color-text-muted)] mb-2" />
          <p className="text-[13px] text-[var(--color-text-muted)]">{t('trainerClasses.noData')}</p>
        </div>
      ) : (
        <>
          {/* Attendance rate + avg rating cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 bg-[var(--color-bg-secondary)] rounded-2xl border border-[var(--color-border-subtle)]">
              <p className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1.5">{t('trainerClasses.attendanceRate')}</p>
              <p className="text-[22px] font-bold text-[var(--color-text-primary)]">{analytics.attendanceRate}%</p>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                {analytics.attended}/{analytics.total}
              </p>
            </div>
            <div className="p-4 bg-[var(--color-bg-secondary)] rounded-2xl border border-[var(--color-border-subtle)]">
              <p className="text-[11px] font-medium text-[var(--color-text-muted)] mb-1.5">{t('trainerClasses.avgRating')}</p>
              {analytics.avgRating ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[22px] font-bold text-[var(--color-text-primary)]">{analytics.avgRating}</p>
                    <Star size={18} className="text-[var(--color-accent)] fill-[var(--color-accent)]" />
                  </div>
                  <div className="mt-2.5 space-y-1">
                    {[5, 4, 3, 2, 1].map(star => {
                      const count = analytics.starDist[star - 1];
                      const maxCount = Math.max(...analytics.starDist, 1);
                      return (
                        <div key={star} className="flex items-center gap-1.5">
                          <span className="text-[9px] text-[var(--color-text-muted)] w-3 text-right">{star}</span>
                          <Star size={8} className="text-[var(--color-accent)] fill-[var(--color-accent)]" />
                          <div className="flex-1 h-1.5 bg-white/6 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--color-accent)]"
                              style={{ width: `${(count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-[var(--color-text-muted)] w-4">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-[14px] text-[var(--color-text-muted)]">--</p>
              )}
            </div>
          </div>

          {/* Recent attendees */}
          {hasTemplate && analytics.recentResults.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-2.5">{t('trainerClasses.recentAttendees')}</p>
              <div className="space-y-1.5">
                {analytics.recentResults.map((r, i) => (
                  <div
                    key={`${r.profile_id}-${i}`}
                    className="flex flex-wrap items-center gap-2 sm:gap-2.5 p-3 bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] overflow-hidden"
                  >
                    {r.profiles?.avatar_url ? (
                      <img src={r.profiles.avatar_url} alt={r.profiles?.full_name || t('trainerClasses.members')} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[11px] font-bold text-[var(--color-accent)]">
                          {r.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="block text-[13px] text-[var(--color-text-primary)] truncate">
                        {r.profiles?.full_name || t('trainerClasses.unknown')}
                      </span>
                      {r.attended_at && (
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          {format(new Date(r.attended_at), 'MMM d', { locale: dateLocale })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {r.workout_sessions?.total_volume_lbs != null && (
                        <span className="text-[11px] text-[var(--color-text-secondary)] flex items-center gap-1">
                          <Dumbbell size={11} />
                          {Number(r.workout_sessions.total_volume_lbs).toLocaleString()} {t('trainerClasses.lbs')}
                        </span>
                      )}
                      {r.rating != null && (
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <Star
                              key={s}
                              size={10}
                              className={s <= Math.round(r.rating) ? 'text-[var(--color-accent)] fill-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Routine Selector (reused from original) ──
function RoutineSelector({ gymId, value, onChange, t }) {
  const [search, setSearch] = useState('');

  const { data: routines = [] } = useQuery({
    queryKey: ['trainer', 'routines-for-classes', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(count)')
        .eq('gym_id', gymId)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = routines.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selected = routines.find(r => r.id === value);

  return (
    <div>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-xl overflow-hidden">
          <Dumbbell size={14} className="text-[var(--color-accent)] flex-shrink-0" />
          <span className="flex-1 text-[13px] text-[var(--color-text-primary)] truncate min-w-0 break-words">
            {selected.name}
            <span className="text-[var(--color-text-muted)] ml-1.5">
              ({t('trainerClasses.exerciseCount', { count: selected.routine_exercises?.[0]?.count || 0 })})
            </span>
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[11px] text-[var(--color-accent)] hover:text-[#C4A030] font-medium transition-colors min-h-[44px] min-w-[44px] px-2 flex items-center justify-center"
            >
              {t('trainerClasses.changeTemplate')}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[11px] text-red-400 hover:text-red-300 font-medium transition-colors min-h-[44px] min-w-[44px] px-2 flex items-center justify-center"
            >
              {t('trainerClasses.removeTemplate')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('trainerClasses.changeTemplate')}
              className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]/40 focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
            />
          </div>
          {search && filtered.length > 0 && (
            <div className="max-h-48 sm:max-h-40 overflow-y-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)]">
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); }}
                  className="w-full text-left px-3 py-2.5 text-[12px] text-[var(--color-text-primary)] hover:bg-white/[0.04] transition-colors flex items-center gap-2 min-h-[44px]"
                >
                  <Dumbbell size={12} className="text-[var(--color-text-muted)]" />
                  <span className="truncate">{r.name}</span>
                  <span className="text-[var(--color-text-muted)] ml-auto flex-shrink-0">
                    {r.routine_exercises?.[0]?.count || 0}
                  </span>
                </button>
              ))}
            </div>
          )}
          {search && filtered.length === 0 && (
            <p className="text-[11px] text-[var(--color-text-muted)] italic px-1">{t('trainerClasses.noTemplatesFound')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Template Preview ──
function TemplatePreview({ templateId, t }) {
  const { data: exercises = [], isLoading } = useQuery({
    queryKey: ['trainer', 'template-exercises', templateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('routine_exercises')
        .select('id, sets, reps, exercises(name)')
        .eq('routine_id', templateId)
        .order('order_index');
      return data || [];
    },
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000,
  });

  if (!templateId) return null;
  if (isLoading) return <Spinner label={t('trainerClasses.loading')} />;

  return (
    <div className="space-y-1 mt-2">
      {exercises.map((ex, i) => (
        <div key={ex.id} className="flex items-center gap-2 p-2.5 bg-[var(--color-bg-card)] rounded-lg border border-[var(--color-border-subtle)]">
          <span className="text-[10px] text-[var(--color-text-muted)] w-4 text-right">{i + 1}.</span>
          <span className="flex-1 text-[12px] text-[var(--color-text-primary)] truncate">{ex.exercises?.name || t('trainerClasses.unknown')}</span>
          <span className="text-[10px] text-[var(--color-text-muted)]">{ex.sets}x{ex.reps}</span>
        </div>
      ))}
      {exercises.length === 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)] italic">{t('trainerClasses.noExercises')}</p>
      )}
    </div>
  );
}

// ── Tab 4: Templates ──
function TemplatesTab({ classes, gymId, t }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Get routine names for classes that have templates
  const templateIds = classes.filter(c => c.workout_template_id).map(c => c.workout_template_id);

  const { data: routineNames = {} } = useQuery({
    queryKey: ['trainer', 'routine-names', templateIds],
    queryFn: async () => {
      if (templateIds.length === 0) return {};
      const { data } = await supabase
        .from('routines')
        .select('id, name')
        .in('id', templateIds);
      const map = {};
      (data || []).forEach(r => { map[r.id] = r.name; });
      return map;
    },
    enabled: templateIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const handleChangeTemplate = async (classId, templateId) => {
    const { error } = await supabase
      .from('gym_classes')
      .update({ workout_template_id: templateId, updated_at: new Date().toISOString() })
      .eq('id', classId);
    if (error) {
      showToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
    }
  };

  const [expandedClass, setExpandedClass] = useState(null);

  if (classes.length === 0) {
    return (
      <div className="text-center py-16">
        <Dumbbell size={40} className="mx-auto text-[var(--color-text-muted)] mb-3" />
        <p className="text-[15px] text-[var(--color-text-muted)]">{t('trainerClasses.noClasses')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {classes.map(cls => {
        const isExpanded = expandedClass === cls.id;
        const templateName = cls.workout_template_id
          ? (routineNames[cls.workout_template_id] || t('trainerClasses.template'))
          : null;

        return (
          <div key={cls.id} className="bg-[var(--color-bg-secondary)] rounded-2xl border border-[var(--color-border-subtle)] overflow-hidden">
            <button
              onClick={() => setExpandedClass(isExpanded ? null : cls.id)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors"
            >
              {cls.image_url ? (
                <img src={cls.image_url} alt={cls.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-[var(--color-border-subtle)]" />
              ) : (
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border border-[var(--color-border-subtle)]"
                  style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
                >
                  <CalendarDays size={16} style={{ color: cls.accent_color || '#D4AF37' }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-[13px] font-bold text-[var(--color-text-primary)] truncate">{cls.name}</h4>
                {templateName ? (
                  <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] mt-0.5">
                    <Dumbbell size={11} /> {templateName}
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{t('trainerClasses.noTemplate')}</span>
                )}
              </div>
              <ChevronRight size={16} className={`text-[var(--color-text-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border-subtle)] pt-3">
                <RoutineSelector
                  gymId={gymId}
                  value={cls.workout_template_id}
                  onChange={(templateId) => handleChangeTemplate(cls.id, templateId)}
                  t={t}
                />
                <TemplatePreview templateId={cls.workout_template_id} t={t} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Propose New Class Modal ──
function ProposeClassModal({ gymId, trainerId, onClose, t, tc }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', description: '', day_of_week: 1, start_time: '09:00', duration: 60 });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('log_admin_action', {
        p_action: 'class_proposal',
        p_entity_type: 'class',
        p_entity_id: null,
        p_details: {
          class_name: form.name.trim(),
          description: form.description.trim(),
          suggested_day: form.day_of_week,
          suggested_time: form.start_time,
          duration_minutes: form.duration,
        },
      });
      if (error) throw error;
      showToast(t('trainerClasses.proposalSent', 'Proposal sent to admin'), 'success');
      onClose();
    } catch (err) {
      logger.error('ProposeClass: error', err);
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-sm max-h-[85vh] overflow-y-auto mx-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
            {t('trainerClasses.proposeClass', 'Propose New Class')}
          </h2>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-3">
          {/* Class name */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.className', 'Class Name')}</label>
            <input
              value={form.name}
              onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
              placeholder={t('trainerClasses.classNamePlaceholder', 'e.g. HIIT Cardio')}
              autoFocus
              className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>
          {/* Description */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.classDescription', 'Description')}</label>
            <textarea
              value={form.description}
              onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
              placeholder={t('trainerClasses.classDescPlaceholder', 'Describe the class...')}
              rows={3}
              className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
            />
          </div>
          {/* Day + Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.suggestedDay', 'Day')}</label>
              <select
                value={form.day_of_week}
                onChange={e => setForm(s => ({ ...s, day_of_week: Number(e.target.value) }))}
                className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors"
              >
                {DAYS_OF_WEEK.map(d => (
                  <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.suggestedTime', 'Time')}</label>
              <input
                type="time"
                value={form.start_time}
                onChange={e => setForm(s => ({ ...s, start_time: e.target.value }))}
                className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-[16px] sm:text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors"
              />
            </div>
          </div>
          {/* Duration */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">{t('trainerClasses.duration', 'Duration (min)')}</label>
            <input
              type="number"
              value={form.duration}
              onChange={e => setForm(s => ({ ...s, duration: Number(e.target.value) }))}
              min={15}
              max={180}
              className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] transition-colors"
            />
          </div>
          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!form.name.trim() || submitting}
            className="w-full py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[14px] transition-colors min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 rounded-full animate-spin border-white/30 border-t-white" />
            ) : (
              <>
                <Plus size={16} />
                {t('trainerClasses.submitProposal', 'Submit Proposal')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function TrainerClasses() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;
  const trainerId = profile?.id;
  const [activeTab, setActiveTab] = useState('myClasses');
  const [showProposeClass, setShowProposeClass] = useState(false);
  const dateLocale = i18n.language === 'es' ? es : enUS;

  useEffect(() => { document.title = t('trainerClasses.documentTitle'); }, [t]);

  const { data: classes = [], isLoading } = useQuery({
    queryKey: ['trainer', 'my-classes', trainerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_classes')
        .select('*, gym_class_schedules(id, day_of_week, start_time, end_time, capacity_override)')
        .eq('trainer_id', trainerId)
        .eq('is_active', true)
        .order('name');
      if (error) logger.error('TrainerClasses: fetch error', error);

      // Resolve signed image URLs
      if (data) {
        for (const cls of data) {
          if (cls.image_url && cls.image_url.startsWith('class-images/')) {
            const { data: signedData } = await supabase.storage
              .from('class-images')
              .createSignedUrl(cls.image_url.replace('class-images/', ''), 3600);
            if (signedData?.signedUrl) cls.image_url = signedData.signedUrl;
          }
        }
      }

      return data || [];
    },
    enabled: !!trainerId,
    staleTime: 60 * 1000,
  });

  const tabKeys = {
    myClasses: 'tabMyClasses',
    bookings: 'tabBookings',
    analytics: 'tabAnalytics',
    templates: 'tabTemplates',
  };

  return (
    <div className="px-3 sm:px-4 md:px-6 py-6 max-w-4xl mx-auto w-full overflow-x-hidden">
      {/* Header */}
      <div className="sticky top-0 z-20 backdrop-blur-2xl -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 py-3 mb-4"
        style={{ background: 'color-mix(in srgb, var(--color-bg-primary) 92%, transparent)', borderBottom: '1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--color-accent)' }}>
          {t('trainerClasses.subtitle')}
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}>
            {t('trainerClasses.title')}
          </h1>
          <button
            onClick={() => setShowProposeClass(true)}
            className="flex items-center gap-1.5 px-3 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[12px] transition-colors min-h-[44px] shrink-0"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">{t('trainerClasses.proposeClass', 'Propose New Class')}</span>
            <span className="sm:hidden">{t('trainerClasses.propose', 'Propose')}</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-5">
        <UnderlineTabs
          tabs={TABS.map(tab => ({ key: tab, label: t(`trainerClasses.${tabKeys[tab]}`) }))}
          activeIndex={TABS.indexOf(activeTab) >= 0 ? TABS.indexOf(activeTab) : 0}
          onChange={(i) => setActiveTab(TABS[i])}
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-[var(--color-bg-secondary)] rounded-2xl border border-[var(--color-border-subtle)] animate-pulse" />
          ))}
        </div>
      )}

      {/* Tab content */}
      {!isLoading && activeTab === 'myClasses' && (
        <MyClassesTab classes={classes} gymId={gymId} t={t} tc={tc} dateLocale={dateLocale} />
      )}
      {!isLoading && activeTab === 'bookings' && (
        <BookingsTab classes={classes} t={t} dateLocale={dateLocale} />
      )}
      {!isLoading && activeTab === 'analytics' && (
        <AnalyticsTab classes={classes} t={t} dateLocale={dateLocale} />
      )}
      {!isLoading && activeTab === 'templates' && (
        <TemplatesTab classes={classes} gymId={gymId} t={t} />
      )}

      {showProposeClass && (
        <ProposeClassModal
          gymId={gymId}
          trainerId={trainerId}
          onClose={() => setShowProposeClass(false)}
          t={t}
          tc={tc}
        />
      )}
    </div>
  );
}
