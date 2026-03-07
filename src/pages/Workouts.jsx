import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Play, Plus, Dumbbell, Clock, ChevronRight, Pencil, BookOpen, X, Trash2, CheckCircle2, Calendar, Zap, RefreshCw, Heart
} from 'lucide-react';
import { useRoutines } from '../hooks/useRoutines';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import GenerateWorkoutModal from '../components/GenerateWorkoutModal';

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
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
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
  const [isCreating, setIsCreating]         = useState(false);
  const [newRoutineName, setNewRoutineName] = useState('');
  const [creating, setCreating]             = useState(false);
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

  const handleCreateRoutine = async (e) => {
    e.preventDefault();
    if (!newRoutineName.trim()) return;
    setCreating(true);
    try {
      const routine = await createRoutine(newRoutineName.trim());
      setNewRoutineName('');
      setIsCreating(false);
      navigate(`/workouts/${routine.id}/edit`);
    } catch (err) {
      console.error('Failed to create routine:', err);
    } finally {
      setCreating(false);
    }
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
      <header className="mb-10">
        <h1 className="text-[24px] font-bold text-[#E5E7EB]">Workouts</h1>
        <p className="text-[13px] text-[#6B7280] mt-1">Your routines and gym programs.</p>
      </header>

      {/* ── Generated Program Banner ── */}
      {!programLoading && programExpired && (
        <div className="mb-8 flex items-center gap-4 bg-[#D4AF37]/8 border border-[#D4AF37]/25 rounded-[14px] px-5 py-4">
          <RefreshCw size={20} className="text-[#D4AF37] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-[#D4AF37]">Your 6-week program has ended</p>
            <p className="text-[12px] text-[#9CA3AF] mt-0.5">Reassess and generate a fresh program to keep progressing.</p>
          </div>
          <button
            onClick={() => setShowGenerator(true)}
            className="flex-shrink-0 px-4 py-2 bg-[#D4AF37] text-black text-[13px] font-bold rounded-xl hover:bg-[#E6C766] transition-colors"
          >
            Reassess
          </button>
        </div>
      )}

      {!programLoading && !generatedProgram && (
        <div className="mb-8 flex items-center gap-4 bg-[#D4AF37]/8 border border-[#D4AF37]/25 rounded-[14px] px-5 py-4">
          <Zap size={20} className="text-[#D4AF37] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-[#D4AF37]">Generate your personalized program</p>
            <p className="text-[12px] text-[#9CA3AF] mt-0.5">6-week AI-built plan based on your goals, body, and equipment.</p>
          </div>
          <button
            onClick={() => setShowGenerator(true)}
            className="flex-shrink-0 px-4 py-2 bg-[#D4AF37] text-black text-[13px] font-bold rounded-xl hover:bg-[#E6C766] transition-colors"
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
              <p className="text-[15px] font-bold text-[#E5E7EB]">This Week's Plan</p>
              <p className="text-[12px] text-[#6B7280]">
                Week {Math.min(currentWeekNum, 6)} of 6 · {isWeekA ? 'Routine A' : 'Routine B'}
                {generatedProgram?.cardio_days?.daysPerWeek > 0 && ` · ${generatedProgram.cardio_days.daysPerWeek}× cardio`}
              </p>
            </div>
            <button
              onClick={() => setShowGenerator(true)}
              className="text-[11px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] transition-colors"
            >
              Regenerate
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {thisWeekRoutines.map(routine => (
              <div key={routine.id} className="bg-[#0F172A] rounded-[14px] border border-[#D4AF37]/15 flex items-center gap-3 px-4 py-3.5">
                <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                  <Dumbbell size={15} className="text-[#D4AF37]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#E5E7EB] text-[14px] truncate">{routine.name.replace('Auto: ', '')}</p>
                  <p className="text-[11px] text-[#6B7280] mt-0.5">{routine.exerciseCount} exercises</p>
                </div>
                <Link
                  to={`/session/${routine.id}`}
                  className="w-9 h-9 rounded-xl bg-[#D4AF37] hover:bg-[#E6C766] flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{ boxShadow: '0 0 10px rgba(212,175,55,0.3)' }}
                >
                  <Play size={13} fill="black" stroke="black" strokeWidth={1.5} />
                </Link>
              </div>
            ))}
            {generatedProgram?.cardio_days?.daysPerWeek > 0 && (
              <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/15 rounded-[14px] px-4 py-3">
                <Heart size={15} className="text-emerald-400 flex-shrink-0" />
                <p className="text-[13px] text-emerald-400 font-semibold">
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
          onClick={() => setIsCreating(true)}
          className="flex flex-col items-center justify-center gap-3 bg-[#0F172A] hover:bg-[#111827] border border-white/6 hover:border-white/12 rounded-[14px] py-8 transition-all cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
            <Plus size={22} className="text-[#D4AF37]" />
          </div>
          <span className="font-semibold text-[#E5E7EB] text-[14px]">Create Routine</span>
        </button>
        <Link
          to="/exercises"
          className="flex flex-col items-center justify-center gap-3 bg-[#0F172A] hover:bg-[#111827] border border-white/6 hover:border-white/12 rounded-[14px] py-8 transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-white/6 flex items-center justify-center">
            <BookOpen size={22} className="text-[#9CA3AF]" />
          </div>
          <span className="font-semibold text-[#E5E7EB] text-[14px]">Browse Exercises</span>
        </Link>
      </div>

      {/* Create Routine form */}
      {isCreating && (
        <div className="bg-[#0F172A] border border-[#D4AF37]/25 rounded-[14px] p-5 mb-8 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <p className="font-semibold text-[#E5E7EB] text-[15px]">Name your routine</p>
            <button onClick={() => setIsCreating(false)} className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors cursor-pointer">
              <X size={17} />
            </button>
          </div>
          <form onSubmit={handleCreateRoutine} className="flex gap-3">
            <input
              type="text"
              value={newRoutineName}
              onChange={e => setNewRoutineName(e.target.value)}
              placeholder="e.g. Upper Body Power"
              autoFocus
              className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-[#E5E7EB] text-[14px] placeholder-[#4B5563] focus:outline-none focus:border-[#D4AF37]/50 transition-colors"
            />
            <button type="submit" disabled={creating} className="btn-primary px-5 py-3 text-[14px] disabled:opacity-50">
              {creating ? '…' : 'Create'}
            </button>
          </form>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-white/8 mb-8">
        {[
          { key: 'my-routines',  label: 'My Routines' },
          { key: 'gym-programs', label: `Gym Programs${enrolledIds.size ? ` (${enrolledIds.size})` : ''}` },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3.5 text-[13px] font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab.key
                ? 'text-[#D4AF37] border-[#D4AF37]'
                : 'text-[#6B7280] border-transparent hover:text-[#9CA3AF]'
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
                <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[76px] animate-pulse" />
              ))}
            </div>
          ) : routines.length === 0 ? (
            <div className="text-center py-20 text-[#6B7280]">
              <Dumbbell size={40} className="mx-auto mb-4 opacity-20" />
              <p className="text-[15px]">No routines yet</p>
              <p className="text-[13px] mt-1">Create your first routine above</p>
            </div>
          ) : (
            routines.map(routine => (
              <div
                key={routine.id}
                className="bg-[#0F172A] rounded-[14px] border border-white/6 flex items-center gap-3 px-4 py-3.5 hover:border-white/12 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/8 flex items-center justify-center flex-shrink-0">
                  <Dumbbell size={16} className="text-[#D4AF37]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#E5E7EB] text-[15px] truncate">{routine.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[12px] text-[#6B7280]">
                    <span className="flex items-center gap-1"><Dumbbell size={10} /> {routine.exerciseCount} ex</span>
                    <span className="flex items-center gap-1 truncate"><Clock size={10} className="flex-shrink-0" /> {formatLastPerformed(routine.lastPerformedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={(e) => handleDelete(e, routine.id)}
                    disabled={deletingId === routine.id}
                    className="w-9 h-9 rounded-lg bg-white/4 hover:bg-red-500/10 flex items-center justify-center text-[#6B7280] hover:text-red-400 transition-colors border border-white/6 cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                  <Link
                    to={`/workouts/${routine.id}/edit`}
                    className="w-9 h-9 rounded-lg bg-white/4 hover:bg-white/8 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors border border-white/6 cursor-pointer"
                  >
                    <Pencil size={14} />
                  </Link>
                  <Link
                    to={`/session/${routine.id}`}
                    className="w-9 h-9 rounded-xl bg-[#D4AF37] hover:bg-[#E6C766] flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer active:scale-95"
                    style={{ boxShadow: '0 0 10px rgba(212,175,55,0.3)' }}
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
                <div key={i} className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[100px] animate-pulse" />
              ))}
            </div>
          ) : gymPrograms.length === 0 ? (
            <div className="text-center py-20 text-[#6B7280]">
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
                  className={`text-left bg-[#0F172A] rounded-[14px] border transition-colors overflow-hidden w-full ${enrolled ? 'border-[#D4AF37]/25 hover:border-[#D4AF37]/40' : 'border-white/6 hover:border-white/12'}`}
                >
                  <div className={`h-[3px] w-full ${enrolled ? 'bg-[#D4AF37]' : 'bg-white/10'}`} />
                  <div className="p-5 flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${enrolled ? 'bg-[#D4AF37]/12' : 'bg-white/6'}`}>
                      <Dumbbell size={18} className={enrolled ? 'text-[#D4AF37]' : 'text-[#6B7280]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[15px] font-bold text-[#E5E7EB]">{prog.name}</h3>
                        {enrolled && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 size={9} /> Enrolled
                          </span>
                        )}
                      </div>
                      {prog.description && (
                        <p className="text-[12px] text-[#9CA3AF] mt-1 line-clamp-2">{prog.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-[12px] text-[#6B7280]">
                        <span className="flex items-center gap-1"><Clock size={11} /> {prog.duration_weeks} weeks</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-[#4B5563] flex-shrink-0 mt-1" />
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
