import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Play, Dumbbell, ChevronRight, ExternalLink, Timer } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
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

/* ── Stat card ──────────────────────────────────────────────────────────────── */
const StatCard = ({ emoji, label, value, to }) => {
  const inner = (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors px-3 py-4 md:p-5 flex flex-col h-full overflow-hidden">
      <p className="text-[28px] md:text-[36px] font-black text-white leading-none tracking-tight">{value}</p>
      <p className="text-[10px] md:text-[11px] text-[#6B7280] uppercase tracking-[0.04em] md:tracking-[0.15em] font-bold mt-2 md:mt-3 flex items-center gap-1 whitespace-nowrap overflow-hidden">
        {emoji}&nbsp;{label}
        {to && <ExternalLink size={10} className="opacity-40 ml-0.5 flex-shrink-0" />}
      </p>
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
};

/* ── Gym News card ──────────────────────────────────────────────────────────── */
const AnnCard = ({ ann }) => (
  <div className={`bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors px-5 py-4 border-l-[3px] ${
    ann.type === 'event' ? 'border-l-[#D4AF37]' : 'border-l-[#3B82F6]'
  }`}>
    <p className="text-[15px] font-semibold text-[#E5E7EB] leading-snug">{ann.title}</p>
    <p className="text-[13px] text-[#6B7280] mt-1.5 leading-relaxed">{ann.message}</p>
  </div>
);

/* ── Main ───────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile } = useAuth();

  const [stats, setStats]               = useState({ sessions: 0, streak: 0, volumeK: '0' });
  const [chartData, setChartData]       = useState(
    DAY_LABELS.map(day => ({ day, volume: 0 }))
  );
  const [nextRoutine, setNextRoutine]   = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading]           = useState(true);

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

      // 1. Load all completed sessions (lightweight — just what we need for stats)
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('completed_at, total_volume_lbs, routine_id')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      const allSessions = sessions || [];

      const totalSessions = allSessions.length;
      const totalVolume   = allSessions.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
      const streak        = computeStreak(allSessions);
      const weekly        = buildWeekChart(allSessions);

      setStats({
        sessions: totalSessions,
        streak,
        volumeK: totalVolume >= 1000
          ? `${(totalVolume / 1000).toFixed(0)}k`
          : `${Math.round(totalVolume)}`,
      });
      setChartData(weekly);

      // 2. Load first/most-recent routine for "Today's Workout"
      const { data: routines } = await supabase
        .from('routines')
        .select('id, name, routine_exercises(id)')
        .eq('created_by', user.id)
        .eq('is_template', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (routines && routines.length > 0) {
        setNextRoutine(routines[0]);
      }

      // 3. Load gym announcements
      const { data: anns } = await supabase
        .from('gym_announcements')
        .select('id, title, message, announcement_type')
        .eq('gym_id', profile.gym_id)
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(5);

      setAnnouncements(anns || []);

      setLoading(false);
    };

    load();
  }, [user, profile]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* ── Greeting ────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-3.5">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt="Profile"
              className="w-11 h-11 rounded-xl border border-white/10 object-cover"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-[#D4AF37]/15 border border-[#D4AF37]/25 flex items-center justify-center">
              <span className="text-[#D4AF37] font-bold text-[16px]">
                {firstName[0]?.toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <h1 className="text-[20px] font-bold text-[#E5E7EB] leading-tight">
              Hey, {firstName} 👋
            </h1>
            <p className="text-[12px] text-[#6B7280] mt-0.5">
              Let's get after it today
            </p>
          </div>
        </div>
        <button
          aria-label="Notifications"
          className="w-9 h-9 rounded-xl bg-white/4 border border-white/8 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] hover:bg-white/8 transition-colors"
        >
          <Bell size={16} />
        </button>
      </div>

      {/* ── TODAY'S WORKOUT ─────────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <p className="section-label">Today's Workout</p>
          <Link
            to="/workouts"
            className="text-[12px] text-[#6B7280] hover:text-[#E5E7EB] flex items-center gap-0.5 transition-colors"
          >
            All workouts <ChevronRight size={13} />
          </Link>
        </div>

        {loading ? (
          <div className="bg-[#0F172A] rounded-[14px] border border-white/6 h-[120px] animate-pulse" />
        ) : activeSession ? (
          /* ── Resume in-progress session ── */
          <div className="bg-[#0F172A] rounded-[14px] border border-[#3B82F6]/30 hover:border-[#3B82F6]/50 transition-colors overflow-hidden">
            <div className="p-6 flex items-center gap-5">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.13em] mb-2.5 text-[#3B82F6] flex items-center gap-1.5">
                  <Timer size={11} />
                  In Progress · {formatTime(activeSession.elapsedTime ?? 0)}
                </p>
                <h2
                  className="text-[28px] font-black text-white leading-tight"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                >
                  {activeSession.routineName ?? 'Workout'}
                </h2>
                <p className="text-[13px] text-[#6B7280] mt-2 flex items-center gap-1.5">
                  <Dumbbell size={13} className="text-[#4B5563]" />
                  {activeSetsCompleted} / {activeSetsTotal} sets completed
                </p>
              </div>

              <Link
                to={`/session/${activeSession.routineId}`}
                aria-label="Resume workout"
                className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 active:scale-95 bg-[#3B82F6] text-white"
                style={{ boxShadow: '0 0 24px rgba(59,130,246,0.35)' }}
              >
                <Play size={22} fill="white" stroke="white" strokeWidth={1.5} className="ml-0.5" />
              </Link>
            </div>
            {/* Progress bar */}
            <div className="h-0.5 bg-white/6">
              <div
                className="h-full bg-[#3B82F6] transition-all"
                style={{ width: activeSetsTotal > 0 ? `${(activeSetsCompleted / activeSetsTotal) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ) : nextRoutine ? (
          /* ── Start a routine ── */
          <div className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/10 transition-colors overflow-hidden">
            <div className="p-6 flex items-center gap-5">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.13em] mb-2.5 text-[#D4AF37]">
                  Ready to go
                </p>
                <h2
                  className="text-[28px] font-black text-white leading-tight"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                >
                  {nextRoutine.name}
                </h2>
                <p className="text-[13px] text-[#6B7280] mt-2 flex items-center gap-1.5">
                  <Dumbbell size={13} className="text-[#4B5563]" />
                  {nextRoutine.routine_exercises?.length ?? 0} exercises
                </p>
              </div>

              <Link
                to={`/session/${nextRoutine.id}`}
                aria-label="Start workout"
                className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 active:scale-95 bg-[#D4AF37] text-[#ffffff]"
                style={{ boxShadow: '0 0 24px rgba(212,175,55,0.35)' }}
              >
                <Play size={22} fill="white" stroke="white" strokeWidth={1.5} className="ml-0.5" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-[#0F172A] rounded-[14px] border border-white/6 p-6 text-center">
            <Dumbbell size={32} className="mx-auto mb-3 text-[#4B5563]" />
            <p className="text-[15px] font-semibold text-[#9CA3AF]">No routines yet</p>
            <p className="text-[13px] text-[#6B7280] mt-1">Create your first routine to get started</p>
            <Link
              to="/workouts"
              className="inline-block mt-4 bg-[#D4AF37] hover:bg-[#E6C766] text-black text-[13px] font-bold px-5 py-2.5 rounded-xl transition-colors"
            >
              Create Routine
            </Link>
          </div>
        )}
      </section>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-10">
        <StatCard emoji="🔥" label="Streak"   value={loading ? '—' : stats.streak} />
        <StatCard emoji="🏋️" label="Workouts" value={loading ? '—' : stats.sessions} to="/workout-log" />
        <StatCard emoji="📊" label="Volume"   value={loading ? '—' : stats.volumeK} />
      </div>

      {/* ── Chart + Sidebar ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-8 md:grid md:grid-cols-[1fr_288px]">

        {/* Volume Chart */}
        <section>
          <p className="section-label mb-4">Volume This Week</p>
          <div className="bg-[#0F172A] rounded-[14px] border border-white/6 p-5" style={{ height: 248 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 4, left: -28, bottom: 0 }}>
                <XAxis
                  dataKey="day" axisLine={false} tickLine={false}
                  tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'Barlow, sans-serif' }}
                />
                <YAxis
                  axisLine={false} tickLine={false}
                  tick={{ fill: '#6B7280', fontSize: 10, fontFamily: 'Barlow, sans-serif' }}
                  tickFormatter={v => v >= 1000 ? `${v / 1000}k` : v}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontFamily: 'Barlow, sans-serif',
                    color: '#0F172A',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  }}
                  labelStyle={{ color: '#64748B', fontWeight: 600 }}
                  formatter={v => [`${v.toLocaleString()} lbs`, '']}
                />
                <Bar dataKey="volume" radius={[5, 5, 2, 2]} maxBarSize={36}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.volume > 0 ? '#3B82F6' : 'rgba(255,255,255,0.04)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Gym News */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <p className="section-label">Gym News</p>
          </div>
          <div className="flex flex-col gap-3">
            {announcements.length > 0 ? (
              announcements.map(ann => (
                <AnnCard
                  key={ann.id}
                  ann={{
                    ...ann,
                    type: ann.announcement_type === 'event' ? 'event' : 'news',
                  }}
                />
              ))
            ) : (
              <div className="bg-[#0F172A] rounded-[14px] border border-white/6 px-5 py-6 text-center">
                <p className="text-[13px] text-[#4B5563]">No announcements from your gym yet.</p>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Dashboard;
