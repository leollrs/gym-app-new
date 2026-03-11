import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Timer, Flame, Zap } from 'lucide-react';
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

  const [loading, setLoading]           = useState(true);
  const [recentSessions, setRecentSessions] = useState([]);
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

      setLoading(false);
    };

    load();
  }, [user, profile]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="min-h-screen bg-[#05070B]">
      <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-28 md:pb-12 animate-fade-in">

        {/* Greeting section */}
        <section className="mb-5 mt-2">
          <h1 className="text-xl font-bold text-[#E5E7EB] tracking-tight">
            Hey, {firstName}
          </h1>
          <p className="text-[13px] text-[#9CA3AF] mt-0.5">
            Stay consistent. Get stronger.
          </p>
        </section>

        {/* In-progress session banner (only shows when a session is active) */}
        {activeSession && (
          <section className="mb-5">
            <button
              type="button"
              onClick={() => navigate(`/session/${activeSession.routineId}`)}
              className="w-full rounded-[14px] bg-[#0F172A] border border-emerald-500/30 p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
            >
              <Timer size={18} className="text-emerald-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#E5E7EB] text-sm truncate">
                  {activeSession.routineName ?? 'Workout'} — in progress
                </p>
                <p className="text-xs text-[#9CA3AF]">
                  {activeSetsCompleted}/{activeSetsTotal} sets · {formatTime(activeSession.elapsedTime ?? 0)}
                </p>
              </div>
              <span className="text-xs font-bold text-emerald-400 flex-shrink-0">Resume →</span>
            </button>
          </section>
        )}

        {/* 3 stat chips */}
        <section className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-3 text-center">
            <div className="text-base mb-0.5">🔥</div>
            <p className="text-[15px] font-bold text-[#E5E7EB]">
              {loading ? '—' : stats.streak}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">Day streak</p>
          </div>
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-3 text-center">
            <div className="text-base mb-0.5">🏋️</div>
            <p className="text-[15px] font-bold text-[#E5E7EB]">
              {loading ? '—' : stats.sessions}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">Workouts</p>
          </div>
          <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-3 text-center">
            <div className="text-base mb-0.5">🎯</div>
            <p className="text-[15px] font-bold text-[#E5E7EB]">
              {loading ? '—' : stats.weekGoal > 0 ? `${stats.weekSessions}/${stats.weekGoal}` : stats.weekSessions}
            </p>
            <p className="text-[10px] text-[#6B7280] mt-0.5">This week</p>
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
