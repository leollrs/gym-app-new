import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Plus, Trash2, Clock, Users, CalendarDays, X, Save,
  ChevronDown, ChevronUp, ChevronLeft, Edit3, Upload,
  Dumbbell, Star, Search, UserCheck,
  XCircle, UserX, Calendar, Languages, Check, Loader2,
  BarChart3, Repeat, Flame, Zap, Wind, Heart, Mountain,
  Bike, Swords, Music, Waves, Brain, Footprints, Sparkles,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import posthog from 'posthog-js';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { validateImageFile } from '../../lib/validateImage';
import { classImageUrl } from '../../lib/classImageUrl';
import { format, addDays } from 'date-fns';
import { useAutoTranslate } from '../../hooks/useAutoTranslate';
import {
  PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton,
  AdminPageShell, FilterBar, AdminModal, StatCard, AdminTabs, Toggle,
} from '../../components/admin';
import { SwipeableTabContent } from '../../components/admin/AdminTabs';
import { ToneIconChip } from '../../lib/admin/adminTones';
import RoutineSelector from './components/RoutineSelector';
import InstructorSelector from './components/InstructorSelector';
import CoverPreview, { CLASS_COVERS } from './components/CoverPreview';
import BookingsTabView from './components/BookingsTabView';
import { slotDayLabel, format12h, addMinutes, DAYS_OF_WEEK } from '../../lib/admin/classScheduleHelpers';
import TranslationPreviewModal from './components/TranslationPreviewModal';
import ScheduleSlotForm from './components/ScheduleSlotForm';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import ClassFormModal from './components/ClassFormModal';
import BookingsView from './components/BookingsView';
import ClassDetailModal from './components/ClassDetailModal';
import ScheduleView from './components/ScheduleView';
import ClassesListView from './components/ClassesListView';
import ClassRoutinesPanel from './components/ClassRoutinesPanel';

// DAYS_OF_WEEK extracted to lib/admin/classScheduleHelpers
// slotDayLabel, format12h, addMinutes extracted to lib/admin/classScheduleHelpers
// CoverPreview + CLASS_COVERS extracted to ./components/CoverPreview
// RoutineSelector extracted to ./components/RoutineSelector
// InstructorSelector extracted to ./components/InstructorSelector
// TranslationPreviewModal extracted to ./components/TranslationPreviewModal
// ClassFormModal (+ CharCount, NAME_MAX, DESC_MAX, DEFAULT_COLOR) extracted to ./components/ClassFormModal

// ScheduleSlotForm + DeleteConfirmModal extracted to ./components/

// SlotCard + ScheduleView extracted to ./components/ScheduleView
// buildScheduleSummary + ClassesListView extracted to ./components/ClassesListView
// BookingsTabView extracted to ./components/BookingsTabView

