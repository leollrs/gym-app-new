import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Timer, Dumbbell, Trophy, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { runNotificationScheduler } from '../lib/notificationScheduler';
import WorkoutOfTheDay from '../components/WorkoutOfTheDay';
import GymPulse from '../components/GymPulse';
import { LevelCard } from '../components/LevelBadge';
import { getUserPoints } from '../lib/rewardsEngine';

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const WEEK_SHORT  = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Mon-Sun display order

const formatTime = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// Scan localStorage for any in-progress session started within the last 24 hours
const readActiveSession = () => {
  try {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('gym_session_')) continue;
      const data = JSON.parse(localStorage.getItem(key));
      if (data?.loggedSets && data?.startedAt && new Date(data.startedAt).getTime() > oneDayAgo) {
        return { routineId: key.replace('gym_session_', ''), ...data };
      }
    }
  } catch { }
  return null;
};

// Compute current consecutive-day streak
const computeStreak = (sessions) => {
  const dates = new Set(
    sessions.map(s => new Date(s.completed_at).toDateString())
  );
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (dates.has(d.toDateString())) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
};

// Returns true if the user trained yesterday but NOT today yet
const isStreakAtRisk = (sessions) => {
  const today    = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const dates    = new Set(sessions.map(s => new Date(s.completed_at).toDateString()));
  return dates.has(yesterday) && !dates.has(today);
};

// Days trained this week (Mon=0 … Sun=6 in display order)
const buildWeekDayChips = (sessions) => {
  const now = new Date();
  // Sunday of current week
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const trained = new Set();
  sessions.forEach(s => {
    const d = new Date(s.completed_at);
    if (d >= startOfWeek) {
      // convert Sun=0 → Mon=0…Sun=6 for display
      const idx = (d.getDay() + 6) % 7;
      trained.add(idx);
    }
  });
  return trained;
};

