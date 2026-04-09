import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Clock, Users, CalendarDays, X, Save,
  ChevronDown, ChevronUp, Edit3, Upload,
  Dumbbell, Star, Search, UserCheck,
  XCircle, UserX, Calendar, Languages, Check, Loader2,
  BarChart3, Repeat, Flame, Zap, Wind, Heart, Mountain,
  Bike, Swords, Music, Waves, Brain, Footprints, Sparkles,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { validateImageFile } from '../../lib/validateImage';
import { useAutoTranslate } from '../../hooks/useAutoTranslate';
import {
  PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton,
  AdminPageShell, FilterBar, AdminModal, StatCard, AdminTabs, Toggle,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';

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

// ── Default class cover presets (gradient + icon) ──
const CLASS_COVERS = [
  { key: 'hiit',      labelKey: 'admin.classes.cover.hiit',       icon: Flame,      gradient: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)' },
  { key: 'crossfit',  labelKey: 'admin.classes.cover.crossfit',   icon: Zap,        gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'yoga',      labelKey: 'admin.classes.cover.yoga',       icon: Wind,       gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'spinning',  labelKey: 'admin.classes.cover.spinning',   icon: Bike,       gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'boxing',    labelKey: 'admin.classes.cover.boxing',     icon: Swords,     gradient: 'linear-gradient(135deg, #EF4444 0%, #991B1B 100%)' },
  { key: 'pilates',   labelKey: 'admin.classes.cover.pilates',    icon: Heart,      gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'strength',  labelKey: 'admin.classes.cover.strength',   icon: Dumbbell,   gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'dance',     labelKey: 'admin.classes.cover.dance',      icon: Music,      gradient: 'linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)' },
  { key: 'cardio',    labelKey: 'admin.classes.cover.cardio',     icon: Footprints, gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'functional',labelKey: 'admin.classes.cover.functional', icon: Mountain,   gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
  { key: 'aqua',      labelKey: 'admin.classes.cover.aqua',       icon: Waves,      gradient: 'linear-gradient(135deg, #0EA5E9 0%, #0369A1 100%)' },
  { key: 'mindBody',  labelKey: 'admin.classes.cover.mindBody',   icon: Brain,      gradient: 'linear-gradient(135deg, #A78BFA 0%, #7C3AED 100%)' },
];

/** Render a cover preset as a visual element */
function CoverPreview({ preset, size = 'sm', className = '' }) {
  if (!preset) return null;
  const cover = CLASS_COVERS.find(c => c.key === preset);
  if (!cover) return null;
  const Icon = cover.icon;
  const sz = size === 'lg' ? 'w-full h-32' : size === 'md' ? 'w-14 h-14' : 'w-10 h-10';
  const iconSz = size === 'lg' ? 36 : size === 'md' ? 20 : 14;
  return (
    <div className={`${sz} rounded-xl flex items-center justify-center ${className}`} style={{ background: cover.gradient }}>
      <Icon size={iconSz} className="text-white/90" />
    </div>
  );
}

// ── Routine Selector ──
function RoutineSelector({ gymId, value, onChange, t }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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
    !search || r.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selected = routines.find(r => r.id === value);

  return (
    <div ref={wrapperRef}>
      <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.classes.workoutTemplate')}
      </label>
      {selected ? (
        <div className="flex items-center gap-2 p-2.5 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          <Dumbbell size={14} className="flex-shrink-0" style={{ color: 'var(--color-accent, #D4AF37)' }} />
          <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>
            {selected.name}
            <span className="ml-1.5" style={{ color: 'var(--color-text-muted)' }}>
              ({selected.routine_exercises?.[0]?.count || 0} {t('admin.classes.exercises', 'exercises')})
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] font-medium transition-colors"
            style={{ color: 'var(--color-danger, #EF4444)' }}
          >
            {t('admin.classes.removeTemplate')}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5 relative">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={t('admin.classes.selectTemplate')}
              aria-label={t('admin.classes.selectTemplate')}
              className="w-full rounded-xl pl-8 pr-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>
          {open && filtered.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl shadow-xl"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              {filtered.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setSearch(''); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-[12px] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors flex items-center gap-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  <Dumbbell size={12} style={{ color: 'var(--color-text-muted)' }} />
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {r.routine_exercises?.[0]?.count || 0}
                  </span>
                </button>
              ))}
              {/* Create new routine hint */}
              <div className="px-3 py-2 text-[11px] italic" style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border-subtle)' }}>
                {t('admin.classes.createRoutineHint', 'To create a new routine, use the Workouts section')}
              </div>
            </div>
          )}
          {open && filtered.length === 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl shadow-xl p-3"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[11px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noTemplate')}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.classes.createRoutineHint', 'To create a new routine, use the Workouts section')}
              </p>
            </div>
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

      // Run all count queries in parallel — each uses head:true so zero rows are transferred
      const baseQuery = () => supabase
        .from('gym_class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('class_id', classId)
        .gte('created_at', since);

      const [
        { count: total },
        { count: attended },
        { count: noShows },
        { count: confirmedPast },
        { count: cancelled },
        { data: ratingRows },
        ...rest
      ] = await Promise.all([
        // Total bookings
        baseQuery(),
        // Attended bookings
        baseQuery().eq('attended', true),
        // No-shows: confirmed but not attended, past booking date
        baseQuery().eq('status', 'confirmed').eq('attended', false).lt('booking_date', today),
        // Confirmed past (confirmed or attended status, past booking date) — for no-show rate denominator
        baseQuery().in('status', ['confirmed', 'attended']).lt('booking_date', today),
        // Cancelled bookings
        baseQuery().eq('status', 'cancelled'),
        // Ratings — only fetch the small subset that have ratings (typically <5% of bookings)
        supabase
          .from('gym_class_bookings')
          .select('rating')
          .eq('class_id', classId)
          .gte('created_at', since)
          .eq('attended', true)
          .not('rating', 'is', null),
        // Recent results (only if class has a workout template)
        ...(hasTemplate ? [
          supabase
            .from('gym_class_bookings')
            .select('profile_id, rating, notes, attended_at, workout_session_id, profiles(full_name, avatar_url), workout_sessions(total_volume_lbs, completed_at)')
            .eq('class_id', classId)
            .eq('attended', true)
            .order('attended_at', { ascending: false })
            .limit(20),
        ] : []),
      ]);

      const recentResults = hasTemplate ? (rest[0]?.data || []) : [];

      const attendanceRate = total > 0 ? Math.round((attended / total) * 100) : 0;
      const noShowRate = confirmedPast > 0 ? Math.round((noShows / confirmedPast) * 100) : 0;
      const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

      const rated = ratingRows || [];
      const avgRating = rated.length > 0
        ? (rated.reduce((sum, b) => sum + b.rating, 0) / rated.length).toFixed(1)
        : null;

      const starDist = [0, 0, 0, 0, 0];
      rated.forEach(b => {
        const idx = Math.max(0, Math.min(4, Math.round(b.rating) - 1));
        starDist[idx]++;
      });

      return {
        total: total || 0, attended: attended || 0, attendanceRate, avgRating, starDist, recentResults,
        noShows: noShows || 0, noShowRate, cancelled: cancelled || 0, cancellationRate,
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
                  <img src={r.profiles.avatar_url} alt={r.profiles?.full_name || "Member avatar"} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
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
    <span className={`text-[10px] tabular-nums ${over ? 'text-red-400' : warn ? 'text-amber-400' : ''}`}
      style={!over && !warn ? { color: 'var(--color-text-muted)' } : undefined}>
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
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.translationPreviewDesc')}</p>

        {/* Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} (EN)</label>
            <input value={name_en} onChange={e => onChange({ ...preview, name_en: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} (ES)</label>
            <input value={name_es} onChange={e => onChange({ ...preview, name_es: e.target.value })}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
          </div>
        </div>

        {/* Description */}
        {(desc_en || desc_es) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')} (EN)</label>
              <textarea value={desc_en} onChange={e => onChange({ ...preview, desc_en: e.target.value })} rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none resize-none"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')} (ES)</label>
              <textarea value={desc_es} onChange={e => onChange({ ...preview, desc_es: e.target.value })} rows={3}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none focus:ring-2 focus:outline-none resize-none"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)' }}>
          {tc('back')}
        </button>
        <button onClick={onConfirm} disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-bg-base)' }}>
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
        .in('role', ['admin', 'trainer'])
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
    const colors = { admin: 'text-red-400 bg-red-400/10', trainer: 'text-[#D4AF37] bg-[#D4AF37]/10' };
    return colors[role] || 'text-blue-400 bg-blue-400/10';
  };

  const selected = value ? people.find(p => p.id === value) : null;

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.instructor')}</label>
      {selected ? (
        <div className="flex items-center gap-2 p-2.5 rounded-xl"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          {selected.avatar_url ? (
            <img src={selected.avatar_url} alt={selected.full_name || "Instructor avatar"} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 15%, transparent)' }}>
              <span className="text-[8px] font-bold" style={{ color: 'var(--color-accent, #D4AF37)' }}>{selected.full_name?.[0]?.toUpperCase() || '?'}</span>
            </div>
          )}
          <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>{selected.full_name}</span>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${roleBadge(selected.role)}`}>
            {selected.role}
          </span>
          <button type="button" onClick={() => { onChange(null, ''); setSearch(''); }}
            aria-label={t('admin.classes.clearInstructor', 'Clear instructor')}
            className="text-[11px] font-medium transition-colors text-red-400 hover:text-red-300">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={t('admin.classes.searchInstructor', 'Search trainers, admins...')}
            aria-label={t('admin.classes.searchInstructor', 'Search trainers, admins...')}
            className="w-full rounded-xl pl-8 pr-3 py-2.5 text-[13px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
          />
          {open && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl shadow-xl"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              {filtered.length === 0 ? (
                <p className="px-3 py-2.5 text-[12px] italic" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noMatchingPeople', 'No matching people')}</p>
              ) : (
                filtered.slice(0, 30).map(p => (
                  <button key={p.id} type="button"
                    onClick={() => { onChange(p.id, p.full_name); setSearch(''); setOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] text-left transition-colors">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt={p.full_name || "Trainer avatar"} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 15%, transparent)' }}>
                        <span className="text-[8px] font-bold" style={{ color: 'var(--color-accent, #D4AF37)' }}>{p.full_name?.[0]?.toUpperCase() || '?'}</span>
                      </div>
                    )}
                    <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--color-text-primary)' }}>{p.full_name}</span>
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
    instructor: classData?.instructor_name || classData?.instructor || '',
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
  const [coverPreset, setCoverPreset] = useState(classData?.cover_preset || '');
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const { translate, translating } = useAutoTranslate();

  const validateClassForm = () => {
    const e = {};
    if (!form.name.trim()) e.name = t('admin.validation.classNameRequired', 'Class name is required');
    else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
    if (form.duration_minutes < 5) e.duration_minutes = t('admin.validation.required', 'This field is required');
    if (form.max_capacity < 1) e.max_capacity = t('admin.validation.required', 'This field is required');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleClassBlur = (field) => {
    const e = { ...errors };
    if (field === 'name') {
      if (!form.name.trim()) e.name = t('admin.validation.classNameRequired', 'Class name is required');
      else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
      else delete e.name;
    }
    if (field === 'duration_minutes') {
      if (form.duration_minutes < 5) e.duration_minutes = t('admin.validation.required', 'This field is required');
      else delete e.duration_minutes;
    }
    if (field === 'max_capacity') {
      if (form.max_capacity < 1) e.max_capacity = t('admin.validation.required', 'This field is required');
      else delete e.max_capacity;
    }
    setErrors(e);
  };

  const setFormField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  // Step 1: Translate → show preview (single API call, second only if needed)
  const handleTranslateAndPreview = async () => {
    if (!validateClassForm()) return;

    const texts = [form.name];
    const hasDesc = !!(form.description || '').trim();
    if (hasDesc) texts.push(form.description);

    // First call: try translating to ES (DeepL auto-detects source)
    const result = await translate(texts, 'ES');

    if (!result) {
      // Translation failed — save without translation
      onSave({ ...form, name_es: classData?.name_es || '', description_es: classData?.description_es || '', imageFile, pendingSlots, cover_preset: coverPreset || null });
      return;
    }

    const isSpanish = result.detected_lang === 'ES';

    if (isSpanish) {
      // Admin typed in Spanish → we need EN translation, not ES
      const toEn = await translate(texts, 'EN');
      if (!toEn) {
        onSave({ ...form, name_es: form.name, description_es: form.description || '', imageFile, pendingSlots, cover_preset: coverPreset || null });
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
      cover_preset: coverPreset || null,
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
            <label className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.className')} <span className="text-red-400">*</span></label>
            <CharCount value={form.name} max={NAME_MAX} />
          </div>
          <input value={form.name} onChange={e => { if (e.target.value.length <= NAME_MAX) setFormField('name', e.target.value); }}
            onBlur={() => handleClassBlur('name')}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: `1px solid ${errors.name ? 'rgba(239, 68, 68, 0.5)' : 'var(--color-border-subtle)'}`, color: 'var(--color-text-primary)' }}
            placeholder="Yoga, Spinning, CrossFit..." />
          {errors.name && <p className="text-[11px] text-red-400 mt-1">{errors.name}</p>}
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.description')}</label>
            <CharCount value={form.description} max={DESC_MAX} />
          </div>
          <textarea value={form.description} onChange={e => { if (e.target.value.length <= DESC_MAX) setFormField('description', e.target.value); }} rows={2}
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
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.duration')} ({tc('min') || 'min'}) <span className="text-red-400">*</span></label>
            <input type="number" min={5} max={480} value={form.duration_minutes} onChange={e => setFormField('duration_minutes', Number(e.target.value))}
              onBlur={() => handleClassBlur('duration_minutes')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: `1px solid ${errors.duration_minutes ? 'rgba(239, 68, 68, 0.5)' : 'var(--color-border-subtle)'}`, color: 'var(--color-text-primary)' }} />
            {errors.duration_minutes && <p className="text-[11px] text-red-400 mt-1">{errors.duration_minutes}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.capacity')} <span className="text-red-400">*</span></label>
            <input type="number" min={1} max={1000} value={form.max_capacity} onChange={e => setFormField('max_capacity', Number(e.target.value))}
              onBlur={() => handleClassBlur('max_capacity')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-bg-deep)', border: `1px solid ${errors.max_capacity ? 'rgba(239, 68, 68, 0.5)' : 'var(--color-border-subtle)'}`, color: 'var(--color-text-primary)' }} />
            {errors.max_capacity && <p className="text-[11px] text-red-400 mt-1">{errors.max_capacity}</p>}
          </div>
        </div>

        {/* Schedule Slots */}
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
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
                  <div key={slot.id} className="flex items-center justify-between p-2 rounded-lg"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    <div className="flex items-center gap-2">
                      {slot.specific_date ? (
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">
                          <CalendarDays size={9} className="inline mr-0.5 -mt-px" />
                          {slotDayLabel(slot, (d) => tc(DAYS_OF_WEEK.find(x => x.value === d)?.labelKey))}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                          <Repeat size={9} className="inline mr-0.5 -mt-px" style={{ color: 'var(--color-accent, #D4AF37)' }} />
                          {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey)}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</span>

                    </div>
                    <button type="button" onClick={() => onDeleteSlot(slot.id)} aria-label={t('admin.classes.deleteSlot', 'Delete schedule slot')} className="p-1 rounded hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors">
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
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex items-center gap-2">
                    {slot.specific_date ? (
                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">
                        <CalendarDays size={9} className="inline mr-0.5 -mt-px" />
                        {slotDayLabel(slot, (d) => tc(DAYS_OF_WEEK.find(x => x.value === d)?.labelKey))}
                      </span>
                    ) : (
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        <Repeat size={9} className="inline mr-0.5 -mt-px" style={{ color: 'var(--color-accent, #D4AF37)' }} />
                        {tc(DAYS_OF_WEEK.find(d => d.value === slot.day_of_week)?.labelKey)}
                      </span>
                    )}
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</span>
                    {slot.capacity_override && <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>({t('admin.classes.cap')}: {slot.capacity_override})</span>}
                  </div>
                  <button type="button" onClick={() => setPendingSlots(s => s.filter((_, i) => i !== idx))} aria-label={t('admin.classes.removePendingSlot', 'Remove pending slot')} className="p-1 rounded hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors">
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
            <p className="text-[10px] italic mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.scheduleHint', 'Add time slots for when this class repeats each week')}</p>
          )}
        </div>

        {/* Workout Template */}
        <RoutineSelector gymId={gymId} value={form.workout_template_id} onChange={(id) => setForm(f => ({ ...f, workout_template_id: id }))} t={t} />

        {/* Class cover — preset or custom upload */}
        <div>
          <label className="block text-[11px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.classCover', 'Class Cover')}</label>

          {/* Custom image preview */}
          {imagePreview ? (
            <div className="relative w-full h-32 rounded-xl overflow-hidden mb-2" style={{ border: '1px solid var(--color-border-subtle)' }}>
              <img src={imagePreview} alt="Class image preview" className="w-full h-full object-cover" />
              <button onClick={() => { setImageFile(null); setImagePreview(''); setCoverPreset(''); }}
                aria-label={t('admin.classes.removeImage', 'Remove image')}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : coverPreset ? (
            <div className="relative mb-2">
              <CoverPreview preset={coverPreset} size="lg" />
              <button onClick={() => setCoverPreset('')}
                aria-label={t('admin.classes.removeCover', 'Remove cover')}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors">
                <X size={14} />
              </button>
            </div>
          ) : null}

          {/* Preset grid */}
          {!imagePreview && (
            <>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {CLASS_COVERS.map(c => {
                  const Icon = c.icon;
                  const selected = coverPreset === c.key;
                  return (
                    <button key={c.key} type="button"
                      onClick={() => { setCoverPreset(c.key); setImageFile(null); setImagePreview(''); }}
                      className={`rounded-xl p-2 flex flex-col items-center gap-1 transition-all ${selected ? 'ring-2 ring-white scale-[1.03]' : 'opacity-70 hover:opacity-100'}`}
                      style={{ background: c.gradient }}>
                      <Icon size={18} className="text-white/90" />
                      <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{t(c.labelKey)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Or upload custom */}
              <label className="flex items-center justify-center gap-2 w-full py-2 rounded-xl border border-dashed cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--color-border-subtle)' }}>
                <Upload size={14} style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.uploadCustom', 'Or upload your own image')}</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { handleImageChange(e); setCoverPreset(''); }} />
              </label>
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)' }}>
          {tc('cancel')}
        </button>
        <button onClick={handleTranslateAndPreview} disabled={saving || translating || !form.name.trim()}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--color-accent, #D4AF37)', color: 'var(--color-bg-base)' }}>
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
            ? { backgroundColor: 'rgba(59,130,246,0.15)', color: '#3B82F6', border: '1px solid rgba(59,130,246,0.3)' }
            : { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
          }>
          <CalendarDays size={11} /> {t('admin.classes.specificDate', 'Specific Date')}
        </button>
      </div>

      {/* Day/Date selector */}
      {mode === 'recurring' ? (
        <div>
          <label className="block text-[10px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.selectDays', 'Select days')}</label>
          <div className="flex flex-wrap gap-1">
            {DAYS_OF_WEEK.map(d => (
              <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                style={selectedDays.includes(d.value)
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 15%, transparent)', color: 'var(--color-accent, #D4AF37)', border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 30%, transparent)' }
                  : { backgroundColor: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
                }>
                {tc(d.labelKey)?.slice(0, 3)}
              </button>
            ))}
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
              className="p-2 rounded-lg bg-[#3B82F6]/12 text-[#3B82F6] hover:bg-[#3B82F6]/20 disabled:opacity-30 transition-colors">
              <Plus size={14} />
            </button>
          </div>
          {selectedDates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedDates.map(date => (
                <span key={date} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-[11px] font-semibold">
                  {fmtDate(date)}
                  <button type="button" onClick={() => removeDate(date)} aria-label={t('admin.classes.removeDate', 'Remove date')} className="hover:text-red-400 transition-colors"><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Time inputs — use text inputs to avoid native time picker overflow */}
      <div className="flex items-end justify-center mb-3">
        <div style={{ width: 90 }}>
          <label className="block text-[10px] font-medium mb-1 text-center" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.startTime')}</label>
          <input type="text" inputMode="numeric" value={startTime} placeholder="09:00"
            onChange={e => {
              let v = e.target.value.replace(/[^\d:]/g, '');
              if (v.length === 2 && !v.includes(':') && startTime.length < v.length) v += ':';
              if (v.length <= 5) setStartTime(v);
            }}
            onBlur={() => { if (/^\d{2}:\d{2}$/.test(startTime)) return; setStartTime('09:00'); }}
            className="block w-full rounded-lg py-1.5 text-[12px] text-center outline-none"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
        </div>
        <span className="px-3 text-[13px] font-medium pb-1.5" style={{ color: 'var(--color-text-muted)' }}>–</span>
        <div style={{ width: 90 }}>
          <label className="block text-[10px] font-medium mb-1 text-center" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.endTime')}</label>
          <input type="text" inputMode="numeric" value={endTime} placeholder="10:00"
            onChange={e => {
              let v = e.target.value.replace(/[^\d:]/g, '');
              if (v.length === 2 && !v.includes(':') && endTime.length < v.length) v += ':';
              if (v.length <= 5) setEndTime(v);
            }}
            onBlur={() => { if (/^\d{2}:\d{2}$/.test(endTime)) return; setEndTime('10:00'); }}
            className="block w-full rounded-lg py-1.5 text-[12px] text-center outline-none"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
        </div>
      </div>
      {/* Add button */}
      <button onClick={handleAdd} disabled={!canAdd}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[12px] font-semibold disabled:opacity-30 transition-colors" aria-label={t('admin.classes.addSchedule')}
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 12%, transparent)', color: 'var(--color-accent, #D4AF37)' }}>
        <Plus size={14} /> {t('admin.classes.addSchedule', 'Add Schedule')}
      </button>
    </div>
  );
}

// ── Delete Confirmation Modal ──
function DeleteConfirmModal({ className: classItem, onConfirm, onCancel, deleting, t, tc }) {
  return (
    <AdminModal isOpen onClose={onCancel} title={t('admin.classes.deleteClass')} size="sm">
      <p className="text-[13px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.classes.deleteConfirm', { name: classItem?.name })}
      </p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)' }}>
          {tc('cancel')}
        </button>
        <button onClick={onConfirm} disabled={deleting}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-red-500 text-white disabled:opacity-50 transition-opacity">
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
        aria-label={t('admin.classes.selectDate', 'Select date')}
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
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[12px] font-semibold transition-all duration-200 border-b-2 -mb-px"
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
                  <div key={slot.id} className="flex items-center justify-between p-2.5 rounded-lg"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                    <div className="flex items-center gap-3">
                      {slot.specific_date ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6]">
                          <CalendarDays size={10} className="inline mr-0.5 -mt-px" />
                          {slotDayLabel(slot, dayLabel)}
                        </span>
                      ) : (
                        <span className="text-[12px] font-semibold min-w-[80px]" style={{ color: 'var(--color-text-primary)' }}>
                          <Repeat size={10} className="inline mr-1 -mt-px" style={{ color: 'var(--color-accent, #D4AF37)' }} />
                          {slotDayLabel(slot, dayLabel)}
                        </span>
                      )}
                      <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</span>
                    </div>
                    <button onClick={() => onDeleteSlot(slot.id)} aria-label={t('admin.classes.deleteSlot', 'Delete schedule slot')} className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors"><Trash2 size={13} /></button>
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
        <input type="text" placeholder={t('admin.classes.searchClasses')} aria-label={t('admin.classes.searchClasses')} value={search} onChange={e => setSearch(e.target.value)}
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
                    <img src={cls.image_url} alt={cls.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" style={{ border: '1px solid var(--color-border-subtle)' }} />
                  ) : cls.cover_preset ? (
                    <CoverPreview preset={cls.cover_preset} size="md" className="flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl flex-shrink-0 flex items-center justify-center"
                      style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: `${cls.accent_color}15` }}>
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
                          <img src={cls.trainer.avatar_url} alt={cls.trainer.full_name || "Trainer avatar"} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
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
                    <button onClick={() => onDelete(cls)} className="p-2 rounded-lg transition-all duration-200 hover:scale-110" style={{ color: 'var(--color-danger, #EF4444)' }} aria-label={tc('delete')}><Trash2 size={15} /></button>
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
function BookingsTabView({ classes, t, tc, locale = 'es' }) {
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
  }, [anchorDate, viewMode, todayStr]);

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
  }, [viewMode, selectedDate, weekDays, anchorDate]);

  // Fetch bookings
  const classIds = classes.map(c => c.id);
  const { data: allBookings = [], isLoading } = useQuery({
    queryKey: adminKeys.classes.bookingsTab(viewMode, dateFrom, dateTo),
    queryFn: async () => {
      if (!classIds.length) return [];
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('id, class_id, status, attended, rating, booking_date, created_at, waitlist_position, profiles(id, full_name, avatar_url)')
        .in('class_id', classIds)
        .gte('booking_date', dateFrom)
        .lte('booking_date', dateTo)
        .order('created_at');
      return data || [];
    },
    enabled: classIds.length > 0,
    staleTime: 30_000,
  });

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
      confirmed: { bg: 'rgba(16,185,129,0.1)', color: '#10B981' },
      waitlisted: { bg: 'rgba(96,165,250,0.1)', color: '#60A5FA' },
      cancelled: { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
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
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
          {VIEW_MODES.map(v => (
            <button key={v.key} onClick={() => { setViewMode(v.key); setMonthSelectedDate(null); setExpandedClassId(null); }}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors"
              style={viewMode === v.key
                ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
                : { color: 'var(--color-text-muted)' }
              }>{v.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => shift(-1)} aria-label={t('admin.classes.previousPeriod', 'Previous period')} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
            <ChevronDown size={16} className="rotate-90" />
          </button>
          <button onClick={goToday} className="px-3.5 py-2 rounded-xl text-[12px] font-bold"
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
                {hasBookings && !d.isToday && <div className="w-1 h-1 rounded-full mt-0.5" style={{ backgroundColor: '#10B981' }} />}
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
                    <div className="w-1 h-1 rounded-full" style={{ backgroundColor: '#10B981' }} />
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
          {classBookings.map(({ cls, bookings, confirmed, waitlisted, attended, total }) => {
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
                  ) : cls.image_url ? (
                    <img src={cls.image_url} alt={cls.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${cls.accent_color || '#D4AF37'}15` }}>
                      <CalendarDays size={16} style={{ color: cls.accent_color || 'var(--color-accent)' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{cls.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10B981' }}>{confirmed} {t('admin.classes.confirmed', 'confirmed')}</span>
                      {waitlisted > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(96,165,250,0.1)', color: '#60A5FA' }}>{waitlisted} {t('admin.classes.waitlisted', 'waitlist')}</span>}
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
                        style={{ width: `${capacityPct}%`, backgroundColor: capacityPct >= 90 ? '#EF4444' : capacityPct >= 70 ? '#F59E0B' : '#10B981' }} />
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

// ────────────────────────────────────────────────────────────
// ── Main Page ──────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
export default function AdminClasses() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const appLocale = i18n.language?.startsWith('es') ? 'es' : 'en';
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const [activeTab, setActiveTab] = useState('classes');
  const [formModal, setFormModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [detailClassId, setDetailClassId] = useState(null);

  useEffect(() => { document.title = `Admin - Classes | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

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

  // Derive detailClass from fresh classes data so schedules stay current
  const detailClass = detailClassId ? classes.find(c => c.id === detailClassId) || null : null;
  const setDetailClass = (cls) => setDetailClassId(cls?.id || null);

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
        instructor_name: formData.instructor || null, duration_minutes: formData.duration_minutes,
        max_capacity: formData.max_capacity, accent_color: formData.accent_color,
        is_active: formData.is_active, image_path: imagePath,
        cover_preset: formData.cover_preset || null,
        workout_template_id: formData.workout_template_id || null, trainer_id: formData.trainer_id || null,
      };

      if (formModal?.id) {
        const { error } = await supabase.from('gym_classes').update(payload).eq('id', formModal.id).eq('gym_id', gymId);
        if (error) throw error;
        logAdminAction('update_class', 'class', formModal.id);
      } else {
        const { data: inserted, error } = await supabase.from('gym_classes').insert(payload).select('id').single();
        if (error) throw error;
        logAdminAction('create_class', 'class', inserted.id, { name: formData.name });

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

      await queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
      setFormModal(null);
      showToast(tc('success'), 'success');
    } catch (err) {
      console.error('[AdminClasses] Save error:', err);
      showToast(err.message || tc('somethingWentWrong'), 'error');
    } finally { setSaving(false); }
  };

  // ── Toggle active ──
  const handleToggleActive = async (cls) => {
    const { error } = await supabase.from('gym_classes').update({ is_active: !cls.is_active }).eq('id', cls.id).eq('gym_id', gymId);
    if (!error) queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
  };

  // ── Delete class ──
  const handleDeleteClass = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_delete_class', { p_class_id: deleteTarget.id });
      if (error) throw error;
      logAdminAction('delete_class', 'class', deleteTarget.id);
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
    const { error } = await supabase.from('gym_class_schedules').delete().eq('id', slotId).eq('gym_id', gymId);
    if (!error) {
      logAdminAction('delete_schedule_slot', 'gym_class_schedule', slotId);
      queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
    }
  };

  const dayLabel = (dayNum) => {
    const d = DAYS_OF_WEEK.find(d => d.value === dayNum);
    return d ? tc(d.labelKey) : `Day ${dayNum}`;
  };

  // Summary stats
  const totalSlots = classes.reduce((sum, c) => sum + (c.gym_class_schedules?.length || 0), 0);
  const activeClasses = classes.filter(c => c.is_active).length;

  const TABS = [
    { key: 'classes', label: t('admin.classes.tabClasses'), icon: CalendarDays },
    { key: 'schedule', label: t('admin.classes.tabSchedule'), icon: Calendar },
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
      <AdminTabs tabs={TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))} active={activeTab} onChange={setActiveTab} className="mb-5" equalWidth />

      {/* Tab content — swipeable */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
      ) : classes.length === 0 ? (
        <FadeIn>
          <AdminCard padding="p-8">
            <div className="text-center">
              <CalendarDays size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-faint)' }} />
              <p className="text-[14px] font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>{t('admin.classes.noClasses')}</p>
              <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.noClassesDesc')}</p>
              <button
                onClick={() => setFormModal('new')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
                style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
              >
                <Plus size={15} /> {t('admin.classes.addClass')}
              </button>
            </div>
          </AdminCard>
        </FadeIn>
      ) : (
        <FadeIn>
          <SwipeableTabContent tabs={TABS} active={activeTab} onChange={setActiveTab}>
            {(tabKey) => {
              if (tabKey === 'schedule') return (
                <ScheduleView
                  classes={classes}
                  onEditClass={setFormModal}
                  onDeleteSlot={handleDeleteSlot}
                  t={t}
                  tc={tc}
                />
              );
              if (tabKey === 'classes') return (
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
              );
              if (tabKey === 'bookings') return (
                <BookingsTabView
                  classes={classes}
                  t={t}
                  tc={tc}
                  locale={appLocale}
                />
              );
              return null;
            }}
          </SwipeableTabContent>
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
          onClose={() => setDetailClassId(null)}
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