// ────────────────────────────────────────────────────────────
// ── Main Page ──────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
export default function AdminClasses() {
  const { profile, availableRoles, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const appLocale = i18n.language?.startsWith('es') ? 'es' : 'en';
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [activeTab, setActiveTab] = useState('classes');
  const [formModal, setFormModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [detailClassId, setDetailClassId] = useState(null);
  // Surface today's roster above the tabs — collapsible so it's out of the
  // way when not needed but reachable in one click instead of two.
  const [todaySummaryExpanded, setTodaySummaryExpanded] = useState(false);
  const [showRoutines, setShowRoutines] = useState(false);

  useEffect(() => { document.title = `${t('admin.classes.pageTitle', 'Admin - Classes')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // ── Fetch classes ──
  const { data: classes = [], isLoading } = useQuery({
    queryKey: adminKeys.classes.all(gymId),
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_classes')
        .select('*, gym_class_schedules(id, day_of_week, start_time, end_time, specific_date), trainer:profiles!gym_classes_trainer_id_fkey(id, full_name, avatar_url), gym_class_trainers(trainer:profiles(id, full_name, avatar_url))')
        .eq('gym_id', gymId)
        .order('name');
      // IMPORTANT: don't bake image_url into the cached row. The persisted
      // React Query cache (24h) was holding signed URLs from a previous
      // build that called createSignedUrl(); those URLs embed a JWT with an
      // `exp` claim, and once expired Supabase returns
      // `400 InvalidJWT: "exp" claim timestamp check failed`. Deriving the
      // URL at render time from image_path means the cache only stores raw
      // DB columns and the URL is regenerated fresh on every render.
      return data || [];
    },
    enabled: !!gymId,
  });

  // Derive detailClass from fresh classes data so schedules stay current
  const detailClass = detailClassId ? classes.find(c => c.id === detailClassId) || null : null;
  const setDetailClass = (cls) => setDetailClassId(cls?.id || null);

  // Same idea for the edit modal: when add/delete slot invalidates the
  // classes query, the modal needs to re-render against the new schedules
  // immediately. `formModal` only ever holds 'new' | { id } now; the live
  // row is looked up here every render.
  const liveFormClass = (formModal && formModal !== 'new')
    ? classes.find(c => c.id === formModal.id) || formModal
    : null;

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

  // ── Today's classes (with schedule slots) for the surfaced summary ──
  const todaysClassList = useMemo(() => {
    const today = new Date().getDay();
    const todayStr = new Date().toISOString().slice(0, 10);
    return classes
      .filter(c => c.is_active)
      .flatMap(c =>
        (c.gym_class_schedules || [])
          .filter(s => s.day_of_week === today || s.specific_date === todayStr)
          .map(s => ({
            classId: c.id,
            name: c.name,
            max_capacity: c.max_capacity,
            slotId: s.id,
            start_time: s.start_time,
          }))
      )
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  }, [classes]);

  // ── Today's bookings, grouped by class, for the surfaced summary ──
  const { data: todaysBookings = [] } = useQuery({
    queryKey: ['admin', 'classes-today-bookings', gymId],
    queryFn: async () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('gym_class_bookings')
        .select('class_id')
        .eq('status', 'confirmed')
        .eq('booking_date', todayStr)
        .in('class_id', classes.map(c => c.id));
      return data || [];
    },
    enabled: !!gymId && classes.length > 0,
    staleTime: 60_000,
  });
  const todaysBookingsByClass = useMemo(() => {
    const map = {};
    todaysBookings.forEach(b => { map[b.class_id] = (map[b.class_id] || 0) + 1; });
    return map;
  }, [todaysBookings]);
  const totalTodayBookings = todaysBookings.length;

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

      const trainerIds = Array.isArray(formData.trainer_ids) ? formData.trainer_ids : [];
      // Keep gym_classes.trainer_id populated with the first selected
      // trainer so legacy single-trainer reads (member side, analytics,
      // dashboard) still resolve to a real person.
      const primaryTrainer = trainerIds[0] || null;

      const payload = {
        gym_id: gymId, name: formData.name, name_es: formData.name_es || null,
        description: formData.description || null, description_es: formData.description_es || null,
        instructor_name: formData.instructor || null, duration_minutes: formData.duration_minutes,
        max_capacity: formData.max_capacity, accent_color: formData.accent_color,
        is_active: formData.is_active, image_path: imagePath,
        cover_preset: formData.cover_preset || null,
        workout_template_id: formData.workout_template_id || null, trainer_id: primaryTrainer,
      };

      const syncTrainers = async (classId) => {
        await supabase.from('gym_class_trainers').delete().eq('class_id', classId);
        if (trainerIds.length > 0) {
          const rows = trainerIds.map(tid => ({ class_id: classId, trainer_id: tid, gym_id: gymId }));
          const { error: junctionErr } = await supabase.from('gym_class_trainers').insert(rows);
          if (junctionErr) throw junctionErr;
        }
      };

      if (formModal?.id) {
        const { error } = await supabase.from('gym_classes').update(payload).eq('id', formModal.id).eq('gym_id', gymId);
        if (error) throw error;
        logAdminAction('update_class', 'class', formModal.id);

        await syncTrainers(formModal.id);

        // Re-normalize every slot's end_time = start_time + new duration.
        // The form no longer collects an end_time directly; it's derived
        // from the class's duration. Changing the duration here cascades
        // to every existing slot so the booking conflict checks and the
        // member-side display stay in sync.
        const { data: existingSlots } = await supabase
          .from('gym_class_schedules')
          .select('id, start_time')
          .eq('class_id', formModal.id);
        if (existingSlots?.length) {
          await Promise.all(existingSlots.map(s =>
            supabase.from('gym_class_schedules')
              .update({ end_time: addMinutes(s.start_time, formData.duration_minutes) })
              .eq('id', s.id)
          ));
        }
      } else {
        const { data: inserted, error } = await supabase.from('gym_classes').insert(payload).select('id').single();
        if (error) throw error;
        logAdminAction('create_class', 'class', inserted.id, { name: formData.name });
        posthog?.capture('admin_class_created');

        if (inserted?.id) await syncTrainers(inserted.id);

        // Insert pending schedule slots for new class
        if (formData.pendingSlots?.length > 0 && inserted?.id) {
          const slots = formData.pendingSlots.map(s => ({
            class_id: inserted.id,
            gym_id: gymId,
            day_of_week: s.specific_date ? null : s.day_of_week,
            specific_date: s.specific_date || null,
            start_time: s.start_time,
            // Recompute end from the final saved duration so slots stay in sync
            // even if the admin changed the duration after adding the slots.
            end_time: addMinutes(s.start_time, formData.duration_minutes),
            // trainer_id only when set (pre-0512-migration safe).
            ...(s.trainer_id ? { trainer_id: s.trainer_id } : {}),
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
    try {
      const { error } = await supabase.from('gym_classes').update({ is_active: !cls.is_active }).eq('id', cls.id).eq('gym_id', gymId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
    } catch (err) {
      showToast(err.message || tc('somethingWentWrong'), 'error');
    }
  };

  // ── Delete class ──
  const handleDeleteClass = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_delete_class', { p_class_id: deleteTarget.id });
      if (error) throw error;
      logAdminAction('delete_class', 'class', deleteTarget.id);
      posthog?.capture('admin_class_deleted');
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
    // Only include trainer_id when set — keeps inserts working even before
    // migration 0512 (the column) is applied.
    if (slot.trainer_id) payload.trainer_id = slot.trainer_id;

    // Pre-insert conflict detection: same class, same day/date, overlapping times.
    const conflictQuery = supabase
      .from('gym_class_schedules')
      .select('id, start_time, end_time')
      .eq('class_id', classId)
      .eq('gym_id', gymId);
    if (slot.specific_date) conflictQuery.eq('specific_date', slot.specific_date);
    else conflictQuery.eq('day_of_week', slot.day_of_week).is('specific_date', null);
    const { data: existing } = await conflictQuery;
    const overlap = (existing || []).find(s =>
      slot.start_time < s.end_time && slot.end_time > s.start_time
    );
    if (overlap) {
      showToast(t('admin.classes.slotConflict', 'A slot already exists at this time.'), 'error');
      return;
    }

    const { error } = await supabase.from('gym_class_schedules').insert(payload);
    if (!error) queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
    else showToast(error.message, 'error');
  };

  // ── Delete schedule slot ──
  // Returning the deleted row + early-exit prevents flooding the audit log
  // when the user double-clicks (or React renders fire several handlers).
  const handleDeleteSlot = async (slotId) => {
    const { data: deletedRows, error } = await supabase
      .from('gym_class_schedules')
      .delete()
      .eq('id', slotId)
      .eq('gym_id', gymId)
      .select('id');
    if (error) {
      showToast(error.message || tc('somethingWentWrong'), 'error');
      return;
    }
    if (!deletedRows || deletedRows.length === 0) return; // already gone — skip audit
    logAdminAction('delete_schedule_slot', 'gym_class_schedule', slotId);
    queryClient.invalidateQueries({ queryKey: adminKeys.classes.all(gymId) });
  };

  const dayLabel = (dayNum) => {
    const d = DAYS_OF_WEEK.find(d => d.value === dayNum);
    return d ? tc(d.labelKey) : t('admin.classes.dayN', 'Day {{n}}', { n: dayNum });
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
        title={showRoutines ? t('admin.classes.routinesTitle', 'Class Routines') : t('admin.classes.title')}
        subtitle={showRoutines
          ? t('admin.classes.routinesSubtitle', 'Build workout routines you can attach to classes')
          : `${activeClasses} ${t('admin.classes.activeClasses')} · ${totalSlots} ${t('admin.classes.weeklySlots')}`}
        actions={
          showRoutines ? (
            <button onClick={() => setShowRoutines(false)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-bold transition-colors w-full sm:w-auto"
              style={{ background: 'var(--color-bg-card)', color: 'var(--color-admin-text-sub)', border: '1px solid var(--color-admin-border)', borderRadius: 999 }}>
              <ChevronLeft size={16} strokeWidth={2.4} /> {t('admin.classes.backToClasses', 'Back to classes')}
            </button>
          ) : (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button onClick={() => setShowRoutines(true)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-bold transition-colors"
                style={{ background: 'var(--color-bg-card)', color: 'var(--color-admin-text-sub)', border: '1px solid var(--color-admin-border)', borderRadius: 999 }}>
                <Dumbbell size={15} strokeWidth={2.4} /> {t('admin.classes.routines', 'Routines')}
              </button>
              <button onClick={() => setFormModal('new')}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}>
                <Plus size={16} strokeWidth={2.6} /> {t('admin.classes.addClass')}
              </button>
            </div>
          )
        }
      />

      {showRoutines ? (
        <FadeIn>
          <ClassRoutinesPanel gymId={gymId} userId={user?.id} t={t} tc={tc} />
        </FadeIn>
      ) : (<>
      {/* Today's bookings — collapsible roster surfaced above the tabs */}
      {!isLoading && classes.length > 0 && (
        <AdminCard padding="p-0" clipContent={false}>
          <button
            type="button"
            onClick={() => setTodaySummaryExpanded(v => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
            aria-expanded={todaySummaryExpanded}
          >
            <ToneIconChip icon={Users} tone="teal" size={40} radius={12} iconScale={0.42} />
            <div className="flex-1 min-w-0">
              <p className="truncate" style={{ fontFamily: 'var(--admin-font-display, "Archivo", system-ui, sans-serif)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.2px', color: 'var(--color-admin-text)' }}>
                {t('admin.classes.todaysBookings', "Today's bookings")}
              </p>
              <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.classes.todaysBookingsSummary', '{{spots}} spots booked across {{count}} classes', {
                  spots: totalTodayBookings,
                  count: todaysClassList.length,
                })}
              </p>
            </div>
            {todaySummaryExpanded
              ? <ChevronUp size={16} style={{ color: 'var(--color-admin-text-sub)' }} />
              : <ChevronDown size={16} style={{ color: 'var(--color-admin-text-sub)' }} />}
          </button>
          {todaySummaryExpanded && (
            <div className="border-t" style={{ borderColor: 'var(--color-admin-border)' }}>
              {todaysClassList.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                  {t('admin.classes.noClassesToday', 'No classes scheduled today')}
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                  {todaysClassList.map((row, idx) => {
                    const booked = todaysBookingsByClass[row.classId] || 0;
                    return (
                      <li key={`${row.slotId || idx}`} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-[12px] font-mono flex-shrink-0" style={{ color: 'var(--color-admin-text-sub)' }}>
                          {format12h(row.start_time)}
                        </span>
                        <span className="text-[13px] font-medium truncate flex-1" style={{ color: 'var(--color-admin-text)' }}>
                          {row.name}
                        </span>
                        <span className="text-[12px] font-semibold flex-shrink-0" style={{ color: 'var(--color-admin-text-sub)' }}>
                          {booked}/{row.max_capacity || '∞'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </AdminCard>
      )}

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
                className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-bold transition-all duration-200 hover:brightness-[1.04]"
                style={{ backgroundColor: 'var(--color-accent)', color: '#fff', borderRadius: 999, boxShadow: '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)' }}
              >
                <Plus size={16} strokeWidth={2.6} /> {t('admin.classes.addClass')}
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
                  lang={i18n.language}
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
                  lang={i18n.language}
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
      </>)}

      {/* Modals */}
      {formModal && (
        <ClassFormModal
          classData={liveFormClass}
          onClose={() => setFormModal(null)}
          onSave={handleSaveClass}
          saving={saving}
          gymId={gymId}
          trainers={trainers}
          onAddSlot={handleAddSlot}
          onDeleteSlot={handleDeleteSlot}
          t={t}
          tc={tc}
          lang={i18n.language}
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
          dayLabel={dayLabel}
          gymId={gymId}
          t={t}
          tc={tc}
          lang={i18n.language}
        />
      )}
    </AdminPageShell>
  );
}
