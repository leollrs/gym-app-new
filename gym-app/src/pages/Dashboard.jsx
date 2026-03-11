import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Timer, Flame, Zap, Dumbbell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// Build a 7-day volume chart (Sun–Sat of the current week)
const buildWeekChart = (sessions) => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  const buckets = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return { day: DAY_LABELS[i], date: d, volume: 0 };
  });

  sessions.forEach(s => {
    const d = new Date(s.completed_at);
    const dayIdx = d.getDay(); // 0=Sun
    // Only include if within this calendar week
    if (d >= startOfWeek && d < new Date(startOfWeek.getTime() + 7 * 86400000)) {
      buckets[dayIdx].volume += parseFloat(s.total_volume_lbs) || 0;
    }
  });

  return buckets.map(b => ({ day: b.day, volume: Math.round(b.volume) }));
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

/* ── Main ───────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]               = useState({ sessions: 0, streak: 0, weekSessions: 0, weekGoal: 0 });
  const [chartData, setChartData]       = useState(
    DAY_LABELS.map(day => ({ day, volume: 0 }))
  );

  const [nextRoutine, setNextRoutine]         = useState(null);
  const [lastSessionForRoutine, setLastSessionForRoutine] = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [recentSessions, setRecentSessions]   = useState([]);
  const [readiness, setReadiness]       = useState('Loading…');
  const [readinessScore, setReadinessScore] = useState(5);

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

      // 1. Load all completed sessions (lightweight — just what we need for stats + cards)
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('id, name, completed_at, total_volume_lbs, duration_seconds, routine_id')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      const allSessions = sessions || [];

      const totalSessions = allSessions.length;
      const streak        = computeStreak(allSessions);
      const weekly        = buildWeekChart(allSessions);

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
      setChartData(weekly);

      // 1b. Recent sessions for activity cards (top 4)
      setRecentSessions(allSessions.slice(0, 4));

      // 1c. Simple readiness heuristic based on recent training load vs goal
      let rScore = 5;
      let rText = 'Great day to start a new streak';
      if (weekGoal > 0) {
        if (weekSessions >= weekGoal + 1) {
          rScore = 4;
          rText = "Go light today — you're ahead of goal";
        } else if (weekSessions === weekGoal) {
          rScore = 6;
          rText = 'Optional day — streak padding';
        } else if (streak >= 3 && weekSessions < weekGoal - 1) {
          rScore = 10;
          rText = 'Well rested and on track — go hard';
        } else if (streak >= 1) {
          rScore = 8;
          rText = 'Keep the momentum going today';
        } else {
          rScore = 8;
          rText = 'Plenty of room to train today';
        }
      } else {
        if (streak >= 5) {
          rScore = 3;
          rText = "You've been on it — consider how you feel before pushing";
        } else if (streak >= 1) {
          rScore = 8;
          rText = 'Keep the momentum going today';
        } else {
          rScore = 5;
          rText = 'Great day to start a new streak';
        }
      }
      setReadiness(rText);
      setReadinessScore(rScore);

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

      setLoading(false);
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

  // Streak visual intensity
  const streakColor = !loading
    ? stats.streak >= 14 ? '#FF6B35'
    : stats.streak >= 7  ? '#D4AF37'
    : stats.streak >= 3  ? '#F59E0B'
    : stats.streak >= 1  ? '#E5E7EB'
    : '#4B5563'
    : '#4B5563';
  const streakLabel = stats.streak >= 3 ? "Don't break it" : stats.streak >= 1 ? 'Day streak' : 'Start today';

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
        </section>

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

        {/* 3 stat chips */}
        <section className="grid grid-cols-3 gap-2 mb-3">
          {/* Streak — dominant */}
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-3 text-center" style={{ borderColor: stats.streak >= 3 && !loading ? `${streakColor}30` : undefined }}>
            <p className="text-[28px] font-black leading-none" style={{ color: streakColor }}>
              {loading ? '—' : stats.streak}
            </p>
            <p className="text-[10px] mt-1 font-semibold" style={{ color: streakColor === '#4B5563' ? '#4B5563' : `${streakColor}99` }}>
              {loading ? '…' : streakLabel}
            </p>
          </div>
          {/* Total workouts */}
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-3 text-center">
            <p className="text-[28px] font-black text-[#E5E7EB] leading-none">
              {loading ? '—' : stats.sessions}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-1 font-semibold">Total</p>
          </div>
          {/* Weekly pace */}
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-3 text-center">
            <p className="text-[28px] font-black leading-none" style={{ color: loading ? '#4B5563' : weekColor }}>
              {loading ? '—' : stats.weekGoal > 0 ? `${stats.weekSessions}/${stats.weekGoal}` : stats.weekSessions}
            </p>
            <p className="text-[10px] mt-1 font-semibold" style={{ color: loading ? '#4B5563' : `${weekColor}99` }}>
              {loading ? '…' : weekLabel}
            </p>
          </div>
        </section>

        {/* 2 shortcut cards */}
        <section className="grid grid-cols-2 gap-3 mb-5">
          <Link
            to="/nutrition"
            className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5 flex flex-col items-center justify-center min-h-[100px] hover:border-[#D4AF37]/30 hover:bg-[#111827] transition-all active:scale-[0.98]"
          >
            <Flame size={28} className="text-[#D4AF37] mb-2" />
            <span className="font-semibold text-[#E5E7EB] text-[15px]">Nutrition</span>
            <span className="text-[11px] text-[#6B7280] mt-1">Calories &amp; macros</span>
          </Link>
          <Link
            to="/strength"
            className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5 flex flex-col items-center justify-center min-h-[100px] hover:border-[#D4AF37]/30 hover:bg-[#111827] transition-all active:scale-[0.98]"
          >
            <Zap size={28} className="text-[#D4AF37] mb-2" />
            <span className="font-semibold text-[#E5E7EB] text-[15px]">Strength</span>
            <span className="text-[11px] text-[#6B7280] mt-1">PRs &amp; volume trends</span>
          </Link>
        </section>

        {/* 6. Weekly progress — compact, motivating strip */}
        <section className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-[0.18em]">
              Weekly consistency
            </span>
            <span className="text-xs font-semibold text-[#E5E7EB]">
              {loading ? '—' : stats.weekGoal > 0 ? `${stats.weekSessions} / ${stats.weekGoal} workouts` : `${stats.weekSessions} workouts`}
            </span>
          </div>
          <div className="flex gap-1.5">
            {chartData.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className={`w-full rounded-xl transition-all min-h-[40px] ${
                    d.volume > 0 ? 'bg-[#D4AF37]' : 'bg-[#111827]'
                  }`}
                />
                <span className="text-[10px] font-medium text-[#6B7280]">
                  {d.day.slice(0, 1)}
                </span>
              </div>
            ))}
          </div>
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
