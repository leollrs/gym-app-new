import { useEffect, useState, useMemo } from 'react';
import { Plus, Dumbbell, ChevronRight, ChevronDown, Trash2, Users, Search } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader,
  AdminCard,
  StatCard,
  FadeIn,
  CardSkeleton,
  SectionLabel,
  AdminTabs,
} from '../../components/admin';
import {
  normalizeWeeks,
  calcDaySeconds,
  fmtTime,
  buildWeeksFromPattern,
} from './components/programHelpers';
import TemplatesModal from './components/TemplatesModal';
import ProgramBuilderModal from './components/ProgramBuilderModal';
import ProgramSuggestionCard from './components/ProgramSuggestionCard';


// ── Main ──────────────────────────────────────────────────
export default function AdminPrograms() {
  const { t, i18n } = useTranslation('pages');
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [prefillProgram, setPrefillProgram] = useState(null);
  const [expandedEnroll, setExpandedEnroll] = useState(null);
  const [enrolledMembers, setEnrolledMembers] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [programSearch, setProgramSearch] = useState('');
  const [durationFilter, setDurationFilter] = useState('all');
  const [statusTab, setStatusTab] = useState('published');

  useEffect(() => { document.title = t('admin.programs.pageTitle', `Admin - Programs | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

  // ── Queries ──────────────────────────────────────────────

  const {
    data: programs = [],
    isLoading: loadingPrograms,
  } = useQuery({
    queryKey: adminKeys.programs(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_programs')
        .select('*')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const {
    data: enrollments = [],
  } = useQuery({
    queryKey: [...adminKeys.programs(gymId), 'enrollments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_program_enrollments')
        .select('program_id')
        .eq('gym_id', gymId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Derived data ─────────────────────────────────────────

  const enrollmentCounts = {};
  enrollments.forEach(r => {
    enrollmentCounts[r.program_id] = (enrollmentCounts[r.program_id] || 0) + 1;
  });

  const programStats = (() => {
    const publishedCount = programs.filter(p => p.is_published).length;
    // gym_program_enrollments has no completion tracking yet — every enrollment counts as active.
    const activeCount = enrollments.length;
    const compRate = 0;

    let topName = '\u2014';
    if (Object.keys(enrollmentCounts).length > 0) {
      const topId = Object.entries(enrollmentCounts).sort((a, b) => b[1] - a[1])[0][0];
      const topProg = programs.find(p => p.id === topId);
      topName = topProg?.name || '\u2014';
    }

    return { totalPrograms: publishedCount, activeEnrollments: activeCount, completionRate: compRate, topProgram: topName };
  })();

  // ── Mutations ────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async ({ programId, payload }) => {
      if (programId) {
        const { error } = await supabase.from('gym_programs').update(payload).eq('id', programId).eq('gym_id', gymId);
        if (error) throw error;
        logAdminAction('update_program', 'program', programId);
      } else {
        const { data: inserted, error } = await supabase.from('gym_programs').insert(payload).select('id').single();
        if (error) throw error;
        logAdminAction('create_program', 'program', inserted.id, { name: payload.name });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.programs(gymId) });
      setShowCreate(false);
      setPrefillProgram(null);
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('gym_programs').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
      logAdminAction('delete_program', 'program', id);
    },
    onSuccess: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: adminKeys.programs(gymId) });
    },
  });

  // ── Handlers ─────────────────────────────────────────────

  const handleSaveProgram = ({ name, description, durationWeeks, weeks }) => {
    // Validation
    if (!name?.trim()) {
      showToast(t('admin.programs.nameRequired', { defaultValue: 'Program name is required' }), 'error');
      return;
    }
    if (!durationWeeks || durationWeeks < 1 || durationWeeks > 52) {
      showToast(t('admin.programs.invalidDuration', { defaultValue: 'Duration must be 1–52 weeks' }), 'error');
      return;
    }
    const weekKeys = Object.keys(weeks || {});
    if (weekKeys.length === 0) {
      showToast(t('admin.programs.noWeeks', { defaultValue: 'Add at least one week of workouts' }), 'error');
      return;
    }
    let totalExercises = 0;
    let invalidExercise = false;
    for (const weekData of Object.values(weeks)) {
      const dayList = weekData?.days || weekData;
      if (!dayList) continue;
      for (const day of Object.values(dayList)) {
        const exercises = Array.isArray(day) ? day : (day?.exercises || []);
        for (const ex of exercises) {
          totalExercises++;
          const sets = Number(ex?.sets ?? ex?.target_sets);
          const rest = Number(ex?.rest_seconds ?? ex?.rest);
          if (!ex?.exercise_id && !ex?.id && !ex?.name) invalidExercise = true;
          if (Number.isFinite(sets) && (sets < 1 || sets > 20)) invalidExercise = true;
          if (Number.isFinite(rest) && (rest < 0 || rest > 600)) invalidExercise = true;
        }
      }
    }
    if (totalExercises === 0) {
      showToast(t('admin.programs.noExercises', { defaultValue: 'Add at least one exercise' }), 'error');
      return;
    }
    if (invalidExercise) {
      showToast(t('admin.programs.invalidExercise', { defaultValue: 'Sets must be 1–20, rest 0–600s' }), 'error');
      return;
    }

    const payload = {
      gym_id: gymId,
      created_by: user.id,
      name: name.trim(),
      description,
      duration_weeks: durationWeeks,
      weeks,
      is_published: true,
    };
    saveMutation.mutate({
      programId: editing?.id || null,
      payload,
    });
  };

  const handleTemplateSelect = (template) => {
    // Auto-generated programs pass weeks directly; manual templates use weekPattern
    const builtWeeks = template.weeks || buildWeeksFromPattern(template.weekPattern, template.durationWeeks);
    setPrefillProgram({
      name: template.name,
      description: template.description,
      duration_weeks: template.durationWeeks,
      weeks: builtWeeks,
    });
    setShowTemplates(false);
  };

  const loadEnrolledMembers = async (programId) => {
    if (enrolledMembers[programId]) return;
    const { data } = await supabase
      .from('gym_program_enrollments')
      .select('profile_id, enrolled_at, profiles(full_name)')
      .eq('program_id', programId)
      .eq('gym_id', gymId)
      .order('enrolled_at', { ascending: true });
    setEnrolledMembers(prev => ({ ...prev, [programId]: data || [] }));
  };

  const toggleEnroll = (programId) => {
    if (expandedEnroll === programId) {
      setExpandedEnroll(null);
    } else {
      setExpandedEnroll(programId);
      loadEnrolledMembers(programId);
    }
  };

  // ── Filtered programs ────────────────────────────────────

  const filteredPrograms = useMemo(() => {
    let result = programs;
    // Status tab — published vs draft. `is_published` lives on gym_programs.
    if (statusTab === 'published') {
      result = result.filter(p => p.is_published === true);
    } else if (statusTab === 'draft') {
      result = result.filter(p => p.is_published !== true);
    }
    if (programSearch.trim()) {
      const q = programSearch.toLowerCase();
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
      );
    }
    if (durationFilter !== 'all') {
      const weeks = parseInt(durationFilter);
      if (durationFilter === '12+') {
        result = result.filter(p => (p.duration_weeks || 0) >= 12);
      } else {
        result = result.filter(p => (p.duration_weeks || 0) <= weeks);
      }
    }
    return result;
  }, [programs, programSearch, durationFilter, statusTab]);

  const statusCounts = useMemo(() => ({
    published: programs.filter(p => p.is_published === true).length,
    draft: programs.filter(p => p.is_published !== true).length,
  }), [programs]);

  // ── Render ───────────────────────────────────────────────

  const loading = loadingPrograms;

  return (
    <div className="admin-shell px-4 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.programs.title', 'Programs')}
        subtitle={t('admin.programs.subtitle', 'Multi-week training plans members can enroll in')}
        actions={
          <button
            onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 font-bold text-[13px] rounded-xl transition-colors w-full sm:w-auto"
            style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
          >
            <Plus size={15} /> {t('admin.programs.newProgram', 'New Program')}
          </button>
        }
        className="mb-5"
      />

      {/* Program Suggestion */}
      <ProgramSuggestionCard
        gymId={gymId}
        t={t}
        isEs={isEs}
        onCreateProgram={() => { setPrefillProgram(null); setShowTemplates(true); }}
      />

      {/* Program Analytics Summary */}
      {!loading && programs.length > 0 && (
        <FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 md:gap-3 mb-5">
            <StatCard label={t('admin.programs.publishedPrograms', 'Published Programs')} value={programStats.totalPrograms} borderColor="var(--color-accent)" delay={0} />
            <StatCard label={t('admin.programs.activeEnrollments', 'Active Enrollments')} value={programStats.activeEnrollments} borderColor="var(--color-info)" delay={50} />
            <AdminCard className="admin-stat-card border-l-2" borderLeft="var(--color-coach)">
              <p className="admin-kpi text-[18px] md:text-[20px] truncate">{programStats.topProgram}</p>
              <p className="text-[11px] mt-1.5 truncate" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.mostPopular', 'Most Popular')}</p>
            </AdminCard>
          </div>
        </FadeIn>
      )}

      {/* Status tabs — separate Published from Draft */}
      {!loading && programs.length > 0 && (
        <AdminTabs
          tabs={[
            { key: 'published', label: t('admin.programs.published', 'Published'), count: statusCounts.published },
            { key: 'draft', label: t('admin.programs.draft', 'Draft'), count: statusCounts.draft },
          ]}
          active={statusTab}
          onChange={setStatusTab}
          className="mb-4"
        />
      )}

      {/* Search and filters */}
      {!loading && programs.length > 0 && (
        <FadeIn delay={0.05}>
          <div className="flex flex-wrap items-center gap-2.5 mb-4">
            {/* Search */}
            <div
              className="relative flex-1 min-w-[200px] flex items-center gap-2"
              style={{
                padding: '8px 12px',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-admin-border)',
                borderRadius: 10,
              }}
            >
              <Search size={13} style={{ color: 'var(--color-admin-text-muted)' }} />
              <input
                type="text"
                placeholder={t('admin.programs.searchPlaceholder', 'Search programs…')}
                aria-label={t('admin.programs.searchPlaceholder', 'Search programs')}
                value={programSearch}
                onChange={e => setProgramSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-[13px]"
                style={{ color: 'var(--color-admin-text)' }}
              />
            </div>
            {/* Duration filter pills */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide w-full md:w-auto md:flex-wrap pb-1">
              {[
                { key: 'all', label: t('admin.programs.durationAll', 'All') },
                { key: '4', label: t('admin.programs.durationShort', '1–4w') },
                { key: '8', label: t('admin.programs.durationMed', '5–8w') },
                { key: '12+', label: t('admin.programs.durationLong', '12w+') },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setDurationFilter(f.key)}
                  className={`admin-pill flex-shrink-0 ${durationFilter === f.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                  style={{ cursor: 'pointer', minHeight: 28 }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton h="h-[80px]" />
          <CardSkeleton h="h-[80px]" />
          <CardSkeleton h="h-[80px]" />
        </div>
      ) : programs.length === 0 ? (
        <FadeIn>
          <div className="text-center py-20">
            <div
              className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: 'var(--color-admin-panel)' }}
            >
              <Dumbbell size={24} style={{ color: 'var(--color-admin-text-muted)' }} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t('admin.programs.noPrograms', 'No programs yet')}</p>
            <p className="text-[12.5px] mt-1 mb-4" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.noProgramsHint', 'Create structured programs for your members to follow')}</p>
            <button
              onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-colors"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
            >
              <Plus size={14} /> {t('admin.programs.createFirst', 'Create your first program')}
            </button>
          </div>
        </FadeIn>
      ) : (
        <FadeIn>
          {filteredPrograms.length === 0 ? (
            <div className="text-center py-12">
              <Search size={24} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.noMatchingPrograms', 'No programs match your search')}</p>
            </div>
          ) : (
          <AdminCard padding="p-0" clipContent={false}>
            {filteredPrograms.map((p, idx) => {
              const wks = normalizeWeeks(p.weeks);
              const allDays = Object.values(wks).flat();
              const totalDays = allDays.length;
              const totalEx   = allDays.reduce((s, d) => s + d.exercises.length, 0);
              const avgTime   = totalDays > 0
                ? Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / totalDays)
                : 0;
              const isLast = idx === filteredPrograms.length - 1;
              return (
                <div
                  key={p.id}
                  style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-admin-border)' }}
                >
                  <div className="px-4 py-4">
                    {/* Header row: icon + title + status pill */}
                    <div className="flex items-start gap-3 md:gap-3.5">
                      <div
                        className="w-11 h-11 rounded-[11px] flex items-center justify-center flex-shrink-0"
                        style={{ background: 'var(--color-coach-soft)' }}
                      >
                        <Dumbbell size={20} style={{ color: 'var(--color-coach)' }} strokeWidth={2} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="admin-page-title text-[14.5px] truncate" style={{ letterSpacing: '-0.015em' }}>{p.name}</span>
                          <span className="admin-pill admin-pill--outline">
                            {p.duration_weeks}{t('admin.programs.weeksShort', 'w')}
                          </span>
                        </div>
                        <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                          {totalDays} {t('admin.programs.days', 'days')} · {totalEx} {t('admin.programs.exercises', 'exercises')}
                          {avgTime > 0 && ` · ~${fmtTime(avgTime)}/${t('admin.programs.session', 'session')}`}
                        </p>
                      </div>

                      <span className={`admin-pill ${p.is_published ? 'admin-pill--good' : 'admin-pill--outline'} flex-shrink-0`}>
                        {p.is_published ? t('admin.programs.published', 'Published') : t('admin.programs.draft', 'Draft')}
                      </span>

                      {/* Desktop-only inline edit/delete */}
                      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => setEditing(p)}
                          aria-label={t('admin.programs.editProgram', 'Edit program')}
                          className="flex items-center justify-center transition-colors"
                          style={{
                            width: 30, height: 30, borderRadius: 8,
                            border: '1px solid var(--color-admin-border)',
                            background: 'var(--color-bg-card)',
                            color: 'var(--color-admin-text-sub)',
                          }}
                        >
                          <ChevronRight size={13} />
                        </button>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deleteMutation.mutate(p.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                              style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
                            >
                              {t('admin.programs.confirm')}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                              style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}
                            >
                              {t('admin.programs.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(p.id)}
                            aria-label={t('admin.programs.deleteProgram', 'Delete program')}
                            className="flex items-center justify-center transition-colors"
                            style={{
                              width: 30, height: 30, borderRadius: 8,
                              border: '1px solid var(--color-admin-border)',
                              background: 'var(--color-bg-card)',
                              color: 'var(--color-danger)',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    {p.description && (
                      <p className="text-[12px] mt-2 line-clamp-2" style={{ color: 'var(--color-admin-text-sub)', maxWidth: 600 }}>{p.description}</p>
                    )}

                    {/* Meta + actions row */}
                    <div className="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
                      <button
                        onClick={() => toggleEnroll(p.id)}
                        className="flex items-center gap-1.5 text-[11.5px] font-medium transition-colors"
                        style={{ color: 'var(--color-admin-text-sub)' }}
                      >
                        <Users size={12} />
                        <span>{enrollmentCounts[p.id] ?? 0} {t('admin.programs.enrolled', 'enrolled')}</span>
                        <ChevronDown size={11} className={`transition-transform ${expandedEnroll === p.id ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Mobile-only actions */}
                      <div className="flex md:hidden items-center gap-1.5">
                        <button
                          onClick={() => setEditing(p)}
                          aria-label={t('admin.programs.editProgram', 'Edit program')}
                          className="flex items-center justify-center transition-colors"
                          style={{
                            width: 30, height: 30, borderRadius: 8,
                            border: '1px solid var(--color-admin-border)',
                            background: 'var(--color-bg-card)',
                            color: 'var(--color-admin-text-sub)',
                          }}
                        >
                          <ChevronRight size={13} />
                        </button>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deleteMutation.mutate(p.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                              style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
                            >
                              {t('admin.programs.confirm')}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                              style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-muted)' }}
                            >
                              {t('admin.programs.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(p.id)}
                            aria-label={t('admin.programs.deleteProgram', 'Delete program')}
                            className="flex items-center justify-center transition-colors"
                            style={{
                              width: 30, height: 30, borderRadius: 8,
                              border: '1px solid var(--color-admin-border)',
                              background: 'var(--color-bg-card)',
                              color: 'var(--color-danger)',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Enrolled members panel */}
                  {expandedEnroll === p.id && (
                    <div
                      className="px-4 pb-4 pt-3"
                      style={{ borderTop: '1px solid var(--color-admin-border)' }}
                    >
                      <SectionLabel className="mb-2">{t('admin.programs.enrolledMembers', 'Enrolled Members')}</SectionLabel>
                      {!enrolledMembers[p.id] ? (
                        <div className="flex justify-center py-3">
                          <div
                            className="w-4 h-4 border-2 rounded-full animate-spin"
                            style={{
                              borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                              borderTopColor: 'var(--color-accent)',
                            }}
                          />
                        </div>
                      ) : enrolledMembers[p.id].length === 0 ? (
                        <p className="text-[12px] text-center py-2" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.programs.noEnrolled', 'No members enrolled yet')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {enrolledMembers[p.id].map(e => {
                            const name = e.profiles?.full_name ?? '?';
                            const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                            return (
                              <div
                                key={e.profile_id}
                                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5"
                                style={{ background: 'var(--color-admin-panel)' }}
                              >
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                                  style={{ background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
                                >
                                  <span className="text-[9px] font-bold" style={{ color: 'var(--color-accent)' }}>{initials}</span>
                                </div>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--color-admin-text)' }}>{name}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </AdminCard>
          )}
        </FadeIn>
      )}

      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onSelect={handleTemplateSelect}
          onStartFromScratch={() => { setShowTemplates(false); setShowCreate(true); }}
        />
      )}
      {(showCreate || prefillProgram) && !editing && (
        <ProgramBuilderModal
          initialData={prefillProgram}
          onClose={() => { setShowCreate(false); setPrefillProgram(null); saveMutation.reset(); }}
          onSave={handleSaveProgram}
          saving={saveMutation.isPending}
          saveError={saveMutation.error?.message || ''}
        />
      )}
      {editing && (
        <ProgramBuilderModal
          program={editing}
          onClose={() => { setEditing(null); saveMutation.reset(); }}
          onSave={handleSaveProgram}
          saving={saveMutation.isPending}
          saveError={saveMutation.error?.message || ''}
        />
      )}
    </div>
  );
}
