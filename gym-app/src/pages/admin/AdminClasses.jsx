import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, Clock, Users, CalendarDays, X, Save,
  ChevronDown, ChevronUp, Edit3, Eye, Upload, Image as ImageIcon,
  Dumbbell, BarChart3, Star, Search, UserCheck, ListOrdered,
  Repeat, ArrowUpCircle, XCircle, UserX, AlertTriangle,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';

const DAYS_OF_WEEK = [
  { value: 0, labelKey: 'days.sunday' },
  { value: 1, labelKey: 'days.monday' },
  { value: 2, labelKey: 'days.tuesday' },
  { value: 3, labelKey: 'days.wednesday' },
  { value: 4, labelKey: 'days.thursday' },
  { value: 5, labelKey: 'days.friday' },
  { value: 6, labelKey: 'days.saturday' },
];

const DEFAULT_COLOR = '#D4AF37';

const COLOR_PRESETS = [
  '#D4AF37', '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6366F1',
];

// ── Toggle helper ──
function Toggle({ checked, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
      style={{ backgroundColor: checked ? 'var(--color-accent, #D4AF37)' : '#6B7280' }}
      aria-label={label}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{ left: checked ? 'calc(100% - 18px)' : '2px' }}
      />
    </button>
  );
}

// ── Routine Selector ──
function RoutineSelector({ gymId, value, onChange, t }) {
  const [search, setSearch] = useState('');

  const { data: routines = [] } = useQuery({
    queryKey: ['admin', 'routines-for-classes', gymId],
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
      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
        {t('admin.classes.workoutTemplate')}
      </label>
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
            {t('admin.classes.removeTemplate')}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('admin.classes.selectTemplate')}
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
            <p className="text-[11px] text-[#6B7280] italic px-1">{t('admin.classes.noTemplate')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Class Analytics Section (enhanced with no-show & cancellation tracking) ──
function ClassAnalytics({ classId, hasTemplate, t }) {
  const [open, setOpen] = useState(false);

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['admin', 'class-analytics', classId],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();
      const today = new Date().toISOString().slice(0, 10);

      // Fetch all bookings in the last 30 days
      const { data: allBookings } = await supabase
        .from('gym_class_bookings')
        .select('id, attended, rating, status, booking_date, cancelled_at')
        .eq('class_id', classId)
        .gte('created_at', since);

      const bookings = allBookings || [];
      const total = bookings.length;
      const attended = bookings.filter(b => b.attended).length;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;

      // No-show tracking: confirmed bookings where booking_date has passed and attended=false
      const noShows = bookings.filter(
        b => b.status === 'confirmed' && !b.attended && b.booking_date && b.booking_date < today,
      ).length;
      const confirmedPast = bookings.filter(
        b => (b.status === 'confirmed' || b.status === 'attended') && b.booking_date && b.booking_date < today,
      ).length;
      const noShowRate = confirmedPast > 0 ? Math.round((noShows / confirmedPast) * 100) : 0;

      // Cancellation tracking
      const cancelled = bookings.filter(b => b.status === 'cancelled').length;
      const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

      // Ratings
      const rated = bookings.filter(b => b.rating != null && b.attended);
      const avgRating = rated.length > 0
        ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
        : null;

      const starDist = [0, 0, 0, 0, 0]; // index 0=1-star, 4=5-star
      rated.forEach(b => {
        const idx = Math.max(0, Math.min(4, Math.round(b.rating) - 1));
        starDist[idx]++;
      });

      // Recent results (if template attached)
      let recentResults = [];
      if (hasTemplate) {
        const { data: resultBookings } = await supabase
          .from('gym_class_bookings')
          .select('profile_id, rating, notes, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs, completed_at)')
          .eq('class_id', classId)
          .eq('attended', true)
          .order('attended_at', { ascending: false })
          .limit(20);
        recentResults = resultBookings || [];
      }

      return {
        total, attended, attendanceRate, avgRating, starDist, recentResults,
        noShows, noShowRate, cancelled, cancellationRate,
      };
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
          {t('admin.classes.analytics')}
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
            <p className="text-[12px] text-[#6B7280] italic py-2">{t('admin.classes.noResults')}</p>
          ) : (
            <>
              {/* Attendance rate + avg rating row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                  <p className="text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.attendanceRate')}</p>
                  <p className="text-[20px] font-bold text-[#E5E7EB]">{analytics.attendanceRate}%</p>
                  <p className="text-[10px] text-[#6B7280]">
                    {analytics.attended}/{analytics.total}
                  </p>
                </div>
                <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                  <p className="text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.avgRating')}</p>
                  {analytics.avgRating ? (
                    <>
                      <div className="flex items-center gap-1">
                        <p className="text-[20px] font-bold text-[#E5E7EB]">{analytics.avgRating}</p>
                        <Star size={16} className="text-[#D4AF37] fill-[#D4AF37]" />
                      </div>
                      {/* Star distribution */}
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

              {/* No-show + cancellation stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                  <div className="flex items-center gap-1.5 mb-1">
                    <UserX size={12} className="text-[#EF4444]" />
                    <p className="text-[10px] font-medium text-[#6B7280]">{t('admin.classes.noShowRate')}</p>
                  </div>
                  <p className={`text-[20px] font-bold ${analytics.noShowRate > 20 ? 'text-[#EF4444]' : analytics.noShowRate > 10 ? 'text-[#F59E0B]' : 'text-[#10B981]'}`}>
                    {analytics.noShowRate}%
                  </p>
                  <p className="text-[10px] text-[#6B7280]">
                    {analytics.noShows} {t('admin.classes.noShows')}
                  </p>
                </div>
                <div className="p-3 bg-[#111827] rounded-xl border border-white/6">
                  <div className="flex items-center gap-1.5 mb-1">
                    <XCircle size={12} className="text-[#F59E0B]" />
                    <p className="text-[10px] font-medium text-[#6B7280]">{t('admin.classes.cancellationRate')}</p>
                  </div>
                  <p className={`text-[20px] font-bold ${analytics.cancellationRate > 30 ? 'text-[#EF4444]' : analytics.cancellationRate > 15 ? 'text-[#F59E0B]' : 'text-[#E5E7EB]'}`}>
                    {analytics.cancellationRate}%
                  </p>
                  <p className="text-[10px] text-[#6B7280]">
                    {analytics.cancelled} {t('admin.classes.cancellations')}
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-[#6B7280] italic text-right">{t('admin.classes.last30Days')}</p>

              {/* Recent workout results */}
              {hasTemplate && analytics.recentResults.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-[#6B7280] mb-2">{t('admin.classes.recentResults')}</p>
                  <div className="space-y-1.5">
                    {analytics.recentResults.map((r, i) => (
                      <div
                        key={`${r.profile_id}-${i}`}
                        className="flex items-center gap-2.5 p-2.5 bg-[#111827] rounded-lg border border-white/6"
                      >
                        {/* Avatar */}
                        {r.profiles?.avatar_url ? (
                          <img
                            src={r.profiles.avatar_url}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-[#D4AF37]">
                              {r.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                        {/* Name */}
                        <span className="flex-1 text-[12px] text-[#E5E7EB] truncate">
                          {r.profiles?.full_name || 'Unknown'}
                        </span>
                        {/* Volume */}
                        {r.workout_sessions?.total_volume_lbs != null && (
                          <span className="text-[11px] text-[#9CA3AF] flex items-center gap-1 flex-shrink-0">
                            <Dumbbell size={11} />
                            {Number(r.workout_sessions.total_volume_lbs).toLocaleString()} lbs
                          </span>
                        )}
                        {/* Rating */}
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

// ── Waitlist Manager (per-class, simplified) ──
function WaitlistManager({ classId, className: classTitle, t }) {
  const [open, setOpen] = useState(false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const { data: waitlist = [], isLoading } = useQuery({
    queryKey: ['admin', 'class-waitlist', classId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, waitlist_position, created_at, profiles(id, full_name, avatar_url, avatar_type, avatar_value)')
        .eq('class_id', classId)
        .eq('status', 'waitlisted')
        .order('waitlist_position', { ascending: true });
      return data || [];
    },
    enabled: open,
  });

  const promoteMutation = useMutation({
    mutationFn: async (bookingId) => {
      const { error } = await supabase
        .from('gym_class_bookings')
        .update({ status: 'confirmed', waitlist_position: null, promoted_at: new Date().toISOString() })
        .eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'class-waitlist', classId] });
      showToast('Member promoted from waitlist', 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: async (bookingId) => {
      const { error } = await supabase
        .from('gym_class_bookings')
        .delete()
        .eq('id', bookingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'class-waitlist', classId] });
      showToast('Removed from waitlist', 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[12px] font-semibold text-blue-400 hover:text-blue-300 transition-colors">
        <ListOrdered size={13} />
        {open ? 'Hide Waitlist' : 'Manage Waitlist'}
        {!open && waitlist.length > 0 && (
          <span className="text-[10px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full">{waitlist.length}</span>
        )}
      </button>
      {open && (
        <div className="mt-3 bg-[#0D1117] border border-white/4 rounded-xl p-3 space-y-2">
          {isLoading ? (
            <p className="text-[12px] text-[#6B7280]">Loading...</p>
          ) : waitlist.length === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic">No one on the waitlist</p>
          ) : (
            waitlist.map((entry, idx) => (
              <div key={entry.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/[0.02]">
                <span className="text-[11px] font-bold text-[#6B7280] w-5 text-center">#{idx + 1}</span>
                <div className="w-7 h-7 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-[#D4AF37]">
                    {entry.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#E5E7EB] truncate">{entry.profiles?.full_name || 'Unknown'}</p>
                  <p className="text-[10px] text-[#6B7280]">Joined waitlist {new Date(entry.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => promoteMutation.mutate(entry.id)}
                    disabled={promoteMutation.isPending}
                    title="Promote to confirmed"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">
                    <ArrowUpCircle size={11} /> Promote
                  </button>
                  <button onClick={() => removeMutation.mutate(entry.id)}
                    disabled={removeMutation.isPending}
                    title="Remove from waitlist"
                    className="p-1 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <XCircle size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Waitlist Queue Section ──
function WaitlistQueue({ classId, schedules = [], gymId, t, tc }) {
  const [open, setOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [promotingId, setPromotingId] = useState(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Auto-select first schedule when opening
  const activeScheduleId = selectedSchedule || schedules[0]?.id;

  const { data: waitlist = [], isLoading, refetch } = useQuery({
    queryKey: ['admin', 'class-waitlist', classId, activeScheduleId],
    queryFn: async () => {
      if (!activeScheduleId) return [];
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, profile_id, waitlist_position, created_at, profiles(full_name, avatar_url)')
        .eq('class_id', classId)
        .eq('schedule_id', activeScheduleId)
        .eq('status', 'waitlisted')
        .order('waitlist_position', { ascending: true });
      return data || [];
    },
    enabled: open && !!activeScheduleId,
    staleTime: 30 * 1000,
  });

  const handlePromote = async (booking) => {
    setPromotingId(booking.id);
    try {
      const { error } = await supabase
        .from('gym_class_bookings')
        .update({
          status: 'confirmed',
          waitlist_position: null,
          promoted_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
      if (error) throw error;

      // Reorder remaining waitlist positions
      const remaining = waitlist
        .filter(w => w.id !== booking.id)
        .sort((a, b) => a.waitlist_position - b.waitlist_position);
      for (let i = 0; i < remaining.length; i++) {
        await supabase
          .from('gym_class_bookings')
          .update({ waitlist_position: i + 1 })
          .eq('id', remaining[i].id);
      }

      showToast(t('admin.classes.promoted'), 'success');
      refetch();
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally {
      setPromotingId(null);
    }
  };

  const dayLabel = (dayNum) => {
    const d = DAYS_OF_WEEK.find(d => d.value === dayNum);
    return d ? tc(d.labelKey) : `Day ${dayNum}`;
  };

  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <ListOrdered size={13} />
          {t('admin.classes.waitlist')}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Schedule selector */}
          {schedules.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              {schedules
                .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
                .map(s => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSchedule(s.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      activeScheduleId === s.id
                        ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                        : 'bg-white/[0.04] text-[#6B7280] border border-white/6 hover:bg-white/[0.06]'
                    }`}
                  >
                    {dayLabel(s.day_of_week)} {s.start_time?.slice(0, 5)}
                  </button>
                ))}
            </div>
          )}

          {schedules.length === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic">{t('admin.classes.selectSchedule')}</p>
          ) : isLoading ? (
            <div className="flex items-center gap-2 py-3">
              <div className="w-4 h-4 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
              <span className="text-[12px] text-[#6B7280]">{tc('loading')}</span>
            </div>
          ) : waitlist.length === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic py-1">{t('admin.classes.waitlistEmpty')}</p>
          ) : (
            <div className="space-y-1.5">
              {waitlist.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center gap-2.5 p-2.5 bg-[#111827] rounded-lg border border-white/6"
                >
                  {/* Position badge */}
                  <span className="w-6 h-6 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                    {w.waitlist_position}
                  </span>
                  {/* Avatar */}
                  {w.profiles?.avatar_url ? (
                    <img
                      src={w.profiles.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-[#9CA3AF]">
                        {w.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                  {/* Name + joined time */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#E5E7EB] truncate">
                      {w.profiles?.full_name || 'Unknown'}
                    </p>
                    <p className="text-[10px] text-[#6B7280]">
                      {t('admin.classes.waitlistJoined')}: {new Date(w.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {/* Promote button */}
                  <button
                    onClick={() => handlePromote(w)}
                    disabled={promotingId === w.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#10B981]/12 text-[#10B981] hover:bg-[#10B981]/20 disabled:opacity-50 transition-colors flex-shrink-0"
                  >
                    <ArrowUpCircle size={12} />
                    {promotingId === w.id ? t('admin.classes.promoting') : t('admin.classes.promoteToConfirmed')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recurring Booking Management Section ──
function RecurringMembers({ classId, schedules = [], gymId, t, tc }) {
  const [open, setOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: recurring = [], isLoading, refetch } = useQuery({
    queryKey: ['admin', 'class-recurring', classId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_class_recurring')
        .select('id, schedule_id, profile_id, is_active, created_at, profiles(full_name, avatar_url), gym_class_schedules(day_of_week, start_time)')
        .eq('class_id', classId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  const handleCancelRecurring = async (rec) => {
    setCancellingId(rec.id);
    try {
      const { error } = await supabase
        .from('gym_class_recurring')
        .update({ is_active: false })
        .eq('id', rec.id);
      if (error) throw error;
      showToast(t('admin.classes.recurringCancelled'), 'success');
      refetch();
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const dayLabel = (dayNum) => {
    const d = DAYS_OF_WEEK.find(d => d.value === dayNum);
    return d ? tc(d.labelKey) : `Day ${dayNum}`;
  };

  return (
    <div className="border-t border-white/6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Repeat size={13} />
          {t('admin.classes.recurringMembers')}
          {recurring.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#D4AF37]/10 text-[#D4AF37] text-[10px] font-bold">
              {recurring.length}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 py-3">
              <div className="w-4 h-4 rounded-full border-2 border-[#D4AF37] border-t-transparent animate-spin" />
              <span className="text-[12px] text-[#6B7280]">{tc('loading')}</span>
            </div>
          ) : recurring.length === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic py-1">{t('admin.classes.noRecurringMembers')}</p>
          ) : (
            <div className="space-y-1.5">
              {recurring.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center gap-2.5 p-2.5 bg-[#111827] rounded-lg border border-white/6"
                >
                  {/* Avatar */}
                  {rec.profiles?.avatar_url ? (
                    <img
                      src={rec.profiles.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-[#9CA3AF]">
                        {rec.profiles?.full_name?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  )}
                  {/* Name + schedule info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#E5E7EB] truncate">
                      {rec.profiles?.full_name || 'Unknown'}
                    </p>
                    <p className="text-[10px] text-[#6B7280] flex items-center gap-1">
                      <Repeat size={9} />
                      {rec.gym_class_schedules
                        ? `${dayLabel(rec.gym_class_schedules.day_of_week)} ${rec.gym_class_schedules.start_time?.slice(0, 5)}`
                        : '--'
                      }
                      <span className="mx-1 text-white/10">|</span>
                      {new Date(rec.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  {/* Cancel button */}
                  <button
                    onClick={() => handleCancelRecurring(rec)}
                    disabled={cancellingId === rec.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#EF4444]/10 text-[#EF4444] hover:bg-[#EF4444]/20 disabled:opacity-50 transition-colors flex-shrink-0"
                  >
                    <XCircle size={12} />
                    {cancellingId === rec.id ? '...' : t('admin.classes.cancelRecurring')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Class Form Modal ──
function ClassFormModal({ classData, onClose, onSave, saving, gymId, trainers = [], t, tc }) {
  const [form, setForm] = useState({
    name: classData?.name || '',
    name_es: classData?.name_es || '',
    description: classData?.description || '',
    description_es: classData?.description_es || '',
    instructor: classData?.instructor || '',
    trainer_id: classData?.trainer_id || '',
    duration_minutes: classData?.duration_minutes || 60,
    max_capacity: classData?.max_capacity || 30,
    accent_color: classData?.accent_color || DEFAULT_COLOR,
    is_active: classData?.is_active ?? true,
    workout_template_id: classData?.workout_template_id || null,
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(classData?.image_url || '');

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    onSave({ ...form, imageFile });
  };

  const isEditing = !!classData?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-white/8 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <h2 className="text-[16px] font-bold text-[#E5E7EB]">
            {isEditing ? t('admin.classes.editClass') : t('admin.classes.addClass')}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/[0.04] text-[#6B7280] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Name EN */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
              {t('admin.classes.className')} (EN) *
            </label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              placeholder="Yoga, Spinning, CrossFit..."
            />
          </div>

          {/* Name ES */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
              {t('admin.classes.className')} (ES)
            </label>
            <input
              value={form.name_es}
              onChange={e => setForm(f => ({ ...f, name_es: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              placeholder="Yoga, Spinning, CrossFit..."
            />
          </div>

          {/* Description EN */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
              {t('admin.classes.description')} (EN)
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none"
            />
          </div>

          {/* Description ES */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
              {t('admin.classes.description')} (ES)
            </label>
            <textarea
              value={form.description_es}
              onChange={e => setForm(f => ({ ...f, description_es: e.target.value }))}
              rows={2}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none"
            />
          </div>

          {/* Instructor */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
              {t('admin.classes.instructor')}
            </label>
            <input
              value={form.instructor}
              onChange={e => setForm(f => ({ ...f, instructor: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            />
          </div>

          {/* Assign Trainer */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
              {t('admin.classes.assignTrainer')}
            </label>
            <select
              value={form.trainer_id}
              onChange={e => setForm(f => ({ ...f, trainer_id: e.target.value }))}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none appearance-none"
            >
              <option value="">{t('admin.classes.noTrainer')}</option>
              {trainers.map(tr => (
                <option key={tr.id} value={tr.id}>{tr.full_name}</option>
              ))}
            </select>
          </div>

          {/* Duration + Capacity row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                {t('admin.classes.duration')} ({tc('min') || 'min'})
              </label>
              <input
                type="number"
                min={5}
                value={form.duration_minutes}
                onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">
                {t('admin.classes.capacity')}
              </label>
              <input
                type="number"
                min={1}
                value={form.max_capacity}
                onChange={e => setForm(f => ({ ...f, max_capacity: Number(e.target.value) }))}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              />
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1.5">
              {t('admin.classes.accentColor')}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(f => ({ ...f, accent_color: c }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    form.accent_color === c ? 'border-white scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
              <input
                type="color"
                value={form.accent_color}
                onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))}
                className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
              />
            </div>
          </div>

          {/* Workout Template */}
          <RoutineSelector
            gymId={gymId}
            value={form.workout_template_id}
            onChange={(id) => setForm(f => ({ ...f, workout_template_id: id }))}
            t={t}
          />

          {/* Image upload */}
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1.5">
              {t('admin.classes.image')}
            </label>
            {imagePreview ? (
              <div className="relative w-full h-32 rounded-xl overflow-hidden border border-white/6">
                <img src={imagePreview} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => { setImageFile(null); setImagePreview(''); }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-24 rounded-xl border border-dashed border-white/10 cursor-pointer hover:border-white/20 transition-colors">
                <Upload size={18} className="text-[#6B7280] mb-1" />
                <span className="text-[11px] text-[#6B7280]">{t('admin.classes.uploadImage')}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-5 border-t border-white/6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.name.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black disabled:opacity-50 transition-opacity"
          >
            <Save size={14} />
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Schedule Slot Form ──
function ScheduleSlotForm({ onAdd, t, tc }) {
  const [day, setDay] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [capacityOverride, setCapacityOverride] = useState('');

  const handleAdd = () => {
    onAdd({
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      capacity_override: capacityOverride ? Number(capacityOverride) : null,
    });
    setCapacityOverride('');
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[100px]">
        <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.day')}</label>
        <select
          value={day}
          onChange={e => setDay(Number(e.target.value))}
          className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 appearance-none"
        >
          {DAYS_OF_WEEK.map(d => (
            <option key={d.value} value={d.value}>{tc(d.labelKey)}</option>
          ))}
        </select>
      </div>
      <div className="min-w-[90px]">
        <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.startTime')}</label>
        <input
          type="time"
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
          className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
        />
      </div>
      <div className="min-w-[90px]">
        <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.endTime')}</label>
        <input
          type="time"
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
        />
      </div>
      <div className="min-w-[70px]">
        <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.capacityOverride')}</label>
        <input
          type="number"
          min={1}
          value={capacityOverride}
          onChange={e => setCapacityOverride(e.target.value)}
          placeholder="-"
          className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40"
        />
      </div>
      <button
        onClick={handleAdd}
        className="p-2 rounded-lg bg-[#D4AF37]/12 text-[#D4AF37] hover:bg-[#D4AF37]/20 transition-colors"
        aria-label={t('admin.classes.addSchedule')}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

// ── Delete Confirmation Modal ──
function DeleteConfirmModal({ className: classItem, onConfirm, onCancel, deleting, t, tc }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-white/8 rounded-2xl w-full max-w-sm p-6">
        <h3 className="text-[15px] font-bold text-[#E5E7EB] mb-2">{t('admin.classes.deleteClass')}</h3>
        <p className="text-[13px] text-[#9CA3AF] mb-5">
          {t('admin.classes.deleteConfirm', { name: classItem?.name })}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-[#EF4444] text-white disabled:opacity-50 transition-opacity"
          >
            {deleting ? '...' : tc('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bookings Viewer Modal ──
function BookingsModal({ classItem, onClose, gymId, t, tc }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchBookings = useCallback(async () => {
    if (!classItem?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('class_bookings')
      .select('id, booked_at, profiles(full_name, username)')
      .eq('class_id', classItem.id)
      .gte('booked_at', `${date}T00:00:00`)
      .lte('booked_at', `${date}T23:59:59`)
      .order('booked_at');
    setBookings(data || []);
    setLoading(false);
  }, [classItem?.id, date]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-white/8 rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <h2 className="text-[15px] font-bold text-[#E5E7EB]">
            {t('admin.classes.bookings')} - {classItem?.name}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/[0.04] text-[#6B7280] transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40"
          />
          {loading ? (
            <p className="text-[12px] text-[#6B7280]">{tc('loading')}</p>
          ) : bookings.length === 0 ? (
            <p className="text-[12px] text-[#6B7280] italic">{t('admin.classes.noBookings')}</p>
          ) : (
            <div className="space-y-2">
              {bookings.map(b => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-[#111827] rounded-xl border border-white/6">
                  <span className="text-[13px] text-[#E5E7EB]">
                    {b.profiles?.full_name || b.profiles?.username || 'Unknown'}
                  </span>
                  <span className="text-[11px] text-[#6B7280]">
                    {new Date(b.booked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-[#6B7280] text-right">
                {bookings.length} {t('admin.classes.booked')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// ── Main Page ──────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
export default function AdminClasses() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  const [formModal, setFormModal] = useState(null); // null | 'new' | classObject
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedClass, setExpandedClass] = useState(null);
  const [bookingsTarget, setBookingsTarget] = useState(null);

  useEffect(() => { document.title = 'Admin - Classes | TuGymPR'; }, []);

  // ── Fetch classes ──
  const { data: classes = [], isLoading } = useQuery({
    queryKey: ['admin', 'classes', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_classes')
        .select('*, class_schedules(id, day_of_week, start_time, end_time, capacity_override), trainer:profiles!gym_classes_trainer_id_fkey(id, full_name, avatar_url)')
        .eq('gym_id', gymId)
        .order('name');
      // Resolve signed image URLs
      if (data) {
        for (const cls of data) {
          if (cls.image_path) {
            const { data: signed } = await supabase.storage
              .from('class-images')
              .createSignedUrl(cls.image_path, 60 * 60);
            cls.image_url = signed?.signedUrl || '';
          }
        }
      }
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Fetch trainers ──
  const { data: trainers = [] } = useQuery({
    queryKey: ['admin', 'trainers-for-classes', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('gym_id', gymId)
        .eq('role', 'trainer')
        .order('full_name');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  // ── Save class (create or update) ──
  const handleSaveClass = async (formData) => {
    setSaving(true);
    try {
      let imagePath = formModal?.image_path || null;

      // Upload image if provided
      if (formData.imageFile) {
        const ext = formData.imageFile.name.split('.').pop();
        const path = `${gymId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('class-images')
          .upload(path, formData.imageFile, { cacheControl: '3600', upsert: false });
        if (uploadErr) throw uploadErr;
        imagePath = path;
      }

      const payload = {
        gym_id: gymId,
        name: formData.name,
        name_es: formData.name_es || null,
        description: formData.description || null,
        description_es: formData.description_es || null,
        instructor: formData.instructor || null,
        duration_minutes: formData.duration_minutes,
        max_capacity: formData.max_capacity,
        accent_color: formData.accent_color,
        is_active: formData.is_active,
        image_path: imagePath,
        workout_template_id: formData.workout_template_id || null,
        trainer_id: formData.trainer_id || null,
      };

      if (formModal?.id) {
        // Update
        const { error } = await supabase
          .from('gym_classes')
          .update(payload)
          .eq('id', formModal.id);
        if (error) throw error;
      } else {
        // Insert
        const { error } = await supabase
          .from('gym_classes')
          .insert(payload);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ['admin', 'classes', gymId] });
      setFormModal(null);
      showToast(tc('success'), 'success');
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle active ──
  const handleToggleActive = async (cls) => {
    const { error } = await supabase
      .from('gym_classes')
      .update({ is_active: !cls.is_active })
      .eq('id', cls.id);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['admin', 'classes', gymId] });
    }
  };

  // ── Delete class ──
  const handleDeleteClass = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Delete schedules first
      await supabase.from('class_schedules').delete().eq('class_id', deleteTarget.id);
      // Delete bookings
      await supabase.from('class_bookings').delete().eq('class_id', deleteTarget.id);
      // Delete class
      const { error } = await supabase.from('gym_classes').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      // Clean up image
      if (deleteTarget.image_path) {
        await supabase.storage.from('class-images').remove([deleteTarget.image_path]);
      }
      queryClient.invalidateQueries({ queryKey: ['admin', 'classes', gymId] });
      setDeleteTarget(null);
      showToast(tc('success'), 'success');
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Add schedule slot ──
  const handleAddSlot = async (classId, slot) => {
    const { error } = await supabase.from('class_schedules').insert({
      class_id: classId,
      gym_id: gymId,
      ...slot,
    });
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['admin', 'classes', gymId] });
    } else {
      showToast(error.message, 'error');
    }
  };

  // ── Delete schedule slot ──
  const handleDeleteSlot = async (slotId) => {
    const { error } = await supabase.from('class_schedules').delete().eq('id', slotId);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['admin', 'classes', gymId] });
    }
  };

  const dayLabel = (dayNum) => {
    const d = DAYS_OF_WEEK.find(d => d.value === dayNum);
    return d ? tc(d.labelKey) : `Day ${dayNum}`;
  };

  return (
    <AdminPageShell size="wide" className="space-y-5">
      <PageHeader
        title={t('admin.classes.title')}
        subtitle={t('admin.classes.subtitle')}
        actions={
          <button
            onClick={() => setFormModal('new')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black hover:bg-[#C9A432] transition-colors"
          >
            <Plus size={15} />
            {t('admin.classes.addClass')}
          </button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
        </div>
      ) : classes.length === 0 ? (
        <FadeIn>
          <AdminCard padding="p-8">
            <div className="text-center">
              <CalendarDays size={32} className="mx-auto text-[#6B7280] mb-3" />
              <p className="text-[14px] font-semibold text-[#9CA3AF] mb-1">{t('admin.classes.noClasses')}</p>
              <p className="text-[12px] text-[#6B7280]">{t('admin.classes.noClassesDesc')}</p>
            </div>
          </AdminCard>
        </FadeIn>
      ) : (
        <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-3">
          {classes.map((cls, idx) => (
            <FadeIn key={cls.id} delay={idx * 40}>
              <AdminCard hover padding="p-0" borderLeft={cls.accent_color}>
                {/* Class header */}
                <div className="flex items-start gap-3 p-4">
                  {/* Image thumbnail */}
                  {cls.image_url ? (
                    <img
                      src={cls.image_url}
                      alt={cls.name}
                      className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6"
                    />
                  ) : (
                    <div
                      className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center border border-white/6"
                      style={{ backgroundColor: `${cls.accent_color}15` }}
                    >
                      <CalendarDays size={20} style={{ color: cls.accent_color }} />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-bold text-[#E5E7EB] truncate">{cls.name}</h3>
                      {!cls.is_active && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/6 text-[#6B7280] border border-white/10">
                          {t('admin.classes.inactive')}
                        </span>
                      )}
                    </div>
                    {cls.instructor && (
                      <p className="text-[12px] text-[#9CA3AF] mt-0.5">{cls.instructor}</p>
                    )}
                    {cls.trainer && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {cls.trainer.avatar_url ? (
                          <img
                            src={cls.trainer.avatar_url}
                            alt=""
                            className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                            <span className="text-[7px] font-bold text-[#D4AF37]">
                              {cls.trainer.full_name?.[0]?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                        <span className="text-[11px] text-[#9CA3AF]">
                          <UserCheck size={11} className="inline mr-0.5 text-[#D4AF37]" />
                          {t('admin.classes.assignedTo')}: {cls.trainer.full_name}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Clock size={12} /> {cls.duration_minutes} {tc('min') || 'min'}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <Users size={12} /> {cls.max_capacity}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                        <CalendarDays size={12} /> {cls.class_schedules?.length || 0} {t('admin.classes.slots')}
                      </span>
                      {cls.workout_template_id && (
                        <span className="flex items-center gap-1 text-[11px] text-[#D4AF37] bg-[#D4AF37]/10 px-2 py-0.5 rounded-full">
                          <Dumbbell size={11} /> {t('admin.classes.templateAttached')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Toggle
                      checked={cls.is_active}
                      onChange={() => handleToggleActive(cls)}
                      label={t('admin.classes.toggleActive')}
                    />
                    <button
                      onClick={() => setBookingsTarget(cls)}
                      className="p-2 rounded-lg hover:bg-white/[0.04] text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                      aria-label={t('admin.classes.bookings')}
                    >
                      <Eye size={15} />
                    </button>
                    <button
                      onClick={() => setFormModal(cls)}
                      className="p-2 rounded-lg hover:bg-white/[0.04] text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                      aria-label={tc('edit')}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(cls)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                      aria-label={tc('delete')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Expandable schedule section */}
                <div className="border-t border-white/6">
                  <button
                    onClick={() => setExpandedClass(expandedClass === cls.id ? null : cls.id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-medium text-[#9CA3AF] hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <CalendarDays size={13} />
                      {t('admin.classes.schedule')} ({cls.class_schedules?.length || 0})
                    </span>
                    {expandedClass === cls.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {expandedClass === cls.id && (
                    <div className="px-4 pb-4 space-y-3">
                      {/* Existing slots */}
                      {cls.class_schedules?.length > 0 && (
                        <div className="space-y-1.5">
                          {cls.class_schedules
                            .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time))
                            .map(slot => (
                              <div
                                key={slot.id}
                                className="flex items-center justify-between p-2.5 bg-[#111827] rounded-lg border border-white/6"
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-[12px] font-semibold text-[#E5E7EB] min-w-[80px]">
                                    {dayLabel(slot.day_of_week)}
                                  </span>
                                  <span className="text-[12px] text-[#9CA3AF]">
                                    {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
                                  </span>
                                  {slot.capacity_override && (
                                    <span className="text-[10px] text-[#6B7280] bg-white/[0.04] px-1.5 py-0.5 rounded">
                                      {t('admin.classes.cap')}: {slot.capacity_override}
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleDeleteSlot(slot.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Add new slot */}
                      <div className="pt-2 border-t border-white/6">
                        <p className="text-[11px] font-medium text-[#6B7280] mb-2">{t('admin.classes.addSchedule')}</p>
                        <ScheduleSlotForm
                          onAdd={(slot) => handleAddSlot(cls.id, slot)}
                          t={t}
                          tc={tc}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Waitlist queue section */}
                <WaitlistQueue
                  classId={cls.id}
                  schedules={cls.class_schedules || []}
                  gymId={gymId}
                  t={t}
                  tc={tc}
                />

                {/* Recurring members section */}
                <RecurringMembers
                  classId={cls.id}
                  schedules={cls.class_schedules || []}
                  gymId={gymId}
                  t={t}
                  tc={tc}
                />

                {/* Analytics section (with no-show & cancellation stats) */}
                <ClassAnalytics
                  classId={cls.id}
                  hasTemplate={!!cls.workout_template_id}
                  t={t}
                />

                {/* Waitlist manager */}
                <div className="px-4 pb-3">
                  <WaitlistManager classId={cls.id} className={cls.name} t={t} />
                </div>
              </AdminCard>
            </FadeIn>
          ))}
        </div>
      )}

      {/* Modals */}
      {formModal && (
        <ClassFormModal
          classData={formModal === 'new' ? null : formModal}
          onClose={() => setFormModal(null)}
          onSave={handleSaveClass}
          saving={saving}
          gymId={gymId}
          trainers={trainers}
          t={t}
          tc={tc}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          className={deleteTarget}
          onConfirm={handleDeleteClass}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleting}
          t={t}
          tc={tc}
        />
      )}

      {bookingsTarget && (
        <BookingsModal
          classItem={bookingsTarget}
          onClose={() => setBookingsTarget(null)}
          gymId={gymId}
          t={t}
          tc={tc}
        />
      )}
    </AdminPageShell>
  );
}
