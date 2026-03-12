import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Trophy, Dumbbell, Clock, Zap, BarChart2, CheckCircle, Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';
import { awardAchievements } from '../lib/achievements';
import AchievementToast from '../components/AchievementToast';
import AnimatedCounter from '../components/AnimatedCounter';

const MILESTONES = [1, 10, 25, 50, 100, 200, 365];

const computeStreak = (sessions) => {
  const dates = new Set(sessions.map(s => new Date(s.completed_at).toDateString()));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (dates.has(d.toDateString())) streak++;
    else if (i > 0) break;
  }
  return streak;
};

const formatTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec > 0 ? `${sec}s` : ''}`.trim();
  return `${sec}s`;
};

const formatVolume = (lbs) => {
  if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k`;
  return Math.round(lbs).toString();
};

const StatCard = ({ icon: Icon, label, value, accent }) => (
  <div className="bg-white/5 rounded-2xl p-4 flex flex-col items-center gap-2 text-center">
    <Icon size={18} style={{ color: accent || '#D4AF37' }} strokeWidth={2} />
    <p className="text-[32px] font-black text-white leading-none">{value}</p>
    <p className="text-[11px] text-[#6B7280] uppercase tracking-wider font-semibold">{label}</p>
  </div>
);

const SessionSummary = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, profile } = useAuth();
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
  } = location.state ?? {};

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

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
          type:      'milestone',
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
          type:      'pr',
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
        await supabase
          .from('challenge_participants')
          .update({ score: (p.score ?? 0) + delta })
          .eq('id', p.id);
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
            achievement_desc: ach.desc,
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
    ? `${sessionPRs.length} new PR${sessionPRs.length > 1 ? 's' : ''}. You earned it.`
    : completedSets >= totalSets && totalSets > 0
    ? 'Full session. Nothing left.'
    : completedSets > 0
    ? 'Work done. Stay consistent.'
    : 'You showed up. That counts.';

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
        className="relative min-h-screen flex flex-col items-center px-5 py-12 transition-all duration-700"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'translateY(20px)' }}
      >
        {/* ── Checkmark ──────────────────────────────────────────── */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-6 mt-4 animate-scale-pop"
          style={{
            background: 'rgba(212,175,55,0.15)',
            border: '2px solid rgba(212,175,55,0.4)',
            boxShadow: '0 0 40px rgba(212,175,55,0.25)',
          }}
        >
          <CheckCircle size={40} strokeWidth={2} style={{ color: '#D4AF37' }} />
        </div>

        {/* ── Title ──────────────────────────────────────────────── */}
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[#6B7280] mb-2">
          {routineName}
        </p>
        <h1
          className="text-[32px] font-black text-white text-center leading-tight mb-1"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
        >
          {coachHeadline}
        </h1>
        <p className="text-[13px] text-[#6B7280] mb-10">{dateStr}</p>

        {/* ── Stats grid ─────────────────────────────────────────── */}
        <div className="w-full max-w-sm grid grid-cols-2 gap-3 mb-6 stagger-fade-in">
          <StatCard icon={Clock}    label="Duration"   value={formatTime(elapsedTime)}   accent="#60A5FA" />
          <StatCard icon={BarChart2} label="Volume"    value={`${formatVolume(totalVolume)} lbs`} accent="#D4AF37" />
          <StatCard icon={Zap}      label="Sets Done"  value={totalSets > 0 ? `${completedSets}/${totalSets}` : completedSets} accent="#34D399" />
          <StatCard icon={Dumbbell} label="Exercises"  value={totalExercises}             accent="#A78BFA" />
        </div>

        {/* ── PRs ────────────────────────────────────────────────── */}
        {sessionPRs.length > 0 && (
          <div
            className="w-full max-w-sm rounded-2xl p-5 mb-6"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-amber-400" />
              <p className="text-amber-400 font-bold text-[14px]">
                {sessionPRs.length} New Personal Record{sessionPRs.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {sessionPRs.map((pr, i) => (
                <div key={i} className="flex items-center justify-between">
                  <p className="text-[13px] text-[#E5E7EB] font-medium truncate flex-1 mr-3">
                    {pr.exercise}
                  </p>
                  <p className="text-[13px] text-amber-400 font-bold flex-shrink-0">
                    {pr.weight} lbs × {pr.reps}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── XP Earned ─────────────────────────────────────────── */}
        {xpEarned > 0 && (
          <div
            className="w-full max-w-sm rounded-2xl px-5 py-4 mb-6 flex items-center gap-3"
            style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)' }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-black text-[16px]"
              style={{ backgroundColor: 'rgba(212,175,55,0.15)', color: '#D4AF37', border: '2px solid rgba(212,175,55,0.4)' }}
            >
              +
            </div>
            <div>
              <p className="text-[18px] font-black text-[#D4AF37]"><AnimatedCounter value={xpEarned} duration={1000} /> XP earned</p>
              <p className="text-[11px] text-[#9CA3AF] mt-0.5">Keep training to level up</p>
            </div>
          </div>
        )}

        {/* ── No PRs encouragement ───────────────────────────────── */}
        {sessionPRs.length === 0 && completedSets > 0 && (
          <div
            className="w-full max-w-sm rounded-2xl px-5 py-4 mb-6 text-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="text-[13px] text-[#9CA3AF]">
              No PRs today. Keep pushing — they come from showing up.
            </p>
          </div>
        )}

        {/* ── Actions ────────────────────────────────────────────── */}
        <div className="w-full max-w-sm flex flex-col gap-3 mt-auto pt-4">
          <p className="text-center text-[13px] text-[#4B5563] mb-1">
            {sessionPRs.length > 0 ? 'Rest up. Come back stronger.' : 'See you next session.'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full bg-[#D4AF37] hover:bg-[#E6C766] text-black font-black text-[17px] py-4 rounded-2xl transition-colors"
          >
            Back to the grind
          </button>
          <button
            onClick={() => navigate('/workouts')}
            className="w-full bg-white/5 hover:bg-white/10 text-[#9CA3AF] font-semibold text-[15px] py-3.5 rounded-2xl transition-colors border border-white/8"
          >
            View Workouts
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionSummary;
