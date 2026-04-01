import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays, Users, Clock, ChevronDown, ChevronUp, Dumbbell,
  BarChart3, Star, Plus, Trash2, Search, Check, UserCheck, Eye,
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

// ── Routine Selector (scoped to gym) ──
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
        <div className="flex items-center gap-2 p-2.5 bg-[#111827] border border-white/6 rounded-xl">
          <Dumbbell size={14} className="text-[#D4AF37] flex-shrink-0" />
          <span className="flex-1 text-[13px] text-[#E5E7EB] truncate">
            {selected.name}
            <span className="text-[#6B7280] ml-1.5">
              ({selected.routine_exercises?.[0]?.count || 0} exercises)
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-red-400 hover:text-red-300 font-medium transition-colors"
          >
            {t('trainerClasses.changeTemplate')}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('trainerClasses.changeTemplate')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>
          {search && filtered.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-xl border border-white/6 bg-[#111827]">
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); }}
                  className="w-full text-left px-3 py-2 text-[12px] text-[#E5E7EB] hover:bg-white/[0.04] transition-colors flex items-center gap-2"
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
            <p className="text-[11px] text-[#6B7280] italic px-1">No templates found</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Template Preview ──
function TemplatePreview({ templateId }) {
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
  if (isLoading) return (
    <div className="flex items-center gap-2 py-2">
      <div className="w-3 h-3 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
      <span className="text-[11px] text-[#6B7280]">Loading...</span>
    </div>
  );

  return (
    <div className="space-y-1 mt-2">
      {exercises.map((ex, i) => (
        <div key={ex.id} className="flex items-center gap-2 p-2 bg-[#111827] rounded-lg border border-white/6">
          <span className="text-[10px] text-[#6B7280] w-4 text-right">{i + 1}.</span>
          <span className="flex-1 text-[12px] text-[#E5E7EB] truncate">{ex.exercises?.name || 'Unknown'}</span>
          <span className="text-[10px] text-[#6B7280]">{ex.sets}x{ex.reps}</span>
        </div>
      ))}
      {exercises.length === 0 && (
        <p className="text-[11px] text-[#6B7280] italic">No exercises in template</p>
      )}
    </div>
  );
}

