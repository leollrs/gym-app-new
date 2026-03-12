import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Timer, Dumbbell, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { runNotificationScheduler } from '../lib/notificationScheduler';
import WorkoutOfTheDay from '../components/WorkoutOfTheDay';
import GymPulse from '../components/GymPulse';
import { getLevel } from '../components/LevelBadge';
import { getUserPoints } from '../lib/rewardsEngine';
import { getRewardTier } from '../lib/rewardsEngine';

/* ── Helpers ────────────────────────────────────────────────────────────────── */
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

// Time-ago helper
const timeAgo = (iso) => {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
};

/* ── Main ───────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]               = useState({ sessions: 0, streak: 0 });
  const [nextRoutine, setNextRoutine]                     = useState(null);
  const [lastSessionForRoutine, setLastSessionForRoutine] = useState(null);
  const [loading, setLoading]                             = useState(true);
  const [recentSessions, setRecentSessions]               = useState([]);
  const [streakAtRisk, setStreakAtRisk]     = useState(false);
  const [memberDaysOld, setMemberDaysOld]   = useState(0);
  const [friendActivity, setFriendActivity] = useState([]);
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

      setStats({ sessions: totalSessions, streak });
      setStreakAtRisk(atRisk);

      // Recent sessions (for coach line calculation)
      setRecentSessions(allSessions.slice(0, 4));

      // Member age
      const createdAt   = profile?.created_at ? new Date(profile.created_at) : null;
      const daysOld     = createdAt ? Math.floor((Date.now() - createdAt.getTime()) / 86400000) : 999;
      setMemberDaysOld(daysOld);

      // 2. Most recent routine for the hero card
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

      // 3. Friend activity (recent, not just this week)
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

          const { data: friendSessions } = await supabase
            .from('workout_sessions')
            .select('profile_id, name, completed_at')
            .in('profile_id', friendIds)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(10);

          if (friendSessions?.length > 0) {
            // Fetch friend profiles for names + avatars
            const { data: friendProfiles } = await supabase
              .from('profiles')
              .select('id, full_name, avatar_url')
              .in('id', friendIds);

            const profileMap = {};
            (friendProfiles || []).forEach(p => { profileMap[p.id] = p; });

            // De-dupe: one entry per friend (their most recent session)
            const seen = new Set();
            const activity = [];
            for (const s of friendSessions) {
              if (seen.has(s.profile_id)) continue;
              seen.add(s.profile_id);
              const fp = profileMap[s.profile_id];
              activity.push({
                profileId: s.profile_id,
                name: fp?.full_name ?? 'Friend',
                avatarUrl: fp?.avatar_url ?? null,
                workout: s.name || 'Workout',
                completedAt: s.completed_at,
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

  // Smart motivational context line
  const smartMotivation = (() => {
    if (loading) return null;
    if (memberDaysOld <= 7) return "Welcome! Your fitness journey starts now.";
    if (daysSinceLast === 0) return "Great start! Every session counts.";
    if (stats.streak >= 7) return "You're on fire — keep the momentum.";
    if (daysSinceLast !== null && daysSinceLast >= 2) return "Pick up where you left off.";
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

  // Level/XP data
  const { level, xpIntoLevel, xpForNext, progress: xpProgress } = getLevel(userPoints.total_points);
  const tier = getRewardTier(userPoints.total_points);

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-28 md:pb-12 stagger-fade-in">

        {/* ── 1. GREETING + STREAK (merged compact row) ──────────────────────── */}
        <section className="mb-4 mt-2">
          <div className="flex items-start justify-between gap-3">
            {/* Left: greeting + coach line */}
            <div className="flex-1 min-w-0">
              <h1 className="text-[22px] font-black text-[#E5E7EB] tracking-tight leading-tight">
                {timeGreeting}, {firstName}.
              </h1>
              <p className="text-[13px] text-[#9CA3AF] mt-1 leading-snug">
                {loading ? '…' : coachLine}
              </p>
              {!loading && smartMotivation && (
                <p className="text-[12px] text-[#D4AF37] mt-1 font-medium leading-snug">
                  {smartMotivation}
                </p>
              )}
              {!loading && streakAtRisk && (
                <p className="text-[11px] font-bold text-amber-400 mt-1">
                  Streak at risk — train today to keep it
                </p>
              )}
            </div>

            {/* Right: streak counter */}
            {!loading && (
              <div className="flex flex-col items-center shrink-0 pt-0.5">
                <span className="text-[28px] leading-none animate-flame inline-block" role="img" aria-label="streak">🔥</span>
                <span
                  className="text-[32px] font-black leading-none -mt-0.5"
                  style={{ color: streakColor }}
                >
                  {stats.streak}
                </span>
                <span className="text-[10px] text-[#6B7280] font-medium mt-0.5 whitespace-nowrap">
                  {stats.streak === 1 ? 'day streak' : stats.streak === 0 ? 'no streak' : 'day streak'}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── 2. LEVEL / XP (compact inline bar) ─────────────────────────────── */}
        {!loading && (
          <Link
            to="/rewards"
            className="block mb-4 rounded-[10px] bg-[#0F172A] border border-white/8 px-3 py-2 active:scale-[0.99] transition-transform"
          >
            <div className="flex items-center gap-2.5 h-[20px]">
              {/* Left label */}
              <span className="text-[12px] font-bold text-[#E5E7EB] whitespace-nowrap shrink-0">
                Lvl {level}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  backgroundColor: `${tier.color}15`,
                  color: tier.color,
                  border: `1px solid ${tier.color}30`,
                }}
              >
                {tier.name}
              </span>

              {/* Progress bar */}
              <div className="flex-1 h-[6px] rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${xpProgress}%`, backgroundColor: tier.color }}
                />
              </div>

              {/* Right label */}
              <span className="text-[10px] text-[#6B7280] whitespace-nowrap shrink-0">
                {xpIntoLevel}/{xpForNext} XP
              </span>
              <ChevronRight size={12} className="text-[#4B5563] shrink-0" />
            </div>
          </Link>
        )}

        {/* ── 3. TODAY'S WORKOUT (hero card) ──────────────────────────────────── */}
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
                <h2 className="text-[28px] font-black text-[#E5E7EB] tracking-tight mb-1">
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

        {/* AI Workout of the Day */}
        {!loading && !activeSession && (
          <section className="mb-5">
            <WorkoutOfTheDay />
          </section>
        )}

        {/* ── 4. COMMUNITY HIGHLIGHTS (compact) ──────────────────────────────── */}
        <section className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-[0.18em]">
              Community
            </span>
            <Link to="/community" className="text-xs font-semibold text-[#D4AF37] flex items-center gap-0.5">
              See all <ChevronRight size={12} />
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
                <Link to="/community" className="text-[12px] text-[#D4AF37] font-medium">
                  Add friends to see their activity →
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 divide-y divide-white/[0.05] overflow-hidden">
              {friendActivity.map((f) => {
                const initials = f.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                const firstName = f.name.split(' ')[0];
                return (
                  <div key={f.profileId} className="px-3 py-2.5 flex items-center gap-3">
                    {/* Avatar */}
                    {f.avatarUrl ? (
                      <img
                        src={f.avatarUrl}
                        alt={f.name}
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#1E293B] flex items-center justify-center shrink-0 text-[11px] font-bold text-[#D4AF37]">
                        {initials}
                      </div>
                    )}
                    {/* Activity description */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#E5E7EB] truncate">
                        <span className="font-semibold">{firstName}</span>
                        <span className="text-[#9CA3AF]"> completed </span>
                        <span className="font-medium">{f.workout}</span>
                      </p>
                    </div>
                    {/* Time ago */}
                    <span className="text-[10px] text-[#6B7280] shrink-0 whitespace-nowrap">
                      {timeAgo(f.completedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── 5. GYM PULSE ───────────────────────────────────────────────────── */}
        <section className="mb-5">
          <GymPulse />
        </section>

      </div>
    </div>
  );
};

export default Dashboard;
