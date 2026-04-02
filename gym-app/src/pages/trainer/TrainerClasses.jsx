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

const DAYS_OF_WEEK = [
  { value: 0, labelKey: 'days.sunday' },
  { value: 1, labelKey: 'days.monday' },
  { value: 2, labelKey: 'days.tuesday' },
  { value: 3, labelKey: 'days.wednesday' },
  { value: 4, labelKey: 'days.thursday' },
  { value: 5, labelKey: 'days.friday' },
  { value: 6, labelKey: 'days.saturday' },
];

const TABS = ['myClasses', 'bookings', 'analytics', 'templates'];

// ── Shared spinner ──
function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center">
      <div className="w-4 h-4 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
      <span className="text-[12px] text-[#6B7280]">{label}</span>
    </div>
  );
}

// ── Class Detail Drawer (for My Classes tab) ──
function ClassDetailDrawer({ cls, gymId, onClose, t, tc }) {
  const [adding, setAdding] = useState(false);
  const [newSlot, setNewSlot] = useState({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
  const queryClient = useQueryClient();
  const { addToast } = useToast();

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
      addToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
      setAdding(false);
      setNewSlot({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
    }
  };

  const handleDeleteSlot = async (slotId) => {
    const { error } = await supabase.from('gym_class_schedules').delete().eq('id', slotId);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[480px] max-h-[85vh] bg-[#0F172A] rounded-t-2xl sm:rounded-2xl border border-white/8 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#0F172A] border-b border-white/6 px-4 py-3 flex items-center justify-between z-10">
          <h3 className="text-[15px] font-bold text-[#E5E7EB]">{t('trainerClasses.classDetails')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors">
            <X size={18} className="text-[#6B7280]" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Class info */}
          <div className="flex items-center gap-3">
            {cls.image_url ? (
              <img src={cls.image_url} alt={cls.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6" />
            ) : (
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/6"
                style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
              >
                <CalendarDays size={22} style={{ color: cls.accent_color || '#D4AF37' }} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h4 className="text-[15px] font-bold text-[#E5E7EB] truncate">{cls.name}</h4>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                  <Clock size={12} /> {cls.duration_minutes} min
                </span>
                <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                  <Users size={12} /> {cls.max_capacity}
                </span>
              </div>
            </div>
          </div>

          {/* Schedule slots */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h5 className="text-[13px] font-semibold text-[#E5E7EB]">
                {t('trainerClasses.schedule')} ({schedules.length})
              </h5>
              {!adding && (
                <button
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-1 text-[12px] text-[#D4AF37] hover:text-[#C4A030] transition-colors font-medium"
                >
                  <Plus size={13} /> {t('trainerClasses.addSlot')}
                </button>
              )}
            </div>

            {schedules.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {schedules.map(slot => (
                  <div key={slot.id} className="flex items-center justify-between p-2.5 bg-[#111827] rounded-lg border border-white/6">
                    <span className="text-[12px] text-[#E5E7EB]">
                      {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey || '')}
                    </span>
                    <span className="text-[12px] text-[#9CA3AF]">
                      {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
                    </span>
                    <button
                      onClick={() => handleDeleteSlot(slot.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {adding && (
              <div className="p-3 bg-[#111827] rounded-xl border border-white/6 space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('trainerClasses.day')}</label>
                  <select
                    value={newSlot.day_of_week}
                    onChange={e => setNewSlot(s => ({ ...s, day_of_week: Number(e.target.value) }))}
                    className="w-full bg-[#0A0D14] border border-white/6 rounded-lg px-3 py-2.5 text-[12px] text-[#E5E7EB] outline-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  >
                    {DAYS_OF_WEEK.map(d => (
                      <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('trainerClasses.start')}</label>
                    <input
                      type="time"
                      value={newSlot.start_time}
                      onChange={e => setNewSlot(s => ({ ...s, start_time: e.target.value }))}
                      className="w-full bg-[#0A0D14] border border-white/6 rounded-lg px-3 py-2.5 text-[12px] text-[#E5E7EB] outline-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('trainerClasses.end')}</label>
                    <input
                      type="time"
                      value={newSlot.end_time}
                      onChange={e => setNewSlot(s => ({ ...s, end_time: e.target.value }))}
                      className="w-full bg-[#0A0D14] border border-white/6 rounded-lg px-3 py-2.5 text-[12px] text-[#E5E7EB] outline-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddSlot}
                    className="px-3 py-2 bg-[#D4AF37] text-[#05070B] text-[12px] font-semibold rounded-xl hover:bg-[#C4A030] transition-colors min-h-[36px]"
                  >
                    {t('trainerClasses.save')}
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="px-3 py-2 text-[12px] text-[#6B7280] hover:text-[#E5E7EB] transition-colors min-h-[36px]"
                  >
                    {t('trainerClasses.cancel')}
                  </button>
                </div>
              </div>
            )}

            {schedules.length === 0 && !adding && (
              <p className="text-[12px] text-[#6B7280] italic">No schedule slots yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab 1: My Classes ──
function MyClassesTab({ classes, gymId, t, tc }) {
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
          <CalendarDays size={40} className="mx-auto text-[#6B7280] mb-3" />
          <p className="text-[15px] text-[#6B7280]">{t('trainerClasses.noClasses')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {classes.map(cls => {
            const nextDate = getNextDate(cls);
            return (
              <button
                key={cls.id}
                onClick={() => setSelectedClass(cls)}
                className="w-full bg-[#111827] rounded-2xl border border-white/6 p-4 hover:border-white/12 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  {cls.image_url ? (
                    <img src={cls.image_url} alt={cls.name} className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border border-white/6" />
                  ) : (
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/6"
                      style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
                    >
                      <CalendarDays size={20} style={{ color: cls.accent_color || '#D4AF37' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-bold text-[#E5E7EB] truncate">{cls.name}</h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Clock size={11} /> {cls.duration_minutes} min
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Users size={11} /> {cls.max_capacity}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <CalendarDays size={11} /> {cls.gym_class_schedules?.length || 0} {t('trainerClasses.slots')}
                      </span>
                    </div>
                    {nextDate && (
                      <p className="text-[10px] text-[#D4AF37] mt-1.5 font-medium">
                        {t('trainerClasses.nextDate')}: {format(nextDate, 'EEE, MMM d')}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-[#6B7280] group-hover:text-[#D4AF37] transition-colors flex-shrink-0" />
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
function BookingsTab({ classes, t }) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [selectedDate, setSelectedDate] = useState(format(today, 'yyyy-MM-dd'));
  const queryClient = useQueryClient();
  const { addToast } = useToast();

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
      addToast(error.message, 'error');
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
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {days.map(day => {
          const dayStr = format(day, 'yyyy-MM-dd');
          const isActive = dayStr === selectedDate;
          return (
            <button
              key={dayStr}
              onClick={() => setSelectedDate(dayStr)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl min-w-[52px] min-h-[52px] transition-all ${
                isActive
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                  : 'bg-[#111827] text-[#6B7280] border border-white/6 hover:border-white/12'
              }`}
            >
              <span className="text-[10px] font-medium uppercase">{format(day, 'EEE')}</span>
              <span className={`text-[15px] font-bold ${isActive ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bookings content */}
      {isLoading ? (
        <Spinner label={t('trainerClasses.loading')} />
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="mx-auto text-[#6B7280] mb-2" />
          <p className="text-[13px] text-[#6B7280]">{t('trainerClasses.noBookings')}</p>
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
                  <span className="text-[13px] font-semibold text-[#E5E7EB]">{cls?.name || 'Unknown'}</span>
                  <span className="text-[11px] text-[#6B7280] ml-auto">{classBookings.length}</span>
                </div>
                <div className="space-y-1.5">
                  {classBookings.map(b => (
                    <div key={b.id} className="flex items-center gap-2.5 p-2.5 bg-[#111827] rounded-xl border border-white/6">
                      {b.profiles?.avatar_url ? (
                        <img src={b.profiles.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-bold text-[#D4AF37]">
                            {b.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                          </span>
                        </div>
                      )}
                      <span className="flex-1 text-[13px] text-[#E5E7EB] truncate">
                        {b.profiles?.full_name || 'Unknown'}
                      </span>
                      {b.attended ? (
                        <span className="flex items-center gap-1 text-[11px] text-[#10B981] bg-[#10B981]/10 px-2.5 py-1 rounded-full font-medium">
                          <Check size={11} /> {t('trainerClasses.attended')}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleMarkAttended(b.id)}
                          className="flex items-center gap-1 text-[11px] text-[#D4AF37] bg-[#D4AF37]/10 px-2.5 py-1.5 rounded-full font-medium hover:bg-[#D4AF37]/20 transition-colors min-h-[32px]"
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
function AnalyticsTab({ classes, t }) {
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
        <BarChart3 size={40} className="mx-auto text-[#6B7280] mb-3" />
        <p className="text-[15px] text-[#6B7280]">{t('trainerClasses.noClasses')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Class selector pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {classes.map(cls => (
          <button
            key={cls.id}
            onClick={() => setSelectedClassId(cls.id)}
            className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-[12px] font-medium transition-all min-h-[36px] ${
              cls.id === selectedClassId
                ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                : 'bg-[#111827] text-[#6B7280] border border-white/6 hover:border-white/12'
            }`}
          >
            {cls.name}
          </button>
        ))}
      </div>

      {/* Analytics content */}
      {isLoading ? (
        <Spinner label={t('trainerClasses.loading')} />
      ) : !analytics || analytics.total === 0 ? (
        <div className="text-center py-12">
          <BarChart3 size={32} className="mx-auto text-[#6B7280] mb-2" />
          <p className="text-[13px] text-[#6B7280]">{t('trainerClasses.noData')}</p>
        </div>
      ) : (
        <>
          {/* Attendance rate + avg rating cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-[#111827] rounded-2xl border border-white/6">
              <p className="text-[11px] font-medium text-[#6B7280] mb-1.5">{t('trainerClasses.attendanceRate')}</p>
              <p className="text-[22px] font-bold text-[#E5E7EB]">{analytics.attendanceRate}%</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                {analytics.attended}/{analytics.total}
              </p>
            </div>
            <div className="p-4 bg-[#111827] rounded-2xl border border-white/6">
              <p className="text-[11px] font-medium text-[#6B7280] mb-1.5">{t('trainerClasses.avgRating')}</p>
              {analytics.avgRating ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[22px] font-bold text-[#E5E7EB]">{analytics.avgRating}</p>
                    <Star size={18} className="text-[#D4AF37] fill-[#D4AF37]" />
                  </div>
                  <div className="mt-2.5 space-y-1">
                    {[5, 4, 3, 2, 1].map(star => {
                      const count = analytics.starDist[star - 1];
                      const maxCount = Math.max(...analytics.starDist, 1);
                      return (
                        <div key={star} className="flex items-center gap-1.5">
                          <span className="text-[9px] text-[#6B7280] w-3 text-right">{star}</span>
                          <Star size={8} className="text-[#D4AF37] fill-[#D4AF37]" />
                          <div className="flex-1 h-1.5 bg-white/6 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#D4AF37]"
                              style={{ width: `${(count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-[#6B7280] w-4">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-[14px] text-[#6B7280]">--</p>
              )}
            </div>
          </div>

          {/* Recent attendees */}
          {hasTemplate && analytics.recentResults.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-[#6B7280] mb-2.5">{t('trainerClasses.recentAttendees')}</p>
              <div className="space-y-1.5">
                {analytics.recentResults.map((r, i) => (
                  <div
                    key={`${r.profile_id}-${i}`}
                    className="flex items-center gap-2.5 p-3 bg-[#111827] rounded-xl border border-white/6"
                  >
                    {r.profiles?.avatar_url ? (
                      <img src={r.profiles.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[11px] font-bold text-[#D4AF37]">
                          {r.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="block text-[13px] text-[#E5E7EB] truncate">
                        {r.profiles?.full_name || 'Unknown'}
                      </span>
                      {r.attended_at && (
                        <span className="text-[10px] text-[#6B7280]">
                          {format(new Date(r.attended_at), 'MMM d')}
                        </span>
                      )}
                    </div>
                    {r.workout_sessions?.total_volume_lbs != null && (
                      <span className="text-[11px] text-[#9CA3AF] flex items-center gap-1 flex-shrink-0">
                        <Dumbbell size={11} />
                        {Number(r.workout_sessions.total_volume_lbs).toLocaleString()} lbs
                      </span>
                    )}
                    {r.rating != null && (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {[1, 2, 3, 4, 5].map(s => (
                          <Star
                            key={s}
                            size={10}
                            className={s <= Math.round(r.rating) ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-[#6B7280]'}
                          />
                        ))}
                      </div>
                    )}
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
        <div className="flex items-center gap-2 p-3 bg-[#0F172A] border border-white/6 rounded-xl">
          <Dumbbell size={14} className="text-[#D4AF37] flex-shrink-0" />
          <span className="flex-1 text-[13px] text-[#E5E7EB] truncate">
            {selected.name}
            <span className="text-[#6B7280] ml-1.5">
              ({selected.routine_exercises?.[0]?.count || 0} exercises)
            </span>
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[11px] text-[#D4AF37] hover:text-[#C4A030] font-medium transition-colors"
            >
              {t('trainerClasses.changeTemplate')}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-[11px] text-red-400 hover:text-red-300 font-medium transition-colors"
            >
              {t('trainerClasses.removeTemplate')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('trainerClasses.changeTemplate')}
              className="w-full bg-[#0F172A] border border-white/6 rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
          {search && filtered.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl border border-white/6 bg-[#0F172A]">
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); }}
                  className="w-full text-left px-3 py-2.5 text-[12px] text-[#E5E7EB] hover:bg-white/[0.04] transition-colors flex items-center gap-2 min-h-[40px]"
                >
                  <Dumbbell size={12} className="text-[#6B7280]" />
                  <span className="truncate">{r.name}</span>
                  <span className="text-[#6B7280] ml-auto flex-shrink-0">
                    {r.routine_exercises?.[0]?.count || 0}
                  </span>
                </button>
              ))}
            </div>
          )}
          {search && filtered.length === 0 && (
            <p className="text-[11px] text-[#6B7280] italic px-1">{t('trainerClasses.noTemplatesFound')}</p>
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
        <div key={ex.id} className="flex items-center gap-2 p-2.5 bg-[#0F172A] rounded-lg border border-white/6">
          <span className="text-[10px] text-[#6B7280] w-4 text-right">{i + 1}.</span>
          <span className="flex-1 text-[12px] text-[#E5E7EB] truncate">{ex.exercises?.name || 'Unknown'}</span>
          <span className="text-[10px] text-[#6B7280]">{ex.sets}x{ex.reps}</span>
        </div>
      ))}
      {exercises.length === 0 && (
        <p className="text-[11px] text-[#6B7280] italic">{t('trainerClasses.noExercises')}</p>
      )}
    </div>
  );
}

// ── Tab 4: Templates ──
function TemplatesTab({ classes, gymId, t }) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

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
      addToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
    }
  };

  const [expandedClass, setExpandedClass] = useState(null);

  if (classes.length === 0) {
    return (
      <div className="text-center py-16">
        <Dumbbell size={40} className="mx-auto text-[#6B7280] mb-3" />
        <p className="text-[15px] text-[#6B7280]">{t('trainerClasses.noClasses')}</p>
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
          <div key={cls.id} className="bg-[#111827] rounded-2xl border border-white/6 overflow-hidden">
            <button
              onClick={() => setExpandedClass(isExpanded ? null : cls.id)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors"
            >
              {cls.image_url ? (
                <img src={cls.image_url} alt={cls.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-white/6" />
              ) : (
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/6"
                  style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
                >
                  <CalendarDays size={16} style={{ color: cls.accent_color || '#D4AF37' }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-[13px] font-bold text-[#E5E7EB] truncate">{cls.name}</h4>
                {templateName ? (
                  <span className="flex items-center gap-1 text-[11px] text-[#D4AF37] mt-0.5">
                    <Dumbbell size={11} /> {templateName}
                  </span>
                ) : (
                  <span className="text-[11px] text-[#6B7280] mt-0.5">{t('trainerClasses.noTemplate')}</span>
                )}
              </div>
              <ChevronRight size={16} className={`text-[#6B7280] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </button>

            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-white/6 pt-3">
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

// ── Main Page ──
export default function TrainerClasses() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;
  const trainerId = profile?.id;
  const [activeTab, setActiveTab] = useState('myClasses');

  useEffect(() => { document.title = 'Trainer - My Classes | TuGymPR'; }, []);

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
    <div className="px-4 md:px-8 py-6 max-w-[480px] mx-auto md:max-w-4xl">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('trainerClasses.title')}</h1>
        <p className="text-[13px] text-[#6B7280] mt-0.5">{t('trainerClasses.subtitle')}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-1 px-1 scrollbar-hide">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-medium transition-all min-h-[40px] ${
              tab === activeTab
                ? 'bg-[#D4AF37]/15 text-[#D4AF37]'
                : 'bg-[#111827] text-[#6B7280] hover:text-[#9CA3AF]'
            }`}
          >
            {t(`trainerClasses.${tabKeys[tab]}`)}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-[#111827] rounded-2xl border border-white/6 animate-pulse" />
          ))}
        </div>
      )}

      {/* Tab content */}
      {!isLoading && activeTab === 'myClasses' && (
        <MyClassesTab classes={classes} gymId={gymId} t={t} tc={tc} />
      )}
      {!isLoading && activeTab === 'bookings' && (
        <BookingsTab classes={classes} t={t} />
      )}
      {!isLoading && activeTab === 'analytics' && (
        <AnalyticsTab classes={classes} t={t} />
      )}
      {!isLoading && activeTab === 'templates' && (
        <TemplatesTab classes={classes} gymId={gymId} t={t} />
      )}
    </div>
  );
}
