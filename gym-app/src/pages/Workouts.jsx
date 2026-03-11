import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Play, Plus, Dumbbell, Clock, ChevronRight, Pencil, BookOpen, X, Trash2, CheckCircle2, Calendar, Zap, RefreshCw, Heart
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import GenerateWorkoutModal from '../components/GenerateWorkoutModal';
import CreateRoutineModal from '../components/CreateRoutineModal';

const formatLastPerformed = (isoDate) => {
  if (!isoDate) return 'Never';
  const diff = Math.floor((Date.now() - new Date(isoDate)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)} weeks ago`;
  return `${Math.floor(diff / 30)} months ago`;
};

// ── Program detail modal ────────────────────────────────────
const ProgramModal = ({ program, isEnrolled, onClose, onEnroll, onLeave }) => {
  const [exercises, setExercises] = useState({});  // { id: name }
  const [loading, setLoading]     = useState(true);
  const [acting, setActing]       = useState(false);

  useEffect(() => {
    // Collect all exercise IDs from all weeks/days (supports old flat, new week/day, and object formats)
    const weeks = program.weeks ?? {};
    const resolveId = (ex) => (typeof ex === 'string' ? ex : ex?.id);
    const allIds = [...new Set(
      Object.values(weeks).flatMap(val => {
        if (!Array.isArray(val) || val.length === 0) return [];
        if (typeof val[0] === 'string') return val;           // old flat format
        return val.flatMap(d => (d.exercises ?? []).map(resolveId)); // new format (string or object)
      })
    )].filter(Boolean);
    if (allIds.length === 0) { setLoading(false); return; }

    supabase
      .from('exercises')
      .select('id, name')
      .in('id', allIds)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(ex => { map[ex.id] = ex.name; });
        setExercises(map);
        setLoading(false);
      });
  }, [program.id]);

  const handleEnroll = async () => {
    setActing(true);
    await onEnroll(program.id);
    setActing(false);
  };

  const handleLeave = async () => {
    setActing(true);
    await onLeave(program.id);
    setActing(false);
  };

  const weeks = program.weeks ?? {};
  const weekNums = Object.keys(weeks).map(Number).sort((a, b) => a - b);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0F172A] border border-white/8 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[17px] font-bold text-[#E5E7EB]">{program.name}</p>
            <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-1.5">
              <Calendar size={11} /> {program.duration_weeks} week program
            </p>
          </div>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {program.description && (
            <p className="text-[13px] text-[#9CA3AF] leading-relaxed">{program.description}</p>
          )}

          {/* Week-by-week */}
          <div>
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Program Overview</p>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 bg-white/4 rounded-xl animate-pulse" />)}
              </div>
            ) : weekNums.length === 0 ? (
              <p className="text-[13px] text-[#4B5563]">No exercises assigned yet</p>
            ) : (
              <div className="space-y-3">
                {weekNums.map(wk => {
                  const rawVal = weeks[wk];
                  // Normalize: old flat format or new day format
                  const days = Array.isArray(rawVal) && rawVal.length > 0 && typeof rawVal[0] === 'string'
                    ? [{ name: 'Day 1', exercises: rawVal }]
                    : (rawVal || []);
                  const resolveId = (ex) => typeof ex === 'string' ? ex : ex?.id;

                  return (
                    <div key={wk} className="bg-[#111827] rounded-xl overflow-hidden">
                      <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 py-2 border-b border-white/4">
                        Week {wk}
                      </p>
                      {days.length === 0 ? (
                        <p className="text-[12px] text-[#4B5563] px-3 py-2">Rest week</p>
                      ) : (
                        <div className="divide-y divide-white/4">
                          {days.map((day, di) => (
                            <div key={di} className="px-3 py-2.5">
                              <p className="text-[12px] font-semibold text-[#E5E7EB] mb-1.5">{day.name || `Day ${di + 1}`}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(day.exercises || []).map((ex, i) => {
                                  const exId = resolveId(ex);
                                  return (
                                    <span key={i} className="text-[11px] bg-white/6 text-[#9CA3AF] px-2.5 py-1 rounded-lg">
                                      {exercises[exId] ?? exId}
                                    </span>
                                  );
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

        {/* Footer CTA */}
        <div className="p-5 border-t border-white/6 flex-shrink-0">
          {isEnrolled ? (
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 py-3 px-4 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
                <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />
                <p className="text-[13px] font-semibold text-emerald-400">Enrolled</p>
              </div>
              <button
                onClick={handleLeave}
                disabled={acting}
                className="px-4 py-3 text-[12px] font-semibold rounded-xl border border-white/10 text-[#9CA3AF] hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40"
              >
                Leave
              </button>
            </div>
          ) : (
            <button
              onClick={handleEnroll}
              disabled={acting}
              className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C4A030] transition-colors disabled:opacity-50"
            >
              {acting ? 'Enrolling…' : 'Enroll in Program'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────
const Workouts = () => {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const { routines, loading, createRoutine, deleteRoutine, refetch } = useRoutines();
  const [activeTab, setActiveTab]           = useState('my-routines');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId]         = useState(null);
  const [gymPrograms, setGymPrograms]       = useState([]);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [enrolledIds, setEnrolledIds]       = useState(new Set());
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [showGenerator, setShowGenerator]   = useState(false);
  const [generatedProgram, setGeneratedProgram] = useState(null);
  const [programLoading, setProgramLoading] = useState(true);
  const [onboardingData, setOnboardingData] = useState(null);

  const loadPrograms = useCallback(async () => {
    if (!profile?.gym_id) return;
    setProgramsLoading(true);
    const [{ data: progs }, { data: enrolled }] = await Promise.all([
      supabase
        .from('gym_programs')
        .select('id, name, description, duration_weeks, weeks, created_at')
        .eq('gym_id', profile.gym_id)
        .eq('is_published', true)
        .order('created_at', { ascending: false }),
      supabase
        .from('gym_program_enrollments')
        .select('program_id')
        .eq('profile_id', user.id),
    ]);
    setGymPrograms(progs || []);
    setEnrolledIds(new Set((enrolled || []).map(r => r.program_id)));
    setProgramsLoading(false);
  }, [profile?.gym_id, user?.id]);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  // Load generated program status and onboarding data
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
    const load = async () => {
      const [{ data: gp }, { data: ob }] = await Promise.all([
        supabase
          .from('generated_programs')
          .select('*')
          .eq('profile_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('member_onboarding')
          .select('*')
          .eq('profile_id', user.id)
          .maybeSingle(),
      ]);
      setGeneratedProgram(gp || null);
      setOnboardingData(ob || null);
      setProgramLoading(false);

      // Fire expiry notification once if program just expired and no notification sent yet
      if (gp && new Date(gp.expires_at) <= new Date() && !gp.expiry_notified) {
        supabase.from('notifications').insert({
          profile_id: user.id,
          gym_id:     profile.gym_id,
          type:       'milestone',
          title:      'Your 6-week program has ended',
          body:       'Great work finishing your program! Head to Workouts to reassess and generate your next one.',
        }).then(() =>
          supabase.from('generated_programs').update({ expiry_notified: true }).eq('id', gp.id)
        );
      }
    };
    load();
  }, [user?.id, profile?.gym_id]);

  // Derived program state
  const today        = new Date();
  const programActive = generatedProgram && new Date(generatedProgram.expires_at) > today;
  const programExpired = generatedProgram && new Date(generatedProgram.expires_at) <= today;
  const currentWeekNum = programActive
    ? Math.floor((today - new Date(generatedProgram.program_start)) / (7 * 86400000)) + 1
    : 0;
  const isWeekA = currentWeekNum % 2 === 1; // odd weeks = A, even weeks = B

  // This week's routines (Auto: routines filtered by A or B suffix)
  const thisWeekRoutines = programActive
    ? routines.filter(r => {
        if (!r.name.startsWith('Auto:')) return false;
        if (isWeekA) return r.name.endsWith(' A') || (!r.name.endsWith(' B') && routines.filter(x => x.name === r.name + ' B').length === 0);
        return r.name.endsWith(' B');
      })
    : [];

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
        routine_id:   routine.id,
        exercise_id:  ex.id,
        position:     i + 1,
        target_sets:  ex.sets,
        target_reps:  ex.reps,
        rest_seconds: ex.restSeconds,
      }));
      const { error: exErr } = await supabase.from('routine_exercises').insert(rows);
      if (exErr) throw exErr;
    }
    refetch();
    navigate(`/workouts/${routine.id}/edit`);
  };

  const handleDelete = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(id);
    try {
      await deleteRoutine(id);
    } catch (err) {
      console.error('Failed to delete routine:', err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* Page header */}
      <header className="mb-10 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#0F172A] dark:text-slate-100">
            Workouts
          </h1>
          <p className="text-[13px] mt-1 text-[#64748B] dark:text-slate-400">
            Build your own routines or follow your gym’s plans.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-[13px] font-semibold shadow-sm active:scale-95 transition-transform"
          style={{ background: 'var(--accent-gold)', color: '#000' }}
        >
          <Plus size={16} />
          New routine
        </button>
      </header>

      {/* ── Generated Program Banner ── */}
      {!programLoading && programExpired && (
        <div className="mb-8 flex items-center gap-4 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-800 shadow-sm px-5 py-4">
          <div className="w-10 h-10 rounded-full bg-[#FEF3C7] dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
            <RefreshCw size={18} className="text-[#CA8A04] dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#0F172A] dark:text-slate-100">
              Your 6‑week program has ended
            </p>
            <p className="text-[12px] mt-0.5 text-[#64748B] dark:text-slate-400">
              Reassess and generate a fresh program to keep progressing.
            </p>
          </div>
          <button
            onClick={() => setShowGenerator(true)}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-semibold hover:opacity-90 transition-colors"
            style={{ background: 'var(--accent-gold)', color: '#000' }}
          >
            Reassess
          </button>
        </div>
      )}

      {!programLoading && !generatedProgram && (
        <div className="mb-8 flex items-center gap-4 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-800 shadow-sm px-5 py-4">
          <div className="w-10 h-10 rounded-full bg-[#ECFEFF] dark:bg-cyan-900/40 flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-[#0EA5E9] dark:text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#0F172A] dark:text-slate-100">
              Generate your personalized program
            </p>
            <p className="text-[12px] mt-0.5 text-[#64748B] dark:text-slate-400">
              6‑week AI‑built plan based on your goals, body, and equipment.
            </p>
          </div>
          <button
            onClick={() => setShowGenerator(true)}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-semibold hover:opacity-90 transition-colors"
            style={{ background: 'var(--accent-gold)', color: '#000' }}
          >
            Generate
          </button>
        </div>
      )}

      {/* ── This Week's Plan ── */}
      {programActive && thisWeekRoutines.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[15px] font-semibold" style={{ color: '#0F172A' }}>This week’s plan</p>
              <p className="text-[12px]" style={{ color: '#64748B' }}>
                Week {Math.min(currentWeekNum, 6)} of 6 · {isWeekA ? 'Routine A' : 'Routine B'}
                {generatedProgram?.cardio_days?.daysPerWeek > 0 && ` · ${generatedProgram.cardio_days.daysPerWeek}× cardio`}
              </p>
            </div>
            <button
              onClick={() => setShowGenerator(true)}
              className="text-[11px] font-semibold text-[#6B7280] dark:text-slate-400 hover:text-[#9CA3AF] dark:hover:text-slate-300 transition-colors"
            >
              Regenerate
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {thisWeekRoutines.map(routine => (
              <div
                key={routine.id}
                className="rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-800 flex items-center gap-3 px-4 py-3.5 shadow-sm"
              >
                <div className="w-9 h-9 rounded-xl bg-[#EEF2FF] dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                  <Dumbbell size={15} className="text-[#4F46E5] dark:text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] truncate text-[#0F172A] dark:text-slate-100">
                    {routine.name.replace('Auto: ', '')}
                  </p>
                  <p className="text-[11px] mt-0.5 text-[#6B7280] dark:text-slate-400">
                    {routine.exerciseCount} exercises
                  </p>
                </div>
                <Link
                  to={`/session/${routine.id}`}
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform active:scale-95"
                  style={{
                    background: '#22C55E',
                    color: '#FFFFFF',
                    boxShadow: '0 0 14px rgba(34,197,94,0.5)',
                  }}
                >
                  <Play size={13} fill="white" stroke="white" strokeWidth={1.5} />
                </Link>
              </div>
            ))}
            {generatedProgram?.cardio_days?.daysPerWeek > 0 && (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-emerald-500/20 bg-emerald-50">
                <Heart size={15} className="text-emerald-500 flex-shrink-0" />
                <p className="text-[13px] text-emerald-700 font-semibold">
                  {generatedProgram.cardio_days.daysPerWeek}× {generatedProgram.cardio_days.description}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-800 shadow-sm py-7 transition-transform active:scale-98"
        >
          <div className="w-12 h-12 rounded-xl bg-[#FEF3C7] dark:bg-amber-900/40 flex items-center justify-center">
            <Plus size={22} className="text-[#CA8A04] dark:text-amber-400" />
          </div>
          <span className="font-semibold text-[14px] text-[#0F172A] dark:text-slate-100">
            Create routine
          </span>
        </button>
        <Link
          to="/exercises"
          className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-800 shadow-sm py-7 transition-transform active:scale-98"
        >
          <div className="w-12 h-12 rounded-xl bg-[#EEF2FF] dark:bg-indigo-900/40 flex items-center justify-center">
            <BookOpen size={22} className="text-[#4F46E5] dark:text-indigo-400" />
          </div>
          <span className="font-semibold text-[14px] text-[#0F172A] dark:text-slate-100">
            Browse exercises
          </span>
        </Link>
      </div>

      {/* Tab bar */}
      <div className="flex mb-8 rounded-full bg-[#E5E7EB] dark:bg-white/10 p-0.5">
        {[
          { key: 'my-routines',  label: 'My Routines' },
          { key: 'gym-programs', label: `Gym Programs${enrolledIds.size ? ` (${enrolledIds.size})` : ''}` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 text-[13px] font-semibold rounded-full transition-colors cursor-pointer ${
              activeTab === tab.key
                ? 'bg-white dark:bg-slate-700 text-[#0F172A] dark:text-slate-100 shadow-sm'
                : 'bg-transparent text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Routines */}
      {activeTab === 'my-routines' && (
        <div className="flex flex-col gap-3 animate-fade-in">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-slate-200 dark:bg-slate-700 rounded-[14px] border border-slate-200 dark:border-white/10 h-[76px] animate-pulse" />
              ))}
            </div>
          ) : routines.length === 0 ? (
            <div className="text-center py-20 text-[#6B7280] dark:text-slate-400">
              <Dumbbell size={40} className="mx-auto mb-4 opacity-20" />
              <p className="text-[15px]">No routines yet</p>
              <p className="text-[13px] mt-1">Create your first routine above</p>
            </div>
          ) : (
            routines.map(routine => (
              <div
                key={routine.id}
                className="rounded-2xl border border-black/5 dark:border-white/10 bg-white dark:bg-slate-800 flex items-center gap-3 px-4 py-3.5 shadow-sm hover:border-black/10 dark:hover:border-white/20 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#EEF2FF] dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                  <Dumbbell size={16} className="text-[#4F46E5] dark:text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[15px] truncate text-[#0F172A] dark:text-slate-100">
                    {routine.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-[12px] text-[#6B7280] dark:text-slate-400">
                    <span className="flex items-center gap-1"><Dumbbell size={10} /> {routine.exerciseCount} ex</span>
                    <span className="flex items-center gap-1 truncate"><Clock size={10} className="flex-shrink-0" /> {formatLastPerformed(routine.lastPerformedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={(e) => handleDelete(e, routine.id)}
                    disabled={deletingId === routine.id}
                    className="w-9 h-9 rounded-lg bg-[#F9FAFB] dark:bg-white/10 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center justify-center text-[#9CA3AF] dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors border border-[#E5E7EB] dark:border-white/10 cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                  <Link
                    to={`/workouts/${routine.id}/edit`}
                    className="w-9 h-9 rounded-lg bg-[#F9FAFB] dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 flex items-center justify-center text-[#9CA3AF] dark:text-slate-400 hover:text-[#111827] dark:hover:text-slate-100 transition-colors border border-[#E5E7EB] dark:border-white/10 cursor-pointer"
                  >
                    <Pencil size={14} />
                  </Link>
                  <Link
                    to={`/session/${routine.id}`}
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform cursor-pointer active:scale-95"
                    style={{
                      background: '#22C55E',
                      color: '#FFFFFF',
                      boxShadow: '0 0 12px rgba(34,197,94,0.5)',
                    }}
                  >
                    <Play size={14} fill="white" stroke="white" strokeWidth={1.5} />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Gym Programs */}
      {activeTab === 'gym-programs' && (
        <div className="flex flex-col gap-4 animate-fade-in">
          {programsLoading ? (
            <div className="flex flex-col gap-3">
              {[1, 2].map(i => (
                <div key={i} className="bg-slate-200 dark:bg-slate-700 rounded-[14px] border border-slate-200 dark:border-white/10 h-[100px] animate-pulse" />
              ))}
            </div>
          ) : gymPrograms.length === 0 ? (
            <div className="text-center py-20 text-[#6B7280] dark:text-slate-400">
              <BookOpen size={40} className="mx-auto mb-4 opacity-20" />
              <p className="text-[15px]">No programs yet</p>
              <p className="text-[13px] mt-1">Your gym hasn't published any programs</p>
            </div>
          ) : (
            gymPrograms.map(prog => {
              const enrolled = enrolledIds.has(prog.id);
              return (
                <button
                  key={prog.id}
                  onClick={() => setSelectedProgram(prog)}
                  className={`text-left rounded-2xl border transition-colors overflow-hidden w-full bg-white dark:bg-slate-800 shadow-sm ${
                    enrolled ? 'border-amber-400/60 dark:border-amber-500/50 hover:border-amber-500 dark:hover:border-amber-400' : 'border-black/5 dark:border-white/10 hover:border-black/10 dark:hover:border-white/20'
                  }`}
                >
                  <div className={`h-[3px] w-full ${enrolled ? 'bg-amber-400 dark:bg-amber-500' : 'bg-[#E5E7EB] dark:bg-white/10'}`} />
                  <div className="p-5 flex items-start gap-4">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        enrolled ? 'bg-[#FEF3C7] dark:bg-amber-900/40' : 'bg-[#EEF2FF] dark:bg-indigo-900/40'
                      }`}
                    >
                      <Dumbbell
                        size={18}
                        className={enrolled ? 'text-[#CA8A04] dark:text-amber-400' : 'text-[#4F46E5] dark:text-indigo-400'}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[15px] font-semibold text-[#0F172A] dark:text-slate-100">
                          {prog.name}
                        </h3>
                        {enrolled && (
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={9} /> Enrolled
                          </span>
                        )}
                      </div>
                      {prog.description && (
                        <p className="text-[12px] mt-1 line-clamp-2 text-[#64748B] dark:text-slate-400">
                          {prog.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-[12px] text-[#6B7280] dark:text-slate-400">
                        <span className="flex items-center gap-1"><Clock size={11} /> {prog.duration_weeks} weeks</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-[#9CA3AF] dark:text-slate-500 flex-shrink-0 mt-1" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

    </div>

    {/* Program detail modal — rendered outside animate-fade-in to preserve fixed positioning */}
    {selectedProgram && (
      <ProgramModal
        program={selectedProgram}
        isEnrolled={enrolledIds.has(selectedProgram.id)}
        onClose={() => setSelectedProgram(null)}
        onEnroll={handleEnroll}
        onLeave={handleLeave}
      />
    )}

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
          // Refresh generated program + routines
          if (user?.id) {
            supabase
              .from('generated_programs')
              .select('*')
              .eq('profile_id', user.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
              .then(({ data }) => setGeneratedProgram(data || null));
          }
          refetch();
        }}
      />
    )}
    </>
  );
};

export default Workouts;
