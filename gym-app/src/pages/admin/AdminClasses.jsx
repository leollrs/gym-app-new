import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Clock, Users, CalendarDays, X, Save,
  ChevronDown, ChevronUp, Edit3, Upload,
  Dumbbell, Star, Search, UserCheck,
  XCircle, UserX, Calendar, Languages, Check, Loader2,
  BarChart3, Repeat,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { validateImageFile } from '../../lib/validateImage';
import { useAutoTranslate } from '../../hooks/useAutoTranslate';
import {
  PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton,
  AdminPageShell, FilterBar, AdminModal, StatCard, AdminTabs,
} from '../../components/admin';

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

// Format a schedule slot label (recurring vs specific date)
function slotDayLabel(slot, dayLabelFn) {
  if (slot.specific_date) {
    const d = new Date(slot.specific_date + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return dayLabelFn(slot.day_of_week);
}

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
    queryKey: adminKeys.classes.routines(gymId),
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
              ({selected.routine_exercises?.[0]?.count || 0} {t('admin.classes.exercises', 'exercises')})
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

// ── Class Analytics Section ──
function ClassAnalytics({ classId, hasTemplate, t }) {
  const { data: analytics, isLoading } = useQuery({
    queryKey: adminKeys.classes.detail(classId),
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = thirtyDaysAgo.toISOString();
      const today = new Date().toISOString().slice(0, 10);

      const { data: allBookings } = await supabase
        .from('gym_class_bookings')
        .select('id, attended, rating, status, booking_date, cancelled_at')
        .eq('class_id', classId)
        .gte('created_at', since);

      const bookings = allBookings || [];
      const total = bookings.length;
      const attended = bookings.filter(b => b.attended).length;
      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;

      const noShows = bookings.filter(
        b => b.status === 'confirmed' && !b.attended && b.booking_date && b.booking_date < today,
      ).length;
      const confirmedPast = bookings.filter(
        b => (b.status === 'confirmed' || b.status === 'attended') && b.booking_date && b.booking_date < today,
      ).length;
      const noShowRate = confirmedPast > 0 ? Math.round((noShows / confirmedPast) * 100) : 0;

      const cancelled = bookings.filter(b => b.status === 'cancelled').length;
      const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

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
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 px-4">
        <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.loading', 'Loading...')}</span>
      </div>
    );
  }

  if (!analytics || analytics.total === 0) {
    return <p className="text-[12px] italic py-3 px-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noResults')}</p>;
  }

  return (
    <div className="space-y-4 p-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.attendanceRate')}</p>
          <p className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{analytics.attendanceRate}%</p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{analytics.attended}/{analytics.total}</p>
        </div>
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.avgRating')}</p>
          {analytics.avgRating ? (
            <div className="flex items-center gap-1">
              <p className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{analytics.avgRating}</p>
              <Star size={14} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>--</p>
          )}
        </div>
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <UserX size={11} style={{ color: 'var(--color-danger)' }} />
            <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noShowRate')}</p>
          </div>
          <p className="text-[18px] font-bold"
            style={{ color: analytics.noShowRate > 20 ? 'var(--color-danger)' : analytics.noShowRate > 10 ? 'var(--color-warning)' : 'var(--color-success)' }}>
            {analytics.noShowRate}%
          </p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{analytics.noShows} {t('admin.classes.noShows')}</p>
        </div>
        <div className="p-3.5 rounded-xl transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <XCircle size={11} style={{ color: 'var(--color-warning)' }} />
            <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.cancellationRate')}</p>
          </div>
          <p className="text-[18px] font-bold"
            style={{ color: analytics.cancellationRate > 30 ? 'var(--color-danger)' : analytics.cancellationRate > 15 ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
            {analytics.cancellationRate}%
          </p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{analytics.cancelled} {t('admin.classes.cancellations')}</p>
        </div>
      </div>

      {/* Star distribution */}
      {analytics.avgRating && (
        <div className="space-y-1.5 py-1">
          {[5, 4, 3, 2, 1].map(star => {
            const count = analytics.starDist[star - 1];
            const maxCount = Math.max(...analytics.starDist, 1);
            return (
              <div key={star} className="flex items-center gap-1.5">
                <span className="text-[9px] w-3 text-right tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{star}</span>
                <Star size={8} style={{ color: 'var(--color-accent)', fill: 'var(--color-accent)' }} />
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: 'var(--color-accent)' }} />
                </div>
                <span className="text-[9px] w-4 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] italic text-right" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.last30Days')}</p>

      {/* Recent workout results */}
      {hasTemplate && analytics.recentResults.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.recentResults')}</p>
          <div className="space-y-1.5">
            {analytics.recentResults.map((r, i) => (
              <div key={`${r.profile_id}-${i}`} className="flex items-center gap-2.5 p-2.5 rounded-lg transition-colors hover:brightness-105"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                {r.profiles?.avatar_url ? (
                  <img src={r.profiles.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--color-accent)' }}>{r.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                  </div>
                )}
                <span className="flex-1 text-[12px] truncate" style={{ color: 'var(--color-text-primary)' }}>{r.profiles?.full_name || t('admin.classes.unknown', 'Unknown')}</span>
                {r.workout_sessions?.total_volume_lbs != null && (
                  <span className="text-[11px] flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                    <Dumbbell size={11} /> {Number(r.workout_sessions.total_volume_lbs).toLocaleString()} {t('admin.classes.lbs', 'lbs')}
                  </span>
                )}
                {r.rating != null && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} size={10} style={s <= Math.round(r.rating) ? { color: 'var(--color-accent)', fill: 'var(--color-accent)' } : { color: 'var(--color-text-faint)' }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const NAME_MAX = 100;
const DESC_MAX = 500;

function CharCount({ value, max }) {
  const len = (value || '').length;
  const warn = len > max * 0.9;
  const over = len > max;
  return (
    <span className={`text-[10px] tabular-nums ${over ? 'text-red-400' : warn ? 'text-amber-400' : 'text-[#6B7280]'}`}>
      {len}/{max}
    </span>
  );
}

// ── Translation Preview Modal ──
function TranslationPreviewModal({ preview, onConfirm, onCancel, onChange, saving, t, tc }) {
  if (!preview) return null;
  const { name_en, name_es, desc_en, desc_es } = preview;
  return (
    <AdminModal isOpen onClose={onCancel} title={t('admin.classes.translationPreview')} size="lg">
      <div className="space-y-4">
        <p className="text-[12px] text-[#9CA3AF]">{t('admin.classes.translationPreviewDesc')}</p>

        {/* Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.classes.className')} (EN)</label>
            <input value={name_en} onChange={e => onChange({ ...preview, name_en: e.target.value })}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.classes.className')} (ES)</label>
            <input value={name_es} onChange={e => onChange({ ...preview, name_es: e.target.value })}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" />
          </div>
        </div>

        {/* Description */}
        {(desc_en || desc_es) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.classes.description')} (EN)</label>
              <textarea value={desc_en} onChange={e => onChange({ ...preview, desc_en: e.target.value })} rows={3}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.classes.description')} (ES)</label>
              <textarea value={desc_es} onChange={e => onChange({ ...preview, desc_es: e.target.value })} rows={3}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none resize-none" />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors">
          {tc('back')}
        </button>
        <button onClick={onConfirm} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black disabled:opacity-50 transition-opacity">
          <Check size={14} /> {saving ? tc('saving') : t('admin.classes.confirmSave')}
        </button>
      </div>
    </AdminModal>
  );
}

// ── Instructor Search Selector ──
function InstructorSelector({ gymId, value, valueName, onChange, t }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { data: people = [] } = useQuery({
    queryKey: ['admin', 'gym-people', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .eq('gym_id', gymId)
        .in('role', ['admin', 'trainer', 'member'])
        .order('full_name');
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = people.filter(p =>
    p.full_name?.toLowerCase().includes(search.toLowerCase()),
  );

  const roleBadge = (role) => {
    const colors = { admin: 'text-red-400 bg-red-400/10', trainer: 'text-[#D4AF37] bg-[#D4AF37]/10', member: 'text-blue-400 bg-blue-400/10' };
    return colors[role] || colors.member;
  };

  const selected = value ? people.find(p => p.id === value) : null;

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="block text-[11px] font-medium text-[#6B7280] mb-1">{t('admin.classes.instructor')}</label>
      {selected ? (
        <div className="flex items-center gap-2 p-2.5 bg-[#111827] border border-white/6 rounded-xl">
          {selected.avatar_url ? (
            <img src={selected.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
              <span className="text-[8px] font-bold text-[#D4AF37]">{selected.full_name?.[0]?.toUpperCase() || '?'}</span>
            </div>
          )}
          <span className="flex-1 text-[13px] text-[#E5E7EB] truncate">{selected.full_name}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge(selected.role)}`}>
            {selected.role}
          </span>
          <button type="button" onClick={() => { onChange(null, ''); setSearch(''); }}
            className="text-[11px] text-red-400 hover:text-red-300 font-medium transition-colors">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={t('admin.classes.searchInstructor', 'Search members, trainers, admins...')}
            className="w-full bg-[#111827] border border-white/6 rounded-xl pl-8 pr-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          />
          {open && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-[#1F2937] border border-white/10 rounded-xl shadow-xl">
              {filtered.length === 0 ? (
                <p className="px-3 py-2.5 text-[12px] text-[#6B7280] italic">{t('admin.classes.noMatchingPeople', 'No matching people')}</p>
              ) : (
                filtered.slice(0, 30).map(p => (
                  <button key={p.id} type="button"
                    onClick={() => { onChange(p.id, p.full_name); setSearch(''); setOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-white/[0.04] text-left transition-colors">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[8px] font-bold text-[#D4AF37]">{p.full_name?.[0]?.toUpperCase() || '?'}</span>
                      </div>
                    )}
                    <span className="flex-1 text-[13px] text-[#E5E7EB] truncate">{p.full_name}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge(p.role)}`}>
                      {p.role}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Class Form Modal ──
function ClassFormModal({ classData, onClose, onSave, saving, gymId, trainers = [], onAddSlot, onDeleteSlot, t, tc }) {
  const [form, setForm] = useState({
    name: classData?.name || '',
    description: classData?.description || '',
    instructor: classData?.instructor || '',
    trainer_id: classData?.trainer_id || '',
    duration_minutes: classData?.duration_minutes || 60,
    max_capacity: classData?.max_capacity || 30,
    accent_color: classData?.accent_color || DEFAULT_COLOR,
    is_active: classData?.is_active ?? true,
    workout_template_id: classData?.workout_template_id || null,
  });
  const [pendingSlots, setPendingSlots] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(classData?.image_url || '');
  const [preview, setPreview] = useState(null);
  const { translate, translating } = useAutoTranslate();

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // Step 1: Translate → show preview (single API call, second only if needed)
  const handleTranslateAndPreview = async () => {
    if (!form.name.trim()) return;

    const texts = [form.name];
    const hasDesc = !!(form.description || '').trim();
    if (hasDesc) texts.push(form.description);

    // First call: try translating to ES (DeepL auto-detects source)
    const result = await translate(texts, 'ES');

    if (!result) {
      // Translation failed — save without translation
      onSave({ ...form, name_es: classData?.name_es || '', description_es: classData?.description_es || '', imageFile, pendingSlots });
      return;
    }

    const isSpanish = result.detected_lang === 'ES';

    if (isSpanish) {
      // Admin typed in Spanish → we need EN translation, not ES
      const toEn = await translate(texts, 'EN');
      if (!toEn) {
        onSave({ ...form, name_es: form.name, description_es: form.description || '', imageFile, pendingSlots });
        return;
      }
      setPreview({
        name_en: toEn.translations[0] || form.name,
        name_es: form.name,
        desc_en: hasDesc ? (toEn.translations[1] || form.description) : '',
        desc_es: hasDesc ? form.description : '',
      });
    } else {
      // Admin typed in English (or other) → ES translation is already done
      setPreview({
        name_en: form.name,
        name_es: result.translations[0] || '',
        desc_en: hasDesc ? form.description : '',
        desc_es: hasDesc ? (result.translations[1] || '') : '',
      });
    }
  };

  // Step 2: Admin confirms preview → save
  const handleConfirmSave = () => {
    if (!preview) return;
    onSave({
      ...form,
      name: preview.name_en,
      name_es: preview.name_es,
      description: preview.desc_en,
      description_es: preview.desc_es,
      imageFile,
      pendingSlots,
    });
  };

  const isEditing = !!classData?.id;

  // Show translation preview modal if active
  if (preview) {
    return (
      <TranslationPreviewModal
        preview={preview}
        onChange={setPreview}
        onConfirm={handleConfirmSave}
        onCancel={() => setPreview(null)}
        saving={saving}
        t={t}
        tc={tc}
      />
    );
  }

  return (
    <AdminModal isOpen onClose={onClose} title={isEditing ? t('admin.classes.editClass') : t('admin.classes.addClass')} size="lg">
      <div className="space-y-4">
        {/* Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} *</label>
            <CharCount value={form.name} max={NAME_MAX} />
          </div>
          <input value={form.name} onChange={e => { if (e.target.value.length <= NAME_MAX) setForm(f => ({ ...f, name: e.target.value })); }}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            placeholder="Yoga, Spinning, CrossFit..." />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')}</label>
            <CharCount value={form.description} max={DESC_MAX} />
          </div>
          <textarea value={form.description} onChange={e => { if (e.target.value.length <= DESC_MAX) setForm(f => ({ ...f, description: e.target.value })); }} rows={2}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none resize-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
        </div>

        {/* Instructor (searchable - pulls from members, trainers, admins) */}
        <InstructorSelector
          gymId={gymId}
          value={form.trainer_id}
          valueName={form.instructor}
          onChange={(id, name) => setForm(f => ({ ...f, trainer_id: id || '', instructor: name || '' }))}
          t={t}
        />

        {/* Duration + Capacity */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.duration')} ({tc('min') || 'min'})</label>
            <input type="number" min={5} value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.capacity')}</label>
            <input type="number" min={1} value={form.max_capacity} onChange={e => setForm(f => ({ ...f, max_capacity: Number(e.target.value) }))}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>
        </div>

        {/* Color picker */}
        <div>
          <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.accentColor')}</label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, accent_color: c }))}
                className={`w-7 h-7 rounded-full border-2 transition-all ${form.accent_color === c ? 'border-white scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} aria-label={c} />
            ))}
            <input type="color" value={form.accent_color} onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))}
              className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent" />
          </div>
        </div>

        {/* Workout Template */}
        <RoutineSelector gymId={gymId} value={form.workout_template_id} onChange={(id) => setForm(f => ({ ...f, workout_template_id: id }))} t={t} />

        {/* Image upload */}
        <div>
          <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.image')}</label>
          {imagePreview ? (
            <div className="relative w-full h-32 rounded-xl overflow-hidden border border-white/6">
              <img src={imagePreview} alt="" className="w-full h-full object-cover" />
              <button onClick={() => { setImageFile(null); setImagePreview(''); }}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
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

        {/* Schedule Slots */}
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280] mb-2">
            <Repeat size={12} /> {t('admin.classes.weeklySchedule', 'Weekly Schedule')}
          </label>

          {/* Existing slots (edit mode) */}
          {isEditing && classData?.gym_class_schedules?.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {classData.gym_class_schedules
                .sort((a, b) => {
                  if (a.specific_date && !b.specific_date) return 1;
                  if (!a.specific_date && b.specific_date) return -1;
                  if (a.specific_date && b.specific_date) return a.specific_date.localeCompare(b.specific_date);
                  return (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || a.start_time.localeCompare(b.start_time);
                })
                .map(slot => (
                  <div key={slot.id} className="flex items-center justify-between p-2 bg-[#0F172A] rounded-lg border border-white/6">
                    <div className="flex items-center gap-2">
                      {slot.specific_date ? (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">
                          <CalendarDays size={9} className="inline mr-0.5 -mt-px" />
                          {slotDayLabel(slot, (d) => tc(DAYS_OF_WEEK.find(x => x.value === d)?.labelKey))}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold text-[#E5E7EB]">
                          <Repeat size={9} className="inline mr-0.5 -mt-px text-[#D4AF37]" />
                          {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey)}
                        </span>
                      )}
                      <span className="text-[11px] text-[#9CA3AF]">{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</span>

                    </div>
                    <button type="button" onClick={() => onDeleteSlot(slot.id)} className="p-1 rounded hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* Pending slots (new class) */}
          {!isEditing && pendingSlots.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {pendingSlots.map((slot, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-[#0F172A] rounded-lg border border-white/6">
                  <div className="flex items-center gap-2">
                    {slot.specific_date ? (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">
                        <CalendarDays size={9} className="inline mr-0.5 -mt-px" />
                        {slotDayLabel(slot, (d) => tc(DAYS_OF_WEEK.find(x => x.value === d)?.labelKey))}
                      </span>
                    ) : (
                      <span className="text-[12px] font-semibold text-[#E5E7EB]">
                        <Repeat size={9} className="inline mr-0.5 -mt-px text-[#D4AF37]" />
                        {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey)}
                      </span>
                    )}
                    <span className="text-[11px] text-[#9CA3AF]">{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</span>
                    {slot.capacity_override && <span className="text-[10px] text-[#6B7280]">({t('admin.classes.cap')}: {slot.capacity_override})</span>}
                  </div>
                  <button type="button" onClick={() => setPendingSlots(s => s.filter((_, i) => i !== idx))} className="p-1 rounded hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add slot form */}
          <ScheduleSlotForm
            onAdd={(slot) => {
              if (isEditing && classData?.id) {
                onAddSlot(classData.id, slot);
              } else {
                setPendingSlots(s => [...s, slot]);
              }
            }}
            t={t}
            tc={tc}
          />

          {(!isEditing && pendingSlots.length === 0 && !classData?.gym_class_schedules?.length) && (
            <p className="text-[10px] text-[#4B5563] italic mt-1.5">{t('admin.classes.scheduleHint', 'Add time slots for when this class repeats each week')}</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors">
          {tc('cancel')}
        </button>
        <button onClick={handleTranslateAndPreview} disabled={saving || translating || !form.name.trim()}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black disabled:opacity-50 transition-opacity">
          {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
          {translating ? t('admin.classes.translating') : tc('save')}
        </button>
      </div>
    </AdminModal>
  );
}

// ── Schedule Slot Form ──
function ScheduleSlotForm({ onAdd, t, tc }) {
  const [mode, setMode] = useState('recurring'); // 'recurring' | 'specific'
  const [selectedDays, setSelectedDays] = useState([1]); // multiple days for recurring
  const [selectedDates, setSelectedDates] = useState([]); // multiple dates for specific
  const [dateInput, setDateInput] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');

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
    if (mode === 'recurring') {
      for (const day of selectedDays) {
        onAdd({
          day_of_week: day,
          specific_date: null,
          start_time: startTime,
          end_time: endTime,
        });
      }
    } else {
      for (const date of selectedDates) {
        onAdd({
          day_of_week: null,
          specific_date: date,
          start_time: startTime,
          end_time: endTime,
        });
      }
      setSelectedDates([]);
    }
  };

  const canAdd = mode === 'recurring' ? selectedDays.length > 0 : selectedDates.length > 0;

  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-2.5">
      {/* Mode toggle */}
      <div className="flex gap-1">
        <button type="button" onClick={() => setMode('recurring')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
            mode === 'recurring'
              ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
              : 'bg-white/[0.04] text-[#6B7280] border border-white/6 hover:bg-white/[0.06]'
          }`}>
          <Repeat size={11} /> {t('admin.classes.recurring', 'Recurring')}
        </button>
        <button type="button" onClick={() => setMode('specific')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
            mode === 'specific'
              ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30'
              : 'bg-white/[0.04] text-[#6B7280] border border-white/6 hover:bg-white/[0.06]'
          }`}>
          <CalendarDays size={11} /> {t('admin.classes.specificDate', 'Specific Date')}
        </button>
      </div>

      {/* Day/Date selector */}
      {mode === 'recurring' ? (
        <div>
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1.5">{t('admin.classes.selectDays', 'Select days')}</label>
          <div className="flex flex-wrap gap-1">
            {DAYS_OF_WEEK.map(d => (
              <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                  selectedDays.includes(d.value)
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                    : 'bg-[#111827] text-[#6B7280] border border-white/6 hover:text-[#E5E7EB]'
                }`}>
                {tc(d.labelKey)?.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.pickDates', 'Pick dates')}</label>
          <div className="flex items-center gap-2 mb-1.5">
            <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="flex-1 bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#3B82F6]/40" />
            <button type="button" onClick={addDate} disabled={!dateInput}
              className="p-2 rounded-lg bg-[#3B82F6]/12 text-[#3B82F6] hover:bg-[#3B82F6]/20 disabled:opacity-30 transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {selectedDates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedDates.map(date => (
                <span key={date} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-[11px] font-semibold">
                  {fmtDate(date)}
                  <button type="button" onClick={() => removeDate(date)} className="hover:text-red-400 transition-colors"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Time + Add */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[90px]">
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.startTime')}</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
        </div>
        <div className="min-w-[90px]">
          <label className="block text-[10px] font-medium text-[#6B7280] mb-1">{t('admin.classes.endTime')}</label>
          <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
            className="w-full bg-[#111827] border border-white/6 rounded-lg px-2 py-2 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40" />
        </div>
        <button onClick={handleAdd} disabled={!canAdd}
          className="p-2 rounded-lg bg-[#D4AF37]/12 text-[#D4AF37] hover:bg-[#D4AF37]/20 disabled:opacity-30 transition-colors" aria-label={t('admin.classes.addSchedule')}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Delete Confirmation Modal ──
function DeleteConfirmModal({ className: classItem, onConfirm, onCancel, deleting, t, tc }) {
  return (
    <AdminModal isOpen onClose={onCancel} title={t('admin.classes.deleteClass')} size="sm">
      <p className="text-[13px] text-[#9CA3AF] mb-5">
        {t('admin.classes.deleteConfirm', { name: classItem?.name })}
      </p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors">
          {tc('cancel')}
        </button>
        <button onClick={onConfirm} disabled={deleting}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-[#EF4444] text-white disabled:opacity-50 transition-opacity">
          {deleting ? '...' : tc('delete')}
        </button>
      </div>
    </AdminModal>
  );
}

// ── Bookings Viewer (used inside detail modal) ──
function BookingsView({ classItem, t, tc }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: adminKeys.classes.bookings(classItem?.id, date),
    queryFn: async () => {
      if (!classItem?.id) return [];
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, booked_at, profiles(full_name, username)')
        .eq('class_id', classItem.id)
        .gte('booked_at', `${date}T00:00:00`)
        .lte('booked_at', `${date}T23:59:59`)
        .order('booked_at');
      return data || [];
    },
    enabled: !!classItem?.id,
  });

  return (
    <div className="space-y-4">
      <input type="date" value={date} onChange={e => setDate(e.target.value)}
        className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
        style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
      {isLoading ? (
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{tc('loading')}</p>
      ) : bookings.length === 0 ? (
        <p className="text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noBookings')}</p>
      ) : (
        <div className="space-y-2">
          {bookings.map(b => (
            <div key={b.id} className="flex items-center justify-between p-3 rounded-xl transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>{b.profiles?.full_name || b.profiles?.username || t('admin.classes.unknown', 'Unknown')}</span>
              <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{new Date(b.booked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))}
          <p className="text-[11px] text-right" style={{ color: 'var(--color-text-muted)' }}>{bookings.length} {t('admin.classes.booked')}</p>
        </div>
      )}
    </div>
  );
}

// ── Class Detail Modal (Schedule + Analytics + Bookings + Template) ──
function ClassDetailModal({ classItem, onClose, onAddSlot, onDeleteSlot, dayLabel, gymId, t, tc }) {
  const [detailTab, setDetailTab] = useState('schedule');

  const DETAIL_TABS = [
    { key: 'schedule', label: t('admin.classes.tabSchedule'), icon: Calendar },
    { key: 'analytics', label: t('admin.classes.analytics'), icon: BarChart3 },
    { key: 'bookings', label: t('admin.classes.bookings'), icon: Users },
  ];

  return (
    <AdminModal isOpen onClose={onClose} title={classItem.name} size="lg">
      {/* Detail tabs */}
      <div className="flex gap-1 mb-4 -mt-1" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
        {DETAIL_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = detailTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setDetailTab(tab.key)}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold transition-all duration-200 border-b-2 -mb-px"
              style={{
                color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
                borderColor: isActive ? 'var(--color-accent)' : 'transparent',
              }}>
              <Icon size={13} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Schedule tab */}
      {detailTab === 'schedule' && (
        <div className="space-y-3">
          {classItem.gym_class_schedules?.length > 0 && (
            <div className="space-y-1.5">
              {classItem.gym_class_schedules
                .sort((a, b) => {
                  // Recurring first (by day), then specific dates chronologically
                  if (a.specific_date && !b.specific_date) return 1;
                  if (!a.specific_date && b.specific_date) return -1;
                  if (a.specific_date && b.specific_date) return a.specific_date.localeCompare(b.specific_date);
                  return (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || a.start_time.localeCompare(b.start_time);
                })
                .map(slot => (
                  <div key={slot.id} className="flex items-center justify-between p-2.5 bg-[#111827] rounded-lg border border-white/6">
                    <div className="flex items-center gap-3">
                      {slot.specific_date ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">
                          <CalendarDays size={10} className="inline mr-0.5 -mt-px" />
                          {slotDayLabel(slot, dayLabel)}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold text-[#E5E7EB] min-w-[80px]">
                          <Repeat size={10} className="inline mr-1 -mt-px text-[#D4AF37]" />
                          {slotDayLabel(slot, dayLabel)}
                        </span>
                      )}
                      <span className="text-[12px] text-[#9CA3AF]">{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</span>
                    </div>
                    <button onClick={() => onDeleteSlot(slot.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-[#6B7280] hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                  </div>
                ))}
            </div>
          )}
          {(!classItem.gym_class_schedules || classItem.gym_class_schedules.length === 0) && (
            <p className="text-[12px] italic py-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noScheduleSlots')}</p>
          )}
          <div className="pt-2" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.addSchedule')}</p>
            <ScheduleSlotForm onAdd={(slot) => onAddSlot(classItem.id, slot)} t={t} tc={tc} />
          </div>
        </div>
      )}

      {/* Analytics tab */}
      {detailTab === 'analytics' && (
        <ClassAnalytics classId={classItem.id} hasTemplate={!!classItem.workout_template_id} t={t} />
      )}

      {/* Bookings tab */}
      {detailTab === 'bookings' && (
        <BookingsView classItem={classItem} t={t} tc={tc} />
      )}
    </AdminModal>
  );
}

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
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
          style={{ color: 'var(--color-text-muted)' }}>
          <Edit3 size={13} />
        </button>
        <button onClick={() => onDeleteSlot(slot.id)}
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110"
          style={{ color: 'var(--color-text-muted)' }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ── Schedule View (recurring + specific dates) ──
function ScheduleView({ classes, onEditClass, onDeleteSlot, t, tc }) {
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
            const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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

// ── Build schedule summary string ──
function buildScheduleSummary(classItem, dayLabel) {
  const schedules = classItem.gym_class_schedules || [];
  if (schedules.length === 0) return null;

  const recurring = schedules.filter(s => !s.specific_date);
  const specific = schedules.filter(s => s.specific_date);

  // Group recurring by time range
  const sorted = [...recurring].sort((a, b) => (a.day_of_week ?? 0) - (b.day_of_week ?? 0) || a.start_time.localeCompare(b.start_time));
  const byTime = {};
  for (const s of sorted) {
    const timeKey = `${s.start_time?.slice(0, 5)}-${s.end_time?.slice(0, 5)}`;
    if (!byTime[timeKey]) byTime[timeKey] = [];
    byTime[timeKey].push(s.day_of_week);
  }

  const parts = [];
  for (const [time, days] of Object.entries(byTime)) {
    const dayNames = days.map(d => dayLabel(d)?.slice(0, 3)).join(', ');
    parts.push(`${dayNames} ${time}`);
  }

  // Append specific date count if any
  if (specific.length > 0) {
    const sortedDates = [...specific].sort((a, b) => a.specific_date.localeCompare(b.specific_date));
    if (specific.length <= 2) {
      for (const s of sortedDates) {
        const d = new Date(s.specific_date + 'T00:00:00');
        parts.push(`${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${s.start_time?.slice(0, 5)}`);
      }
    } else {
      parts.push(`+${specific.length} dates`);
    }
  }

  return parts.join(' | ');
}

// ── Classes List View (simplified cards) ──
function ClassesListView({ classes, onEdit, onDelete, onToggleActive, onOpenDetail, dayLabel, todaysClasses, upcomingBookings, t, tc }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return classes;
    const q = search.toLowerCase();
    return classes.filter(c => c.name.toLowerCase().includes(q) || c.instructor?.toLowerCase().includes(q));
  }, [classes, search]);

  // Summary stats
  const totalSlots = classes.reduce((sum, c) => sum + (c.gym_class_schedules?.length || 0), 0);
  const activeCount = classes.filter(c => c.is_active).length;

  return (
    <div className="space-y-4">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={t('admin.classes.statActiveClasses')}
          value={activeCount}
          icon={CalendarDays}
          borderColor="#10B981"
          delay={0}
        />
        <StatCard
          label={t('admin.classes.statWeeklySlots')}
          value={totalSlots}
          icon={Clock}
          borderColor="#3B82F6"
          delay={40}
        />
        <StatCard
          label={t('admin.classes.statTodaysClasses')}
          value={todaysClasses}
          icon={Calendar}
          borderColor="#D4AF37"
          delay={80}
        />
        <StatCard
          label={t('admin.classes.statUpcomingBookings')}
          value={upcomingBookings}
          icon={Users}
          borderColor="#8B5CF6"
          delay={120}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input type="text" placeholder={t('admin.classes.searchClasses')} value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl pl-9 pr-4 py-2.5 text-[13px] outline-none transition-all duration-200"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
      </div>

      {/* Cards */}
      <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {filtered.map((cls, idx) => {
          const scheduleSummary = buildScheduleSummary(cls, dayLabel);
          return (
            <FadeIn key={cls.id} delay={idx * 40}>
              <AdminCard hover padding="p-0" borderLeft={cls.accent_color}>
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer"
                  onClick={() => onOpenDetail(cls)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(cls); } }}
                >
                  {cls.image_url ? (
                    <img src={cls.image_url} alt={cls.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0 border border-white/6" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center border border-white/6"
                      style={{ backgroundColor: `${cls.accent_color}15` }}>
                      <CalendarDays size={20} style={{ color: cls.accent_color }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</h3>
                      {!cls.is_active && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
                          {t('admin.classes.inactive')}
                        </span>
                      )}
                    </div>
                    {cls.instructor && <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{cls.instructor}</p>}
                    {cls.trainer && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {cls.trainer.avatar_url ? (
                          <img src={cls.trainer.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                            <span className="text-[7px] font-bold" style={{ color: 'var(--color-accent)' }}>{cls.trainer.full_name?.[0]?.toUpperCase() || '?'}</span>
                          </div>
                        )}
                        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                          <UserCheck size={11} className="inline mr-0.5" style={{ color: 'var(--color-accent)' }} />
                          {cls.trainer.full_name}
                        </span>
                      </div>
                    )}
                    {/* Schedule summary */}
                    {scheduleSummary && (
                      <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                        <CalendarDays size={11} className="flex-shrink-0" />
                        <span className="truncate">{scheduleSummary}</span>
                      </p>
                    )}
                    {!scheduleSummary && (
                      <p className="text-[11px] italic mt-1.5" style={{ color: 'var(--color-text-faint)' }}>{t('admin.classes.noScheduleSlots')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <Toggle checked={cls.is_active} onChange={() => onToggleActive(cls)} label={t('admin.classes.toggleActive')} />
                    <button onClick={() => onEdit(cls)} className="p-2 rounded-lg transition-all duration-200 hover:scale-110" style={{ color: 'var(--color-text-muted)' }} aria-label={tc('edit')}><Edit3 size={15} /></button>
                    <button onClick={() => onDelete(cls)} className="p-2 rounded-lg transition-all duration-200 hover:scale-110" style={{ color: 'var(--color-text-muted)' }} aria-label={tc('delete')}><Trash2 size={15} /></button>
                  </div>
                </div>
              </AdminCard>
            </FadeIn>
          );
        })}
      </div>
    </div>
  );
}

// ── Bookings Tab View ──
function BookingsTabView({ classes, t, tc }) {
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  const selectedClass = classes.find(c => c.id === selectedClassId) || classes[0];

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: adminKeys.classes.bookingsTab(selectedClass?.id, dateFilter),
    queryFn: async () => {
      if (!selectedClass?.id) return [];
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, status, attended, rating, booking_date, created_at, waitlist_position, cancelled_at, profiles(id, full_name, avatar_url)')
        .eq('class_id', selectedClass.id)
        .gte('booking_date', dateFilter)
        .lte('booking_date', dateFilter)
        .order('created_at');
      return data || [];
    },
    enabled: !!selectedClass?.id,
    staleTime: 30_000,
  });

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return bookings;
    if (statusFilter === 'confirmed') return bookings.filter(b => b.status === 'confirmed');
    if (statusFilter === 'waitlisted') return bookings.filter(b => b.status === 'waitlisted');
    if (statusFilter === 'cancelled') return bookings.filter(b => b.status === 'cancelled');
    if (statusFilter === 'attended') return bookings.filter(b => b.attended);
    return bookings;
  }, [bookings, statusFilter]);

  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length;
  const waitlistedCount = bookings.filter(b => b.status === 'waitlisted').length;
  const cancelledCount = bookings.filter(b => b.status === 'cancelled').length;
  const attendedCount = bookings.filter(b => b.attended).length;

  return (
    <div className="space-y-4">
      {/* Class selector + date */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select value={selectedClass?.id || ''} onChange={e => setSelectedClassId(e.target.value)}
          className="flex-1 rounded-xl px-3 py-2.5 text-[13px] outline-none appearance-none cursor-pointer transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
      </div>

      {/* Status filter pills */}
      <FilterBar options={[
        { key: 'all', label: t('admin.classes.allBookings'), count: bookings.length },
        { key: 'confirmed', label: t('admin.classes.confirmed'), count: confirmedCount },
        { key: 'waitlisted', label: t('admin.classes.waitlisted'), count: waitlistedCount },
        { key: 'attended', label: t('admin.classes.attended'), count: attendedCount },
        { key: 'cancelled', label: t('admin.classes.cancelledLabel'), count: cancelledCount },
      ]} active={statusFilter} onChange={setStatusFilter} />

      {/* Bookings list */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
          <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{tc('loading')}</span>
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="text-center py-12">
          <Users size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noBookingsForDate')}</p>
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden divide-y"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', borderColor: 'var(--color-border-subtle)' }}>
          {filteredBookings.map(b => {
            const statusColors = {
              confirmed: { bg: 'bg-[#10B981]/10', text: 'text-[#10B981]', border: 'border-[#10B981]/20' },
              waitlisted: { bg: 'bg-[#60A5FA]/10', text: 'text-[#60A5FA]', border: 'border-[#60A5FA]/20' },
              cancelled: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', border: 'border-[#EF4444]/20' },
              attended: { bg: 'bg-[#D4AF37]/10', text: 'text-[#D4AF37]', border: 'border-[#D4AF37]/20' },
            };
            const status = b.attended ? 'attended' : b.status;
            const sc = statusColors[status] || statusColors.confirmed;

            return (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors duration-200">
                {b.profiles?.avatar_url ? (
                  <img src={b.profiles.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{b.profiles?.full_name?.[0]?.toUpperCase() || '?'}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{b.profiles?.full_name || t('admin.classes.unknown', 'Unknown')}</p>
                  <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    {new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {b.waitlist_position && ` . #${b.waitlist_position} ${t('admin.classes.inWaitlist')}`}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.text} ${sc.border}`}>
                  {status === 'attended' ? t('admin.classes.attended') : t(`admin.classes.status_${status}`, status)}
                </span>
                {b.rating != null && (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} size={9} className={s <= Math.round(b.rating) ? 'text-[#D4AF37] fill-[#D4AF37]' : 'text-[#6B7280]'} />
                    ))}
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
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const [activeTab, setActiveTab] = useState('schedule');
  const [formModal, setFormModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [detailClass, setDetailClass] = useState(null);

  useEffect(() => { document.title = 'Admin - Classes | TuGymPR'; }, []);

  // ── Fetch classes ──
  const { data: classes = [], isLoading } = useQuery({
    queryKey: adminKeys.classes.all(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_classes')
        .select('*, gym_class_schedules(id, day_of_week, start_time, end_time, specific_date), trainer:profiles!gym_classes_trainer_id_fkey(id, full_name, avatar_url)')
        .eq('gym_id', gymId)
        .order('name');
      if (data) {
        await Promise.all(data.map(async (cls) => {
          if (cls.image_path) {
            const { data: signed } = await supabase.storage
              .from('class-images')
              .createSignedUrl(cls.image_path, 60 * 60);
            cls.image_url = signed?.signedUrl || '';
          }
        }));
      }
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Fetch trainers ──
  const { data: trainers = [] } = useQuery({
    queryKey: adminKeys.classes.trainers(gymId),
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

  // ── Compute today's classes count ──
  const todaysClasses = useMemo(() => {
    const today = new Date().getDay(); // 0=Sun, 1=Mon...
    const todayStr = new Date().toISOString().slice(0, 10);
    return classes.filter(c =>
      c.is_active && c.gym_class_schedules?.some(s =>
        s.day_of_week === today || s.specific_date === todayStr,
      ),
    ).length;
  }, [classes]);

  // ── Fetch upcoming bookings count ──
  const { data: upcomingBookings = 0 } = useQuery({
    queryKey: ['admin', 'classes-upcoming-bookings', gymId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count } = await supabase
        .from('gym_class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed')
        .gte('booking_date', today)
        .in('class_id', classes.map(c => c.id));
      return count || 0;
    },
    enabled: !!gymId && classes.length > 0,
    staleTime: 60_000,
  });

  // ── Save class ──
  const handleSaveClass = async (formData) => {
    setSaving(true);
    try {
      let imagePath = formModal?.image_path || null;
      if (formData.imageFile) {
        const validation = await validateImageFile(formData.imageFile);
        if (!validation.valid) {
          showToast(validation.error, 'error');
          setSaving(false);
          return;
        }
        const mimeExtMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
        const ext = mimeExtMap[validation.mime] || 'jpg';
        const path = `${gymId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('class-images')
          .upload(path, formData.imageFile, { cacheControl: '3600', upsert: false });
        if (uploadErr) throw uploadErr;
        imagePath = path;
      }

      const payload = {
        gym_id: gymId, name: formData.name, name_es: formData.name_es || null,
        description: formData.description || null, description_es: formData.description_es || null,
        instructor: formData.instructor || null, duration_minutes: formData.duration_minutes,
        max_capacity: formData.max_capacity, accent_color: formData.accent_color,
        is_active: formData.is_active, image_path: imagePath,
        workout_template_id: formData.workout_template_id || null, trainer_id: formData.trainer_id || null,
      };

      if (formModal?.id) {
        const { error } = await supabase.from('gym_classes').update(payload).eq('id', formModal.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from('gym_classes').insert(payload).select('id').single();
        if (error) throw error;

        // Insert pending schedule slots for new class
        if (formData.pendingSlots?.length > 0 && inserted?.id) {
          const slots = formData.pendingSlots.map(s => ({
            class_id: inserted.id,
            gym_id: gymId,
            day_of_week: s.specific_date ? null : s.day_of_week,
            specific_date: s.specific_date || null,
            start_time: s.start_time,
            end_time: s.end_time,
          }));
          const { error: slotErr } = await supabase.from('gym_class_schedules').insert(slots);
          if (slotErr) throw slotErr;
        }
      }

      queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
      setFormModal(null);
      showToast(tc('success'), 'success');
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally { setSaving(false); }
  };

  // ── Toggle active ──
  const handleToggleActive = async (cls) => {
    const { error } = await supabase.from('gym_classes').update({ is_active: !cls.is_active }).eq('id', cls.id);
    if (!error) queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
  };

  // ── Delete class ──
  const handleDeleteClass = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await supabase.from('gym_class_schedules').delete().eq('class_id', deleteTarget.id);
      await supabase.from('gym_class_bookings').delete().eq('class_id', deleteTarget.id);
      const { error } = await supabase.from('gym_classes').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      if (deleteTarget.image_path) {
        await supabase.storage.from('class-images').remove([deleteTarget.image_path]);
      }
      queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
      setDeleteTarget(null);
      showToast(tc('success'), 'success');
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally { setDeleting(false); }
  };

  // ── Add schedule slot ──
  const handleAddSlot = async (classId, slot) => {
    const payload = {
      class_id: classId,
      gym_id: gymId,
      start_time: slot.start_time,
      end_time: slot.end_time,
    };
    if (slot.specific_date) {
      payload.specific_date = slot.specific_date;
      // day_of_week must be null for specific-date slots
    } else {
      payload.day_of_week = slot.day_of_week;
    }
    const { error } = await supabase.from('gym_class_schedules').insert(payload);
    if (!error) queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
    else showToast(error.message, 'error');
  };

  // ── Delete schedule slot ──
  const handleDeleteSlot = async (slotId) => {
    const { error } = await supabase.from('gym_class_schedules').delete().eq('id', slotId);
    if (!error) queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
  };

  const dayLabel = (dayNum) => {
    const d = DAYS_OF_WEEK.find(d => d.value === dayNum);
    return d ? tc(d.labelKey) : `Day ${dayNum}`;
  };

  // Summary stats
  const totalSlots = classes.reduce((sum, c) => sum + (c.gym_class_schedules?.length || 0), 0);
  const activeClasses = classes.filter(c => c.is_active).length;

  const TABS = [
    { key: 'schedule', label: t('admin.classes.tabSchedule'), icon: Calendar },
    { key: 'classes', label: t('admin.classes.tabClasses'), icon: CalendarDays },
    { key: 'bookings', label: t('admin.classes.tabBookings'), icon: Users },
  ];

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger, #EF4444)' }}>{t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}</p>
      </div>
    );
  }

  return (
    <AdminPageShell size="wide" className="space-y-5">
      {/* Header */}
      <PageHeader
        title={t('admin.classes.title')}
        subtitle={`${activeClasses} ${t('admin.classes.activeClasses')} . ${totalSlots} ${t('admin.classes.weeklySlots')}`}
        actions={
          <button onClick={() => setFormModal('new')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold transition-all duration-200 hover:scale-[1.03] hover:shadow-lg"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}>
            <Plus size={15} /> {t('admin.classes.addClass')}
          </button>
        }
      />

      {/* Subnav tabs */}
      <AdminTabs tabs={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))} active={activeTab} onChange={setActiveTab} className="mb-5" />

      {/* Tab content */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
      ) : classes.length === 0 ? (
        <FadeIn>
          <AdminCard padding="p-8">
            <div className="text-center">
              <CalendarDays size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
              <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('admin.classes.noClasses')}</p>
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noClassesDesc')}</p>
            </div>
          </AdminCard>
        </FadeIn>
      ) : (
        <FadeIn>
          {activeTab === 'schedule' && (
            <ScheduleView
              classes={classes}
              onEditClass={setFormModal}
              onDeleteSlot={handleDeleteSlot}
              t={t}
              tc={tc}
            />
          )}

          {activeTab === 'classes' && (
            <ClassesListView
              classes={classes}
              onEdit={setFormModal}
              onDelete={setDeleteTarget}
              onToggleActive={handleToggleActive}
              onOpenDetail={setDetailClass}
              dayLabel={dayLabel}
              todaysClasses={todaysClasses}
              upcomingBookings={upcomingBookings}
              t={t}
              tc={tc}
            />
          )}

          {activeTab === 'bookings' && (
            <BookingsTabView
              classes={classes}
              t={t}
              tc={tc}
            />
          )}
        </FadeIn>
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
          onAddSlot={handleAddSlot}
          onDeleteSlot={handleDeleteSlot}
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

      {detailClass && (
        <ClassDetailModal
          classItem={detailClass}
          onClose={() => setDetailClass(null)}
          onAddSlot={handleAddSlot}
          onDeleteSlot={handleDeleteSlot}
          dayLabel={dayLabel}
          gymId={gymId}
          t={t}
          tc={tc}
        />
      )}
    </AdminPageShell>
  );
}
