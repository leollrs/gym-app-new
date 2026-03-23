import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Plus, Dumbbell, ChevronRight, ChevronDown, Clock, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { timeAgo as formatTimeAgo } from '../lib/dateUtils';
import Skeleton from '../components/Skeleton';
import FadeIn from '../components/FadeIn';
import { exercises as exerciseLibrary } from '../data/exercises';
import { useTranslation } from 'react-i18next';

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
          .select('routine_id, completed_at')
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center">
        <Skeleton variant="page" />
      </div>
    );
  }

  return (
    <FadeIn>
    <div className="min-h-screen bg-[#05070B] px-5 pt-4 pb-28" data-tour="tour-quickstart-page">
      <div className="max-w-[480px] mx-auto space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-[26px] font-black text-[#E5E7EB] tracking-tight">{t('quickStart.startWorkout')}</h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5">
            {todayRoutine ? t('quickStart.todaysWorkoutReady') : t('quickStart.pickRoutineAndGo')}
          </p>
        </div>

        {/* ── TODAY'S WORKOUT HERO ─────────────────────────────── */}
        {todayRoutine ? (
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
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#D4AF37]/40 to-transparent z-[2]" />

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
              <p className="text-[11px] font-bold text-[#D4AF37] uppercase tracking-[0.15em] mb-2">
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
              <div className="w-full py-5 rounded-2xl bg-[#D4AF37] shadow-[0_4px_24px_rgba(212,175,55,0.3)] flex items-center justify-center gap-2.5">
                <Play size={20} className="text-black" fill="black" strokeWidth={0} />
                <span className="text-[18px] font-black text-black tracking-wide uppercase">
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
            onClick={() => navigate('/workouts')}
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
                {otherRoutines.map(r => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/session/${r.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#0F172A] border border-white/[0.06] hover:border-white/[0.1] transition-colors text-left active:scale-[0.99]"
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
                    <ChevronRight size={14} className="text-[#4B5563] shrink-0" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
    </FadeIn>
  );
};

export default QuickStart;
