import { useEffect, useState, useMemo } from 'react';
import { Plus, Dumbbell, ChevronRight, ChevronDown, Trash2, Users, Search, Lightbulb } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { adminKeys } from '../../lib/adminQueryKeys';
import {
  PageHeader,
  AdminCard,
  StatCard,
  FadeIn,
  CardSkeleton,
  SectionLabel,
} from '../../components/admin';
import {
  normalizeWeeks,
  calcDaySeconds,
  fmtTime,
  buildWeeksFromPattern,
} from './components/programHelpers';
import TemplatesModal from './components/TemplatesModal';
import ProgramBuilderModal from './components/ProgramBuilderModal';

// ── Program Suggestion Card ───────────────────────────────
function ProgramSuggestionCard({ gymId, t, isEs, onCreateProgram }) {
  const { data: suggestion } = useQuery({
    queryKey: ['program-suggestion', gymId],
    queryFn: async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('fitness_level, primary_goal')
        .eq('gym_id', gymId)
        .eq('role', 'member');

      if (!profiles?.length) return null;

      const goalCounts = {};
      const levelCounts = {};
      profiles.forEach(p => {
        if (p.primary_goal) goalCounts[p.primary_goal] = (goalCounts[p.primary_goal] || 0) + 1;
        if (p.fitness_level) levelCounts[p.fitness_level] = (levelCounts[p.fitness_level] || 0) + 1;
      });

      const topGoal = Object.entries(goalCounts).sort((a, b) => b[1] - a[1])[0];
      const topLevel = Object.entries(levelCounts).sort((a, b) => b[1] - a[1])[0];

      if (!topGoal) return null;

      const SUGGESTIONS = {
        muscle_gain: { name_en: 'Hypertrophy Focus Program', name_es: 'Programa de Hipertrofia', desc_en: 'Most members want muscle gain — this program targets hypertrophy with progressive overload', desc_es: 'La mayoría de los miembros buscan ganar músculo — este programa se enfoca en hipertrofia con sobrecarga progresiva', template: 'ppl' },
        strength: { name_en: 'Strength Builder Program', name_es: 'Programa de Fuerza', desc_en: 'Your members are focused on getting stronger — compound lifts with low reps', desc_es: 'Tus miembros se enfocan en fuerza — levantamientos compuestos con pocas repeticiones', template: 'upper_lower' },
        fat_loss: { name_en: 'Fat Loss Circuit Program', name_es: 'Programa de Pérdida de Grasa', desc_en: 'Many members want fat loss — high-intensity circuits with short rest', desc_es: 'Muchos miembros buscan perder grasa — circuitos de alta intensidad con descanso corto', template: 'full_body' },
        endurance: { name_en: 'Endurance Training Program', name_es: 'Programa de Resistencia', desc_en: 'Endurance is the top goal — high-rep work with progressive volume', desc_es: 'La resistencia es el objetivo principal — trabajo de muchas repeticiones con volumen progresivo', template: 'full_body' },
        general_fitness: { name_en: 'General Fitness Program', name_es: 'Programa de Fitness General', desc_en: 'A balanced program for overall fitness', desc_es: 'Un programa equilibrado para fitness general', template: 'full_body' },
      };

      const s = SUGGESTIONS[topGoal[0]] || SUGGESTIONS.general_fitness;
      return {
        ...s,
        topGoal: topGoal[0],
        goalCount: topGoal[1],
        totalMembers: profiles.length,
        topLevel: topLevel?.[0],
        pct: Math.round((topGoal[1] / profiles.length) * 100),
      };
    },
    staleTime: 24 * 60 * 60 * 1000,
    enabled: !!gymId,
  });

  if (!suggestion) return null;

  const name = isEs ? suggestion.name_es : suggestion.name_en;
  const desc = isEs ? suggestion.desc_es : suggestion.desc_en;

  return (
    <AdminCard className="mb-5 border-[#D4AF37]/20 bg-gradient-to-r from-[#D4AF37]/[0.04] to-transparent">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
          <Lightbulb size={20} className="text-[#D4AF37]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-[#D4AF37] uppercase tracking-wider mb-1.5">
            {t('admin.programs.suggestion.title', 'Monthly Suggestion')}
          </p>

          <div className="flex items-center gap-2 mb-2">
            <Dumbbell size={15} className="text-[#E5E7EB] flex-shrink-0" />
            <p className="text-[16px] font-bold text-[#E5E7EB] truncate">{name}</p>
          </div>

          <p className="text-[13px] text-[#9CA3AF] leading-relaxed mb-2">{desc}</p>

          <p className="text-[11px] text-[#6B7280] mb-4">
            {t('admin.programs.suggestion.basedOn', 'Based on {{pct}}% of your members ({{count}}/{{total}})', {
              pct: suggestion.pct,
              count: suggestion.goalCount,
              total: suggestion.totalMembers,
            })}
          </p>

          <button
            type="button"
            onClick={onCreateProgram}
            className="px-5 py-2.5 rounded-xl text-[13px] font-bold text-black bg-[#D4AF37] hover:bg-[#E6C766] active:scale-[0.97] transition-all"
          >
            {t('admin.programs.suggestion.createButton', 'Create This Program')}
          </button>
        </div>
      </div>
    </AdminCard>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function AdminPrograms() {
  const { t, i18n } = useTranslation('pages');
  const { profile, user } = useAuth();
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

  useEffect(() => { document.title = t('admin.programs.pageTitle', 'Admin - Programs | TuGymPR'); }, [t]);

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
        .select('program_id, completed_at')
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
    const activeCount = enrollments.filter(e => !e.completed_at).length;
    const completedCount = enrollments.filter(e => e.completed_at).length;
    const compRate = enrollments.length > 0 ? Math.round((completedCount / enrollments.length) * 100) : 0;

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
        const { error } = await supabase.from('gym_programs').update(payload).eq('id', programId);
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
      const { error } = await supabase.from('gym_programs').delete().eq('id', id);
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
    const payload = {
      gym_id: gymId,
      created_by: user.id,
      name,
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
  }, [programs, programSearch, durationFilter]);

  // ── Render ───────────────────────────────────────────────

  const loading = loadingPrograms;

  return (
    <div className="px-4 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader
        title={t('admin.programs.title', 'Programs')}
        subtitle={t('admin.programs.subtitle', 'Gym-branded workout programs for members')}
        actions={
          <button
            onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors"
          >
            <Plus size={15} /> {t('admin.programs.newProgram', 'New Program')}
          </button>
        }
        className="mb-6"
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label={t('admin.programs.publishedPrograms', 'Published Programs')} value={programStats.totalPrograms} borderColor="var(--color-accent)" delay={0} />
            <StatCard label={t('admin.programs.activeEnrollments', 'Active Enrollments')} value={programStats.activeEnrollments} borderColor="#3B82F6" delay={50} />
            <StatCard label={t('admin.programs.completionRate', 'Completion Rate')} value={`${programStats.completionRate}%`} borderColor="#10B981" delay={100} />
            <AdminCard className="overflow-hidden">
              <p className="text-[16px] font-bold text-[#E5E7EB] truncate">{programStats.topProgram}</p>
              <p className="text-[11px] text-[#9CA3AF] truncate">{t('admin.programs.mostPopular', 'Most Popular')}</p>
            </AdminCard>
          </div>
        </FadeIn>
      )}

      {/* Search and filters */}
      {!loading && programs.length > 0 && (
        <FadeIn delay={0.05}>
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
              <input
                type="text"
                placeholder={t('admin.programs.searchPlaceholder', 'Search programs...')}
                aria-label={t('admin.programs.searchPlaceholder', 'Search programs')}
                value={programSearch}
                onChange={e => setProgramSearch(e.target.value)}
                className="w-full bg-[#111827] border border-white/6 rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#6B7280] outline-none focus:border-[#D4AF37]/30"
              />
            </div>
            {/* Duration filter pills */}
            <div className="flex gap-2">
              {[
                { key: 'all', label: t('admin.programs.durationAll', 'All') },
                { key: '4', label: t('admin.programs.durationShort', '1-4w') },
                { key: '8', label: t('admin.programs.durationMed', '5-8w') },
                { key: '12+', label: t('admin.programs.durationLong', '12w+') },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setDurationFilter(f.key)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
                    durationFilter === f.key
                      ? 'bg-[#D4AF37] text-black'
                      : 'bg-[#0F172A] text-[#6B7280] border border-white/6 hover:text-[#9CA3AF]'
                  }`}
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
            <Dumbbell size={32} className="text-[#4B5563] mx-auto mb-3" />
            <p className="text-[14px] text-[#6B7280]">{t('admin.programs.noPrograms', 'No programs yet')}</p>
            <p className="text-[12px] text-[#4B5563] mt-1">{t('admin.programs.noProgramsHint', 'Create structured programs for your members to follow')}</p>
          </div>
        </FadeIn>
      ) : (
        <FadeIn>
          {filteredPrograms.length === 0 ? (
            <div className="text-center py-12">
              <Search size={24} className="text-[#6B7280] mx-auto mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.programs.noMatchingPrograms', 'No programs match your search')}</p>
            </div>
          ) : (
          <div className="space-y-3">
            {filteredPrograms.map(p => {
              const wks = normalizeWeeks(p.weeks);
              const allDays = Object.values(wks).flat();
              const totalDays = allDays.length;
              const totalEx   = allDays.reduce((s, d) => s + d.exercises.length, 0);
              const avgTime   = totalDays > 0
                ? Math.round(allDays.reduce((s, d) => s + calcDaySeconds(d), 0) / totalDays)
                : 0;
              return (
                <AdminCard key={p.id} hover padding="p-0" className="overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                          <Dumbbell size={17} className="text-[#D4AF37]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{p.name}</p>
                          <p className="text-[11px] text-[#6B7280]">
                            {p.duration_weeks}{t('admin.programs.weeksShort', 'w')} · {totalDays} {t('admin.programs.days', 'days')} · {totalEx} {t('admin.programs.exercises', 'exercises')}
                            {avgTime > 0 && ` · ~${fmtTime(avgTime)}/${t('admin.programs.session', 'session')}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${p.is_published ? 'text-emerald-400 bg-emerald-500/10' : 'text-[#6B7280] bg-white/6'}`}>
                          {p.is_published ? t('admin.programs.published', 'Published') : t('admin.programs.draft', 'Draft')}
                        </span>
                        <button onClick={() => setEditing(p)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors p-1">
                          <ChevronRight size={16} />
                        </button>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-[#9CA3AF]">{t('admin.programs.deleteConfirm')}</span>
                            <button onClick={() => deleteMutation.mutate(p.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                              {t('admin.programs.confirm')}
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors">
                              {t('admin.programs.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteId(p.id)} className="text-[#6B7280] hover:text-red-400 transition-colors p-1">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {p.description && (
                      <p className="text-[12px] text-[#6B7280] mt-2 ml-12 line-clamp-2">{p.description}</p>
                    )}

                    {/* Enrollment toggle */}
                    <button
                      onClick={() => toggleEnroll(p.id)}
                      className="ml-12 mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
                    >
                      <Users size={11} />
                      <span>{enrollmentCounts[p.id] ?? 0} {t('admin.programs.enrolled', 'enrolled')}</span>
                      <ChevronDown size={11} className={`transition-transform ${expandedEnroll === p.id ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Enrolled members panel */}
                  {expandedEnroll === p.id && (
                    <div className="px-4 pb-4 border-t border-white/4 pt-3">
                      <SectionLabel className="mb-2">{t('admin.programs.enrolledMembers', 'Enrolled Members')}</SectionLabel>
                      {!enrolledMembers[p.id] ? (
                        <div className="flex justify-center py-3">
                          <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                        </div>
                      ) : enrolledMembers[p.id].length === 0 ? (
                        <p className="text-[12px] text-[#6B7280] text-center py-2">{t('admin.programs.noEnrolled', 'No members enrolled yet')}</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {enrolledMembers[p.id].map(e => {
                            const name = e.profiles?.full_name ?? '?';
                            const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                            return (
                              <div key={e.profile_id} className="flex items-center gap-1.5 bg-[#111827] rounded-xl px-2.5 py-1.5">
                                <div className="w-6 h-6 rounded-full bg-[#D4AF37]/20 flex items-center justify-center flex-shrink-0">
                                  <span className="text-[9px] font-bold text-[#D4AF37]">{initials}</span>
                                </div>
                                <span className="text-[11px] font-medium text-[#E5E7EB]">{name}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </AdminCard>
              );
            })}
          </div>
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
