import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Dumbbell, Clock, ChevronRight, ChevronLeft, Pencil, X, Trash2, CheckCircle2,
  Calendar, Zap, Heart, BookOpen, AlertTriangle, Activity, Target, Play,
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import logger from '../lib/logger';
import GenerateWorkoutModal from '../components/GenerateWorkoutModal';
import CreateRoutineModal from '../components/CreateRoutineModal';
import Skeleton from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { timeAgo } from '../lib/dateUtils';
import { programTemplates, PROGRAM_CATEGORIES } from '../data/programTemplates';
import { exercises as exerciseLibrary } from '../data/exercises';
import { useTranslation } from 'react-i18next';
import { exName } from '../lib/exerciseName';

// Expandable description text — shows 2 lines with "Read more" toggle
const ExpandableText = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation('pages');
  if (!text) return null;
  return (
    <div className="mt-2">
      <p className={`text-[13px] leading-relaxed ${expanded ? '' : 'line-clamp-2'}`} style={{ color: 'var(--color-text-subtle)' }}>
        {text}
      </p>
      {text.length > 120 && (
        <button onClick={() => setExpanded(!expanded)} className="text-[12px] font-semibold mt-1" style={{ color: 'var(--color-accent)' }}>
          {expanded ? t('exerciseLibrary.showLess', 'Show less') : t('exerciseLibrary.readMore', 'Read more')}
        </button>
      )}
    </div>
  );
};

// Local fallback map (English only — used until DB data loads)
const localExerciseMap = {};
exerciseLibrary.forEach(e => { localExerciseMap[e.id] = e; });