/* ── Main ───────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]               = useState({ sessions: 0, streak: 0, weekSessions: 0, weekGoal: 0 });
  const [nextRoutine, setNextRoutine]                     = useState(null);
  const [lastSessionForRoutine, setLastSessionForRoutine] = useState(null);
  const [loading, setLoading]                             = useState(true);
  const [recentSessions, setRecentSessions]               = useState([]);
  // New state for retention features
  const [streakAtRisk, setStreakAtRisk]     = useState(false);
  const [weekDaysTrained, setWeekDaysTrained] = useState(new Set());
  const [isNewMember, setIsNewMember]       = useState(false);
  const [memberDaysOld, setMemberDaysOld]   = useState(0);
  const [habitSessions, setHabitSessions]   = useState(0); // sessions within first 42 days
  const [friendActivity, setFriendActivity] = useState([]);
  const [milestone, setMilestone]           = useState(null);
  const [totalVolume, setTotalVolume]       = useState(0);
  const [userPoints, setUserPoints]         = useState({ total_points: 0, lifetime_points: 0 });

  // Detect in-progress session from localStorage (checked fresh on every mount)
  const [activeSession] = useState(() => readActiveSession());
  const activeSetsCompleted = activeSession
    ? Object.values(activeSession.loggedSets).flat().filter(s => s.completed).length
    : 0;
  const activeSetsTotal = activeSession
    ? Object.values(activeSession.loggedSets).flat().length
    : 0;

  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      setLoading(true);

      // 1. Load all completed sessions
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('id, name, completed_at, total_volume_lbs, duration_seconds, routine_id')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      const allSessions = sessions || [];

      const totalSessions = allSessions.length;
      const streak        = computeStreak(allSessions);
      const atRisk        = isStreakAtRisk(allSessions);
      const dayChips      = buildWeekDayChips(allSessions);

      // Total volume lifted (all time)
      const volTotal = allSessions.reduce((acc, s) => acc + (parseFloat(s.total_volume_lbs) || 0), 0);

      // Count sessions completed this calendar week (Sun–Sat)
      const now2 = new Date();
      const startOfWeek = new Date(now2);
      startOfWeek.setDate(now2.getDate() - now2.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const weekSessions = allSessions.filter(s => new Date(s.completed_at) >= startOfWeek).length;

      // Fetch weekly goal from onboarding
      const { data: ob } = await supabase
        .from('member_onboarding')
        .select('training_days_per_week')
        .eq('profile_id', user.id)
        .single();
      const weekGoal = ob?.training_days_per_week ?? 0;

      setStats({ sessions: totalSessions, streak, weekSessions, weekGoal });
      setStreakAtRisk(atRisk);
      setWeekDaysTrained(dayChips);
      setTotalVolume(Math.round(volTotal));

      // 1b. Recent sessions for activity cards (top 4)
      setRecentSessions(allSessions.slice(0, 4));

      // 2. New member + habit tracking
      const createdAt   = profile?.created_at ? new Date(profile.created_at) : null;
      const daysOld     = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 86400000) : 999;
      const newMember   = daysOld <= 42;
      setMemberDaysOld(daysOld);
      setIsNewMember(newMember);

      if (newMember && createdAt) {
        const habitEnd = new Date(createdAt.getTime() + 42 * 86400000);
        const habitCount = allSessions.filter(s => {
          const d = new Date(s.completed_at);
          return d >= createdAt && d <= habitEnd;
        }).length;
        setHabitSessions(Math.min(habitCount, 9));
      }

      // 3. Milestone detection
      const milestoneTargets = [10, 25, 50, 100, 250, 500];
      const nextSessionMilestone = milestoneTargets.find(t => t > totalSessions);
      const distanceToMilestone  = nextSessionMilestone ? nextSessionMilestone - totalSessions : null;

      const streakMilestones = [7, 14, 30, 60, 100];
      const nextStreakMilestone = streakMilestones.find(t => t > streak);
      const distanceToStreakMilestone = nextStreakMilestone ? nextStreakMilestone - streak : null;

      const volumeMilestones = [10000, 25000, 50000, 100000, 250000, 500000, 1000000];
      const nextVolMilestone = volumeMilestones.find(t => t > volTotal);
      const distanceToVolMilestone = nextVolMilestone ? nextVolMilestone - volTotal : null;

      // Pick the milestone the user is closest to (within 20%)
      let chosenMilestone = null;

      if (distanceToMilestone !== null && nextSessionMilestone) {
        const pct = distanceToMilestone / nextSessionMilestone;
        if (pct <= 0.2) {
          chosenMilestone = {
            type: 'sessions',
            distance: distanceToMilestone,
            target: nextSessionMilestone,
            label: `${distanceToMilestone} more workout${distanceToMilestone === 1 ? '' : 's'} to hit ${nextSessionMilestone} sessions`,
          };
        }
      }
      if (!chosenMilestone && distanceToStreakMilestone !== null && nextStreakMilestone) {
        const pct = distanceToStreakMilestone / nextStreakMilestone;
        if (pct <= 0.2) {
          chosenMilestone = {
            type: 'streak',
            distance: distanceToStreakMilestone,
            target: nextStreakMilestone,
            label: `${distanceToStreakMilestone} more day${distanceToStreakMilestone === 1 ? '' : 's'} to complete your ${nextStreakMilestone}-day streak`,
          };
        }
      }
      if (!chosenMilestone && distanceToVolMilestone !== null && nextVolMilestone) {
        const pct = distanceToVolMilestone / nextVolMilestone;
        if (pct <= 0.2) {
          const distK = distanceToVolMilestone >= 1000
            ? `${(distanceToVolMilestone / 1000).toFixed(1)}k`
            : `${Math.round(distanceToVolMilestone)}`;
          const targetK = nextVolMilestone >= 1000
            ? `${(nextVolMilestone / 1000).toFixed(0)}k`
            : `${nextVolMilestone}`;
          chosenMilestone = {
            type: 'volume',
            distance: distanceToVolMilestone,
            target: nextVolMilestone,
            label: `${distK} more lbs to hit ${targetK} total volume`,
          };
        }
      }
      setMilestone(chosenMilestone);

      // 4. Most recent routine for the hero card
      const { data: routines } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(id)')
        .eq('created_by', user.id)
        .eq('is_template', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (routines?.length > 0) {
        setNextRoutine(routines[0]);
        setLastSessionForRoutine(allSessions.find(s => s.routine_id === routines[0].id) ?? null);
      }

      // 5. Friend activity this week
      try {
        const { data: friendships } = await supabase
          .from('friendships')
          .select('friend_id, user_id')
          .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
          .eq('status', 'accepted');

        if (friendships?.length > 0) {
          const friendIds = friendships.map(f =>
            f.user_id === user.id ? f.friend_id : f.user_id
          );

          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);

          const { data: friendSessions } = await supabase
            .from('workout_sessions')
            .select('profile_id, name, completed_at, total_volume_lbs')
            .in('profile_id', friendIds)
            .eq('status', 'completed')
            .gte('completed_at', weekStart.toISOString())
            .order('completed_at', { ascending: false })
            .limit(10);

          if (friendSessions?.length > 0) {
            // Fetch friend profiles for names
            const { data: friendProfiles } = await supabase
              .from('profiles')
              .select('id, full_name, avatar_url')
              .in('id', friendIds);

            const profileMap = {};
            (friendProfiles || []).forEach(p => { profileMap[p.id] = p; });

            // De-dupe: one entry per friend (their most recent session this week)
            const seen = new Set();
            const activity = [];
            for (const s of friendSessions) {
              if (seen.has(s.profile_id)) continue;
              seen.add(s.profile_id);
              const fp = profileMap[s.profile_id];
              activity.push({
                profileId: s.profile_id,
                name: fp?.full_name ?? 'Friend',
                workout: s.name || 'Workout',
                completedAt: s.completed_at,
                volume: Math.round(parseFloat(s.total_volume_lbs) || 0),
              });
              if (activity.length >= 3) break;
            }
            setFriendActivity(activity);
          }
        }
      } catch { /* friendships table may not exist yet — fail silently */ }

      // Fetch XP/level data
      getUserPoints(user.id).then(pts => setUserPoints(pts)).catch(() => {});

      setLoading(false);

      // Run smart notification scheduler (fire-and-forget)
      runNotificationScheduler(user.id, profile.gym_id).catch(() => {});
    };

    load();
  }, [user, profile]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  const liftCount    = nextRoutine?.routine_exercises?.length ?? 0;
  const lastVol      = lastSessionForRoutine ? Math.round(lastSessionForRoutine.total_volume_lbs || 0) : 0;
  const lastDur      = lastSessionForRoutine?.duration_seconds ? formatTime(lastSessionForRoutine.duration_seconds) : null;
  const lastSummary  = lastVol > 0 ? `Last: ${(lastVol / 1000).toFixed(1)}k lbs — beat it.` : lastDur ? `Last: ${lastDur} — top it.` : null;
  const estimatedMin = lastSessionForRoutine?.duration_seconds
    ? Math.round(lastSessionForRoutine.duration_seconds / 60)
    : liftCount * 4;

  // Coach greeting — data-driven, personal
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const daysSinceLast = recentSessions.length > 0
    ? Math.floor((Date.now() - new Date(recentSessions[0].completed_at).getTime()) / 86400000)
    : null;
  const coachLine = daysSinceLast === null
    ? 'Your first session starts the chain.'
    : daysSinceLast === 0
    ? 'Strong work today. Rest up — you earned it.'
    : daysSinceLast === 1
    ? 'Yesterday was solid. Keep the chain going.'
    : daysSinceLast === 2
    ? "Two days off. Your body's recovered. Go."
    : `${daysSinceLast} days since your last session. Don't lose it.`;

  // Smart motivational context line (feature #6)
  const smartMotivation = (() => {
    if (loading) return null;
    if (memberDaysOld <= 7) return "Welcome! Your fitness journey starts now.";
    if (daysSinceLast === 0) return "Great start! Every session counts.";
    if (stats.streak >= 7) return "You're on fire 🔥 Keep the momentum.";
    if (daysSinceLast !== null && daysSinceLast >= 2) return "Pick up where you left off 💪";
    return null;
  })();

  // Streak visual intensity
  const streakColor = !loading
    ? stats.streak >= 14 ? '#FF6B35'
    : stats.streak >= 7  ? '#D4AF37'
    : stats.streak >= 3  ? '#F59E0B'
    : stats.streak >= 1  ? '#E5E7EB'
    : '#4B5563'
    : '#4B5563';
  // Weekly pace context
  const weekBehind = stats.weekGoal > 0 ? stats.weekGoal - stats.weekSessions : 0;
  const weekLabel = stats.weekGoal === 0
    ? `${stats.weekSessions} this week`
    : stats.weekSessions >= stats.weekGoal
    ? 'Goal met'
    : weekBehind === 1
    ? '1 more to goal'
    : `${weekBehind} behind pace`;
  const weekColor = !loading
    ? (stats.weekGoal === 0 || stats.weekSessions >= stats.weekGoal) ? '#10B981'
    : weekBehind === 1 ? '#D4AF37'
    : '#F59E0B'
    : '#4B5563';

  // Habit tracker derived values
  const memberWeek = isNewMember ? Math.min(6, Math.ceil((memberDaysOld + 1) / 7)) : 1;
  const habitFormed = habitSessions >= 9;

  // Time-ago helper for friend activity
  const timeAgo = (iso) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return `${Math.floor(diff / 1440)}d ago`;
  };

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-28 md:pb-12 animate-fade-in">

        {/* Greeting — coach voice */}
        <section className="mb-5 mt-2">
          <h1 className="text-[22px] font-black text-[#E5E7EB] tracking-tight leading-tight">
            {timeGreeting}, {firstName}.
          </h1>
          <p className="text-[13px] text-[#9CA3AF] mt-1 leading-snug">
            {loading ? '…' : coachLine}
          </p>
          {/* Smart motivational context */}
          {!loading && smartMotivation && (
            <p className="text-[12px] text-[#D4AF37] mt-1 font-medium leading-snug">
              {smartMotivation}
            </p>
          )}
        </section>

        {/* ── STREAK COUNTER (prominent) ───────────────────────────────────────── */}
        <section className="mb-5">
          {loading ? (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 h-24 animate-pulse" />
          ) : (
            <div
              className="rounded-[14px] bg-[#0F172A] border p-4 flex items-center gap-4 transition-all"
              style={{
                borderColor: stats.streak >= 7 ? `${streakColor}40` : 'rgba(255,255,255,0.08)',
                boxShadow: stats.streak >= 7 ? `0 0 24px ${streakColor}18` : undefined,
              }}
            >
              {/* Flame + number */}
              <div className="flex flex-col items-center justify-center min-w-[72px]">
                <span className="text-[42px] leading-none" role="img" aria-label="streak">🔥</span>
                <span
                  className="text-[36px] font-black leading-none -mt-1"
                  style={{ color: streakColor }}
                >
                  {stats.streak}
                </span>
              </div>

              {/* Labels */}
              <div className="flex-1 min-w-0">
                {stats.streak === 0 ? (
                  <>
                    <p className="text-[16px] font-bold text-[#E5E7EB]">Start your streak today</p>
                    <p className="text-[12px] text-[#6B7280] mt-0.5">Train today to ignite your first streak</p>
                  </>
                ) : (
                  <>
                    <p className="text-[16px] font-bold" style={{ color: streakColor }}>
                      {stats.streak} day streak
                    </p>
                    <p className="text-[12px] text-[#9CA3AF] mt-0.5">
                      {stats.streak >= 14 ? 'Absolutely unstoppable 🏆'
                        : stats.streak >= 7  ? 'Consistency is your superpower'
                        : stats.streak >= 3  ? 'Building real momentum'
                        : 'Keep showing up'}
                    </p>
                    {streakAtRisk && (
                      <p className="text-[11px] font-bold text-amber-400 mt-1">
                        ⚠️ At risk — train today to keep it
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Mini badge for big streaks */}
              {stats.streak >= 7 && (
                <div
                  className="rounded-xl px-2.5 py-1 text-[11px] font-black tracking-wide shrink-0"
                  style={{ background: `${streakColor}18`, color: streakColor, border: `1px solid ${streakColor}30` }}
                >
                  {stats.streak >= 30 ? 'LEGEND' : stats.streak >= 14 ? 'ELITE' : 'ON FIRE'}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── LEVEL / XP ────────────────────────────────────────────────────── */}
        {!loading && (
          <Link to="/rewards" className="block mb-5">
            <LevelCard
              totalPoints={userPoints.total_points}
              lifetimePoints={userPoints.lifetime_points}
            />
          </Link>
        )}

        {/* Hero workout card */}
        <section className="mb-5">
          {loading ? (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 h-48 animate-pulse" />
          ) : activeSession ? (
            <button
              type="button"
              onClick={() => navigate(`/session/${activeSession.routineId}`)}
              className="w-full rounded-[14px] bg-[#0F172A] border border-emerald-500/30 overflow-hidden text-left active:scale-[0.99] transition-transform"
            >
              <div className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Timer size={13} className="text-emerald-400" />
                  <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">In progress</span>
                </div>
                <h2 className="text-[22px] font-black text-[#E5E7EB] tracking-tight mb-1">
                  {activeSession.routineName ?? 'Workout'}
                </h2>
                <p className="text-sm text-[#9CA3AF] mb-4">
                  {activeSetsCompleted} / {activeSetsTotal} sets · {formatTime(activeSession.elapsedTime ?? 0)}
                </p>
                <div className="w-full py-3.5 rounded-xl bg-emerald-500 text-black text-center font-bold text-[15px]">
                  Resume workout
                </div>
              </div>
            </button>
          ) : nextRoutine ? (
            <button
              type="button"
              onClick={() => navigate(`/session/${nextRoutine.id}`)}
              className="w-full rounded-[14px] bg-[#0F172A] border border-white/8 overflow-hidden text-left active:scale-[0.99] transition-transform"
            >
              <div className="p-5">
                <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                  {liftCount} exercises · ~{estimatedMin} min
                </p>
                <h2 className="text-[24px] font-black text-[#E5E7EB] tracking-tight mb-1">
                  {nextRoutine.name}
                </h2>
                {lastSummary ? (
                  <p className="text-[13px] text-[#D4AF37] font-semibold mb-5">{lastSummary}</p>
                ) : (
                  <p className="text-[13px] text-[#6B7280] mb-5">First time. Set your baseline.</p>
                )}
                <div className="w-full py-4 rounded-xl bg-[#D4AF37] text-black text-center font-black text-[16px] tracking-wide">
                  Let's go
                </div>
              </div>
            </button>
          ) : (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-6 text-center">
              <Dumbbell size={36} className="mx-auto mb-3 text-[#6B7280]" />
              <p className="font-bold text-[#E5E7EB] text-base">No routines yet</p>
              <p className="text-sm text-[#9CA3AF] mt-1 mb-4">Create one to get started.</p>
              <Link to="/workouts" className="inline-block py-2.5 px-6 rounded-xl bg-[#D4AF37] text-black font-bold text-sm">
                Create routine
              </Link>
            </div>
          )}
        </section>

        {/* ── AI WORKOUT OF THE DAY ────────────────────────────────────────────── */}
        {!loading && !activeSession && (
          <section className="mb-5">
            <WorkoutOfTheDay />
          </section>
        )}


        {/* ── WEEKLY SUMMARY CARD ──────────────────────────────────────────────── */}
        <section className="mb-5">
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-4">
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-[0.18em]">
                This week
              </span>
              {!loading && stats.weekGoal > 0 && (
                <span className="text-[12px] font-bold" style={{ color: weekColor }}>
                  {stats.weekSessions} of {stats.weekGoal} sessions
                </span>
              )}
              {!loading && stats.weekGoal === 0 && (
                <span className="text-[12px] font-bold text-[#9CA3AF]">
                  {stats.weekSessions} session{stats.weekSessions !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Progress bar */}
            {!loading && stats.weekGoal > 0 && (
              <div className="w-full h-2 bg-[#1E293B] rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (stats.weekSessions / stats.weekGoal) * 100)}%`,
                    background: weekColor,
                  }}
                />
              </div>
            )}

            {/* Day chips — Mon–Sun */}
            <div className="flex gap-1.5">
              {WEEK_SHORT.map((label, i) => {
                const trained = weekDaysTrained.has(i);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full aspect-square rounded-lg flex items-center justify-center text-[10px] font-bold transition-all"
                      style={{
                        background: trained ? '#D4AF37' : '#1E293B',
                        color: trained ? '#000' : '#4B5563',
                      }}
                    >
                      {/* intentionally empty — color tells the story */}
                    </div>
                    <span className="text-[9px] font-medium text-[#4B5563]">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── HABIT FORMATION TRACKER (new members only, first 42 days) ─────── */}
        {!loading && isNewMember && (
          <section className="mb-5">
            <div
              className="rounded-[14px] bg-[#0F172A] border p-4"
              style={{ borderColor: habitFormed ? '#D4AF3740' : 'rgba(255,255,255,0.08)' }}
            >
              {habitFormed ? (
                <div className="text-center py-2">
                  <p className="text-[28px] mb-1">🧠</p>
                  <p className="text-[16px] font-black text-[#D4AF37]">Habit Formed!</p>
                  <p className="text-[12px] text-[#9CA3AF] mt-1">
                    You've completed 9 workouts — fitness is now part of who you are.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-[0.18em]">
                      Habit Formation
                    </span>
                    <span className="text-[11px] font-semibold text-[#9CA3AF]">
                      Week {memberWeek} of 6
                    </span>
                  </div>
                  <p className="text-[13px] font-bold text-[#E5E7EB] mb-3">
                    {habitSessions} of 9 workouts completed
                  </p>
                  {/* 9 circles */}
                  <div className="flex gap-2">
                    {Array.from({ length: 9 }, (_, i) => {
                      const filled = i < habitSessions;
                      return (
                        <div
                          key={i}
                          className="flex-1 aspect-square rounded-full transition-all"
                          style={{
                            background: filled ? '#D4AF37' : '#1E293B',
                            border: filled ? '2px solid #D4AF37' : '2px solid #374151',
                            boxShadow: filled ? '0 0 8px #D4AF3740' : undefined,
                          }}
                        />
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-[#6B7280] mt-2">
                    Research says 9 visits in 6 weeks = a lasting habit. You're on your way.
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {/* ── MILESTONE APPROACHING ────────────────────────────────────────────── */}
        {!loading && milestone && (
          <section className="mb-5">
            <div className="rounded-[14px] bg-[#0F172A] border p-4 flex items-center gap-3"
              style={{ borderColor: '#D4AF3730' }}
            >
              <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: '#D4AF3715' }}
              >
                <Trophy size={18} style={{ color: '#D4AF37' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[#D4AF37] uppercase tracking-[0.15em] mb-0.5">
                  Milestone approaching
                </p>
                <p className="text-[13px] font-bold text-[#E5E7EB] leading-snug">
                  {milestone.label}
                </p>
              </div>
            </div>
          </section>
        )}


        {/* ── GYM PULSE (real-time gym activity) ─────────────────────────────── */}
        <section className="mb-5">
          <GymPulse />
        </section>

        {/* ── FRIENDS THIS WEEK ────────────────────────────────────────────────── */}
        <section className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-[0.18em]">
              Friends this week
            </span>
            <Link to="/social" className="text-xs font-semibold text-[#D4AF37] flex items-center gap-0.5">
              View all <ChevronRight size={12} />
            </Link>
          </div>

          {loading ? (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 h-20 animate-pulse" />
          ) : friendActivity.length === 0 ? (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#1E293B] flex items-center justify-center shrink-0">
                <Users size={18} className="text-[#4B5563]" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[#9CA3AF]">No friend activity yet</p>
                <Link to="/social" className="text-[12px] text-[#D4AF37] font-medium">
                  Add friends to see their workouts →
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 divide-y divide-white/[0.05] overflow-hidden">
              {friendActivity.map((f, idx) => {
                const initials = f.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <div key={f.profileId} className="p-3 flex items-center gap-3">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center shrink-0 text-[13px] font-bold text-[#D4AF37]">
                      {initials}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{f.name}</p>
                      <p className="text-[11px] text-[#6B7280] truncate">
                        {f.workout}
                        {f.volume > 0 ? ` · ${(f.volume / 1000).toFixed(1)}k lbs` : ''}
                        {' · '}{timeAgo(f.completedAt)}
                      </p>
                    </div>
                    {/* Like button */}
                    <button
                      type="button"
                      className="shrink-0 rounded-xl px-2.5 py-1.5 text-[12px] font-bold transition-all active:scale-95"
                      style={{ background: '#1E293B', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.06)' }}
                      onClick={() => {/* like action — wired up if like endpoint exists */}}
                    >
                      👍
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 7. Recent activity — single card preview + View all */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
              Recent
            </span>
            <Link
              to="/workout-log"
              className="text-xs font-semibold text-[#D4AF37] flex items-center gap-0.5"
            >
              View all <ChevronRight size={12} />
            </Link>
          </div>
          {recentSessions.length === 0 ? (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 px-4 py-3 text-center">
              <p className="text-xs text-[#6B7280]">No workouts yet</p>
            </div>
          ) : (
            <Link
              to="/workout-log"
              className="block rounded-[14px] bg-[#0F172A] border border-white/8 p-3 hover:border-white/[0.12] hover:bg-[#111827] transition-colors"
            >
              <p className="font-medium text-[#E5E7EB] text-sm truncate">
                {recentSessions[0].name || 'Workout'}
              </p>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {recentSessions[0].duration_seconds ? formatTime(recentSessions[0].duration_seconds) : '—'}
                {' · '}
                {((recentSessions[0].total_volume_lbs || 0) / 1000).toFixed(1)}k lbs
              </p>
            </Link>
          )}
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