// ── Schedule Management Section ──
function ScheduleSection({ cls, gymId, t, tc }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newSlot, setNewSlot] = useState({ day_of_week: 1, start_time: '09:00', end_time: '10:00' });
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const handleAddSlot = async () => {
    const { error } = await supabase.from('class_schedules').insert({
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
    const { error } = await supabase.from('class_schedules').delete().eq('id', slotId);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
    }
  };

  const schedules = cls.class_schedules || [];

  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <CalendarDays size={13} />
          {t('trainerClasses.schedule')} ({schedules.length})
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {schedules.length > 0 && (
            <div className="space-y-1.5">
              {schedules
                .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
                .map(slot => (
                  <div key={slot.id} className="flex items-center justify-between p-2.5 bg-[#111827] rounded-lg border border-white/6">
                    <span className="text-[12px] text-[#E5E7EB]">
                      {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey || '')}
                    </span>
                    <span className="text-[12px] text-[#9CA3AF]">
                      {slot.start_time?.slice(0, 5)} – {slot.end_time?.slice(0, 5)}
                    </span>
                    <button
                      onClick={() => handleDeleteSlot(slot.id)}
                      className="p-1 rounded hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
            </div>
          )}

          {adding ? (
            <div className="p-3 bg-[#111827] rounded-xl border border-white/6 space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-[#6B7280] mb-1">Day</label>
                <select
                  value={newSlot.day_of_week}
                  onChange={e => setNewSlot(s => ({ ...s, day_of_week: Number(e.target.value) }))}
                  className="w-full bg-[#0A0D14] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                >
                  {DAYS_OF_WEEK.map(d => (
                    <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280] mb-1">Start</label>
                  <input
                    type="time"
                    value={newSlot.start_time}
                    onChange={e => setNewSlot(s => ({ ...s, start_time: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280] mb-1">End</label>
                  <input
                    type="time"
                    value={newSlot.end_time}
                    onChange={e => setNewSlot(s => ({ ...s, end_time: e.target.value }))}
                    className="w-full bg-[#0A0D14] border border-white/6 rounded-lg px-3 py-2 text-[12px] text-[#E5E7EB] outline-none focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddSlot}
                  className="px-3 py-1.5 bg-[#D4AF37] text-[#05070B] text-[12px] font-semibold rounded-lg hover:bg-[#C4A030] transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setAdding(false)}
                  className="px-3 py-1.5 text-[12px] text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-[12px] text-[#D4AF37] hover:text-[#C4A030] transition-colors font-medium"
            >
              <Plus size={13} /> Add Slot
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Upcoming Bookings Section ──
function BookingsSection({ cls, t }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['trainer', 'class-bookings', cls.id],
    queryFn: async () => {
      const today = startOfDay(new Date());
      const next7 = addDays(today, 7);

      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, status, attended, booked_date, profiles(id, full_name, avatar_url)')
        .eq('class_id', cls.id)
        .gte('booked_date', format(today, 'yyyy-MM-dd'))
        .lte('booked_date', format(next7, 'yyyy-MM-dd'))
        .order('booked_date');
      return data || [];
    },
    enabled: open,
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
      queryClient.invalidateQueries({ queryKey: ['trainer', 'class-bookings', cls.id] });
    }
  };

  // Group bookings by date
  const grouped = bookings.reduce((acc, b) => {
    const date = b.booked_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(b);
    return acc;
  }, {});

  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Users size={13} />
          {t('trainerClasses.bookings')} — {t('trainerClasses.upcoming7Days')}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4">
              <div className="w-4 h-4 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
              <span className="text-[12px] text-[#6B7280]">Loading...</span>
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic py-2">No bookings in the next 7 days</p>
          ) : (
            Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, dateBookings]) => (
                <div key={date}>
                  <p className="text-[11px] font-semibold text-[#D4AF37] mb-1.5">
                    {format(new Date(date + 'T00:00:00'), 'EEE, MMM d')}
                  </p>
                  <div className="space-y-1">
                    {dateBookings.map(b => (
                      <div key={b.id} className="flex items-center gap-2.5 p-2.5 bg-[#111827] rounded-lg border border-white/6">
                        {b.profiles?.avatar_url ? (
                          <img src={b.profiles.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-[#D4AF37]">
                              {b.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                        <span className="flex-1 text-[12px] text-[#E5E7EB] truncate">
                          {b.profiles?.full_name || 'Unknown'}
                        </span>
                        {b.attended ? (
                          <span className="flex items-center gap-1 text-[10px] text-[#10B981] bg-[#10B981]/10 px-2 py-0.5 rounded-full font-medium">
                            <Check size={10} /> Attended
                          </span>
                        ) : (
                          <button
                            onClick={() => handleMarkAttended(b.id)}
                            className="flex items-center gap-1 text-[10px] text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-1 rounded-full font-medium hover:bg-[#D4AF37]/20 transition-colors"
                          >
                            <UserCheck size={10} /> {t('trainerClasses.markAttended')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Analytics Section ──
function AnalyticsSection({ cls, t }) {
  const [open, setOpen] = useState(false);
  const hasTemplate = !!cls.workout_template_id;

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['trainer', 'class-analytics', cls.id],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();

      const { data: allBookings } = await supabase
        .from('gym_class_bookings')
        .select('id, attended, rating')
        .eq('class_id', cls.id)
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
          .eq('class_id', cls.id)
          .eq('attended', true)
          .order('attended_at', { ascending: false })
          .limit(20);
        recentResults = resultBookings || [];
      }

      return { total, attended, attendanceRate, avgRating, starDist, recentResults };
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <BarChart3 size={13} />
          {t('trainerClasses.analytics')}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4">
              <div className="w-4 h-4 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
              <span className="text-[12px] text-[#6B7280]">Loading...</span>
            </div>
          ) : !analytics || analytics.total === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic py-2">No data yet</p>
          ) : (
            <>
              {/* Attendance rate + avg rating row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                  <p className="text-[10px] font-medium text-[#6B7280] mb-1">{t('trainerClasses.attendanceRate')}</p>
                  <p className="text-[20px] font-bold text-[#E5E7EB]">{analytics.attendanceRate}%</p>
                  <p className="text-[10px] text-[#6B7280]">
                    {analytics.attended}/{analytics.total}
                  </p>
                </div>
                <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                  <p className="text-[10px] font-medium text-[#6B7280] mb-1">{t('trainerClasses.avgRating')}</p>
                  {analytics.avgRating ? (
                    <>
                      <div className="flex items-center gap-1">
                        <p className="text-[20px] font-bold text-[#E5E7EB]">{analytics.avgRating}</p>
                        <Star size={16} className="text-[#D4AF37] fill-[#D4AF37]" />
                      </div>
                      <div className="mt-2 space-y-1">
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
                    <p className="text-[13px] text-[#6B7280]">--</p>
                  )}
                </div>
              </div>

              {/* Recent attendees */}
              {hasTemplate && analytics.recentResults.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-[#6B7280] mb-2">{t('trainerClasses.recentAttendees')}</p>
                  <div className="space-y-1.5">
                    {analytics.recentResults.map((r, i) => (
                      <div
                        key={`${r.profile_id}-${i}`}
                        className="flex items-center gap-2.5 p-2.5 bg-[#111827] rounded-lg border border-white/6"
                      >
                        {r.profiles?.avatar_url ? (
                          <img src={r.profiles.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-[#D4AF37]">
                              {r.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="block text-[12px] text-[#E5E7EB] truncate">
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
      )}
    </div>
  );
}

// ── Workout Template Section ──
function TemplateSection({ cls, gymId, t }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const handleChangeTemplate = async (templateId) => {
    const { error } = await supabase
      .from('gym_classes')
      .update({ workout_template_id: templateId, updated_at: new Date().toISOString() })
      .eq('id', cls.id);
    if (error) {
      addToast(error.message, 'error');
    } else {
      queryClient.invalidateQueries({ queryKey: ['trainer', 'my-classes'] });
    }
  };

  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Dumbbell size={13} />
          {t('trainerClasses.template')}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <RoutineSelector
            gymId={gymId}
            value={cls.workout_template_id}
            onChange={handleChangeTemplate}
            t={t}
          />
          <TemplatePreview templateId={cls.workout_template_id} />
        </div>
      )}
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

  useEffect(() => { document.title = 'Trainer - My Classes | TuGymPR'; }, []);

  const { data: classes = [], isLoading } = useQuery({
    queryKey: ['trainer', 'my-classes', trainerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_classes')
        .select('*, class_schedules(id, day_of_week, start_time, end_time, capacity_override)')
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

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#E5E7EB]">{t('trainerClasses.title')}</h1>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-[#0F172A] rounded-[14px] border border-white/6 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && classes.length === 0 && (
        <div className="text-center py-16">
          <CalendarDays size={40} className="mx-auto text-[#6B7280] mb-3" />
          <p className="text-[15px] text-[#6B7280]">{t('trainerClasses.noClasses')}</p>
        </div>
      )}

      {/* Classes list */}
      {!isLoading && classes.length > 0 && (
        <div className="space-y-4">
          {classes.map(cls => (
            <div key={cls.id} className="bg-[#0F172A] rounded-[14px] border border-white/6 overflow-hidden">
              {/* Class header card */}
              <div className="flex items-center gap-3 p-4">
                {cls.image_url ? (
                  <img
                    src={cls.image_url}
                    alt={cls.name}
                    className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6"
                  />
                ) : (
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/6"
                    style={{ backgroundColor: (cls.accent_color || '#D4AF37') + '20' }}
                  >
                    <CalendarDays size={22} style={{ color: cls.accent_color || '#D4AF37' }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-[15px] font-bold text-[#E5E7EB] truncate">{cls.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                      <Clock size={12} /> {cls.duration_minutes} min
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                      <Users size={12} /> {cls.max_capacity}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                      <CalendarDays size={12} /> {cls.class_schedules?.length || 0} slots
                    </span>
                    {cls.workout_template_id && (
                      <span className="flex items-center gap-1 text-[11px] text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full">
                        <Dumbbell size={11} /> Template
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable sections */}
              <ScheduleSection cls={cls} gymId={gymId} t={t} tc={tc} />
              <BookingsSection cls={cls} t={t} />
              <AnalyticsSection cls={cls} t={t} />
              <TemplateSection cls={cls} gymId={gymId} t={t} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
