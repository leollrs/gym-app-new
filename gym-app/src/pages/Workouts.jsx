import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Dumbbell, Clock, ChevronRight, Pencil, X, Trash2, CheckCircle2,
  Calendar, Zap, RefreshCw, Heart, ChevronDown, BookOpen, AlertTriangle,
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import GenerateWorkoutModal from '../components/GenerateWorkoutModal';
import CreateRoutineModal from '../components/CreateRoutineModal';

// ── Helpers ─────────────────────────────────────────────────
const timeAgo = (iso) => {
  if (!iso) return 'Never';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7)  return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
};

// ── Program detail modal ────────────────────────────────────
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

  const handleEnroll = async () => { setActing(true); await onEnroll(program.id); setActing(false); };
  const handleLeave  = async () => { setActing(true); await onLeave(program.id); setActing(false); };

  const weeks = program.weeks ?? {};
  const weekNums = Object.keys(weeks).map(Number).sort((a, b) => a - b);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm py-[10vh] px-4" onClick={onClose}>
      <div className="bg-[#0F172A] border border-white/8 rounded-[14px] w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[17px] font-bold text-[#E5E7EB]">{program.name}</p>
            <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-1.5">
              <Calendar size={11} /> {program.duration_weeks} week program
            </p>
          </div>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {program.description && <p className="text-[13px] text-[#9CA3AF] leading-relaxed">{program.description}</p>}
          <div>
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Program Overview</p>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-white/4 rounded-xl animate-pulse" />)}</div>
            ) : weekNums.length === 0 ? (
              <p className="text-[13px] text-[#4B5563]">No exercises assigned yet</p>
            ) : (
              <div className="space-y-3">
                {weekNums.map(wk => {
                  const rawVal = weeks[wk];
                  const days = Array.isArray(rawVal) && rawVal.length > 0 && typeof rawVal[0] === 'string'
                    ? [{ name: 'Day 1', exercises: rawVal }]
                    : (rawVal || []);
                  const resolveId = (ex) => typeof ex === 'string' ? ex : ex?.id;
                  return (
                    <div key={wk} className="bg-[#111827] rounded-xl overflow-hidden">
                      <p className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-3 py-2 border-b border-white/4">Week {wk}</p>
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
                                  return <span key={i} className="text-[11px] bg-white/6 text-[#9CA3AF] px-2.5 py-1 rounded-lg">{exercises[exId] ?? exId}</span>;
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
        <div className="p-5 border-t border-white/6 flex-shrink-0">
          {isEnrolled ? (
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 py-3 px-4 rounded-xl border border-[#D4AF37]/25 bg-[#D4AF37]/10">
                <CheckCircle2 size={16} className="text-[#D4AF37] flex-shrink-0" />
                <p className="text-[13px] font-semibold text-[#D4AF37]">Enrolled</p>
              </div>
              <button onClick={handleLeave} disabled={acting} className="px-4 py-3 text-[12px] font-semibold rounded-xl border border-white/8 text-[#9CA3AF] hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40">Leave</button>
            </div>
          ) : (
            <button onClick={handleEnroll} disabled={acting} className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:opacity-90 transition-opacity disabled:opacity-50">
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

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId]           = useState(null);
  const [showGenerator, setShowGenerator]     = useState(false);
  const [activeTab, setActiveTab]             = useState('routines');

  // Gym programs
  const [gymPrograms, setGymPrograms]       = useState([]);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [enrolledIds, setEnrolledIds]       = useState(new Set());
  const [selectedProgram, setSelectedProgram] = useState(null);

  // Generated programs (all user programs)
  const [generatedProgram, setGeneratedProgram] = useState(null);    // latest/active
  const [allPrograms, setAllPrograms]           = useState([]);      // all user programs
  const [programLoading, setProgramLoading]     = useState(true);
  const [onboardingData, setOnboardingData]     = useState(null);
  const [goalsMismatch, setGoalsMismatch]       = useState(false);

  // ── Load gym programs ──
  const loadPrograms = useCallback(async () => {
    if (!profile?.gym_id) return;
    setProgramsLoading(true);
    const [{ data: progs }, { data: enrolled }] = await Promise.all([
      supabase.from('gym_programs').select('id, name, description, duration_weeks, weeks, created_at').eq('gym_id', profile.gym_id).eq('is_published', true).order('created_at', { ascending: false }),
      supabase.from('gym_program_enrollments').select('program_id').eq('profile_id', user.id),
    ]);
    setGymPrograms(progs || []);
    setEnrolledIds(new Set((enrolled || []).map(r => r.program_id)));
    setProgramsLoading(false);
  }, [profile?.gym_id, user?.id]);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  // ── Load generated programs + onboarding ──
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
    const load = async () => {
      const [{ data: allGp }, { data: ob }] = await Promise.all([
        supabase.from('generated_programs').select('*').eq('profile_id', user.id).order('created_at', { ascending: false }),
        supabase.from('member_onboarding').select('*').eq('profile_id', user.id).maybeSingle(),
      ]);
      const programs = allGp || [];
      setAllPrograms(programs);
      const latest = programs[0] || null;
      setGeneratedProgram(latest);
      setOnboardingData(ob || null);
      setProgramLoading(false);

      // Check if active program was built with different goals than current onboarding
      if (latest && ob && new Date(latest.expires_at) > new Date()) {
        const programCreated = new Date(latest.created_at);
        const onboardingUpdated = ob.updated_at ? new Date(ob.updated_at) : new Date(ob.created_at);
        if (onboardingUpdated > programCreated) {
          setGoalsMismatch(true);
        }
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
    try { await deleteRoutine(id); } catch (err) { console.error(err); }
    finally { setDeletingId(null); }
  };

  return (
    <>
    <div className="mx-auto w-full max-w-[600px] px-4 pt-4 pb-28 md:pb-12 stagger-fade-in">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[26px] font-bold text-[#E5E7EB] tracking-tight">Workouts</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/exercises"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-semibold border border-white/8 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
          >
            <BookOpen size={14} />
            Exercises
          </Link>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black active:scale-95 transition-transform"
          >
            <Plus size={15} />
            New
          </button>
        </div>
      </div>

      {/* ── Current Program (highlighted box) ──────────────── */}
      {!programLoading && programActive && (
        <div className="mb-6 rounded-[14px] border border-[#D4AF37]/25 bg-gradient-to-br from-[#D4AF37]/8 to-[#D4AF37]/3 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-widest">Current Program</p>
              <p className="text-[20px] font-bold text-[#E5E7EB] mt-1">
                Week {Math.min(currentWeekNum, 6)} of 6
              </p>
              <p className="text-[12px] text-[#9CA3AF] mt-0.5">Routine {isWeekA ? 'A' : 'B'} this week</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/25 flex items-center justify-center">
              <Zap size={20} className="text-[#D4AF37]" />
            </div>
          </div>
          {thisWeekRoutines.length > 0 && (
            <div className="space-y-2">
              {thisWeekRoutines.map(routine => (
                <div key={routine.id} className="rounded-xl border border-white/8 bg-[#0F172A]/80 flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-[#111827] flex items-center justify-center flex-shrink-0">
                    <Dumbbell size={14} className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[14px] truncate text-[#E5E7EB]">{routine.name.replace('Auto: ', '')}</p>
                    <p className="text-[11px] text-[#6B7280]">{routine.exerciseCount} exercises</p>
                  </div>
                  <Link to={`/workouts/${routine.id}/edit`} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors">
                    <Pencil size={12} />
                  </Link>
                </div>
              ))}
              {generatedProgram?.cardio_days?.daysPerWeek > 0 && (
                <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-[#0F172A]/80 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-[#111827] flex items-center justify-center flex-shrink-0">
                    <Heart size={14} className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">Active Recovery</p>
                    <p className="text-[11px] text-[#6B7280]">{generatedProgram.cardio_days.description}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── No program / expired — two options side by side ── */}
      {!programLoading && !programActive && (
        <div className="mb-6">
          <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">
            {programExpired ? 'Program ended — what\'s next?' : 'Get started with a program'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setShowGenerator(true)}
              className="text-left rounded-[14px] border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-4 active:scale-[0.97] transition-transform"
            >
              <div className="w-10 h-10 rounded-full bg-[#D4AF37]/10 flex items-center justify-center mb-3">
                <Zap size={18} className="text-[#D4AF37]" />
              </div>
              <p className="text-[14px] font-semibold text-[#E5E7EB] leading-tight">Custom Program</p>
              <p className="text-[11px] text-[#9CA3AF] mt-1 leading-snug">Built around your goals and experience</p>
            </button>
            <button
              onClick={() => setActiveTab('programs')}
              className="text-left rounded-[14px] border border-white/8 bg-[#0F172A] p-4 active:scale-[0.97] transition-transform"
            >
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-3">
                <BookOpen size={18} className="text-[#9CA3AF]" />
              </div>
              <p className="text-[14px] font-semibold text-[#E5E7EB] leading-tight">Gym Programs</p>
              <p className="text-[11px] text-[#9CA3AF] mt-1 leading-snug">Follow a program from your gym</p>
            </button>
          </div>
        </div>
      )}

      {/* ── Tab bar: My Routines / Programs ────────────────── */}
      <div className="flex gap-1 bg-[#111827] p-1 rounded-xl mb-4">
        {[
          { key: 'routines', label: 'My Routines' },
          { key: 'programs', label: `Programs${enrolledIds.size ? ` (${enrolledIds.size})` : ''}` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
              activeTab === t.key
                ? 'bg-[#D4AF37] text-black'
                : 'text-[#6B7280] hover:text-[#9CA3AF]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── My Routines tab ────────────────────────────────── */}
      {activeTab === 'routines' && (
        <div className="animate-fade-in">
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="bg-[#111827] rounded-[14px] border border-white/8 h-[68px] animate-pulse" />)}</div>
          ) : routines.length === 0 ? (
            <div className="text-center py-14">
              <Dumbbell size={36} className="mx-auto mb-3 text-[#6B7280] opacity-20" />
              <p className="text-[14px] text-[#9CA3AF]">No routines yet</p>
              <p className="text-[12px] text-[#6B7280] mt-1">Tap "New" to create your first routine</p>
            </div>
          ) : (
            <div className="space-y-2">
              {routines.map(routine => (
                <div
                  key={routine.id}
                  className="rounded-[14px] border border-white/8 bg-[#0F172A] flex items-center gap-3 px-4 py-3.5"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#111827] flex items-center justify-center flex-shrink-0">
                    <Dumbbell size={16} className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[15px] truncate text-[#E5E7EB]">{routine.name}</p>
                    <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-2">
                      <span>{routine.exerciseCount} exercises</span>
                      <span className="text-white/10">·</span>
                      <span>{timeAgo(routine.lastPerformedAt)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={(e) => handleDelete(e, routine.id)}
                      disabled={deletingId === routine.id}
                      className="w-8 h-8 rounded-lg bg-[#111827] flex items-center justify-center text-[#6B7280] hover:text-red-400 transition-colors border border-white/6 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                    <Link
                      to={`/workouts/${routine.id}/edit`}
                      className="w-8 h-8 rounded-lg bg-[#111827] flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors border border-white/6"
                    >
                      <Pencil size={13} />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Programs tab ───────────────────────────────────── */}
      {activeTab === 'programs' && (
        <div className="animate-fade-in space-y-6">

          {/* Goals mismatch alert */}
          {goalsMismatch && programActive && (
            <div className="rounded-[14px] border border-amber-500/25 bg-amber-500/5 p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle size={16} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-[#E5E7EB]">Your goals have changed</p>
                <p className="text-[12px] text-[#9CA3AF] mt-0.5 leading-relaxed">
                  Your current program may no longer match your updated goals.
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => setShowGenerator(true)}
                    className="px-3.5 py-2 rounded-xl text-[12px] font-bold bg-[#D4AF37] text-black active:scale-95 transition-transform"
                  >
                    Create New Program
                  </button>
                  <button
                    onClick={() => setGoalsMismatch(false)}
                    className="px-3.5 py-2 rounded-xl text-[12px] font-semibold border border-white/8 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors"
                  >
                    Keep Current
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── My Programs ──────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest">My Programs</p>
              <button
                onClick={() => setShowGenerator(true)}
                className="flex items-center gap-1 text-[12px] font-semibold text-[#D4AF37] hover:text-[#f2d36b] transition-colors"
              >
                <Plus size={13} />
                New Program
              </button>
            </div>

            {allPrograms.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-white/10 bg-[#0F172A]/50 py-10 text-center">
                <Zap size={32} className="mx-auto mb-3 text-[#6B7280] opacity-30" />
                <p className="text-[14px] text-[#9CA3AF]">No programs yet</p>
                <p className="text-[12px] text-[#6B7280] mt-1 mb-4">Create one tailored to your goals and schedule</p>
                <button
                  onClick={() => setShowGenerator(true)}
                  className="px-4 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black active:scale-95 transition-transform"
                >
                  Create Your First Program
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {allPrograms.map(prog => {
                  const isActive = new Date(prog.expires_at) > new Date();
                  const isExpired = !isActive;
                  const weekNum = isActive
                    ? Math.min(Math.floor((new Date() - new Date(prog.program_start)) / (7 * 86400000)) + 1, 6)
                    : 6;
                  const daysTotal = 42;
                  const daysElapsed = Math.min(Math.floor((new Date() - new Date(prog.program_start)) / 86400000), daysTotal);
                  const progress = Math.round((daysElapsed / daysTotal) * 100);

                  return (
                    <div
                      key={prog.id}
                      className={`rounded-[14px] border px-4 py-4 ${
                        isActive
                          ? 'border-[#D4AF37]/25 bg-gradient-to-br from-[#D4AF37]/6 to-transparent'
                          : 'border-white/8 bg-[#0F172A]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-semibold text-[#E5E7EB]">
                            {prog.split_type ? prog.split_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Custom'} Program
                          </p>
                          {isActive && (
                            <span className="text-[10px] font-bold text-[#10B981] bg-[#10B981]/10 px-1.5 py-0.5 rounded-full">Active</span>
                          )}
                          {isExpired && (
                            <span className="text-[10px] font-bold text-[#6B7280] bg-white/5 px-1.5 py-0.5 rounded-full">Completed</span>
                          )}
                        </div>
                      </div>
                      <p className="text-[12px] text-[#6B7280] flex items-center gap-2 mb-3">
                        <span className="flex items-center gap-1"><Calendar size={11} /> 6 weeks</span>
                        <span className="text-white/10">·</span>
                        <span>{isActive ? `Week ${weekNum} of 6` : 'Finished'}</span>
                        {prog.routines_a_count > 0 && (
                          <>
                            <span className="text-white/10">·</span>
                            <span>{prog.routines_a_count} routines</span>
                          </>
                        )}
                      </p>
                      {/* Progress bar */}
                      <div className="w-full h-1.5 rounded-full bg-white/6 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isActive ? 'bg-[#D4AF37]' : 'bg-[#6B7280]'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Gym Programs ─────────────────────────────────── */}
          <div>
            <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Gym Programs</p>
            {programsLoading ? (
              <div className="space-y-2">{[1, 2].map(i => <div key={i} className="bg-[#111827] rounded-[14px] border border-white/8 h-[80px] animate-pulse" />)}</div>
            ) : gymPrograms.length === 0 ? (
              <div className="text-center py-10">
                <BookOpen size={32} className="mx-auto mb-3 text-[#6B7280] opacity-20" />
                <p className="text-[14px] text-[#9CA3AF]">No gym programs</p>
                <p className="text-[12px] text-[#6B7280] mt-1">Your gym hasn't published any programs yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {gymPrograms.map(prog => {
                  const enrolled = enrolledIds.has(prog.id);
                  return (
                    <button
                      key={prog.id}
                      onClick={() => setSelectedProgram(prog)}
                      className={`w-full text-left rounded-[14px] border bg-[#0F172A] px-4 py-3.5 flex items-center gap-3 transition-colors ${
                        enrolled ? 'border-[#D4AF37]/30' : 'border-white/8'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-xl bg-[#111827] flex items-center justify-center flex-shrink-0">
                        <Dumbbell size={16} className={enrolled ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[15px] font-semibold text-[#E5E7EB] truncate">{prog.name}</p>
                          {enrolled && (
                            <span className="text-[10px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0">
                              <CheckCircle2 size={9} /> Enrolled
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-[#6B7280] mt-0.5 flex items-center gap-1">
                          <Clock size={11} /> {prog.duration_weeks} weeks
                        </p>
                      </div>
                      <ChevronRight size={16} className="text-[#4B5563] flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

    </div>

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
            supabase.from('generated_programs').select('*').eq('profile_id', user.id).order('created_at', { ascending: false })
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
    </>
  );
};

export default Workouts;
