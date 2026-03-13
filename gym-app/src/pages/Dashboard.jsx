import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Timer, Dumbbell, Check, ChevronDown, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { runNotificationScheduler } from '../lib/notificationScheduler';
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

/* ── Main ───────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]               = useState({ sessions: 0, streak: 0 });
  const [nextRoutine, setNextRoutine]                     = useState(null);
  const [routineExercises, setRoutineExercises]           = useState([]);
  const [lastSessionForRoutine, setLastSessionForRoutine] = useState(null);
  const [loading, setLoading]                             = useState(true);
  const [recentSessions, setRecentSessions]               = useState([]);
  const [streakAtRisk, setStreakAtRisk]     = useState(false);
  const [memberDaysOld, setMemberDaysOld]   = useState(0);
  const [userPoints, setUserPoints]         = useState({ total_points: 0, lifetime_points: 0 });
  const [weekGoal, setWeekGoal]             = useState(4);
  const [weekDaysTrained, setWeekDaysTrained] = useState([]);
  const [showExercises, setShowExercises]   = useState(false);

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

      // 2. Most recent routine for the hero card (with exercise details)
      const { data: routines } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(id, target_sets, target_reps, position, exercises(name))')
        .eq('created_by', user.id)
        .eq('is_template', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (routines?.length > 0) {
        setNextRoutine(routines[0]);
        const exercises = (routines[0].routine_exercises || [])
          .sort((a, b) => (a.position || 0) - (b.position || 0));
        setRoutineExercises(exercises);
        setLastSessionForRoutine(allSessions.find(s => s.routine_id === routines[0].id) ?? null);
      }

      // 3. Weekly goal tracker — which days this week did the user train?
      const weekGoalValue = profile?.training_days_per_week || 4;
      setWeekGoal(weekGoalValue);

      // Get start of current week (Monday)
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sun
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - mondayOffset);
      monday.setHours(0, 0, 0, 0);

      // Check which day indices (0=Mon..6=Sun) had a completed session
      const trainedDays = new Set();
      for (const s of allSessions) {
        const d = new Date(s.completed_at);
        if (d >= monday) {
          const idx = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon=0..Sun=6
          trainedDays.add(idx);
        }
      }
      setWeekDaysTrained([...trainedDays]);

      // Fetch XP/level data
      getUserPoints(user.id).then(pts => setUserPoints(pts)).catch(() => {});

      setLoading(false);

      // Run smart notification scheduler (fire-and-forget)
      runNotificationScheduler(user.id, profile.gym_id).catch(() => {});
    };

    load();
  }, [user, profile]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  const liftCount    = routineExercises.length || nextRoutine?.routine_exercises?.length || 0;
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

  // Weekly goal progress
  const weekProgress = Math.min((weekDaysTrained.length / weekGoal) * 100, 100);
  const goalHit = weekDaysTrained.length >= weekGoal;

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="mx-auto w-full max-w-[480px] px-5 pt-6 pb-28 md:pb-12 stagger-fade-in space-y-5">

        {/* ── 1. LEVEL / XP (top of page) ────────────────────────────────────── */}
        {!loading && (
          <Link
            to="/rewards"
            className="block rounded-[12px] bg-[#0F172A] border border-white/8 px-4 py-2.5 active:scale-[0.99] transition-transform"
          >
            <div className="flex items-center gap-2.5 h-[20px]">
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
              <div className="flex-1 h-[6px] rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${xpProgress}%`, backgroundColor: tier.color }}
                />
              </div>
              <span className="text-[10px] text-[#6B7280] whitespace-nowrap shrink-0">
                {xpIntoLevel}/{xpForNext} XP
              </span>
              <ChevronRight size={12} className="text-[#4B5563] shrink-0" />
            </div>
          </Link>
        )}

        {/* ── 2. GREETING + STREAK ───────────────────────────────────────────── */}
        <section className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-[24px] font-black text-[#E5E7EB] tracking-tight leading-tight">
                {timeGreeting}, {firstName}.
              </h1>
              <p className="text-[13px] text-[#9CA3AF] mt-2 leading-relaxed">
                {loading ? '…' : coachLine}
              </p>
              {!loading && smartMotivation && (
                <p className="text-[12px] text-[#D4AF37] mt-1.5 font-medium leading-snug">
                  {smartMotivation}
                </p>
              )}
              {!loading && streakAtRisk && (
                <p className="text-[11px] font-bold text-amber-400 mt-1.5">
                  Streak at risk — train today to keep it
                </p>
              )}
            </div>

            {!loading && (
              <div className="flex flex-col items-center shrink-0 pt-1">
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

        {/* ── 3. TODAY'S WORKOUT (highlighted hero card) ─────────────────────── */}
        <section>
          {loading ? (
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 h-48 animate-pulse" />
          ) : activeSession ? (
            <div className="rounded-[14px] bg-gradient-to-b from-emerald-500/[0.08] to-[#0F172A] border border-emerald-500/25 overflow-hidden">
              <button
                type="button"
                onClick={() => navigate(`/session/${activeSession.routineId}`)}
                className="w-full text-left active:scale-[0.99] transition-transform"
              >
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <Timer size={12} className="text-emerald-400" />
                    </div>
                    <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">In progress</span>
                  </div>
                  <h2 className="text-[24px] font-black text-[#E5E7EB] tracking-tight mb-1">
                    {activeSession.routineName ?? 'Workout'}
                  </h2>
                  <p className="text-sm text-[#9CA3AF] mb-5">
                    {activeSetsCompleted} / {activeSetsTotal} sets · {formatTime(activeSession.elapsedTime ?? 0)}
                  </p>
                  <div className="w-full py-3.5 rounded-xl bg-emerald-500 text-black text-center font-bold text-[15px]">
                    Resume workout
                  </div>
                </div>
              </button>
            </div>
          ) : nextRoutine ? (
            <div className="rounded-[14px] bg-gradient-to-b from-[#D4AF37]/[0.06] to-[#0F172A] border border-[#D4AF37]/20 overflow-hidden">
              <button
                type="button"
                onClick={() => navigate(`/session/${nextRoutine.id}`)}
                className="w-full text-left active:scale-[0.99] transition-transform"
              >
                <div className="p-5 pb-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-[#D4AF37]/15 flex items-center justify-center">
                      <Dumbbell size={12} className="text-[#D4AF37]" />
                    </div>
                    <span className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                      Today's workout
                    </span>
                  </div>
                  <h2 className="text-[26px] font-black text-[#E5E7EB] tracking-tight mb-1">
                    {nextRoutine.name}
                  </h2>
                  <p className="text-[12px] text-[#6B7280] mb-1">
                    {liftCount} exercises · ~{estimatedMin} min
                  </p>
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

              {/* Expandable exercise list */}
              {routineExercises.length > 0 && (
                <div className="border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowExercises(!showExercises); }}
                    className="w-full flex items-center justify-between px-5 py-3 text-left"
                  >
                    <span className="text-[12px] font-semibold text-[#9CA3AF]">
                      {showExercises ? 'Hide' : 'View'} exercises ({routineExercises.length})
                    </span>
                    <ChevronDown
                      size={14}
                      className={`text-[#6B7280] transition-transform duration-200 ${showExercises ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showExercises && (
                    <div className="px-5 pb-4 space-y-2">
                      {routineExercises.map((ex, i) => (
                        <div
                          key={ex.id}
                          className="flex items-center gap-3 py-2 px-3 rounded-lg bg-white/[0.03]"
                        >
                          <span className="text-[11px] font-bold text-[#4B5563] w-5 text-center shrink-0">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-[#E5E7EB] truncate">
                              {ex.exercises?.name || 'Exercise'}
                            </p>
                          </div>
                          <span className="text-[11px] text-[#6B7280] shrink-0">
                            {ex.target_sets} x {ex.target_reps}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
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

        {/* ── 4. WEEKLY GOAL TRACKER ──────────────────────────────────────── */}
        {!loading && (
          <section>
            <div
              className="rounded-[14px] border overflow-hidden"
              style={{
                background: goalHit
                  ? 'linear-gradient(135deg, rgba(212,175,55,0.08) 0%, rgba(15,23,42,1) 100%)'
                  : '#0F172A',
                borderColor: goalHit ? 'rgba(212,175,55,0.25)' : 'rgba(255,255,255,0.08)',
              }}
            >
              <div className="p-5">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #D4AF37 0%, #B8941F 100%)' }}
                    >
                      <Trophy size={14} className="text-black" />
                    </div>
                    <span className="text-[14px] font-bold text-[#E5E7EB]">
                      Weekly Goal
                    </span>
                  </div>
                  <div className="flex items-baseline gap-0.5">
                    <span
                      className="text-[20px] font-black"
                      style={{ color: goalHit ? '#D4AF37' : '#E5E7EB' }}
                    >
                      {weekDaysTrained.length}
                    </span>
                    <span className="text-[13px] text-[#6B7280] font-semibold">
                      / {weekGoal}
                    </span>
                  </div>
                </div>

                {/* Day boxes: Mon–Sun */}
                <div className="flex gap-2">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
                    const today = new Date();
                    const todayIdx = today.getDay() === 0 ? 6 : today.getDay() - 1;
                    const trained = weekDaysTrained.includes(i);
                    const isToday = i === todayIdx;
                    const isPast = i < todayIdx;

                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center gap-1.5"
                      >
                        <span className={`text-[10px] font-bold tracking-wide ${
                          isToday ? 'text-[#D4AF37]' : 'text-[#4B5563]'
                        }`}>
                          {label}
                        </span>
                        <div
                          className={`w-full aspect-square rounded-[10px] flex items-center justify-center transition-all duration-300 ${
                            trained
                              ? 'shadow-[0_0_12px_rgba(212,175,55,0.25)]'
                              : ''
                          }`}
                          style={{
                            background: trained
                              ? 'linear-gradient(135deg, #D4AF37 0%, #B8941F 100%)'
                              : isToday
                              ? 'rgba(212,175,55,0.08)'
                              : 'rgba(255,255,255,0.03)',
                            border: trained
                              ? 'none'
                              : isToday
                              ? '1.5px solid rgba(212,175,55,0.3)'
                              : isPast
                              ? '1px solid rgba(255,255,255,0.06)'
                              : '1px dashed rgba(255,255,255,0.08)',
                          }}
                        >
                          {trained && <Check size={16} strokeWidth={3} className="text-black" />}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="mt-4 h-[5px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${weekProgress}%`,
                      background: goalHit
                        ? 'linear-gradient(90deg, #D4AF37, #F5D060)'
                        : 'linear-gradient(90deg, #D4AF37, #B8941F)',
                    }}
                  />
                </div>

                {goalHit && (
                  <p className="text-[12px] font-bold mt-3 text-center"
                    style={{ color: '#D4AF37' }}
                  >
                    Goal hit! Keep the momentum going.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── 5. GYM PULSE ───────────────────────────────────────────────────── */}
        <section>
          <GymPulse />
        </section>

      </div>
    </div>
  );
};

export default Dashboard;
