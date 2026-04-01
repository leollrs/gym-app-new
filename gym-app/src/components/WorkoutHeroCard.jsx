import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Timer, CheckCircle2 } from 'lucide-react';
import { exName } from '../lib/exerciseName';

const CYCLE_INTERVAL = 4000; // ms per exercise

const WorkoutHeroCard = ({
  routineId,
  exercises = [],
  isActive = false,
  isCompleted = false,
  activeSetsCompleted = 0,
  activeSetsTotal = 0,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [videoReady, setVideoReady] = useState(false);

  // Reset video ready state when the current exercise changes
  useEffect(() => {
    setVideoReady(false);
  }, [currentIndex]);

  const handleVideoReady = useCallback(() => {
    setVideoReady(true);
  }, []);

  // Cycle through exercises
  useEffect(() => {
    if (exercises.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % exercises.length);
    }, CYCLE_INTERVAL);
    return () => clearInterval(timer);
  }, [exercises.length]);

  const current = exercises[currentIndex] || {};
  const exerciseName = exName(current) || t('workoutHeroCard.workout');
  const exerciseVideo = current.video || null;
  const hasMedia = !!exerciseVideo;

  const fallbackBg = 'linear-gradient(145deg, var(--color-bg-deep) 0%, var(--color-bg-secondary) 50%, var(--color-bg-primary) 100%)';

  return (
    <motion.button
      type="button"
      onClick={() => navigate(`/session/${routineId}`)}
      aria-label={exerciseName}
      className="relative w-full rounded-[20px] overflow-hidden text-left group focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
      style={{ aspectRatio: '9 / 10' }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Background: cycling video/gradient */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="absolute inset-0"
        >
          {/* Always render the gradient placeholder */}
          <div className="w-full h-full" style={{ background: fallbackBg }}>
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
                backgroundSize: '24px 24px',
              }}
            />
          </div>
          {/* Video loads on top and fades in when ready */}
          {exerciseVideo && (
            <video
              key={exerciseVideo}
              src={exerciseVideo}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              onCanPlay={handleVideoReady}
              aria-label={exerciseName}
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
              style={{ opacity: videoReady ? 1 : 0 }}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Dark backdrop — always present so white text is readable */}
      <div className={`absolute inset-0 z-[1] ${hasMedia ? 'bg-black/50' : 'bg-black/40'}`} />
      {/* Gradient overlay */}
      <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/90 via-black/40 to-black/30" />

      {/* Accent glow */}
      {isActive ? (
        <div className="absolute top-0 left-0 right-0 h-1 z-[2] bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />
      ) : (
        <div className="absolute top-0 left-0 right-0 h-[2px] z-[2] bg-gradient-to-r from-transparent via-[#D4AF37]/40 to-transparent" />
      )}

      {/* Content */}
      <div className="relative z-10 h-full flex flex-col justify-end p-5">
        {/* Status badge */}
        {isActive && (
          <div className="absolute top-4 left-5 flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                {t('dashboard.inProgress')}
              </span>
            </div>
          </div>
        )}

        {/* Exercise counter dots */}
        {exercises.length > 1 && (
          <div className="absolute top-4 right-5 flex items-center gap-1">
            {exercises.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === currentIndex
                    ? 'w-4 h-1.5 bg-white/80'
                    : 'w-1.5 h-1.5 bg-white/25'
                }`}
              />
            ))}
          </div>
        )}

        {/* Exercise info */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-[13px] font-medium mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {t('workoutHeroCard.exerciseXOfY', { current: currentIndex + 1, total: exercises.length })}
            </p>
            <h3 className="text-[18px] font-black tracking-tight leading-tight truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>
              {exerciseName}
            </h3>
            {current.sets && current.reps && (
              <p className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {t('workoutHeroCard.setsXReps', { sets: current.sets, reps: current.reps })}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Suggested routine hint */}
        <p className="text-[10px] mt-3 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {t('dashboard.suggestedRoutineHint')}
        </p>

        {/* CTA Button */}
        <div
          className={`w-full py-4 rounded-2xl flex items-center justify-center gap-2.5 transition-all mt-2 ${
            isCompleted
              ? 'bg-emerald-500/20 border border-emerald-500/30'
              : isActive
              ? 'bg-emerald-500 shadow-[0_4px_24px_rgba(16,185,129,0.3)]'
              : 'bg-[#D4AF37] shadow-[0_4px_24px_rgba(212,175,55,0.3)]'
          }`}
        >
          {isCompleted ? (
            <CheckCircle2 size={18} className="text-emerald-400" strokeWidth={2.5} />
          ) : isActive ? (
            <Timer size={18} className="text-black" strokeWidth={2.5} />
          ) : (
            <Play size={18} className="text-black" fill="black" strokeWidth={0} />
          )}
          <span className={`text-[13px] font-black tracking-wide uppercase ${
            isCompleted ? 'text-emerald-400' : 'text-black'
          }`}>
            {isCompleted ? t('workoutHeroCard.workoutCompleted', 'Workout Completed') : isActive ? t('workoutHeroCard.resumeWorkout') : t('workoutHeroCard.startWorkout')}
          </span>
        </div>
      </div>
    </motion.button>
  );
};

export default WorkoutHeroCard;
