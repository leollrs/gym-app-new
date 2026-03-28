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
import { formatDurationLong as formatTime } from '../lib/dateUtils';

import { useTranslation } from 'react-i18next';

const MILESTONES = [1, 10, 25, 50, 100, 200, 365];

const formatVolume = (lbs) => {
  if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k`;
  return Math.round(lbs).toString();
};

const StatCard = ({ icon: Icon, label, value, accent }) => (
  <div className="bg-white/[0.04] border border-white/[0.06] rounded-2xl p-5 flex flex-col items-center gap-2 text-center">
    <Icon size={18} style={{ color: accent || 'var(--color-accent)' }} strokeWidth={2} />
    <p className="text-[32px] font-black text-white leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
    <p className="text-[11px] text-[#6B7280] uppercase tracking-wider font-semibold">{label}</p>
  </div>
);

const SessionSummary = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, profile, gymName, gymLogoUrl } = useAuth();
  const { t } = useTranslation('pages');
  const [visible, setVisible] = useState(false);
  const [newAchievements, setNewAchievements] = useState([]);

  // Data passed from ActiveSession via navigate state
  const {
    routineName    = 'Workout',
    elapsedTime    = 0,
    totalVolume    = 0,
    completedSets  = 0,
    totalSets      = 0,
    totalExercises = 0,
    sessionPRs     = [],
    completedAt    = new Date().toISOString(),
    xpEarned       = 0,
    heartRate      = null,
    streak         = 0,
  } = location.state ?? {};

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
  useEffect(() => {
    if (!user?.id || !profile?.gym_id) return;
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
          title:     `${count} workout${count === 1 ? '' : 's'} completed!`,
          body:      count === 1
            ? 'Welcome to your fitness journey. Keep it up!'
            : `You've hit ${count} workouts. Consistency is everything.`,
        });
      }

      // PR notifications
      if (sessionPRs?.length > 0) {
        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'pr_beaten',
          title:     `${sessionPRs.length} new PR${sessionPRs.length > 1 ? 's' : ''} this session!`,
          body:      sessionPRs.slice(0, 3).map(p => p.exerciseName ?? p.exercise_name ?? 'Exercise').join(', '),
        });
      }

      // Update challenge scores for any active challenges the user has joined
      const now = new Date().toISOString();
      const { data: myParticipations } = await supabase
        .from('challenge_participants')
        .select('id, challenge_id, score, challenges(type, start_date, end_date, status)')
        .eq('profile_id', user.id)
        .eq('gym_id', profile.gym_id);

      const active = (myParticipations || []).filter(p => {
        const c = p.challenges;
        if (!c) return false;
        return new Date(c.start_date) <= new Date(now) && new Date(c.end_date) >= new Date(now);
      });

      for (const p of active) {
        const type = p.challenges.type;
        let delta = 0;
        if (type === 'consistency') delta = 1;
        else if (type === 'volume')  delta = totalVolume ?? 0;
        else if (type === 'pr_count') delta = sessionPRs?.length ?? 0;
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

        await createNotification({
          profileId: user.id,
          gymId:     profile.gym_id,
          type:      'achievement',
          title:     `Achievement Unlocked: ${ach.label}`,
          body:      ach.desc,
        });
      }

      if (newlyEarned.length > 0) {
        setNewAchievements(newlyEarned);
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

  const dateStr = new Date(completedAt).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="fixed inset-0 bg-[#05070B] z-[110] overflow-y-auto">

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
        className="relative min-h-screen flex flex-col items-center px-5 py-12 transition-all duration-300"
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
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6B7280] mb-2">
          {routineName}
        </p>
        <h1
          className="text-[28px] font-bold text-white text-center leading-tight mb-1"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {coachHeadline}
        </h1>
        <p className="text-[13px] text-[#6B7280] mb-10">{dateStr}</p>

        {/* ── Stats grid ─────────────────────────────────────────── */}
        <div className="w-full max-w-sm md:max-w-lg grid grid-cols-2 gap-3 mb-6">
          {[
            { icon: Clock,    label: t('sessionSummary.duration'),  value: formatTime(elapsedTime),   accent: '#60A5FA' },
            { icon: BarChart2, label: t('sessionSummary.volume'),   value: `${formatVolume(totalVolume)} lbs`, accent: '#D4AF37' },
            { icon: Zap,      label: t('sessionSummary.setsDone'), value: totalSets > 0 ? `${completedSets}/${totalSets}` : completedSets, accent: '#34D399' },
            { icon: Dumbbell, label: t('sessionSummary.exercises'), value: totalExercises,             accent: '#A78BFA' },
            ...(heartRate?.averageBPM ? [{ icon: Heart, label: 'Avg Heart Rate', value: `${heartRate.averageBPM} bpm`, accent: '#EF4444' }] : []),
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
              <p className="text-[#D4AF37] font-semibold text-[16px]">
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
                    <p className="text-[13px] text-[#E5E7EB] font-semibold truncate">
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
              <p className="text-[18px] font-black text-[#D4AF37]" style={{ fontVariantNumeric: 'tabular-nums' }}><AnimatedCounter value={xpEarned} duration={1000} /> {t('sessionSummary.xpEarned')}</p>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">{t('sessionSummary.keepTraining')}</p>
            </div>
          </div>
        )}

        {/* ── No PRs encouragement ───────────────────────────────── */}
        {sessionPRs.length === 0 && completedSets > 0 && (
          <div
            className="w-full max-w-sm md:max-w-lg rounded-2xl px-5 py-4 mb-6 text-center bg-white/[0.04] border border-white/[0.06]"
          >
            <p className="text-[13px] text-[#9CA3AF]">
              {t('sessionSummary.noPRsToday')}
            </p>
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────────── */}
        <div className="w-full max-w-sm md:max-w-lg flex flex-col gap-3 mt-auto pt-4">
          <p className="text-center text-[13px] text-[#4B5563] mb-1">
            {sessionPRs.length > 0 ? t('sessionSummary.restUp') : t('sessionSummary.seeYouNextSession')}
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-[#D4AF37] hover:bg-[#E6C766] text-black font-bold text-[17px] py-4 rounded-2xl transition-colors duration-200"
          >
            {t('sessionSummary.backToTheGrind')}
          </button>
          <button
            onClick={() => navigate('/workouts')}
            className="w-full bg-white/[0.04] hover:bg-white/[0.06] text-[#9CA3AF] font-semibold text-[15px] py-3.5 rounded-2xl transition-colors duration-200 border border-white/[0.06]"
          >
            {t('sessionSummary.viewWorkouts')}
          </button>
        </div>
      </div>

    </div>
  );
};

export default SessionSummary;
