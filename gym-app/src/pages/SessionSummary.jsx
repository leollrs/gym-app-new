import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Dumbbell, Clock, Zap, BarChart2, CheckCircle, Heart, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { writeWorkout } from '../lib/healthSync';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';
import { awardAchievements } from '../lib/achievements';
import AchievementToast from '../components/AchievementToast';
import { sanitize } from '../lib/sanitize';
import AnimatedCounter from '../components/AnimatedCounter';
import CoolDown from './active-session/CoolDown';
import { formatDurationLong as formatTime } from '../lib/dateUtils';
import { localizeRoutineName } from '../lib/exerciseName';
import { formatStatNumber, statFontSize } from '../lib/formatStatValue';
import { analyzeAndAdapt, saveAdaptationSuggestions } from '../lib/programAdaptation';
import { updateGoalsAfterWorkout } from '../lib/goalUpdater';
import { updateWorkoutSchedulePattern } from '../lib/workoutScheduleTracker';

import { useTranslation } from 'react-i18next';
import i18n from 'i18next';

const MILESTONES = [1, 10, 25, 50, 100, 200, 365];

const StatCard = ({ icon: Icon, label, value, accent }) => {
  const display = typeof value === 'number' ? formatStatNumber(value) : value;
  const fontSize = statFontSize(display, 'text-[24px]');
  return (
    <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-5 flex flex-col items-center gap-2 text-center overflow-hidden min-w-0">
      <Icon size={18} style={{ color: accent || 'var(--color-accent)' }} strokeWidth={2} />
      <p className={`${fontSize} font-black leading-none truncate w-full`} style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{display}</p>
      <p className="text-[11px] uppercase tracking-wider font-semibold truncate w-full" style={{ color: 'var(--color-text-subtle)' }}>{label}</p>
    </div>
  );
};

