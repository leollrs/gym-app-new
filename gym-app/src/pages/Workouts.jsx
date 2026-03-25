import { useState, useEffect, useCallback } from 'react';
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

// Exercise name lookup
const exerciseNameMap = {};
exerciseLibrary.forEach(e => { exerciseNameMap[e.id] = e.name; });

// ── Program detail modal (gym programs) ──────────────────
const ProgramModal = ({ program, isEnrolled, onClose, onEnroll, onLeave }) => {
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
    supabase.from('exercises').select('id, name').in('id', allIds)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(ex => { map[ex.id] = ex.name; });
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
      <div role="dialog" aria-modal="true" className="bg-[#0A0F1A] rounded-[20px] w-full max-w-lg md:max-w-2xl max-h-[80vh] flex flex-col overflow-hidden border border-white/[0.04]" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-white/[0.04] flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[17px] font-bold text-[#E5E7EB]">{program.name}</p>
            <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-1.5">
              <Calendar size={11} /> {program.duration_weeks} week program
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center"><X size={16} className="text-[#6B7280]" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {program.description && <p className="text-[13px] text-[#9CA3AF] leading-relaxed">{program.description}</p>}
          <div>
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Program Overview</p>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-white/[0.03] rounded-xl animate-pulse" />)}</div>
            ) : weekNums.length === 0 ? (
              <p className="text-[13px] text-[#4B5563]">No exercises assigned yet</p>
            ) : (
              <div className="space-y-3">
                {weekNums.map(wk => {
                  const rawVal = weeks[wk];
                  const days = Array.isArray(rawVal) && rawVal.length > 0 && typeof rawVal[0] === 'string'
                    ? [{ name: 'Day 1', exercises: rawVal }] : (rawVal || []);
                  const resolveId = (ex) => typeof ex === 'string' ? ex : ex?.id;
                  return (
                    <div key={wk} className="bg-white/[0.02] rounded-xl overflow-hidden">
                      <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 py-2 border-b border-white/[0.03]">Week {wk}</p>
                      {days.length === 0 ? (
                        <p className="text-[12px] text-[#4B5563] px-3 py-2">Rest week</p>
                      ) : (
                        <div className="divide-y divide-white/[0.03]">
                          {days.map((day, di) => (
                            <div key={di} className="px-3 py-2.5">
                              <p className="text-[12px] font-semibold text-[#E5E7EB] mb-1.5">{day.name || `Day ${di + 1}`}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(day.exercises || []).map((ex, i) => {
                                  const exId = resolveId(ex);
                                  return <span key={i} className="text-[11px] bg-white/[0.04] text-[#9CA3AF] px-2.5 py-1 rounded-lg">{exercises[exId] ?? exId}</span>;
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
        <div className="p-5 border-t border-white/[0.04] flex-shrink-0">
          {isEnrolled ? (
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 py-3 px-4 rounded-xl bg-[#10B981]/10">
                <CheckCircle2 size={16} className="text-[#10B981] flex-shrink-0" />
                <p className="text-[13px] font-semibold text-[#10B981]">Enrolled</p>
              </div>
              <button onClick={handleLeave} disabled={acting} className="px-4 py-3 text-[12px] font-semibold rounded-xl border border-white/[0.06] text-[#9CA3AF] hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40">Leave</button>
            </div>
          ) : (
            <button onClick={handleEnroll} disabled={acting} className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors disabled:opacity-50">
              {acting ? 'Enrolling…' : 'Start This Program'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Routine detail (expandable) ──────────────────────────
const RoutineDetail = ({ routineId, onEdit, onDelete, deletingId }) => {
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
    <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
      {!loaded ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-4 bg-white/[0.03] rounded animate-pulse" />)}
        </div>
      ) : exercises.length === 0 ? (
        <p className="text-[12px] text-[#4B5563]">No exercises added yet</p>
      ) : (
        <div className="space-y-1.5">
          {exercises.map((ex, i) => (
            <div key={ex.id} className="flex items-center justify-between">
              <p className="text-[12px] text-[#9CA3AF]">
                <span className="text-[#4B5563] mr-1.5">{i + 1}.</span>
                {ex.exercises?.name || 'Unknown'}
              </p>
              <p className="text-[10px] text-[#4B5563]">
                {ex.target_sets}×{ex.target_reps}
              </p>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-white/[0.04]">
        <Link
          to={`/session/${routineId}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
        >
          <Play size={11} fill="white" /> Start
        </Link>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#6B7280] hover:text-[#E5E7EB] bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
        >
          <Pencil size={11} /> Edit
        </button>
        <button
          onClick={(e) => onDelete(e, routineId)}
          disabled={deletingId === routineId}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#4B5563] hover:text-red-400 bg-white/[0.03] hover:bg-red-500/10 transition-colors disabled:opacity-40"
        >
          <Trash2 size={11} /> Delete
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
  const { t } = useTranslation('pages');

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
          title: 'Your 6-week program has ended',
          body: 'Great work finishing your program! Head to Workouts to reassess and generate your next one.',
        }).then(() => supabase.from('generated_programs').update({ expiry_notified: true }).eq('id', latest.id));
      }
    };
    load();
  }, [user?.id, profile?.gym_id]);

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
    }
    refetch();
    navigate(`/workouts/${routine.id}/edit`);
  };
  const handleDelete = async (e, id) => {
    e.preventDefault(); e.stopPropagation();
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
      alert('Something went wrong: ' + err.message);
    } finally {
      setSwitchingProgram(false);
    }
  };

  return (
    <>
    <div className="mx-auto w-full max-w-[680px] md:max-w-4xl px-4 pt-4 pb-28 md:pb-12" data-tour="tour-workouts-page">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-[28px] font-bold text-[#E5E7EB] tracking-tight">{t('workouts.title')}</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/exercises"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
          >
            <BookOpen size={14} />
            {t('workouts.library')}
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold bg-white/[0.06] text-[#E5E7EB] hover:bg-white/[0.1] transition-colors"
          >
            <Plus size={14} />
            {t('workouts.new')}
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 1: CURRENT PROGRAM — Hero
         ════════════════════════════════════════════════════════ */}
      {!programLoading && programActive && (
        <section className="mb-10">
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.15em] mb-3">Current Program</p>
          <div className="rounded-2xl bg-gradient-to-br from-white/[0.04] to-white/[0.01] p-6">
            {/* Title & progress */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className="text-[20px] font-semibold text-[#E5E7EB] tracking-tight leading-tight">
                  Week {Math.min(currentWeekNum, 6)} of 6
                </h2>
                <p className="text-[13px] text-[#6B7280] mt-1">Routine {isWeekA ? 'A' : 'B'} this week</p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-[#10B981]/10 flex items-center justify-center">
                <Zap size={18} className="text-[#10B981]" />
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-6">
              <div className="w-full h-1 rounded-full bg-white/[0.04]">
                <div
                  className="h-full rounded-full bg-[#10B981] transition-all"
                  style={{ width: `${Math.min((currentWeekNum / 6) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* This week's routines */}
            {thisWeekRoutines.length > 0 && (
              <div className="space-y-2">
                {thisWeekRoutines.map(routine => (
                  <Link
                    key={routine.id}
                    to={`/session/${routine.id}`}
                    className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200 group"
                  >
                    <div className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                      <Dumbbell size={15} className="text-[#9CA3AF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[14px] truncate text-[#E5E7EB]">{routine.name.replace('Auto: ', '')}</p>
                      <p className="text-[11px] text-[#4B5563] mt-0.5">{routine.exerciseCount} exercises</p>
                    </div>
                    <ChevronRight size={16} className="text-[#2A2F3A] group-hover:text-[#6B7280] transition-colors flex-shrink-0" />
                  </Link>
                ))}
                {generatedProgram?.cardio_days?.daysPerWeek > 0 && (
                  <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl bg-white/[0.04]">
                    <div className="w-11 h-11 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                      <Heart size={15} className="text-[#9CA3AF]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#E5E7EB]">Active Recovery</p>
                      <p className="text-[11px] text-[#4B5563] mt-0.5">{generatedProgram.cardio_days.description}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Start CTA */}
            {thisWeekRoutines.length > 0 && (
              <Link
                to={`/session/${thisWeekRoutines[0].id}`}
                className="flex items-center justify-center gap-2 w-full mt-5 py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] active:scale-[0.98] transition-all"
              >
                <Play size={16} fill="white" />
                Start Workout
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── No program / expired — two options ──────────────── */}
      {!programLoading && !programActive && (
        <section className="mb-10">
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.15em] mb-3">
            {programExpired ? 'Program ended — what\'s next?' : 'Get started'}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setShowGenerator(true)}
              className="text-left rounded-2xl bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/[0.02] p-5 active:scale-[0.98] transition-transform duration-150"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mb-4">
                <Zap size={18} className="text-[#10B981]" />
              </div>
              <p className="text-[14px] font-bold text-[#E5E7EB] leading-tight">Custom Program</p>
              <p className="text-[11px] text-[#6B7280] mt-1.5 leading-snug">Built around your goals</p>
            </button>
            <button
              onClick={() => {
                const el = document.getElementById('discover-programs');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="text-left rounded-2xl bg-white/[0.04] p-5 active:scale-[0.98] transition-transform duration-150"
            >
              <div className="w-10 h-10 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4">
                <BookOpen size={18} className="text-[#6B7280]" />
              </div>
              <p className="text-[14px] font-bold text-[#E5E7EB] leading-tight">Browse Programs</p>
              <p className="text-[11px] text-[#6B7280] mt-1.5 leading-snug">22 proven programs</p>
            </button>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════════════
          SECTION 2: MY ROUTINES
         ════════════════════════════════════════════════════════ */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.15em]">{t('workouts.myRoutines')}</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-[11px] font-medium text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
          >
            {t('workouts.addNew')}
          </button>
        </div>

        {loading ? (
          <Skeleton variant="list-item" count={3} />
        ) : routines.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.04] py-12 text-center">
            <Dumbbell size={28} className="mx-auto mb-3 text-[#2A2F3A]" />
            <p className="text-[14px] text-[#6B7280]">{t('workouts.noRoutinesYet')}</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 px-4 py-2.5 rounded-xl text-[12px] font-semibold bg-white/[0.06] text-[#E5E7EB] hover:bg-white/[0.1] transition-colors"
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
                    <div key={routine.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedRoutineId(isExpanded ? null : routine.id)}
                        className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-colors duration-200 text-left ${
                          isExpanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                          <Dumbbell size={16} className="text-[#6B7280]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[15px] truncate text-[#E5E7EB]">{routine.name}</p>
                          <p className="text-[11px] text-[#4B5563] mt-0.5 flex items-center gap-2">
                            <span>{routine.exerciseCount} exercises</span>
                            <span className="text-white/[0.06]">·</span>
                            <span>{timeAgo(routine.lastPerformedAt)}</span>
                          </p>
                        </div>
                        <ChevronRight size={16} className={`text-[#2A2F3A] flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                      </button>

                      {/* Expanded exercise list */}
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
                  className="w-full mt-2 py-3 rounded-2xl text-[12px] font-medium text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
                >
                  {t('workouts.showAllRoutines', { count: routines.length })}
                </button>
              )}
              {showAllRoutines && routines.length > 3 && (
                <button
                  onClick={() => setShowAllRoutines(false)}
                  className="w-full mt-2 py-3 rounded-2xl text-[12px] font-medium text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
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
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.15em]">{t('workouts.myPrograms')}</p>
          <button
            onClick={() => setShowGenerator(true)}
            className="text-[11px] font-medium text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
          >
            {t('workouts.newProgram')}
          </button>
        </div>

        {/* Goals mismatch alert */}
        {goalsMismatch && programActive && (
          <div className="rounded-2xl bg-amber-500/[0.06] p-4 mb-4 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[#E5E7EB]">Your goals have changed</p>
              <p className="text-[11px] text-[#6B7280] mt-0.5">Your program may no longer match your updated goals.</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setShowGenerator(true)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#10B981] text-white">
                  New Program
                </button>
                <button onClick={() => setGoalsMismatch(false)} className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-[#6B7280] hover:text-[#9CA3AF] transition-colors">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {allPrograms.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.04] py-12 text-center">
            <Zap size={28} className="mx-auto mb-3 text-[#2A2F3A]" />
            <p className="text-[14px] text-[#6B7280]">No programs yet</p>
            <p className="text-[11px] text-[#4B5563] mt-1 mb-4">Create one tailored to your goals</p>
            <button
              onClick={() => setShowGenerator(true)}
              className="px-4 py-2.5 rounded-xl text-[12px] font-semibold bg-[#10B981] text-white hover:bg-[#0EA572] transition-colors"
            >
              Create Your First Program
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
                <button key={prog.id} onClick={() => { setSelectedMyProgram(prog); setMyProgWeek('1'); }} className="w-full text-left rounded-2xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200 p-5 group">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2.5">
                      <p className="text-[15px] font-bold text-[#E5E7EB]">
                        {prog.split_type ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Custom'} Program
                      </p>
                      {isActive && (
                        <span className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 px-2 py-0.5 rounded-full">Active</span>
                      )}
                      {!isActive && (
                        <span className="text-[9px] font-medium text-[#4B5563] bg-white/[0.04] px-2 py-0.5 rounded-full">Completed</span>
                      )}
                    </div>
                    <ChevronRight size={16} className="text-[#2A2F3A] group-hover:text-[#6B7280] transition-colors flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-[#4B5563] mb-3">
                    <span className="flex items-center gap-1"><Calendar size={10} /> 6 weeks</span>
                    <span>{isActive ? `Week ${weekNum} of 6` : 'Finished'}</span>
                    {prog.routines_a_count > 0 && <span>{prog.routines_a_count} routines</span>}
                  </div>
                  <div className="w-full h-1 rounded-full bg-white/[0.04]">
                    <div
                      className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : 'bg-[#4B5563]'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </button>
              );
            })}
            {!showAllMyPrograms && allPrograms.length > 3 && (
              <button
                onClick={() => setShowAllMyPrograms(true)}
                className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
              >
                Show all {allPrograms.length} programs
              </button>
            )}
            {showAllMyPrograms && allPrograms.length > 3 && (
              <button
                onClick={() => setShowAllMyPrograms(false)}
                className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
              >
                Show less
              </button>
            )}
          </div>
        )}

        {/* Gym Programs */}
        {gymPrograms.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-[0.15em] mb-3">From Your Gym</p>
            <div className="space-y-1.5">
              {(showAllGymPrograms ? gymPrograms : gymPrograms.slice(0, 3)).map(prog => {
                const enrolled = enrolledIds.has(prog.id);
                return (
                  <button
                    key={prog.id}
                    onClick={() => setSelectedProgram(prog)}
                    className="w-full text-left flex items-center gap-3.5 px-4 py-3.5 rounded-2xl hover:bg-white/[0.06] transition-colors duration-200 group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                      <Dumbbell size={16} className={enrolled ? 'text-[#10B981]' : 'text-[#4B5563]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{prog.name}</p>
                        {enrolled && (
                          <span className="text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0">
                            <CheckCircle2 size={8} /> Enrolled
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#4B5563] mt-0.5">{prog.duration_weeks} weeks</p>
                    </div>
                    <ChevronRight size={16} className="text-[#1F2937] group-hover:text-[#4B5563] transition-colors flex-shrink-0" />
                  </button>
                );
              })}
              {!showAllGymPrograms && gymPrograms.length > 3 && (
                <button
                  onClick={() => setShowAllGymPrograms(true)}
                  className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
                >
                  Show all {gymPrograms.length} gym programs
                </button>
              )}
              {showAllGymPrograms && gymPrograms.length > 3 && (
                <button
                  onClick={() => setShowAllGymPrograms(false)}
                  className="w-full py-2.5 mt-1 rounded-xl text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
                >
                  Show less
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
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent mb-10" />

        <div className="mb-6">
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.15em] mb-1">Discover</p>
          <h2 className="text-[20px] font-semibold text-[#E5E7EB] tracking-tight">Programs</h2>
        </div>

        {/* Category filter chips */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-5 -mx-1 px-1">
          {PROGRAM_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setProgramCategoryFilter(cat)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-medium transition-all ${
                programCategoryFilter === cat
                  ? 'bg-white/[0.1] text-[#E5E7EB]'
                  : 'text-[#4B5563] hover:text-[#6B7280]'
              }`}
            >
              {cat}
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
                onClick={() => { setSelectedTemplate(tmpl); setTemplateWeek('1'); }}
                className="relative text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-150 group"
                style={{ aspectRatio: '3 / 4' }}
              >
                {/* Background image */}
                <div className="absolute inset-0">
                  {tmpl.image && (
                    <img
                      src={tmpl.image}
                      alt={tmpl.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-br from-[#1a1f35] to-[#0a0f1a]" style={{ zIndex: tmpl.image ? -1 : 0 }} />
                </div>

                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/5" />

                {/* Level badge */}
                <div className="absolute top-3 left-3 z-10">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider backdrop-blur-sm ${
                    tmpl.level === 'Beginner'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : tmpl.level === 'Advanced'
                      ? 'bg-red-500/20 text-red-300'
                      : 'bg-white/10 text-white/70'
                  }`}>
                    {tmpl.level}
                  </span>
                </div>

                {/* Content at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-3.5 z-10">
                  <p className="text-[14px] font-bold text-white leading-tight">{tmpl.name}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] font-medium text-white/40">{tmpl.durationWeeks}wk</span>
                    <span className="text-[10px] text-white/15">·</span>
                    <span className="text-[10px] font-medium text-white/40">{tmpl.daysPerWeek}x/week</span>
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
          <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] bg-[#0A0F1A] overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full bg-white/[0.08]" />
              <button onClick={() => setSelectedMyProgram(null)} className="absolute right-4 top-3 w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
                <X size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Header */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'text-[#10B981] bg-[#10B981]/10' : 'text-[#4B5563] bg-white/[0.04]'}`}>
                    {isActive ? 'Active' : 'Completed'}
                  </span>
                </div>
                <h2 className="text-[24px] font-bold text-[#E5E7EB] tracking-tight leading-tight">{progName} Program</h2>
                {tmpl?.description && <p className="text-[13px] text-[#4B5563] mt-2 leading-relaxed line-clamp-2">{tmpl.description}</p>}
              </div>

              {/* Progress */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-[#9CA3AF]">{isActive ? `Week ${weekNum} of 6` : 'Program Finished'}</span>
                  <span className="text-[11px] text-[#4B5563]" style={{ fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/[0.04]">
                  <div className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : 'bg-[#4B5563]'}`} style={{ width: `${progress}%` }} />
                </div>
              </div>

              {/* This week's routines (if active) */}
              {isActive && programRoutines.length > 0 && (
                <div className="mb-6">
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">This Week's Routines</p>
                  <div className="space-y-2">
                    {programRoutines.map(r => (
                      <Link key={r.id} to={`/session/${r.id}`} onClick={() => setSelectedMyProgram(null)} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors group">
                        <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center"><Dumbbell size={14} className="text-[#9CA3AF]" /></div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{r.name.replace('Auto: ', '')}</p>
                          <p className="text-[10px] text-[#4B5563] mt-0.5">{r.exerciseCount} exercises</p>
                        </div>
                        <ChevronRight size={14} className="text-[#2A2F3A] group-hover:text-[#6B7280] transition-colors" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Week-by-week breakdown (if template_weeks exists) */}
              {weekKeys.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Program Overview</p>
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => canPrev && setMyProgWeek(weekKeys[weekIdx - 1])} disabled={!canPrev} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${canPrev ? 'bg-white/[0.04] text-[#E5E7EB] hover:bg-white/[0.08]' : 'text-[#1F2937]'}`}>
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-[14px] font-semibold text-[#E5E7EB]">Week {myProgWeek} <span className="text-[#4B5563]">of {weekKeys.length}</span></span>
                    <button onClick={() => canNext && setMyProgWeek(weekKeys[weekIdx + 1])} disabled={!canNext} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${canNext ? 'bg-white/[0.04] text-[#E5E7EB] hover:bg-white/[0.08]' : 'text-[#1F2937]'}`}>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {currentWeekDays.length === 0 ? (
                      <div className="rounded-xl bg-white/[0.02] py-6 text-center"><p className="text-[12px] text-[#4B5563]">Rest week</p></div>
                    ) : currentWeekDays.map((day, di) => (
                      <div key={di} className="rounded-xl bg-white/[0.04] p-4">
                        <p className="text-[13px] font-semibold text-[#E5E7EB] mb-1.5">{day.name || `Day ${di + 1}`}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(day.exercises || []).map((ex, i) => {
                            const exId = typeof ex === 'string' ? ex : ex?.id;
                            return <span key={i} className="text-[11px] bg-white/[0.04] text-[#9CA3AF] px-2.5 py-1 rounded-lg">{exerciseNameMap[exId] ?? exId}</span>;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed state */}
              {!isActive && (
                <div className="mt-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 size={28} className="text-[#10B981]" />
                  </div>
                  <p className="text-[16px] font-bold text-[#E5E7EB]">Program Completed</p>
                  <p className="text-[12px] text-[#6B7280] mt-1">All workout history and progress has been saved</p>
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="shrink-0 px-6 pt-4 pb-5 bg-gradient-to-t from-[#0A0F1A] via-[#0A0F1A] to-transparent">
              {isActive && programRoutines.length > 0 ? (
                <Link to={`/session/${programRoutines[0].id}`} onClick={() => setSelectedMyProgram(null)} className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-bold text-[15px] text-white bg-[#10B981] hover:bg-[#0EA572] active:scale-[0.98] transition-all">
                  <Play size={16} fill="white" /> Start Workout
                </Link>
              ) : !isActive ? (
                <button onClick={() => { setSelectedMyProgram(null); const el = document.getElementById('discover-programs'); el?.scrollIntoView({ behavior: 'smooth' }); }} className="w-full py-4 rounded-2xl font-bold text-[15px] text-[#E5E7EB] bg-white/[0.06] hover:bg-white/[0.1] transition-colors">
                  Browse New Programs
                </button>
              ) : null}
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
            className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] bg-[#0A0F1A] overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle + Close */}
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full bg-white/[0.08]" />
              <button
                onClick={() => setSelectedTemplate(null)}
                className="absolute right-4 top-3 w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Hero */}
              <div className="mb-6">
                <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-[0.15em]">
                  {selectedTemplate.level} · {selectedTemplate.category}
                </span>
                <h2 className="text-[28px] font-bold text-[#E5E7EB] tracking-tight leading-tight mt-2">
                  {selectedTemplate.name}
                </h2>
                <p className="text-[13px] text-[#4B5563] mt-2 leading-relaxed line-clamp-2">
                  {selectedTemplate.description}
                </p>
              </div>

              {/* Meta pills */}
              <div className="flex items-center gap-2 mb-8">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03]">
                  <Activity size={11} className="text-[#4B5563]" />
                  <span className="text-[11px] font-medium text-[#6B7280]">{selectedTemplate.daysPerWeek}x/week</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03]">
                  <Calendar size={11} className="text-[#4B5563]" />
                  <span className="text-[11px] font-medium text-[#6B7280]">{selectedTemplate.durationWeeks} weeks</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03]">
                  <Target size={11} className="text-[#4B5563]" />
                  <span className="text-[11px] font-medium text-[#6B7280]">{selectedTemplate.goal}</span>
                </div>
              </div>

              {/* Week navigator */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2.5">
                  <button
                    onClick={() => canPrev && setTemplateWeek(weekKeys[weekIdx - 1])}
                    disabled={!canPrev}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      canPrev ? 'bg-white/[0.04] text-[#E5E7EB] hover:bg-white/[0.08]' : 'text-[#1F2937]'
                    }`}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="text-center">
                    <span className="text-[16px] font-semibold text-[#E5E7EB]">Week {templateWeek}</span>
                    <span className="text-[14px] text-[#4B5563] ml-1.5">of {weekKeys.length}</span>
                  </div>
                  <button
                    onClick={() => canNext && setTemplateWeek(weekKeys[weekIdx + 1])}
                    disabled={!canNext}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      canNext ? 'bg-white/[0.04] text-[#E5E7EB] hover:bg-white/[0.08]' : 'text-[#1F2937]'
                    }`}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="h-[2px] rounded-full bg-white/[0.03]">
                  <div
                    className="h-full rounded-full bg-[#10B981]/60 transition-all duration-300"
                    style={{ width: `${((weekIdx + 1) / weekKeys.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Workout day cards — pad to 7 days with rest days */}
              <div className="space-y-3">
                {(() => {
                  const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                  // Build a full 7-day view: workout days first, then rest days fill remaining
                  const fullWeek = DAY_LABELS.map((dayLabel, i) => {
                    const workoutDay = currentWeekDays[i];
                    if (workoutDay) return { ...workoutDay, dayLabel, isRest: false };
                    return { dayLabel, isRest: true, name: dayLabel, exercises: [] };
                  });

                  if (currentWeekDays.length === 0) {
                    return (
                      <div className="rounded-2xl bg-white/[0.04] py-8 text-center">
                        <p className="text-[13px] text-[#4B5563]">Rest week</p>
                      </div>
                    );
                  }

                  return fullWeek.map((day, di) => (
                    <div key={di} className={`rounded-2xl p-5 ${day.isRest ? 'bg-white/[0.02]' : 'bg-white/[0.04]'}`}>
                      <div className="flex items-center gap-2.5 mb-1">
                        <h4 className={`text-[14px] font-semibold ${day.isRest ? 'text-[#4B5563]' : 'text-[#E5E7EB]'}`}>
                          {day.isRest ? day.dayLabel : day.name}
                        </h4>
                        {!day.isRest && (
                          <span className="text-[10px] font-medium text-[#4B5563] bg-white/[0.03] px-2 py-0.5 rounded-full">
                            {day.exercises.length}
                          </span>
                        )}
                      </div>
                      {day.isRest ? (
                        <p className="text-[11px] text-[#3B3F4A]">Rest Day</p>
                      ) : (
                        <div className="space-y-1 mt-2">
                          {day.exercises.map((ex, ei) => (
                            <p key={ei} className="text-[12px] text-[#6B7280]">
                              {exerciseNameMap[ex.id] || ex.id}
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
                <p className="text-[10px] text-[#3B3F4A] mt-5">
                  Equipment: {selectedTemplate.equipment.join(' · ')}
                </p>
              )}
            </div>

            {/* CTA */}
            <div className="shrink-0 px-6 pt-4 pb-5 bg-gradient-to-t from-[#0A0F1A] via-[#0A0F1A] to-transparent">
              <button
                onClick={handleStartTemplate}
                disabled={switchingProgram}
                className="w-full py-4 rounded-2xl font-bold text-[15px] active:scale-[0.98] transition-all text-white bg-[#10B981] hover:bg-[#0EA572] disabled:opacity-50"
              >
                {switchingProgram ? 'Setting up…' : 'Start This Program'}
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

    {/* ── My Program Detail Modal ──────────────────────── */}
    {selectedMyProgram && (() => {
      const prog = selectedMyProgram;
      const isActive = new Date(prog.expires_at) > new Date();
      const weekNum = isActive
        ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, 6) : 6;
      const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), 42);
      const progress = Math.round((daysElapsed / 42) * 100);
      const programName = prog.split_type ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Custom';

      // Resolve template data for week breakdown
      const template = prog.template_id ? programTemplates.find(t => t.id === prog.template_id) : null;
      const weeks = prog.template_weeks || template?.weeks || null;
      const weekKeys = weeks ? Object.keys(weeks).sort((a, b) => Number(a) - Number(b)) : [];
      const weekIdx = weekKeys.indexOf(myProgramWeek);
      const currentWeekDays = weeks ? (weeks[myProgramWeek] || []) : [];
      const canPrevWeek = weekIdx > 0;
      const canNextWeek = weekIdx < weekKeys.length - 1;

      // This program's Auto: routines
      const programRoutines = routines.filter(r => r.name.startsWith('Auto:'));

      return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={() => setSelectedMyProgram(null)} />
          <div
            className="relative w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-[28px] bg-[#0A0F1A] overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle + Close */}
            <div className="relative flex justify-center pt-4 pb-3 shrink-0">
              <div className="w-8 h-[3px] rounded-full bg-white/[0.08]" />
              <button
                onClick={() => setSelectedMyProgram(null)}
                className="absolute right-4 top-3 w-8 h-8 rounded-full bg-white/[0.04] flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {/* Header */}
              <div className="mb-5">
                <div className="flex items-center gap-2.5 mb-2">
                  {isActive ? (
                    <span className="text-[10px] font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-0.5 rounded-full">Active</span>
                  ) : (
                    <span className="text-[10px] font-bold text-[#4B5563] bg-white/[0.04] px-2.5 py-0.5 rounded-full">Completed</span>
                  )}
                  {isActive && (
                    <span className="text-[10px] font-medium text-[#6B7280]">Week {weekNum} of 6</span>
                  )}
                </div>
                <h2 className="text-[24px] font-bold text-[#E5E7EB] tracking-tight leading-tight">
                  {programName} Program
                </h2>
                {template && (
                  <p className="text-[13px] text-[#4B5563] mt-1.5 leading-relaxed line-clamp-2">{template.description}</p>
                )}
              </div>

              {/* Progress bar */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-[#6B7280]">Progress</span>
                  <span className="text-[11px] font-medium text-[#9CA3AF]">{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/[0.04]">
                  <div
                    className={`h-full rounded-full transition-all ${isActive ? 'bg-[#10B981]' : 'bg-[#4B5563]'}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Meta pills */}
              <div className="flex items-center gap-2 mb-6">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03]">
                  <Calendar size={11} className="text-[#4B5563]" />
                  <span className="text-[11px] font-medium text-[#6B7280]">6 weeks</span>
                </div>
                {prog.routines_a_count > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03]">
                    <Activity size={11} className="text-[#4B5563]" />
                    <span className="text-[11px] font-medium text-[#6B7280]">{prog.routines_a_count} days/week</span>
                  </div>
                )}
                {template && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03]">
                    <Target size={11} className="text-[#4B5563]" />
                    <span className="text-[11px] font-medium text-[#6B7280]">{template.goal}</span>
                  </div>
                )}
              </div>

              {/* Week-by-week breakdown (if template_weeks available) */}
              {weekKeys.length > 0 && (
                <>
                  {/* Week navigator */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <button
                        onClick={() => canPrevWeek && setMyProgWeek(weekKeys[weekIdx - 1])}
                        disabled={!canPrevWeek}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                          canPrevWeek ? 'bg-white/[0.04] text-[#E5E7EB] hover:bg-white/[0.08]' : 'text-[#1F2937]'
                        }`}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <div className="text-center">
                        <span className="text-[16px] font-semibold text-[#E5E7EB]">Week {myProgramWeek}</span>
                        <span className="text-[14px] text-[#4B5563] ml-1.5">of {weekKeys.length}</span>
                        {isActive && Number(myProgramWeek) === weekNum && (
                          <span className="ml-2 text-[9px] font-bold text-[#10B981] bg-[#10B981]/10 px-1.5 py-0.5 rounded-full">Current</span>
                        )}
                      </div>
                      <button
                        onClick={() => canNextWeek && setMyProgWeek(weekKeys[weekIdx + 1])}
                        disabled={!canNextWeek}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                          canNextWeek ? 'bg-white/[0.04] text-[#E5E7EB] hover:bg-white/[0.08]' : 'text-[#1F2937]'
                        }`}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <div className="h-[2px] rounded-full bg-white/[0.03]">
                      <div
                        className="h-full rounded-full bg-[#10B981]/60 transition-all duration-300"
                        style={{ width: `${((weekIdx + 1) / weekKeys.length) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Day cards */}
                  <div className="space-y-3">
                    {(() => {
                      const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                      const fullWeek = DAY_LABELS.map((dayLabel, i) => {
                        const workoutDay = currentWeekDays[i];
                        if (workoutDay) return { ...workoutDay, dayLabel, isRest: false };
                        return { dayLabel, isRest: true, name: dayLabel, exercises: [] };
                      });

                      if (currentWeekDays.length === 0) {
                        return (
                          <div className="rounded-2xl bg-white/[0.04] py-8 text-center">
                            <p className="text-[13px] text-[#4B5563]">Rest week</p>
                          </div>
                        );
                      }

                      return fullWeek.map((day, di) => (
                        <div key={di} className={`rounded-2xl p-5 ${day.isRest ? 'bg-white/[0.02]' : 'bg-white/[0.04]'}`}>
                          <div className="flex items-center gap-2.5 mb-1">
                            <h4 className={`text-[14px] font-semibold ${day.isRest ? 'text-[#4B5563]' : 'text-[#E5E7EB]'}`}>
                              {day.isRest ? day.dayLabel : day.name}
                            </h4>
                            {!day.isRest && (
                              <span className="text-[10px] font-medium text-[#4B5563] bg-white/[0.03] px-2 py-0.5 rounded-full">
                                {day.exercises.length}
                              </span>
                            )}
                          </div>
                          {day.isRest ? (
                            <p className="text-[11px] text-[#3B3F4A]">Rest Day</p>
                          ) : (
                            <div className="space-y-1 mt-2">
                              {day.exercises.map((ex, ei) => (
                                <p key={ei} className="text-[12px] text-[#6B7280]">
                                  {exerciseNameMap[typeof ex === 'string' ? ex : ex.id] || (typeof ex === 'string' ? ex : ex.id)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </>
              )}

              {/* This week's routines (when no week breakdown available, or as a quick-start section) */}
              {isActive && programRoutines.length > 0 && (
                <div className={weekKeys.length > 0 ? 'mt-6' : ''}>
                  <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.15em] mb-3">Your Routines</p>
                  <div className="space-y-2">
                    {programRoutines.map(routine => (
                      <Link
                        key={routine.id}
                        to={`/session/${routine.id}`}
                        onClick={() => setSelectedMyProgram(null)}
                        className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200 group"
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                          <Dumbbell size={15} className="text-[#9CA3AF]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[14px] truncate text-[#E5E7EB]">{routine.name.replace('Auto: ', '')}</p>
                          <p className="text-[11px] text-[#4B5563] mt-0.5">{routine.exerciseCount} exercises</p>
                        </div>
                        <ChevronRight size={16} className="text-[#2A2F3A] group-hover:text-[#6B7280] transition-colors flex-shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed state */}
              {!isActive && (
                <div className="mt-6 rounded-2xl bg-white/[0.02] p-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-[#10B981]/10 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 size={28} className="text-[#10B981]" />
                  </div>
                  <p className="text-[16px] font-bold text-[#E5E7EB] mb-1">Program Completed</p>
                  <p className="text-[12px] text-[#4B5563] mb-4">Great work finishing this program!</p>
                  <button
                    onClick={() => {
                      setSelectedMyProgram(null);
                      const el = document.getElementById('discover-programs');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="px-4 py-2.5 rounded-xl text-[12px] font-semibold bg-white/[0.06] text-[#E5E7EB] hover:bg-white/[0.1] transition-colors"
                  >
                    Browse New Programs
                  </button>
                </div>
              )}
            </div>

            {/* CTA */}
            {isActive && (
              <div className="shrink-0 px-6 pt-4 pb-5 bg-gradient-to-t from-[#0A0F1A] via-[#0A0F1A] to-transparent">
                {programRoutines.length > 0 ? (
                  <Link
                    to={`/session/${programRoutines[0].id}`}
                    onClick={() => setSelectedMyProgram(null)}
                    className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-bold text-[15px] text-white bg-[#10B981] hover:bg-[#0EA572] active:scale-[0.98] transition-all"
                  >
                    <Play size={16} fill="white" />
                    Start Today's Workout
                  </Link>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedMyProgram(null);
                      const el = document.getElementById('discover-programs');
                      el?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="w-full py-4 rounded-2xl font-bold text-[15px] text-[#E5E7EB] bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.98] transition-all"
                  >
                    Browse Programs
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
    })()}

    {/* ── Switch Program Confirmation Dialog ────────────── */}
    {switchStep && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" onClick={() => setSwitchStep(null)}>
        <div className="bg-[#0F172A] rounded-[20px] w-full max-w-sm p-6 border border-white/[0.06]" onClick={e => e.stopPropagation()}>
          {switchStep === 'confirm' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={22} className="text-amber-400" />
              </div>
              <h3 className="text-[18px] font-bold text-[#E5E7EB] text-center mb-2">Switch Programs?</h3>
              <p className="text-[13px] text-[#6B7280] text-center leading-relaxed mb-6">
                You're currently on an active program. Switching will start <span className="text-[#E5E7EB] font-medium">{selectedTemplate?.name}</span> as your new program. Your current progress will be saved.
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={() => setSwitchStep('final')}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-[#10B981] hover:bg-[#0EA572] transition-colors"
                >
                  Yes, Switch Program
                </button>
                <button
                  onClick={() => setSwitchStep(null)}
                  className="w-full py-3 rounded-2xl font-medium text-[13px] text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
                >
                  Keep Current Program
                </button>
              </div>
            </>
          ) : switchStep === 'final' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={22} className="text-red-400" />
              </div>
              <h3 className="text-[18px] font-bold text-[#E5E7EB] text-center mb-2">Are you sure?</h3>
              <p className="text-[13px] text-[#6B7280] text-center leading-relaxed mb-2">
                Your current program will be deactivated and <span className="text-[#E5E7EB] font-medium">{selectedTemplate?.name}</span> will become your active program.
              </p>
              <p className="text-[11px] text-[#4B5563] text-center mb-6">
                All workout history and progress from your current program are kept — nothing is deleted.
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={enrollInTemplate}
                  disabled={switchingProgram}
                  className="w-full py-3.5 rounded-2xl font-bold text-[14px] text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {switchingProgram ? 'Switching…' : 'Confirm & Switch'}
                </button>
                <button
                  onClick={() => setSwitchStep(null)}
                  disabled={switchingProgram}
                  className="w-full py-3 rounded-2xl font-medium text-[13px] text-[#6B7280] hover:text-[#9CA3AF] transition-colors disabled:opacity-40"
                >
                  Cancel
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
