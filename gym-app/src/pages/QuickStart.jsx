import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Play, Plus, Dumbbell, ChevronRight, ChevronDown, Clock, X, CheckCircle2, Zap, Pencil, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { timeAgo as formatTimeAgo } from '../lib/dateUtils';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import { exercises as exerciseLibrary } from '../data/exercises';
import { useTranslation } from 'react-i18next';
import CreateRoutineModal from '../components/CreateRoutineModal';

// Video lookup
const videoMap = {};
for (const ex of exerciseLibrary) {
  if (ex.videoUrl) videoMap[ex.id] = ex.videoUrl;
}

const CYCLE_MS = 3500;

const QuickStart = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const [routines, setRoutines] = useState([]);
  const [todayRoutine, setTodayRoutine] = useState(null);
  const [todayExercises, setTodayExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showOther, setShowOther] = useState(false);
  const [cycleIndex, setCycleIndex] = useState(0);
  const [todayCompleted, setTodayCompleted] = useState(false);
  const [completedSession, setCompletedSession] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedRoutineId, setExpandedRoutineId] = useState(null);
  const [expandedExercises, setExpandedExercises] = useState([]);
  const [loadingExercises, setLoadingExercises] = useState(false);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const todayDow = new Date().getDay();

      const [{ data: routineData }, { data: sessionData }, scheduleRes] = await Promise.all([
        supabase
          .from('routines')
          .select('id, name, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name))')
          .eq('created_by', user.id)
          .eq('is_template', false)
          .order('created_at', { ascending: false }),
        supabase
          .from('workout_sessions')
          .select('id, routine_id, name, completed_at, duration_seconds, total_volume_lbs')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false }),
        supabase
          .from('workout_schedule')
          .select('day_of_week, routine_id')
          .eq('profile_id', user.id),
      ]);

      const allRoutines = routineData || [];
      const sessions = sessionData || [];

      // Build last-performed map
      const lastPerformed = {};
      sessions.forEach(s => {
        if (s.routine_id && !lastPerformed[s.routine_id]) {
          lastPerformed[s.routine_id] = s.completed_at;
        }
      });

      const enriched = allRoutines.map(r => ({
        ...r,
        exerciseCount: r.routine_exercises?.length ?? 0,
        lastPerformedAt: lastPerformed[r.id] || null,
      }));
      setRoutines(enriched);

      // Find today's scheduled routine
      let todayR = null;
      if (!scheduleRes.error && scheduleRes.data) {
        const todaySchedule = scheduleRes.data.find(s => s.day_of_week === todayDow);
        if (todaySchedule) {
          todayR = allRoutines.find(r => r.id === todaySchedule.routine_id) || null;
        }
      }

      // Fallback: least recently done
      if (!todayR && enriched.length > 0) {
        const sorted = [...enriched].sort((a, b) => {
          if (!a.lastPerformedAt && !b.lastPerformedAt) return 0;
          if (!a.lastPerformedAt) return -1;
          if (!b.lastPerformedAt) return 1;
          return new Date(a.lastPerformedAt) - new Date(b.lastPerformedAt);
        });
        todayR = sorted[0];
      }

      if (todayR) {
        setTodayRoutine(todayR);
        const exs = (todayR.routine_exercises || [])
          .sort((a, b) => (a.position || 0) - (b.position || 0))
          .map(ex => ({
            name: ex.exercises?.name || 'Exercise',
            sets: ex.target_sets,
            reps: ex.target_reps,
            video: videoMap[ex.exercise_id] || null,
          }));
        setTodayExercises(exs);

        // Check if this routine was already completed today
        const todayStr = new Date().toDateString();
        const doneSession = sessions.find(
          s => s.routine_id === todayR.id && new Date(s.completed_at).toDateString() === todayStr
        );
        setTodayCompleted(!!doneSession);
        if (doneSession) setCompletedSession(doneSession);
      }

      setLoading(false);
    };

    load();
  }, [user]);

  // Cycle through exercises for hero preview
  useEffect(() => {
    if (todayExercises.length <= 1) return;
    const timer = setInterval(() => {
      setCycleIndex(prev => (prev + 1) % todayExercises.length);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [todayExercises.length]);

  const currentEx = todayExercises[cycleIndex] || {};
  const otherRoutines = routines.filter(r => r.id !== todayRoutine?.id);

  const handleToggleExpand = async (routineId) => {
    if (expandedRoutineId === routineId) {
      setExpandedRoutineId(null);
      setExpandedExercises([]);
      return;
    }
    setExpandedRoutineId(routineId);
    setLoadingExercises(true);
    // The routine data already has routine_exercises from the initial query
    const routine = routines.find(r => r.id === routineId);
    if (routine?.routine_exercises?.length > 0) {
      const exs = [...routine.routine_exercises]
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map(ex => ({
          name: ex.exercises?.name || 'Exercise',
          sets: ex.target_sets,
          reps: ex.target_reps,
        }));
      setExpandedExercises(exs);
    } else {
      setExpandedExercises([]);
    }
    setLoadingExercises(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <Skeleton variant="page" />
      </div>
    );
  }

  return (
    <FadeIn>
    <div className="min-h-screen bg-[#05070B] px-5 pt-4 pb-28">
      <div className="max-w-[480px] mx-auto space-y-5">

        {/* Header */}
        <div data-tour="tour-quickstart-page">
          <h1 className="text-[26px] font-black text-[#E5E7EB] tracking-tight">{t('quickStart.startWorkout')}</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">
            {todayCompleted ? t('quickStart.greatWorkToday') : todayRoutine ? t('quickStart.todaysWorkoutReady') : t('quickStart.pickRoutineAndGo')}
          </p>
        </div>

        {/* ── TODAY'S WORKOUT HERO ─────────────────────────────── */}
        {todayRoutine && todayCompleted && completedSession ? (
          /* ── COMPLETED STATE — matches Dashboard hero ── */
          <div className="w-full rounded-2xl bg-gradient-to-br from-[#10B981]/8 to-[#10B981]/[0.01] border border-[#10B981]/15 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-[#10B981]" />
            </div>
            <p className="font-bold text-[18px] text-[#E5E7EB]">{t('quickStart.workoutAlreadyCompleted', 'Workout Already Completed')}</p>
            <p className="text-[13px] text-[#6B7280] mt-1.5 mb-5">
              Great job today! Your <span className="text-[#10B981] font-semibold">{todayRoutine.name?.replace('Auto: ', '').replace(/ [AB]$/, '')}</span> session is done.
            </p>

            {/* Link to session summary */}
            {(() => {
              const vol = parseFloat(completedSession.total_volume_lbs) || 0;
              const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;
              return (
                <Link
                  to="/session-summary"
                  state={{
                    routineName: completedSession.name || todayRoutine.name,
                    elapsedTime: completedSession.duration_seconds,
                    totalVolume: vol,
                    completedSets: 0,
                    sessionId: completedSession.id,
                    completedAt: completedSession.completed_at,
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-3 text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                    <Trophy size={16} className="text-[#10B981]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{completedSession.name || todayRoutine.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#6B7280]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <span>{Math.round((completedSession.duration_seconds || 0) / 60)}m</span>
                      <span className="text-white/[0.06]">&middot;</span>
                      <span>{volStr} lbs</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium text-[#10B981]">View summary</span>
                </Link>
              );
            })()}

            <button
              onClick={() => navigate('/workouts')}
              className="w-full py-3.5 rounded-2xl text-[13px] font-bold text-[#E5E7EB] bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
            >
              {t('quickStart.doAnotherWorkout', 'Do Another Workout')}
            </button>
          </div>
        ) : todayRoutine ? (
          <button
            type="button"
            onClick={() => navigate(`/session/${todayRoutine.id}`)}
            className="relative w-full rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform"
            style={{ aspectRatio: '4 / 3' }}
          >
            {/* Cycling video/gradient background */}
            <AnimatePresence mode="wait">
              <motion.div
                key={cycleIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0"
              >
                {currentEx.video ? (
                  <video
                    src={currentEx.video}
                    autoPlay loop muted playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#1a1f35] to-[#0a0f1a]" />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/10 z-[1]" />
            <div className="absolute top-0 left-0 right-0 h-[2px] z-[2] bg-gradient-to-r from-transparent via-[#D4AF37]/40 to-transparent" />

            {/* Exercise dots */}
            {todayExercises.length > 1 && (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
                {todayExercises.map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-300 ${
                      i === cycleIndex ? 'w-4 h-1.5 bg-white/80' : 'w-1.5 h-1.5 bg-white/25'
                    }`}
                  />
                ))}
              </div>
            )}

            {/* Content */}
            <div className="relative z-10 h-full flex flex-col justify-end p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] mb-2 text-[#D4AF37]">
                {t('quickStart.todaysWorkout')}
              </p>
              <h2 className="text-[24px] font-black text-white tracking-tight leading-tight">
                {todayRoutine.name?.replace('Auto: ', '').replace(/ [AB]$/, '')}
              </h2>

              {/* Current exercise info */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={cycleIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="text-[13px] text-white/50 mt-1"
                >
                  {currentEx.name} — {currentEx.sets}×{currentEx.reps}
                </motion.p>
              </AnimatePresence>

              <p className="text-[12px] text-white/30 mt-1 mb-4">
                {todayExercises.length} {t('quickStart.exercises')}
              </p>

              {/* CTA */}
              <div className="w-full py-5 rounded-2xl flex items-center justify-center gap-2.5 bg-[#D4AF37] shadow-[0_4px_24px_rgba(212,175,55,0.3)]">
                <Play size={20} className="text-black" fill="black" strokeWidth={0} />
                <span className="text-[18px] font-black tracking-wide uppercase text-black">
                  {t('quickStart.startWorkout')}
                </span>
              </div>
            </div>
          </button>
        ) : (
          /* No routines at all */
          <div className="rounded-2xl bg-[#0F172A] border border-white/[0.06] p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Dumbbell size={28} className="text-[#4B5563]" />
            </div>
            <p className="font-bold text-[#E5E7EB] text-[16px]">{t('quickStart.noRoutinesYet')}</p>
            <p className="text-[13px] text-[#6B7280] mt-1.5 mb-5">{t('quickStart.createToGetStarted')}</p>
            <button
              onClick={() => navigate('/workouts')}
              className="inline-block py-3 px-8 rounded-2xl bg-[#D4AF37] text-black font-bold text-[14px]"
            >
              {t('quickStart.createRoutine')}
            </button>
          </div>
        )}

        {/* ── START ANOTHER — two big cards ──────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Choose Existing */}
          <button
            type="button"
            onClick={() => setShowOther(v => !v)}
            className="rounded-[16px] bg-[#0F172A] border border-white/[0.06] hover:border-white/[0.12] p-4 text-left transition-colors active:scale-[0.97]"
          >
            <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3">
              <Dumbbell size={20} className="text-[#9CA3AF]" />
            </div>
            <p className="text-[14px] font-bold text-[#E5E7EB]">{t('quickStart.chooseRoutine')}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              {otherRoutines.length} {t('quickStart.available')}
            </p>
          </button>

          {/* Create New */}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="rounded-[16px] bg-[#0F172A] border border-dashed border-[#D4AF37]/20 hover:border-[#D4AF37]/40 p-4 text-left transition-colors active:scale-[0.97]"
          >
            <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center mb-3">
              <Plus size={20} className="text-[#D4AF37]" />
            </div>
            <p className="text-[14px] font-bold text-[#D4AF37]">{t('quickStart.createNew')}</p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              {t('quickStart.buildWorkout')}
            </p>
          </button>
        </div>

        {/* ── ROUTINE LIST (expanded) ─────────────────────────── */}
        <AnimatePresence>
          {showOther && otherRoutines.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="space-y-1.5">
                {otherRoutines.map(r => {
                  const isExpanded = expandedRoutineId === r.id;
                  return (
                    <div key={r.id}>
                      <button
                        onClick={() => handleToggleExpand(r.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#0F172A] border transition-colors text-left active:scale-[0.99] ${
                          isExpanded ? 'border-[#D4AF37]/30' : 'border-white/[0.06] hover:border-white/[0.1]'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                          <Dumbbell size={16} className="text-[#6B7280]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">
                            {r.name?.replace('Auto: ', '').replace(/ [AB]$/, '')}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            {r.exerciseCount} {t('quickStart.exercises')}
                            {r.lastPerformedAt && ` · ${formatTimeAgo(r.lastPerformedAt)}`}
                          </p>
                        </div>
                        <ChevronDown size={14} className={`text-[#4B5563] shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Expanded exercise details */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-1 ml-2 mr-2 rounded-xl bg-[#111827] border border-white/[0.04] p-4">
                              {loadingExercises ? (
                                <p className="text-[12px] text-[#6B7280]">Loading...</p>
                              ) : expandedExercises.length === 0 ? (
                                <p className="text-[12px] text-[#6B7280]">No exercises yet. Tap Edit to add some.</p>
                              ) : (
                                <div className="space-y-1.5 mb-4">
                                  {expandedExercises.map((ex, i) => (
                                    <div key={i} className="flex items-center justify-between">
                                      <p className="text-[13px] text-[#E5E7EB] truncate flex-1">{ex.name}</p>
                                      <p className="text-[12px] text-[#6B7280] ml-3 shrink-0">{ex.sets}&times;{ex.reps}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2 mt-3">
                                <button
                                  onClick={() => navigate(`/workouts/${r.id}/edit?from=/quick-start`)}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold bg-white/[0.06] border border-white/[0.06] text-[#E5E7EB] hover:bg-white/[0.1] transition-colors"
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  onClick={() => navigate(`/session/${r.id}`)}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black transition-colors"
                                >
                                  <Play size={14} fill="black" strokeWidth={0} />
                                  Start
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>

    {showCreateModal && (
      <CreateRoutineModal
        onClose={() => setShowCreateModal(false)}
        onSave={async ({ name, exercises: exs }) => {
          // Create routine in DB
          const { data: routine, error: routineErr } = await supabase
            .from('routines')
            .insert({ name, created_by: user.id, gym_id: profile.gym_id, is_template: false })
            .select('id')
            .single();
          if (routineErr) throw routineErr;

          // Insert exercises if any
          if (exs?.length > 0) {
            const rows = exs.map((ex, i) => ({
              routine_id: routine.id, exercise_id: ex.id, position: i + 1,
              target_sets: ex.sets, target_reps: ex.reps, rest_seconds: ex.restSeconds,
            }));
            await supabase.from('routine_exercises').insert(rows);
          }

          // Route based on whether exercises were added
          if (exs?.length > 0) {
            navigate(`/session/${routine.id}`);
          } else {
            navigate(`/workouts/${routine.id}/edit?from=/quick-start`);
          }
        }}
      />
    )}
    </FadeIn>
  );
};

export default QuickStart;