const SessionSummary = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, profile, gymName, gymLogoUrl } = useAuth();
  const { t, i18n } = useTranslation('pages');
  const [visible, setVisible] = useState(false);
  const [newAchievements, setNewAchievements] = useState([]);

  // Data passed from ActiveSession via navigate state
  const {
    routineName    = 'Workout',
    elapsedTime    = 0,
    totalVolume    = 0,
    completedSets: initialCompletedSets  = 0,
    totalSets: initialTotalSets      = 0,
    totalExercises: initialTotalExercises = 0,
    sessionPRs     = [],
    completedAt    = new Date().toISOString(),
    xpEarned       = 0,
    heartRate      = null,
    streak         = 0,
    workedMuscleGroups = [],
    sessionId      = null,
  } = location.state ?? {};

  // If navigate state has 0 sets but we have a sessionId, fetch from DB
  const [completedSets, setCompletedSets] = useState(initialCompletedSets);
  const [totalSets, setTotalSets] = useState(initialTotalSets);
  const [totalExercises, setTotalExercises] = useState(initialTotalExercises);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !sessionId || initialCompletedSets > 0) return;
    fetchedRef.current = true;
    (async () => {
      const { data } = await supabase
        .from('session_exercises')
        .select('id, session_sets(id)')
        .eq('session_id', sessionId);
      if (data?.length) {
        const sets = data.reduce((sum, ex) => sum + (ex.session_sets?.length || 0), 0);
        setCompletedSets(sets);
        setTotalSets(sets);
        setTotalExercises(data.length);
      }
    })();
  }, [sessionId, initialCompletedSets]);

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Sync completed workout to Apple Health / Health Connect if enabled
  useEffect(() => {
    try {
      const hs = JSON.parse(localStorage.getItem('tugympr_health_settings') || '{}');
      if (hs.syncWorkouts) {
        const end = completedAt ? new Date(completedAt) : new Date();
        const start = new Date(end.getTime() - (elapsedTime || 0) * 1000);
        writeWorkout({
          name: routineName || 'Workout',
          startDate: start,
          endDate: end,
          calories: undefined,
        });
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Milestone + PR notifications
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (!user?.id || !profile?.gym_id) return;
    firedRef.current = true;
    const fire = async () => {
      // Count total completed sessions
      const { count } = await supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('status', 'completed');

      if (MILESTONES.includes(count)) {
        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'workout_reminder',
          title:     count === 1
            ? i18n.t('notifications.workoutsCompletedSingular', { ns: 'common', count, defaultValue: `${count} workout completed!` })
            : i18n.t('notifications.workoutsCompletedPlural', { ns: 'common', count, defaultValue: `${count} workouts completed!` }),
          body:      count === 1
            ? i18n.t('notifications.welcomeJourney', { ns: 'common', defaultValue: 'Welcome to your fitness journey. Keep it up!' })
            : i18n.t('notifications.hitWorkoutsConsistency', { ns: 'common', count, defaultValue: `You've hit ${count} workouts. Consistency is everything.` }),
          dedupKey:  `milestone_${count}_${user.id}`,
        });
      }

      // PR notifications
      if (sessionPRs?.length > 0) {
        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'pr_beaten',
          title:     sessionPRs.length > 1
            ? i18n.t('notifications.newPRsPlural', { ns: 'common', count: sessionPRs.length, defaultValue: `${sessionPRs.length} new PRs this session!` })
            : i18n.t('notifications.newPRsSingular', { ns: 'common', count: sessionPRs.length, defaultValue: `${sessionPRs.length} new PR this session!` }),
          body:      sessionPRs.slice(0, 3).map(p => p.exerciseName ?? p.exercise_name ?? i18n.t('social.feedContent.exercise', { ns: 'pages', defaultValue: 'Exercise' })).join(', '),
          dedupKey:  `pr_session_${completedAt}_${user.id}`,
        });
      }

      // Update challenge scores for any active challenges the user has joined
      const now = new Date().toISOString();
      const { data: myParticipations } = await supabase
        .from('challenge_participants')
        .select('id, challenge_id, score, challenges(type, start_date, end_date, status, exercise_id, scoring_metric, exercise_ids, milestone_target)')
        .eq('profile_id', user.id)
        .eq('gym_id', profile.gym_id);

      const active = (myParticipations || []).filter(p => {
        const c = p.challenges;
        if (!c) return false;
        return new Date(c.start_date) <= new Date(now) && new Date(c.end_date) >= new Date(now);
      });

      for (const p of active) {
        const c = p.challenges;
        const type = c.type;
        let delta = 0;

        if (type === 'consistency') {
          delta = 1;
        } else if (type === 'volume') {
          delta = totalVolume ?? 0;
        } else if (type === 'pr_count') {
          delta = sessionPRs?.length ?? 0;
        } else if (type === 'team') {
          // Team challenges use the base metric from scoring_metric
          const metric = c.scoring_metric || 'consistency';
          if (metric === 'consistency') delta = 1;
          else if (metric === 'volume')  delta = totalVolume ?? 0;
          else if (metric === 'pr_count') delta = sessionPRs?.length ?? 0;
        } else if (type === 'specific_lift' && c.exercise_id) {
          const metric = c.scoring_metric || 'volume';
          if (metric === 'volume' && sessionId) {
            // Query per-exercise volume from this session
            const { data: exSets } = await supabase
              .from('session_sets')
              .select('weight_lbs, reps, session_exercises!inner(exercise_id)')
              .eq('session_exercises.session_id', sessionId)
              .eq('session_exercises.exercise_id', c.exercise_id)
              .eq('is_completed', true);
            delta = (exSets || []).reduce((sum, s) => sum + (s.weight_lbs || 0) * (s.reps || 0), 0);
          } else if (metric === '1rm') {
            // Count PRs for this specific exercise
            const matchingPRs = (sessionPRs || []).filter(pr => pr.exerciseId === c.exercise_id);
            delta = matchingPRs.length;
          }
        } else if (type === 'milestone' && c.exercise_ids?.length > 0) {
          // Club challenge: set score to combined 1RM total across exercises
          const { data: prs } = await supabase
            .from('personal_records')
            .select('exercise_id, estimated_1rm')
            .eq('profile_id', user.id)
            .in('exercise_id', c.exercise_ids);
          const combinedTotal = (prs || []).reduce((sum, pr) => sum + (pr.estimated_1rm || 0), 0);
          // Set absolute score (not delta)
          if (combinedTotal > 0) {
            await supabase.rpc('set_challenge_score', {
              p_participant_id: p.id,
              p_score: combinedTotal,
            });
          }
          continue; // skip the increment below
        }

        if (delta === 0) continue;
        await supabase.rpc('increment_challenge_score', {
          p_participant_id: p.id,
          p_delta: delta,
        });
      }

      // ── Check and award achievements ─────────────────────────────────────
      const newlyEarned = await awardAchievements(user.id, profile.gym_id, supabase);

      // Post activity feed items and notifications for each newly earned achievement
      for (const ach of newlyEarned) {
        await supabase.from('activity_feed_items').insert({
          gym_id:    profile.gym_id,
          actor_id:  user.id,
          type:      'achievement_unlocked',
          is_public: true,
          data: {
            achievement_key:  ach.key,
            achievement_name: ach.label,
            achievement_name_key: ach.labelKey,
            achievement_desc: ach.desc,
            achievement_desc_key: ach.descKey,
          },
        });

        const achLabel = ach.labelKey ? i18n.t(ach.labelKey, { ns: 'common', defaultValue: ach.label }) : ach.label;
        const achDesc  = ach.descKey ? i18n.t(ach.descKey, { ns: 'common', defaultValue: ach.desc }) : ach.desc;
        const quotedLabel = i18n.language === 'es' ? `\u00AB${achLabel}\u00BB` : `\u201C${achLabel}\u201D`;
        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'achievement',
          title:     i18n.t('notifications.achievementUnlocked', { ns: 'common', label: quotedLabel, defaultValue: `Achievement Unlocked: ${quotedLabel}` }),
          body:      achDesc,
          dedupKey:  `achievement_${ach.key}_${user.id}`,
        });
      }

      if (newlyEarned.length > 0) {
        setNewAchievements(newlyEarned);
      }

      // Run program adaptation analysis in the background
      try {
        const adaptations = await analyzeAndAdapt(user.id, profile.gym_id);
        if (adaptations) {
          saveAdaptationSuggestions(adaptations);
        }
      } catch {
        // Non-critical — silently ignore adaptation errors
      }

      // Update goal progress after workout
      try {
        const prData = (sessionPRs || []).map(pr => ({
          exerciseId: pr.exercise_id ?? pr.exerciseId ?? null,
          estimated1RM: pr.estimated1RM ?? pr.weight ?? 0,
        }));
        await updateGoalsAfterWorkout(user.id, profile.gym_id, {
          totalVolume: totalVolume ?? 0,
          sessionPRs: prData,
        });
      } catch {
        // Non-critical — silently ignore goal update errors
      }

      // Update workout schedule pattern for smart visit notifications
      try {
        await updateWorkoutSchedulePattern(user.id, profile.gym_id);
      } catch {
        // Non-critical — silently ignore schedule pattern errors
      }
    };
    fire();
  }, [user?.id, profile?.gym_id]); // eslint-disable-line

  const coachHeadline = sessionPRs.length > 0
    ? t('sessionSummary.newPRHeadline', { count: sessionPRs.length })
    : completedSets >= totalSets && totalSets > 0
    ? t('sessionSummary.fullSession')
    : completedSets > 0
    ? t('sessionSummary.workDone')
    : t('sessionSummary.youShowedUp');

  const dateLocale = i18n.language === 'es' ? 'es-ES' : 'en-US';
  const dateStr = new Date(completedAt).toLocaleDateString(dateLocale, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-[110] overflow-y-auto" style={{ background: 'var(--color-bg-primary)' }}>

      {/* ── Achievement celebration overlay ──────────────────────────────── */}
      {newAchievements.length > 0 && (
        <AchievementToast
          achievements={newAchievements}
          onDone={() => setNewAchievements([])}
        />
      )}

      {/* Subtle glow backdrop */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 40% at 50% 0%, rgba(212,175,55,0.12) 0%, transparent 70%)',
        }}
      />

      <div
        className="relative min-h-screen flex flex-col items-center px-4 py-12 pb-28 md:pb-12 transition-all duration-300 max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)' }}
      >
        {/* ── Checkmark ──────────────────────────────────────────── */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6 mt-4 animate-scale-pop"
          style={{
            background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
            border: '2px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
            boxShadow: '0 0 40px rgba(212,175,55,0.25)',
          }}
        >
          <CheckCircle size={40} strokeWidth={2} style={{ color: 'var(--color-accent)' }} />
        </div>

        {/* ── Title ──────────────────────────────────────────────── */}
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: 'var(--color-text-subtle)' }}>
          {localizeRoutineName(routineName)}
        </p>
        <h1
          className="text-[22px] font-bold text-center leading-tight mb-1 truncate max-w-full"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", color: 'var(--color-text-primary)' }}
        >
          {coachHeadline}
        </h1>
        <p className="text-[13px] mb-10" style={{ color: 'var(--color-text-subtle)' }}>{dateStr}</p>

        {/* ── Stats grid ─────────────────────────────────────────── */}
        <div className="w-full max-w-sm md:max-w-lg grid grid-cols-2 gap-3 mb-6">
          {[
            { icon: Clock,    label: t('sessionSummary.duration'),  value: formatTime(elapsedTime),   accent: 'var(--color-blue-soft)' },
            { icon: BarChart2, label: t('sessionSummary.volume'),   value: `${formatStatNumber(totalVolume)} lbs`, accent: 'var(--color-accent)' },
            { icon: Zap,      label: t('sessionSummary.setsDone'), value: totalSets > 0 ? `${completedSets}/${totalSets}` : completedSets, accent: 'var(--color-success)' },
            { icon: Dumbbell, label: t('sessionSummary.exercises'), value: totalExercises,             accent: '#A78BFA' },
            ...(heartRate?.averageBPM ? [{ icon: Heart, label: t('sessionSummary.avgHeartRate'), value: `${heartRate.averageBPM} bpm`, accent: 'var(--color-danger)' }] : []),
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3, ease: 'easeOut' }}
            >
              <StatCard icon={stat.icon} label={stat.label} value={stat.value} accent={stat.accent} />
            </motion.div>
          ))}
        </div>

        {/* ── PRs ────────────────────────────────────────────────── */}
        {sessionPRs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 0.3, ease: 'easeOut' }}
            className="w-full max-w-sm md:max-w-lg rounded-2xl p-5 mb-6 bg-gradient-to-r from-[#D4AF37]/10 to-transparent"
            style={{ border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                  boxShadow: '0 0 20px rgba(212,175,55,0.3)',
                }}
              >
                <Trophy size={22} className="text-[#D4AF37]" />
              </div>
              <p className="text-[#D4AF37] font-semibold text-[16px] truncate">
                {t('sessionSummary.newPRCount', { count: sessionPRs.length })}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {sessionPRs.map((pr, i) => (
                <div
                  key={`pr-${pr.exercise}-${pr.weight}`}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04]"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0 mr-3">
                    <Trophy size={12} className="text-[#D4AF37] shrink-0" />
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                      {sanitize(pr.exercise)}
                    </p>
                  </div>
                  <p className="text-[14px] text-[#D4AF37] font-black flex-shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {pr.weight} lbs x {pr.reps}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── XP Earned ─────────────────────────────────────────── */}
        {xpEarned > 0 && (
          <div
            className="w-full max-w-sm md:max-w-lg rounded-2xl px-5 py-4 mb-6 flex items-center gap-3"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[16px]"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', border: '2px solid color-mix(in srgb, var(--color-accent) 40%, transparent)' }}
            >
              +
            </div>
            <div>
              <p className="text-[18px] font-black text-[#D4AF37] truncate" style={{ fontVariantNumeric: 'tabular-nums' }}><AnimatedCounter value={xpEarned} duration={1000} /> {t('sessionSummary.xpEarned')}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('sessionSummary.keepTraining')}</p>
            </div>
          </div>
        )}

        {/* ── No PRs encouragement ───────────────────────────────── */}
        {sessionPRs.length === 0 && completedSets > 0 && (
          <div
            className="w-full max-w-sm md:max-w-lg rounded-2xl px-5 py-4 mb-6 text-center bg-white/[0.04] border border-white/[0.06]"
          >
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('sessionSummary.noPRsToday')}
            </p>
          </div>
        )}

        {/* Cool down moved to ActiveSession workout-complete gate */}

        {/* ── Actions ────────────────────────────────────────────── */}
        <div className="w-full max-w-sm md:max-w-lg flex flex-col gap-3 mt-auto pt-4">
          <p className="text-center text-[13px] mb-1" style={{ color: 'var(--color-text-muted)' }}>
            {sessionPRs.length > 0 ? t('sessionSummary.restUp') : t('sessionSummary.seeYouNextSession')}
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[14px] py-4 rounded-2xl transition-colors duration-200 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            {t('sessionSummary.backToTheGrind')}
          </button>
          <button
            onClick={() => navigate('/workouts')}
            className="w-full bg-white/[0.04] hover:bg-white/[0.06] font-semibold text-[14px] py-3.5 rounded-2xl transition-colors duration-200 border border-white/[0.06] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t('sessionSummary.viewWorkouts')}
          </button>
        </div>
      </div>

    </div>
  );
};

export default SessionSummary;