// ── Program detail modal (gym programs) ──────────────────
const ProgramModal = ({ program, isEnrolled, onClose, onEnroll, onLeave }) => {
  const { t, i18n } = useTranslation('pages');
  const progName = (tmpl) => i18n.language === 'es' && tmpl.name_es ? tmpl.name_es : tmpl.name;
  const progDesc = (tmpl) => i18n.language === 'es' && tmpl.description_es ? tmpl.description_es : tmpl.description;
  const dayName = (day) => i18n.language === 'es' && day.name_es ? day.name_es : day.name;
  const [exercises, setExercises] = useState({});
  const [loading, setLoading]     = useState(true);
  const [acting, setActing]       = useState(false);

  useEffect(() => {
    const weeks = program.weeks ?? {};
    const resolveId = (ex) => (typeof ex === 'string' ? ex : ex?.id);
    const allIds = [...new Set(
      Object.values(weeks).flatMap(val => {
        if (!Array.isArray(val) || val.length === 0) return [];
        if (typeof val[0] === 'string') return val;
        return val.flatMap(d => (d.exercises ?? []).map(resolveId));
      })
    )].filter(Boolean);
    if (allIds.length === 0) { setLoading(false); return; }
    supabase.from('exercises').select('id, name, name_es').in('id', allIds)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(ex => { map[ex.id] = ex; });
        setExercises(map);
        setLoading(false);
      });
  }, [program.id]);

  const handleEnroll = async () => { setActing(true); await onEnroll(program.id); setActing(false); };
  const handleLeave  = async () => { setActing(true); await onLeave(program.id); setActing(false); };
  const weeks = program.weeks ?? {};
  const weekNums = Object.keys(weeks).map(Number).sort((a, b) => a - b);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="rounded-[20px] w-full max-w-lg md:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[17px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{progName(program)}</p>
            <p className="text-[12px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-subtle)' }}>
              <Calendar size={11} /> {t('workouts.weekProgram', { count: program.duration_weeks })}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><X size={16} style={{ color: 'var(--color-text-subtle)' }} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {program.description && <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{progDesc(program)}</p>}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.programOverview')}</p>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }} />)}</div>
            ) : weekNums.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noExercisesAssigned')}</p>
            ) : (
              <div className="space-y-3">
                {weekNums.map(wk => {
                  const rawVal = weeks[wk];
                  const days = Array.isArray(rawVal) && rawVal.length > 0 && typeof rawVal[0] === 'string'
                    ? [{ name: t('workouts.dayN', { n: 1 }), exercises: rawVal }] : (rawVal || []);
                  const resolveId = (ex) => typeof ex === 'string' ? ex : ex?.id;
                  return (
                    <div key={wk} className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 border-b" style={{ color: 'var(--color-text-subtle)', borderColor: 'var(--color-border-subtle)' }}>{t('workouts.weekN', { n: wk })}</p>
                      {days.length === 0 ? (
                        <p className="text-[12px] px-3 py-2" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p>
                      ) : (
                        <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                          {days.map((day, di) => (
                            <div key={di} className="px-3 py-2.5">
                              <p className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>{dayName(day) || t('workouts.dayN', { n: di + 1 })}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(day.exercises || []).map((ex, i) => {
                                  const exId = resolveId(ex);
                                  return <span key={i} className="text-[11px] px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-muted)' }}>{exName(exercises[exId]) ?? exId}</span>;
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="p-5 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {isEnrolled ? (
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 py-3 px-4 rounded-xl bg-[#10B981]/10">
                <CheckCircle2 size={16} className="text-[#10B981] flex-shrink-0" />
                <p className="text-[13px] font-semibold text-[#10B981]">{t('workouts.enrolled')}</p>
              </div>
              <button onClick={handleLeave} disabled={acting} className="px-4 py-3 text-[12px] font-semibold rounded-xl border hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>{t('challenges.leave')}</button>
            </div>
          ) : (
            <button onClick={handleEnroll} disabled={acting} className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors disabled:opacity-50">
              {acting ? t('workouts.enrolling') : t('workouts.startThisProgram')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Routine detail (expandable) ──────────────────────────
const RoutineDetail = ({ routineId, onEdit, onDelete, deletingId }) => {
  const { t } = useTranslation('pages');
  const [exercises, setExercises] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase
      .from('routine_exercises')
      .select('id, position, target_sets, target_reps, rest_seconds, exercises(name)')
      .eq('routine_id', routineId)
      .order('position')
      .then(({ data }) => {
        setExercises(data || []);
        setLoaded(true);
      });
  }, [routineId]);

  return (
    <div className="mx-4 mb-2 px-4 py-3 rounded-xl border" style={{ backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)' }}>
      {!loaded ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }} />)}
        </div>
      ) : exercises.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noExercisesAddedYet')}</p>
      ) : (
        <div className="space-y-1.5">
          {exercises.map((ex, i) => (
            <div key={ex.id} className="flex items-center justify-between">
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                <span style={{ color: 'var(--color-text-subtle)' }} className="mr-1.5">{i + 1}.</span>
                {ex.exercises?.name || t('workouts.unknown')}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                {ex.target_sets}×{ex.target_reps}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <Link
          to={`/session/${routineId}`}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
        >
          <Play size={12} fill="white" /> {t('workouts.startWorkout')}
        </Link>
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
          style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface-hover)' }}
        >
          <Pencil size={12} /> {t('workouts.edit')}
        </button>
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────
const Workouts = () => {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const { routines, loading, createRoutine, deleteRoutine, refetch } = useRoutines();
  const { t, i18n } = useTranslation('pages');
  const progName = (tmpl) => i18n.language === 'es' && tmpl.name_es ? tmpl.name_es : tmpl.name;
  const progDesc = (tmpl) => i18n.language === 'es' && tmpl.description_es ? tmpl.description_es : tmpl.description;
  const dayName = (day) => i18n.language === 'es' && day.name_es ? day.name_es : day.name;

  // Exercise name map — fetched from DB only when a modal opens, for bilingual support
  const [exerciseNameMap, setExerciseNameMap] = useState(localExerciseMap);
  const exerciseMapLoaded = useRef(false);
  const loadExerciseNames = useCallback(() => {
    if (exerciseMapLoaded.current) return;
    exerciseMapLoaded.current = true;
    supabase.from('exercises').select('id, name, name_es').eq('is_active', true)
      .then(({ data }) => {
        if (data?.length) {
          const map = { ...localExerciseMap };
          data.forEach(e => { map[e.id] = { ...map[e.id], ...e }; });
          setExerciseNameMap(map);
        }
      });
  }, []);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId]           = useState(null);
  const [showGenerator, setShowGenerator]     = useState(false);
  const [programCategoryFilter, setProgramCategoryFilter] = useState('All');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateWeek, setTemplateWeek] = useState('1');
  // Switch program confirmation flow: null | 'confirm' | 'final'
  const [switchStep, setSwitchStep] = useState(null);
  const [switchingProgram, setSwitchingProgram] = useState(false);
  const [expandedRoutineId, setExpandedRoutineId] = useState(null);
  const [expandedProgramRoutineId, setExpandedProgramRoutineId] = useState(null);
  const [programViewWeek, setProgramViewWeek] = useState(null);
  const [todayCompletedRoutineIds, setTodayCompletedRoutineIds] = useState(new Set());
  const [showAllRoutines, setShowAllRoutines] = useState(false);
  const [showAllMyPrograms, setShowAllMyPrograms] = useState(false);
  const [showAllGymPrograms, setShowAllGymPrograms] = useState(false);
  const [selectedMyProgram, setSelectedMyProgram] = useState(null);
  const [myProgWeek, setMyProgWeek] = useState('1');

  // Gym programs
  const [gymPrograms, setGymPrograms]       = useState([]);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [enrolledIds, setEnrolledIds]       = useState(new Set());
  const [selectedProgram, setSelectedProgram] = useState(null);

  // Generated programs
  const [generatedProgram, setGeneratedProgram] = useState(null);
  const [allPrograms, setAllPrograms]           = useState([]);
  const [programLoading, setProgramLoading]     = useState(true);
  const [onboardingData, setOnboardingData]     = useState(null);
  const [goalsMismatch, setGoalsMismatch]       = useState(false);

  // Load gym programs
  const loadPrograms = useCallback(async () => {
    if (!profile?.gym_id) return;
    setProgramsLoading(true);
    const [{ data: progs }, { data: enrolled }] = await Promise.all([
      supabase.from('gym_programs').select('id, name, description, duration_weeks, weeks, created_at').eq('gym_id', profile.gym_id).eq('is_published', true).order('created_at', { ascending: false }).limit(50),
      supabase.from('gym_program_enrollments').select('program_id').eq('profile_id', user.id).limit(50),
    ]);
    setGymPrograms(progs || []);
    setEnrolledIds(new Set((enrolled || []).map(r => r.program_id)));
    setProgramsLoading(false);
  }, [profile?.gym_id, user?.id]);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  // Scroll locking for modals
  useEffect(() => {
    if (selectedMyProgram) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedMyProgram]);
  useEffect(() => {
    if (selectedTemplate) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedTemplate]);
  useEffect(() => {
    if (selectedProgram) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [selectedProgram]);
  useEffect(() => {
    if (switchStep) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [switchStep]);
  useEffect(() => {
    if (showCreateModal) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showCreateModal]);
  useEffect(() => {
    if (showGenerator) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [showGenerator]);

  // Load generated programs + onboarding
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
    const load = async () => {
      const [{ data: allGp }, { data: ob }] = await Promise.all([
        supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('member_onboarding').select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes').eq('profile_id', user.id).maybeSingle(),
      ]);
      const programs = allGp || [];
      setAllPrograms(programs);
      const latest = programs[0] || null;
      setGeneratedProgram(latest);
      setOnboardingData(ob || null);
      setProgramLoading(false);
      if (latest && ob && new Date(latest.expires_at) > new Date()) {
        const programCreated = new Date(latest.created_at);
        const onboardingUpdated = ob.updated_at ? new Date(ob.updated_at) : new Date(ob.created_at);
        if (onboardingUpdated > programCreated) setGoalsMismatch(true);
      }
      if (latest && new Date(latest.expires_at) <= new Date() && !latest.expiry_notified) {
        supabase.from('notifications').insert({
          profile_id: user.id, gym_id: profile.gym_id, type: 'milestone',
          title: t('workouts.programEnded'),
          body: t('workouts.programEndedBody'),
        }).then(() => supabase.from('generated_programs').update({ expiry_notified: true }).eq('id', latest.id));
      }
    };
    load();
  }, [user?.id, profile?.gym_id]);

  // Fetch today's completed workout sessions
  useEffect(() => {
    if (!user?.id) return;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    supabase
      .from('workout_sessions')
      .select('routine_id')
      .eq('profile_id', user.id)
      .eq('status', 'completed')
      .gte('completed_at', todayStart.toISOString())
      .then(({ data }) => {
        setTodayCompletedRoutineIds(new Set((data || []).map(s => s.routine_id)));
      });
  }, [user?.id]);

  // Enforce single active program — deactivate all but the latest
  useEffect(() => {
    if (allPrograms.length <= 1) return;
    const activePrograms = allPrograms.filter(p => new Date(p.expires_at) > new Date());
    if (activePrograms.length <= 1) return;
    // Keep the most recent, deactivate the rest
    const [keep, ...deactivate] = activePrograms;
    const ids = deactivate.map(p => p.id);
    supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).in('id', ids).then(() => {
      setAllPrograms(prev => prev.map(p => ids.includes(p.id) ? { ...p, expires_at: new Date().toISOString() } : p));
    });
  }, [allPrograms.length]);

  // Program state
  const today = new Date();
  const programActive  = generatedProgram && new Date(generatedProgram.expires_at) > today;
  const programExpired = generatedProgram && new Date(generatedProgram.expires_at) <= today;
  const currentWeekNum = programActive ? Math.floor((today - new Date(generatedProgram.program_start)) / (7 * 86400000)) + 1 : 0;
  const isWeekA = currentWeekNum % 2 === 1;

  const thisWeekRoutines = programActive
    ? routines.filter(r => {
        if (!r.name.startsWith('Auto:')) return false;
        if (isWeekA) return r.name.endsWith(' A') || (!r.name.endsWith(' B') && routines.filter(x => x.name === r.name + ' B').length === 0);
        return r.name.endsWith(' B');
      })
    : [];

  // Handlers
  const handleEnroll = async (programId) => {
    await supabase.from('gym_program_enrollments').insert({ program_id: programId, profile_id: user.id, gym_id: profile.gym_id });
    setEnrolledIds(prev => new Set([...prev, programId]));
  };
  const handleLeave = async (programId) => {
    await supabase.from('gym_program_enrollments').delete().eq('program_id', programId).eq('profile_id', user.id);
    setEnrolledIds(prev => { const s = new Set(prev); s.delete(programId); return s; });
  };
  const handleSaveCreateModal = async ({ name, exercises }) => {
    const routine = await createRoutine(name);
    if (exercises?.length > 0) {
      const rows = exercises.map((ex, i) => ({
        routine_id: routine.id, exercise_id: ex.id, position: i + 1,
        target_sets: ex.sets, target_reps: ex.reps, rest_seconds: ex.restSeconds,
      }));
      await supabase.from('routine_exercises').insert(rows);
      refetch();
      navigate(`/session/${routine.id}`);
    } else {
      refetch();
      navigate(`/workouts/${routine.id}/edit`);
    }
  };
  const handleDelete = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
    // Prevent deleting routines that belong to the active program
    const routine = routines.find(r => r.id === id);
    if (programActive && routine?.name?.startsWith('Auto:')) {
      alert(t('workouts.deleteRoutineActiveProgram'));
      return;
    }
    if (!confirm(t('workouts.deleteRoutineConfirm'))) return;
    setDeletingId(id);
    try { await deleteRoutine(id); } catch (err) { logger.error(err); }
    finally { setDeletingId(null); }
  };

  // ── Template program enrollment ──
  const handleStartTemplate = () => {
    // If user has an active program, ask for confirmation first
    if (programActive) {
      setSwitchStep('confirm');
    } else {
      // No active program — go straight to enrollment
      enrollInTemplate();
    }
  };

  const enrollInTemplate = async () => {
    if (!selectedTemplate || !user?.id || !profile?.gym_id) return;
    setSwitchingProgram(true);

    try {
      // 1. Deactivate current program (don't delete — just expire it)
      if (generatedProgram && new Date(generatedProgram.expires_at) > new Date()) {
        await supabase.from('generated_programs')
          .update({ expires_at: new Date().toISOString() })
          .eq('id', generatedProgram.id);
      }

      // 2. Delete old Auto: routines (and their exercises + schedule entries)
      const { data: oldAutoRoutines } = await supabase
        .from('routines')
        .select('id')
        .eq('created_by', user.id)
        .like('name', 'Auto:%');

      if (oldAutoRoutines?.length > 0) {
        const oldIds = oldAutoRoutines.map(r => r.id);
        // Delete routine_exercises for these routines
        await supabase.from('routine_exercises').delete().in('routine_id', oldIds);
        // Delete workout_schedule entries pointing to these routines
        await supabase.from('workout_schedule').delete().in('routine_id', oldIds).then(() => {}).catch(() => {});
        // Delete the routines themselves
        await supabase.from('routines').delete().in('id', oldIds);
        logger.log(`Cleaned up ${oldIds.length} old Auto: routines`);
      }

      // 3. Create a generated_programs entry for the template
      const startDate = new Date();
      const expiresAt = new Date(startDate);
      expiresAt.setDate(expiresAt.getDate() + selectedTemplate.durationWeeks * 7);

      const insertData = {
        profile_id: user.id,
        gym_id: profile.gym_id,
        split_type: selectedTemplate.id.replace('tmpl_', ''),
        program_start: startDate.toISOString(),
        expires_at: expiresAt.toISOString(),
        routines_a_count: selectedTemplate.daysPerWeek,
      };

      // Try with template columns first, fall back without them
      let insertRes = await supabase.from('generated_programs').insert({
        ...insertData,
        template_id: selectedTemplate.id,
        template_weeks: selectedTemplate.weeks,
      }).select().single();

      if (insertRes.error) {
        logger.warn('Template columns not available, inserting without them:', insertRes.error.message);
        insertRes = await supabase.from('generated_programs').insert(insertData).select().single();
      }

      if (insertRes.error) {
        throw new Error('Failed to create program entry: ' + insertRes.error.message);
      }

      logger.log('Created program:', insertRes.data?.id);

      // 3. Create routines from the first week's workouts
      const firstWeek = selectedTemplate.weeks['1'] || [];
      const createdRoutineIds = [];

      for (let i = 0; i < firstWeek.length; i++) {
        const day = firstWeek[i];
        const routineName = `Auto: ${day.name}`;

        let routine;
        try {
          routine = await createRoutine(routineName);
        } catch (err) {
          logger.error('Failed to create routine:', routineName, err);
          continue;
        }

        if (!routine?.id) {
          logger.error('No routine ID returned for:', routineName);
          continue;
        }

        createdRoutineIds.push(routine.id);
        logger.log(`Created routine ${i + 1}/${firstWeek.length}: ${routineName} (${routine.id})`);

        if (day.exercises?.length > 0) {
          const rows = day.exercises.map((ex, pos) => ({
            routine_id: routine.id,
            exercise_id: ex.id,
            position: pos + 1,
            target_sets: ex.sets || 3,
            target_reps: '8-12',
            rest_seconds: ex.rest_seconds || 90,
          }));
          const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
          if (exErr) logger.error('Failed to insert exercises for routine:', routineName, exErr);
        }

        // Assign to workout_schedule (day 0=Sun, 1=Mon, ...)
        // Map first routine to Monday (1), second to Tuesday (2), etc.
        const dayOfWeek = (i + 1) % 7;
        const { error: schedErr } = await supabase.from('workout_schedule').upsert({
          profile_id: user.id,
          gym_id: profile.gym_id,
          day_of_week: dayOfWeek,
          routine_id: routine.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'profile_id,day_of_week' });
        if (schedErr) logger.warn('Schedule upsert failed (table may not exist):', schedErr.message);
      }

      logger.log(`Enrollment complete: ${createdRoutineIds.length} routines created`);

      // 4. Refresh state
      const { data: allGp } = await supabase.from('generated_programs')
        .select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
      const programs = allGp || [];
      setAllPrograms(programs);
      setGeneratedProgram(programs[0] || null);
      await refetch();

      // Close everything
      setSwitchStep(null);
      setSelectedTemplate(null);
    } catch (err) {
      logger.error('Failed to enroll in template:', err);
      alert(t('workouts.somethingWentWrong') + err.message);
    } finally {
      setSwitchingProgram(false);
    }
  };

  return (
    <>
    <div className="mx-auto w-full max-w-[680px] md:max-w-4xl px-4 pt-4 pb-28 md:pb-12">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8" data-tour="tour-workouts-page">
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.title')}</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/exercises"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            <BookOpen size={14} />
            {t('workouts.library')}
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-colors"
            style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
          >
            <Plus size={14} />
            {t('workouts.new')}
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 1: CURRENT PROGRAM — Hero
         ════════════════════════════════════════════════════════ */}
      {programLoading && (
        <section className="mb-10">
          <div className="h-3 w-32 rounded animate-pulse mb-3" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
          <div className="rounded-2xl p-6 animate-pulse" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
            <div className="h-6 w-40 rounded mb-4" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            <div className="h-1 w-full rounded-full mb-6" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            <div className="space-y-2">
              <div className="h-14 rounded-2xl" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
              <div className="h-14 rounded-2xl" style={{ backgroundColor: 'var(--color-surface-hover)' }} />
            </div>
          </div>
        </section>
      )}
      {!programLoading && programActive && (() => {
        const viewWeek = programViewWeek || currentWeekNum;
        const isViewingCurrentWeek = viewWeek === currentWeekNum;
        // For non-current weeks, show template exercises if available
        const templateWeeks = generatedProgram?.template_weeks || null;
        const viewWeekDays = (!isViewingCurrentWeek && templateWeeks) ? (templateWeeks[String(viewWeek)] || []) : null;

        return (
        <section className="mb-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.currentProgram')}</p>
          <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--color-bg-card)' }}>
            {/* Title & progress with week navigator */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <button onClick={() => setProgramViewWeek(w => Math.max(1, (w || currentWeekNum) - 1))} disabled={viewWeek <= 1} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}><ChevronLeft size={16} /></button>
                <div>
                  <h2 className="text-[20px] font-semibold tracking-tight leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                    {t('workouts.weekXOfY', { current: Math.min(viewWeek, 6), total: 6 })}
                  </h2>
                  <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                    {isViewingCurrentWeek ? t('workouts.currentWeekRoutine', { variant: isWeekA ? 'A' : 'B' }) : ''}
                  </p>
                </div>
                <button onClick={() => setProgramViewWeek(w => Math.min(6, (w || currentWeekNum) + 1))} disabled={viewWeek >= 6} className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-20" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}><ChevronRight size={16} /></button>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-[#10B981]/10 flex items-center justify-center">
                <Zap size={18} className="text-[#10B981]" />
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-6">
              <div className="w-full h-1 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                <div
                  className="h-full rounded-full bg-[#10B981] transition-all"
                  style={{ width: `${Math.min((currentWeekNum / 6) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Week content */}
            {isViewingCurrentWeek ? (
              <>
                {/* This week's routines (expandable) */}
                {thisWeekRoutines.length > 0 && (
                  <div className="space-y-2">
                    {thisWeekRoutines.map(routine => {
                      const isExpanded = expandedProgramRoutineId === routine.id;
                      return (
                        <div key={routine.id}>
                          <button
                            type="button"
                            onClick={() => setExpandedProgramRoutineId(isExpanded ? null : routine.id)}
                            className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left"
                            style={{ backgroundColor: 'var(--color-surface-hover)' }}
                          >
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                              <Dumbbell size={15} style={{ color: 'var(--color-text-muted)' }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{routine.name.replace('Auto: ', '')}</p>
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{routine.exerciseCount} {t('workouts.exercises')}</p>
                            </div>
                            <ChevronRight size={16} className={`flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
                          </button>
                          {isExpanded && (
                            <RoutineDetail routineId={routine.id} onEdit={() => navigate(`/workouts/${routine.id}/edit`)} onDelete={(e) => handleDelete(e, routine.id)} deletingId={deletingId} />
                          )}
                        </div>
                      );
                    })}
                    {generatedProgram?.cardio_days?.daysPerWeek > 0 && (
                      <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                          <Heart size={15} style={{ color: 'var(--color-text-muted)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.activeRecovery')}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{generatedProgram.cardio_days.description}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </>
            ) : (
              /* Non-current week: show template exercises */
              viewWeekDays && viewWeekDays.length > 0 ? (
                <div className="space-y-2">
                  {viewWeekDays.map((day, di) => {
                    const dayExpanded = expandedProgramRoutineId === `week-${viewWeek}-${di}`;
                    return (
                      <div key={di}>
                        <button
                          type="button"
                          onClick={() => setExpandedProgramRoutineId(dayExpanded ? null : `week-${viewWeek}-${di}`)}
                          className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left"
                          style={{ backgroundColor: 'var(--color-surface-hover)' }}
                        >
                          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                            <Dumbbell size={15} style={{ color: 'var(--color-text-muted)' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-[14px] truncate" style={{ color: 'var(--color-text-primary)' }}>{dayName(day) || t('workouts.dayN', { n: di + 1 })}</p>
                            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{(day.exercises || []).length} {t('workouts.exercises')}</p>
                          </div>
                          <ChevronRight size={16} className={`flex-shrink-0 transition-transform duration-200 ${dayExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--color-text-subtle)' }} />
                        </button>
                        {dayExpanded && (
                          <div className="mx-4 mb-2 px-4 py-3 rounded-xl border" style={{ backgroundColor: 'var(--color-surface-hover)', borderColor: 'var(--color-border-subtle)' }}>
                            <div className="space-y-1.5">
                              {(day.exercises || []).map((ex, i) => {
                                const exId = typeof ex === 'string' ? ex : ex?.id;
                                return (
                                  <div key={i} className="flex items-center justify-between">
                                    <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                                      <span className="mr-1.5" style={{ color: 'var(--color-text-subtle)' }}>{i + 1}.</span>
                                      {exName(exerciseNameMap[exId]) ?? exId}
                                    </p>
                                    {ex.sets && <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>{ex.sets} {t('workouts.sets')}</p>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl py-6 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noPreviewAvailable')}</p>
                </div>
              )
            )}
          </div>
        </section>
        );
      })()}

      {/* ── No program / expired — two options ──────────────── */}
      {!programLoading && !programActive && (
        <section className="mb-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
            {programExpired ? t('workouts.programEndedWhatsNext') : t('workouts.getStarted')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setShowGenerator(true)}
              className="text-left rounded-2xl bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/[0.02] p-5 active:scale-[0.98] transition-transform duration-150"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mb-4">
                <Zap size={18} className="text-[#10B981]" />
              </div>
              <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.customProgram')}</p>
              <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.builtAroundGoals')}</p>
            </button>
            <button
              onClick={() => {
                const el = document.getElementById('discover-programs');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-left rounded-2xl p-5 active:scale-[0.98] transition-transform duration-150"
              style={{ backgroundColor: 'var(--color-surface-hover)' }}
            >
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                <BookOpen size={18} style={{ color: 'var(--color-text-subtle)' }} />
              </div>
              <p className="text-[14px] font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.browsePrograms')}</p>
              <p className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.provenPrograms')}</p>
            </button>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════
          SECTION 2: MY ROUTINES
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.myRoutines')}</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-[11px] font-medium transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('workouts.addNew')}
          </button>
        </div>

        {loading ? (
          <Skeleton variant="list-item" count={3} />
        ) : routines.length === 0 ? (
          <div className="rounded-2xl py-12 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
            <Dumbbell size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-subtle)' }} />
            <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noRoutinesYet')}</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 px-4 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
              style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }}
            >
              {t('workouts.createRoutine')}
            </button>
          </div>
        ) : (() => {
          const visible = showAllRoutines ? routines : routines.slice(0, 3);
          const hiddenCount = routines.length - 3;
          return (
            <>
              <div className="space-y-1">
                {visible.map(routine => {
                  const isExpanded = expandedRoutineId === routine.id;
                  return (
                    <div key={routine.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setExpandedRoutineId(isExpanded ? null : routine.id)}
                        className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left"
                        style={isExpanded ? { backgroundColor: 'var(--color-surface-hover)' } : undefined}
                      >
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                          <Dumbbell size={16} style={{ color: 'var(--color-text-subtle)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--color-text-primary)' }}>{routine.name}</p>
                          <p className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--color-text-subtle)' }}>
                            <span>{routine.exerciseCount} {t('workouts.exercises')}</span>
                            <span style={{ color: 'var(--color-border-subtle)' }}>·</span>
                            <span>{timeAgo(routine.lastPerformedAt)}</span>
                          </p>
                        </div>
                      </button>
                      {/* Delete button on card — hidden for active program routines */}
                      {!(programActive && routine.name?.startsWith('Auto:')) && (
                      <button
                        onClick={(e) => handleDelete(e, routine.id)}
                        disabled={deletingId === routine.id}
                        className="absolute top-2.5 right-2.5 w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                        style={{ opacity: 1 }}
                      >
                        <Trash2 size={13} />
                      </button>
                      )}
                      {isExpanded && (
                        <RoutineDetail routineId={routine.id} onEdit={() => navigate(`/workouts/${routine.id}/edit`)} onDelete={(e) => handleDelete(e, routine.id)} deletingId={deletingId} />
                      )}
                    </div>
                  );
                })}
              </div>
              {!showAllRoutines && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllRoutines(true)}
                  className="w-full mt-2 py-3 rounded-2xl text-[12px] font-medium transition-colors duration-200"
                  style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.showAllRoutines', { count: routines.length })}
                </button>
              )}
              {showAllRoutines && routines.length > 3 && (
                <button
                  onClick={() => setShowAllRoutines(false)}
                  className="w-full mt-2 py-3 rounded-2xl text-[12px] font-medium transition-colors duration-200"
                  style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.showLess')}
                </button>
              )}
            </>
          );
        })()}
      </section>

      {/* ════════════════════════════════════════════════════════
          SECTION 3: MY PROGRAMS
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.myPrograms')}</p>
          <button
            onClick={() => setShowGenerator(true)}
            className="text-[11px] font-medium transition-colors"
            style={{ color: 'var(--color-text-subtle)' }}
          >
            {t('workouts.newProgram')}
          </button>
        </div>

        {/* Goals mismatch alert */}
        {goalsMismatch && programActive && (
          <div className="rounded-2xl bg-amber-500/[0.06] p-4 mb-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.goalsChanged')}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.goalsChangedDesc')}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setShowGenerator(true)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#10B981] text-white">
                  {t('workouts.newProgramBtn')}
                </button>
                <button onClick={() => setGoalsMismatch(false)} className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('workouts.dismiss')}
                </button>
              </div>
            </div>
          </div>
        )}

        {allPrograms.length === 0 ? (
          <div className="rounded-2xl py-12 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
            <Zap size={28} className="mx-auto mb-3" style={{ color: 'var(--color-text-subtle)' }} />
            <p className="text-[14px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.noProgramsYet')}</p>
            <p className="text-[11px] mt-1 mb-4" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.createOneTailored')}</p>
            <button
              onClick={() => setShowGenerator(true)}
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold bg-[#10B981] text-white hover:bg-[#0EA572] transition-colors"
            >
              {t('workouts.createYourFirstProgram')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {(showAllMyPrograms ? allPrograms : allPrograms.slice(0, 3)).map(prog => {
              const isActive = new Date(prog.expires_at) > new Date();
              const weekNum = isActive
                ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, 6) : 6;
              const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), 42);
              const progress = Math.round((daysElapsed / 42) * 100);

              return (
                <div key={prog.id} className="relative rounded-2xl transition-colors duration-200 group" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <button onClick={() => { loadExerciseNames(); setSelectedMyProgram(prog); setMyProgWeek('1'); }} className="w-full text-left p-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <p className="text-[15px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                          {t('workouts.programSuffix', { name: prog.split_type ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Custom' })}
                        </p>
                        {isActive && (
                          <span className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 px-2 py-0.5 rounded-full flex-shrink-0">{t('workouts.active')}</span>
                        )}
                        {!isActive && (
                          <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${progress >= 95 ? '' : 'text-amber-400 bg-amber-500/10'}`} style={progress >= 95 ? { color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' } : undefined}>
                            {progress >= 95 ? t('workouts.completed') : t('workouts.unfinished')}
                          </span>
                        )}
                      </div>
                      <ChevronRight size={16} className="transition-colors flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                    </div>
                    <div className="flex items-center gap-3 text-[11px] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
                      <span className="flex items-center gap-1"><Calendar size={10} /> {t('workouts.sixWeeks')}</span>
                      <span>{isActive ? t('workouts.weekXOfY', { current: weekNum, total: 6 }) : t('workouts.finished')}</span>
                      {prog.routines_a_count > 0 && <span>{t('workouts.routinesCount', { count: prog.routines_a_count })}</span>}
                    </div>
                    <div className="w-full h-1 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                      <div
                        className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : ''}`}
                        style={{ width: `${progress}%`, ...(!isActive ? { backgroundColor: 'var(--color-text-subtle)' } : {}) }}
                      />
                    </div>
                  </button>
                  {/* Delete program */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(t('workouts.removeProgramConfirm'))) return;
                      if (isActive) {
                        await supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).eq('id', prog.id);
                      } else {
                        await supabase.from('generated_programs').delete().eq('id', prog.id);
                      }
                      const { data: allGp } = await supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
                      const programs = allGp || [];
                      setAllPrograms(programs);
                      setGeneratedProgram(programs[0] || null);
                    }}
                    className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
                    style={{ opacity: 1 }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
            {!showAllMyPrograms && allPrograms.length > 3 && (
              <button
                onClick={() => setShowAllMyPrograms(true)}
                className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold transition-colors duration-200"
                style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
              >
                {t('workouts.showAllPrograms', { count: allPrograms.length })}
              </button>
            )}
            {showAllMyPrograms && allPrograms.length > 3 && (
              <button
                onClick={() => setShowAllMyPrograms(false)}
                className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold transition-colors duration-200"
                style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
              >
                {t('workouts.showLess')}
              </button>
            )}
          </div>
        )}

        {/* Gym Programs */}
        {gymPrograms.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.fromYourGym')}</p>
            <div className="space-y-1.5">
              {(showAllGymPrograms ? gymPrograms : gymPrograms.slice(0, 3)).map(prog => {
                const enrolled = enrolledIds.has(prog.id);
                return (
                  <button
                    key={prog.id}
                    onClick={() => setSelectedProgram(prog)}
                    className="w-full text-left flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 group"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                      <Dumbbell size={16} className={enrolled ? 'text-[#10B981]' : ''} style={!enrolled ? { color: 'var(--color-text-subtle)' } : undefined} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{prog.name}</p>
                        {enrolled && (
                          <span className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0">
                            <CheckCircle2 size={8} /> {t('workouts.enrolled')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.weeksCount', { count: prog.duration_weeks })}</p>
                    </div>
                    <ChevronRight size={16} className="transition-colors flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />
                  </button>
                );
              })}
              {!showAllGymPrograms && gymPrograms.length > 3 && (
                <button
                  onClick={() => setShowAllGymPrograms(true)}
                  className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold transition-colors duration-200"
                  style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.showAllGymPrograms', { count: gymPrograms.length })}
                </button>
              )}
              {showAllGymPrograms && gymPrograms.length > 3 && (
                <button
                  onClick={() => setShowAllGymPrograms(false)}
                  className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold transition-colors duration-200"
                  style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}
                >
                  {t('workouts.showLess')}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════
          SECTION 4: DISCOVER PROGRAMS
         ════════════════════════════════════════════════════════ */}
      <section id="discover-programs" className="mb-6">
        {/* Visual separator */}
        <div className="h-px mb-10" style={{ background: 'linear-gradient(to right, transparent, var(--color-border-subtle), transparent)' }} />

        <div className="mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-1" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.discover')}</p>
          <h2 className="text-[20px] font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.programs')}</h2>
        </div>

        {/* Category filter chips */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-5 -mx-1 px-1">
          {PROGRAM_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setProgramCategoryFilter(cat)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-medium transition-all ${
                programCategoryFilter === cat ? '' : ''
              }`}
              style={programCategoryFilter === cat
                ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' }
                : { color: 'var(--color-text-subtle)' }
              }
            >
              {t(`workouts.programCategories.${cat}`)}
            </button>
          ))}
        </div>

        {/* Program cards grid */}
        <div className="grid grid-cols-2 gap-4">
          {programTemplates
            .filter(p => programCategoryFilter === 'All' || p.category === programCategoryFilter)
            .map(tmpl => (
              <button
                key={tmpl.id}
                onClick={() => { loadExerciseNames(); setSelectedTemplate(tmpl); setTemplateWeek('1'); }}
                className="relative text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-150 group"
                style={{ aspectRatio: '3 / 4' }}
              >
                {/* Background image */}
                <div className="absolute inset-0">
                  {tmpl.image && (
                    <img
                      src={tmpl.image}
                      alt={progName(tmpl)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom right, var(--color-bg-deep), var(--color-bg-primary))', zIndex: tmpl.image ? -1 : 0 }} />
                </div>

                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/10" />

                {/* Level badge — forced colors because it's on an image */}
                <div className="absolute top-3 left-3 z-10">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-sm"
                    style={{
                      backgroundColor: tmpl.level === 'Beginner' ? 'rgba(16,185,129,0.2)' : tmpl.level === 'Advanced' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.1)',
                      color: tmpl.level === 'Beginner' ? '#6EE7B7' : tmpl.level === 'Advanced' ? '#FCA5A5' : 'rgba(255,255,255,0.7)',
                    }}>
                    {t(`workouts.programLevels.${tmpl.level}`)}
                  </span>
                </div>

                {/* Content at bottom — forced white because it's on top of a dark gradient over an image */}
                <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
                  <p className="text-[14px] font-bold leading-tight" style={{ color: '#FFFFFF', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>{progName(tmpl)}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('workouts.durationWk', { count: tmpl.durationWeeks })}</span>
                    <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                    <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('workouts.xPerWeek', { count: tmpl.daysPerWeek })}</span>
                  </div>
                </div>
              </button>
            ))}
        </div>
      </section>

    </div>

    {/* ── My Program Detail Modal ───────────────────────── */}
    {selectedMyProgram && (() => {
      const prog = selectedMyProgram;
      const isActive = new Date(prog.expires_at) > new Date();
      const weekNum = isActive ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, 6) : 6;
      const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), 42);
      const progress = Math.round((daysElapsed / 42) * 100);
      const tmplWeeks = prog.template_weeks || null;
      const tmpl = prog.template_id ? programTemplates.find(t => t.id === prog.template_id) : null;
      const weekKeys = tmplWeeks ? Object.keys(tmplWeeks).sort((a, b) => Number(a) - Number(b)) : [];
      const weekIdx = weekKeys.indexOf(myProgWeek);
      const currentWeekDays = tmplWeeks ? (tmplWeeks[myProgWeek] || []) : [];
      const canPrev = weekIdx > 0;
      const canNext = weekIdx < weekKeys.length - 1;
      const programRoutines = isActive ? routines.filter(r => r.name.startsWith('Auto:')) : [];
      const progName = prog.split_type ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Custom';

      return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setSelectedMyProgram(null)} />
          <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}>
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button onClick={() => setSelectedMyProgram(null)} className="absolute right-4 top-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors" style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}>
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Header */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'text-[#10B981] bg-[#10B981]/10' : ''}`} style={!isActive ? { color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' } : undefined}>
                    {isActive ? t('workouts.active') : t('workouts.completed')}
                  </span>
                </div>
                <h2 className="text-[24px] font-bold tracking-tight leading-tight" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.programSuffix', { name: progName })}</h2>
                {tmpl?.description && <ExpandableText text={progDesc(tmpl)} />}
              </div>

              {/* Progress */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{isActive ? t('workouts.weekXOfY', { current: weekNum, total: 6 }) : t('workouts.programFinished')}</span>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : ''}`} style={{ width: `${progress}%`, ...(!isActive ? { backgroundColor: 'var(--color-text-subtle)' } : {}) }} />
                </div>
              </div>

              {/* This week's routines (if active) */}
              {isActive && programRoutines.length > 0 && (
                <div className="mb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.thisWeeksRoutines')}</p>
                  <div className="space-y-2">
                    {programRoutines.map(r => (
                      <Link key={r.id} to={`/session/${r.id}`} onClick={() => setSelectedMyProgram(null)} className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors group" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><Dumbbell size={14} style={{ color: 'var(--color-text-muted)' }} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{r.name.replace('Auto: ', '')}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{r.exerciseCount} {t('workouts.exercises')}</p>
                        </div>
                        <ChevronRight size={14} className="transition-colors" style={{ color: 'var(--color-text-subtle)' }} />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Week-by-week breakdown (if template_weeks exists) */}
              {weekKeys.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.programOverview')}</p>
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => canPrev && setMyProgWeek(weekKeys[weekIdx - 1])} disabled={!canPrev} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors" style={canPrev ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}>
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.weekXOfY', { current: myProgWeek, total: weekKeys.length })}</span>
                    <button onClick={() => canNext && setMyProgWeek(weekKeys[weekIdx + 1])} disabled={!canNext} className="w-8 h-8 rounded-full flex items-center justify-center transition-colors" style={canNext ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentWeekDays.length === 0 ? (
                      <div className="rounded-xl py-6 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}><p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p></div>
                    ) : currentWeekDays.map((day, di) => (
                      <div key={di} className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{dayName(day) || t('workouts.dayN', { n: di + 1 })}</p>
                        <div className="space-y-1.5">
                          {(day.exercises || []).map((ex, i) => {
                            const exId = typeof ex === 'string' ? ex : ex?.id;
                            const sets = typeof ex === 'object' ? ex.sets : null;
                            const reps = typeof ex === 'object' ? (ex.reps || ex.target_reps) : null;
                            const rest = typeof ex === 'object' ? ex.rest_seconds : null;
                            return (
                              <div key={i} className="flex items-center justify-between">
                                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                                  <span className="mr-1.5" style={{ color: 'var(--color-text-subtle)' }}>{i + 1}.</span>
                                  {exName(exerciseNameMap[exId]) ?? exId}
                                </p>
                                <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                                  {sets && <span>{sets} {t('workouts.sets')}</span>}
                                  {reps && <span>x {reps}</span>}
                                  {rest && <span style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.sRest', { seconds: rest })}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed / Unfinished state */}
              {!isActive && (() => {
                const wasFullyCompleted = progress >= 95;
                return (
                  <div className="mt-6 text-center">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${wasFullyCompleted ? 'bg-[#10B981]/10' : 'bg-amber-500/10'}`}>
                      {wasFullyCompleted
                        ? <CheckCircle2 size={28} className="text-[#10B981]" />
                        : <AlertTriangle size={28} className="text-amber-400" />
                      }
                    </div>
                    <p className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                      {wasFullyCompleted ? t('workouts.programCompleted') : t('workouts.programEndedEarly')}
                    </p>
                    <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                      {wasFullyCompleted
                        ? t('workouts.allProgressSaved')
                        : t('workouts.endedAtProgress', { progress })
                      }
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* CTA */}
            <div className="shrink-0 px-6 pt-4 pb-5" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), var(--color-bg-secondary), transparent)' }}>
              {isActive ? (
                <button
                  onClick={async () => {
                    await supabase.from('generated_programs').update({ expires_at: new Date().toISOString() }).eq('id', prog.id);
                    setSelectedMyProgram(null);
                    // Refresh programs
                    const { data: allGp } = await supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20);
                    const programs = allGp || [];
                    setAllPrograms(programs);
                    setGeneratedProgram(programs[0] || null);
                  }}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 transition-colors"
                >
                  {t('workouts.removeProgram')}
                </button>
              ) : (
                <button onClick={() => { setSelectedMyProgram(null); const el = document.getElementById('discover-programs'); el?.scrollIntoView({ behavior: 'smooth' }); }} className="w-full py-4 rounded-2xl font-bold text-[15px] transition-colors" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface-hover)' }}>
                  {t('workouts.browseNewPrograms')}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    })()}

    {/* ── Modals ─────────────────────────────────────────── */}
    {selectedProgram && (
      <ProgramModal
        program={selectedProgram}
        isEnrolled={enrolledIds.has(selectedProgram.id)}
        onClose={() => setSelectedProgram(null)}
        onEnroll={handleEnroll}
        onLeave={handleLeave}
      />
    )}

    {/* ── Featured Program Detail Modal ──────────────────── */}
    {selectedTemplate && (() => {
      const weekKeys = Object.keys(selectedTemplate.weeks).sort((a, b) => Number(a) - Number(b));
      const weekIdx = weekKeys.indexOf(templateWeek);
      const currentWeekDays = selectedTemplate.weeks[templateWeek] || [];
      const canPrev = weekIdx > 0;
      const canNext = weekIdx < weekKeys.length - 1;

      return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setSelectedTemplate(null)} />
          <div
            className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] overflow-hidden"
            style={{ backgroundColor: 'var(--color-bg-secondary)', paddingBottom: 'var(--safe-area-bottom, env(safe-area-inset-bottom))' }}
          >
            {/* Handle + Close */}
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }} />
              <button
                onClick={() => setSelectedTemplate(null)}
                className="absolute right-4 top-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-subtle)' }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Hero */}
              <div className="mb-6">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--color-text-subtle)' }}>
                  {t(`workouts.programLevels.${selectedTemplate.level}`)} · {t(`workouts.programCategories.${selectedTemplate.category}`)}
                </span>
                <h2 className="text-[28px] font-bold tracking-tight leading-tight mt-2" style={{ color: 'var(--color-text-primary)' }}>
                  {progName(selectedTemplate)}
                </h2>
                <ExpandableText text={progDesc(selectedTemplate)} />
              </div>

              {/* Meta pills */}
              <div className="flex items-center gap-2 mb-8">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <Activity size={11} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.xPerWeek', { count: selectedTemplate.daysPerWeek })}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <Calendar size={11} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.weeksCount', { count: selectedTemplate.durationWeeks })}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <Target size={11} style={{ color: 'var(--color-text-subtle)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-subtle)' }}>{t(`workouts.programGoals.${selectedTemplate.goal}`)}</span>
                </div>
              </div>

              {/* Week navigator */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2.5">
                  <button
                    onClick={() => canPrev && setTemplateWeek(weekKeys[weekIdx - 1])}
                    disabled={!canPrev}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                    style={canPrev ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="text-center">
                    <span className="text-[16px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.weekXOfY', { current: templateWeek, total: weekKeys.length })}</span>
                  </div>
                  <button
                    onClick={() => canNext && setTemplateWeek(weekKeys[weekIdx + 1])}
                    disabled={!canNext}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                    style={canNext ? { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-text-primary)' } : { color: 'var(--color-border-subtle)' }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="h-[2px] rounded-full" style={{ backgroundColor: 'var(--color-border-subtle)' }}>
                  <div
                    className="h-full rounded-full bg-[#10B981]/60 transition-all duration-300"
                    style={{ width: `${((weekIdx + 1) / weekKeys.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Workout day cards — pad to 7 days with rest days */}
              <div className="space-y-3">
                {(() => {
                  const DAY_LABELS = [t('days.monday', { ns: 'common' }), t('days.tuesday', { ns: 'common' }), t('days.wednesday', { ns: 'common' }), t('days.thursday', { ns: 'common' }), t('days.friday', { ns: 'common' }), t('days.saturday', { ns: 'common' }), t('days.sunday', { ns: 'common' })];
                  // Build a full 7-day view: workout days first, then rest days fill remaining
                  const fullWeek = DAY_LABELS.map((dayLabel, i) => {
                    const workoutDay = currentWeekDays[i];
                    if (workoutDay) return { ...workoutDay, dayLabel, isRest: false };
                    return { dayLabel, isRest: true, name: dayLabel, exercises: [] };
                  });

                  if (currentWeekDays.length === 0) {
                    return (
                      <div className="rounded-2xl py-8 text-center" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                        <p className="text-[13px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restWeek')}</p>
                      </div>
                    );
                  }

                  return fullWeek.map((day, di) => (
                    <div key={di} className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                      <div className="flex items-center gap-2.5 mb-1">
                        <h4 className="text-[14px] font-semibold" style={{ color: day.isRest ? 'var(--color-text-subtle)' : 'var(--color-text-primary)' }}>
                          {day.isRest ? day.dayLabel : dayName(day)}
                        </h4>
                        {!day.isRest && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--color-text-subtle)', backgroundColor: 'var(--color-surface-hover)' }}>
                            {day.exercises.length}
                          </span>
                        )}
                      </div>
                      {day.isRest ? (
                        <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('workouts.restDay')}</p>
                      ) : (
                        <div className="space-y-1 mt-2">
                          {day.exercises.map((ex, ei) => (
                            <p key={ei} className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
                              {exName(exerciseNameMap[ex.id]) || ex.id}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>

              {/* Equipment */}
              {selectedTemplate.equipment && (
                <p className="text-[10px] mt-5" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('workouts.equipmentLabel', { list: selectedTemplate.equipment.join(' · ') })}
                </p>
              )}
            </div>

            {/* CTA */}
            <div className="shrink-0 px-6 pt-4 pb-5" style={{ background: 'linear-gradient(to top, var(--color-bg-secondary), var(--color-bg-secondary), transparent)' }}>
              <button
                onClick={handleStartTemplate}
                disabled={switchingProgram}
                className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.98] transition-all text-white bg-[#10B981] hover:bg-[#0EA572] disabled:opacity-50"
              >
                {switchingProgram ? t('workouts.settingUp') : t('workouts.startThisProgram')}
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {showCreateModal && (
      <CreateRoutineModal
        onClose={() => setShowCreateModal(false)}
        onSave={handleSaveCreateModal}
      />
    )}

    {showGenerator && (
      <GenerateWorkoutModal
        onboarding={onboardingData}
        onClose={() => setShowGenerator(false)}
        onGenerated={() => {
          if (user?.id) {
            supabase.from('generated_programs').select('id, profile_id, split_type, program_start, expires_at, routines_a_count, created_at, template_id, template_weeks, expiry_notified').eq('profile_id', user.id).order('created_at', { ascending: false }).limit(20)
              .then(({ data }) => {
                const programs = data || [];
                setAllPrograms(programs);
                setGeneratedProgram(programs[0] || null);
                setGoalsMismatch(false);
              });
          }
          refetch();
        }}
      />
    )}

    {/* ── Switch Program Confirmation Dialog ────────────── */}
    {switchStep && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => setSwitchStep(null)}>
        <div className="rounded-[20px] w-full max-w-sm p-6 border" style={{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
          {switchStep === 'confirm' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={22} className="text-amber-400" />
              </div>
              <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.switchPrograms')}</h3>
              <p className="text-[13px] text-center leading-relaxed mb-6" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.switchProgramsDesc', { name: selectedTemplate ? progName(selectedTemplate) : '' })}
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={() => setSwitchStep('final')}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
                >
                  {t('workouts.yesSwitchProgram')}
                </button>
                <button
                  onClick={() => setSwitchStep(null)}
                  className="w-full py-3 rounded-2xl font-medium text-[13px] transition-colors"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {t('workouts.keepCurrentProgram')}
                </button>
              </div>
            </>
          ) : switchStep === 'final' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={22} className="text-red-400" />
              </div>
              <h3 className="text-[18px] font-bold text-center mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('workouts.areYouSure')}</h3>
              <p className="text-[13px] text-center leading-relaxed mb-2" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.switchConfirmDesc', { name: selectedTemplate ? progName(selectedTemplate) : '' })}
              </p>
              <p className="text-[11px] text-center mb-6" style={{ color: 'var(--color-text-subtle)' }}>
                {t('workouts.switchConfirmNote')}
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={enrollInTemplate}
                  disabled={switchingProgram}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {switchingProgram ? t('workouts.switching') : t('workouts.confirmAndSwitch')}
                </button>
                <button
                  onClick={() => setSwitchStep(null)}
                  disabled={switchingProgram}
                  className="w-full py-3 rounded-2xl font-medium text-[13px] transition-colors disabled:opacity-40"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {t('workouts.cancel')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    )}
    </>
  );
};

export default Workouts;
