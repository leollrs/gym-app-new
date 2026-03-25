import { useEffect, useState } from 'react';
import { Plus, Dumbbell, ChevronRight, ChevronDown, Trash2, Users } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
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

// ── Main ──────────────────────────────────────────────────
export default function AdminPrograms() {
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [prefillProgram, setPrefillProgram] = useState(null);
  const [expandedEnroll, setExpandedEnroll] = useState(null);
  const [enrolledMembers, setEnrolledMembers] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => { document.title = 'Admin - Programs | TuGymPR'; }, []);

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
      const { error } = programId
        ? await supabase.from('gym_programs').update(payload).eq('id', programId)
        : await supabase.from('gym_programs').insert(payload);
      if (error) throw error;
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
    const builtWeeks = buildWeeksFromPattern(template.weekPattern, template.durationWeeks);
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

  // ── Render ───────────────────────────────────────────────

  const loading = loadingPrograms;

  return (
    <div className="px-4 md:px-8 py-6 max-w-5xl mx-auto">
      <PageHeader
        title="Programs"
        subtitle="Gym-branded workout programs for members"
        actions={
          <button
            onClick={() => { setPrefillProgram(null); setShowTemplates(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors"
          >
            <Plus size={15} /> New Program
          </button>
        }
        className="mb-6"
      />

      {/* Program Analytics Summary */}
      {!loading && programs.length > 0 && (
        <FadeIn>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Published Programs" value={programStats.totalPrograms} borderColor="#D4AF37" delay={0} />
            <StatCard label="Active Enrollments" value={programStats.activeEnrollments} borderColor="#3B82F6" delay={50} />
            <StatCard label="Completion Rate" value={`${programStats.completionRate}%`} borderColor="#10B981" delay={100} />
            <AdminCard>
              <p className="text-[22px] font-bold text-[#E5E7EB] truncate text-[16px]">{programStats.topProgram}</p>
              <p className="text-[12px] text-[#9CA3AF]">Most Popular</p>
            </AdminCard>
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
            <p className="text-[14px] text-[#6B7280]">No programs yet</p>
            <p className="text-[12px] text-[#4B5563] mt-1">Create structured programs for your members to follow</p>
          </div>
        </FadeIn>
      ) : (
        <FadeIn>
          <div className="space-y-3">
            {programs.map(p => {
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
                            {p.duration_weeks}w · {totalDays} days · {totalEx} exercises
                            {avgTime > 0 && ` · ~${fmtTime(avgTime)}/session`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${p.is_published ? 'text-emerald-400 bg-emerald-500/10' : 'text-[#6B7280] bg-white/6'}`}>
                          {p.is_published ? 'Published' : 'Draft'}
                        </span>
                        <button onClick={() => setEditing(p)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors p-1">
                          <ChevronRight size={16} />
                        </button>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-[#9CA3AF]">Delete?</span>
                            <button onClick={() => deleteMutation.mutate(p.id)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors">
                              Confirm
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/5 text-[#9CA3AF] hover:bg-white/10 transition-colors">
                              Cancel
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
                      <span>{enrollmentCounts[p.id] ?? 0} enrolled</span>
                      <ChevronDown size={11} className={`transition-transform ${expandedEnroll === p.id ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {/* Enrolled members panel */}
                  {expandedEnroll === p.id && (
                    <div className="px-4 pb-4 border-t border-white/4 pt-3">
                      <SectionLabel className="mb-2">Enrolled Members</SectionLabel>
                      {!enrolledMembers[p.id] ? (
                        <div className="flex justify-center py-3">
                          <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                        </div>
                      ) : enrolledMembers[p.id].length === 0 ? (
                        <p className="text-[12px] text-[#6B7280] text-center py-2">No members enrolled yet</p>
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
