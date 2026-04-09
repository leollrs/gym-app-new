import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Play, Plus, Dumbbell, ChevronRight, ChevronDown, Clock, X, CheckCircle2, Zap, Pencil, Trophy, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { timeAgo as formatTimeAgo } from '../lib/dateUtils';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import { exercises as exerciseLibrary } from '../data/exercises';
import { localizeRoutineName } from '../lib/exerciseName';
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
  const [isRestDay, setIsRestDay] = useState(false);
  const [isGymClosed, setIsGymClosed] = useState(false);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const todayDow = new Date().getDay();

      const [{ data: routineData }, { data: sessionData }, scheduleRes, progRes] = await Promise.all([
        supabase
          .from('routines')
          .select('id, name, created_at, routine_exercises(id, exercise_id, target_sets, target_reps, position, exercises(name))')
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
        supabase
          .from('generated_programs')
          .select('id, program_start, split_type, expires_at, routines_a_count')
          .eq('profile_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const allRoutines = routineData || [];
      const sessions = sessionData || [];
      const fetchedProgram = !progRes.error ? progRes.data : null;
      const programStart = fetchedProgram ? new Date(fetchedProgram.program_start) : null;

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

      // Build schedule map (same logic as Dashboard)
      const scheduleData = !scheduleRes.error ? (scheduleRes.data || []) : [];
      const scheduleMap = {};
      for (const row of scheduleData) {
        const routine = allRoutines.find(r => r.id === row.routine_id);
        if (routine) {
          // When an active program exists, only include Auto: routines created
          // after the program start — filters out stale manual schedule entries
          if (fetchedProgram) {
            const isAutoRoutine = routine.name.startsWith('Auto:');
            const createdAfterProgram = new Date(routine.created_at || 0) >= programStart;
            if (!isAutoRoutine || !createdAfterProgram) continue;
          }
          scheduleMap[row.day_of_week] = row.routine_id;
        }
      }

      // Find today's scheduled routine using schedule map
      let todayR = null;
      if (scheduleMap[todayDow]) {
        todayR = allRoutines.find(r => r.id === scheduleMap[todayDow]) || null;
      }

      // Check if gym is closed today
      try {
        const { data: gymHours } = await supabase
          .from('gym_hours')
          .select('is_closed')
          .eq('gym_id', profile?.gym_id)
          .eq('day_of_week', todayDow)
          .maybeSingle();
        if (gymHours?.is_closed) {
          setIsGymClosed(true);
        }
      } catch { /* table may not exist */ }

      // If there's a schedule with entries but nothing for today → rest day
      const hasAnySchedule = Object.keys(scheduleMap).length > 0;
      if (!todayR && hasAnySchedule) {
        setIsRestDay(true);
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg-primary)' }}>
        <Skeleton variant="page" />
      </div>
    );
  }

  return (
    <FadeIn>
    <div className="min-h-screen px-4 pt-4 pb-28 md:pb-12" style={{ background: 'var(--color-bg-primary)' }}>
      <div className="max-w-[480px] md:max-w-4xl lg:max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div data-tour="tour-quickstart-page">
          <h1 className="text-[22px] font-black tracking-tight truncate" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.startWorkout')}</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
            {isGymClosed ? t('dashboard.gymClosed', 'Gym Closed') : todayCompleted ? t('quickStart.greatWorkToday') : isRestDay && !todayRoutine ? t('quickStart.noWorkoutScheduled', 'No workout scheduled today') : todayRoutine ? t('quickStart.todaysWorkoutReady') : t('quickStart.pickRoutineAndGo')}
          </p>
        </div>

        {/* ── TODAY'S WORKOUT HERO ─────────────────────────────── */}
        {isGymClosed ? (
          /* ── GYM CLOSED STATE ── */
          <div className="w-full rounded-2xl bg-red-500/5 border border-red-500/15 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-[28px]">🔒</span>
            </div>
            <p className="font-bold text-[18px] text-red-400">{t('dashboard.gymClosed', 'Gym Closed')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('dashboard.gymClosedMessage', 'The gym is closed today. Rest up and come back stronger!')}
            </p>
            <button
              onClick={() => setShowOther(v => !v)}
              className="inline-flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl text-[13px] font-bold text-black transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              <Dumbbell size={15} />
              {t('dashboard.trainOutsideGym', 'Want to train outside the gym?')}
            </button>
          </div>
        ) : isRestDay && !todayRoutine ? (
          /* ── REST DAY STATE ── */
          <div className="w-full rounded-2xl bg-gradient-to-br from-[#6B7280]/8 to-[#6B7280]/[0.01] border border-white/[0.06] p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
              <Moon size={28} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="font-bold text-[18px]" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.restDay', 'Rest Day')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('quickStart.restDayMessage', 'No workout scheduled for today. Rest up and come back stronger!')}
            </p>
            <button
              onClick={() => setShowOther(v => !v)}
              className="w-full py-3.5 rounded-2xl text-[13px] font-bold bg-white/[0.06] hover:bg-white/[0.10] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t('quickStart.startAnywayButton', 'Start a Workout Anyway')}
            </button>
          </div>
        ) : todayRoutine && todayCompleted && completedSession ? (
          /* ── COMPLETED STATE — matches Dashboard hero ── */
          <div className="w-full rounded-2xl bg-gradient-to-br from-[#10B981]/8 to-[#10B981]/[0.01] border border-[#10B981]/15 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={28} className="text-[#10B981]" />
            </div>
            <p className="font-bold text-[18px]" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.workoutAlreadyCompleted', 'Workout Already Completed')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>
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
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.08] transition-colors mb-3 text-left focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                    <Trophy size={16} className="text-[#10B981]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{completedSession.name || todayRoutine.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px]" style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
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
              className="w-full py-3.5 rounded-2xl text-[13px] font-bold bg-white/[0.06] hover:bg-white/[0.10] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t('quickStart.doAnotherWorkout', 'Do Another Workout')}
            </button>
          </div>
        ) : todayRoutine ? (
          <button
            type="button"
            onClick={() => navigate(`/session/${todayRoutine.id}`)}
            className="relative w-full rounded-2xl overflow-hidden text-left active:scale-[0.98] transition-transform focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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
                    aria-label={t('quickStart.exerciseDemo', { name: currentEx.name || 'Exercise' })}
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
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1" role="tablist" aria-label={t('quickStart.exerciseIndicators', 'Exercise indicators')}>
                {todayExercises.map((ex, i) => (
                  <div
                    key={i}
                    role="tab"
                    aria-selected={i === cycleIndex}
                    aria-label={`${ex.name || `Exercise ${i + 1}`}`}
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
              <h2 className="text-[18px] font-black text-white tracking-tight leading-tight truncate">
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
                  className="text-[13px] text-white/70 mt-1"
                >
                  {currentEx.name} — {currentEx.sets}×{currentEx.reps}
                </motion.p>
              </AnimatePresence>

              <p className="text-[12px] text-white/60 mt-1 mb-4">
                {todayExercises.length} {t('quickStart.exercises')}
              </p>

              {/* CTA */}
              <div className="w-full py-5 rounded-2xl flex items-center justify-center gap-2.5 bg-[#D4AF37] shadow-[0_4px_24px_rgba(212,175,55,0.3)]">
                <Play size={20} className="text-black" fill="black" strokeWidth={0} />
                <span className="text-[14px] font-black tracking-wide uppercase text-black whitespace-nowrap">
                  {t('quickStart.startWorkout')}
                </span>
              </div>
            </div>
          </button>
        ) : (
          /* No routines at all */
          <div className="rounded-2xl border border-white/[0.06] p-8 text-center" style={{ background: 'var(--color-bg-card)' }}>
            <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <Dumbbell size={28} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="font-bold text-[16px]" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.noRoutinesYet')}</p>
            <p className="text-[13px] mt-1.5 mb-5" style={{ color: 'var(--color-text-subtle)' }}>{t('quickStart.createToGetStarted')}</p>
            <button
              onClick={() => navigate('/workouts')}
              className="inline-block py-3 px-8 rounded-2xl bg-[#D4AF37] text-black font-bold text-[14px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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
            className="rounded-[16px] border border-white/[0.06] hover:border-white/[0.12] p-4 text-left transition-colors active:scale-[0.97] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ background: 'var(--color-bg-card)' }}
          >
            <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3">
              <Dumbbell size={20} style={{ color: 'var(--color-text-muted)' }} />
            </div>
            <p className="text-[14px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('quickStart.chooseRoutine')}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {otherRoutines.length} {t('quickStart.available')}
            </p>
          </button>

          {/* Quick Start Empty */}
          <button
            type="button"
            onClick={() => navigate('/session/empty')}
            className="rounded-[16px] border border-dashed border-[#D4AF37]/20 hover:border-[#D4AF37]/40 p-4 text-left transition-colors active:scale-[0.97] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ background: 'var(--color-bg-card)' }}
          >
            <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center mb-3">
              <Zap size={20} className="text-[#D4AF37]" />
            </div>
            <p className="text-[14px] font-bold text-[#D4AF37]">{t('quickStart.startEmptyWorkout')}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
              {t('quickStart.addExercisesAsYouGo')}
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
              <div className="space-y-1.5 pb-28">
                {otherRoutines.map(r => {
                  const isExpanded = expandedRoutineId === r.id;
                  return (
                    <div key={r.id}>
                      <button
                        onClick={() => handleToggleExpand(r.id)}
                        aria-expanded={isExpanded}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-colors text-left active:scale-[0.99] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none ${
                          isExpanded ? 'border-[#D4AF37]/30' : 'border-white/[0.06] hover:border-white/[0.1]'
                        }`}
                        style={{ background: 'var(--color-bg-card)' }}
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                          <Dumbbell size={16} style={{ color: 'var(--color-text-subtle)' }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                            {localizeRoutineName(r.name).replace(/ [AB]$/, '')}
                          </p>
                          <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>
                            {r.exerciseCount} {t('quickStart.exercises')}
                            {r.lastPerformedAt && ` · ${formatTimeAgo(r.lastPerformedAt)}`}
                          </p>
                        </div>
                        <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-muted)' }} />
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
                            <div className="mt-1 ml-2 mr-2 rounded-xl border border-white/[0.04] p-4" style={{ background: 'var(--color-bg-card)' }}>
                              {loadingExercises ? (
                                <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>Loading...</p>
                              ) : expandedExercises.length === 0 ? (
                                <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>No exercises yet. Tap Edit to add some.</p>
                              ) : (
                                <div className="space-y-1.5 mb-4">
                                  {expandedExercises.map((ex, i) => (
                                    <div key={i} className="flex items-center justify-between">
                                      <p className="text-[13px] truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>{ex.name}</p>
                                      <p className="text-[12px] ml-3 shrink-0" style={{ color: 'var(--color-text-subtle)' }}>{ex.sets}&times;{ex.reps}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-2 mt-3">
                                <button
                                  onClick={() => navigate(`/workouts/${r.id}/edit?from=/quick-start`)}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.1] transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                                  style={{ color: 'var(--color-text-primary)' }}
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  onClick={() => navigate(`/session/${r.id}`)}
                                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
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
