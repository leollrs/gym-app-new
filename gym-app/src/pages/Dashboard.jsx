import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Play, Dumbbell, ChevronRight, ExternalLink, Timer, Flame, Zap } from 'lucide-react';
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

/* ── Stat card (Apple Fitness-inspired) ─────────────────────────────────────── */
const StatCard = ({ emoji, label, value, to, gold }) => {
  const content = (
    <div className={`rounded-[18px] border shadow-sm hover:shadow-md transition-all px-3 py-4 md:px-4 md:py-4 flex flex-col items-center text-center justify-between h-full ${gold ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30' : 'bg-white/90 dark:bg-slate-800/90 border-black/5 dark:border-white/10'}`}>
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F3F4F6] dark:bg-white/10 text-[15px]">
          {emoji}
        </span>
        <p className="text-[10px] md:text-[11px] text-[#6B7280] dark:text-slate-400 uppercase tracking-[0.18em] font-semibold">
          {label}
        </p>
      </div>
      <p
        className={`text-[26px] md:text-[32px] font-black leading-none tracking-tight ${gold ? 'text-[#D4AF37]' : 'text-[#0F172A] dark:text-slate-100'}`}
        style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
      >
        {value}
      </p>
    </div>
  );
  return to ? <Link to={to} className="block">{content}</Link> : content;
};

/* ── Main ───────────────────────────────────────────────────────────────────── */
const Dashboard = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats]               = useState({ sessions: 0, streak: 0, weekSessions: 0, weekGoal: 0 });
  const [chartData, setChartData]       = useState(
    DAY_LABELS.map(day => ({ day, volume: 0 }))
  );
  const [nextRoutine, setNextRoutine]   = useState(null);
  const [welcomeMsg, setWelcomeMsg]     = useState('');
  const [loading, setLoading]           = useState(true);
  const [unread, setUnread]             = useState(0);

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

      // 3. Load welcome message (gym news moved to Notifications page)
      const { data: branding } = await supabase
        .from('gym_branding')
        .select('welcome_message')
        .eq('gym_id', profile.gym_id)
        .single();

      setWelcomeMsg(branding?.welcome_message || '');

      setLoading(false);
    };

    load();
  }, [user, profile]);

  useEffect(() => {
    if (!user?.id) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .is('read_at', null);
      setUnread(count || 0);
    };
    fetchUnread();
    const ch = supabase.channel('dashboard-notif')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${user.id}` }, fetchUnread)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user?.id]);

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-10 pb-28 md:pb-12 animate-fade-in">

      {/* ── Greeting / hero strip ───────────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-center justify-between rounded-2xl border border-white/60 dark:border-white/10 bg-white/70 dark:bg-slate-800/80 shadow-sm backdrop-blur-xl px-4 md:px-6 py-4 md:py-5">
          <div className="flex items-center gap-3.5">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Profile"
                className="w-11 h-11 rounded-2xl border border-white/60 dark:border-white/20 object-cover shadow-sm"
              />
            ) : (
              <div className="w-11 h-11 rounded-2xl bg-[#F3F4FF] dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center justify-center shadow-sm">
                <span className="text-[#111827] dark:text-slate-200 font-bold text-[16px]">
                  {firstName[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <h1 className="text-[20px] md:text-[22px] font-semibold text-[#0F172A] dark:text-slate-100 leading-tight tracking-tight">
                Hey, {firstName}
              </h1>
              <p className="text-[12px] text-[#64748B] dark:text-slate-400 mt-0.5">
                Your training at a glance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Notifications"
              onClick={() => navigate('/notifications')}
              className="relative w-11 h-11 rounded-full bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 flex items-center justify-center text-[#64748B] dark:text-slate-400 hover:text-[#D4AF37] dark:hover:text-[#D4AF37] hover:bg-white dark:hover:bg-white/20 shadow-sm transition-colors"
            >
              <Bell size={20} />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#D4AF37] text-black text-[9px] font-bold flex items-center justify-center leading-none">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ── Welcome message (set by gym admin) ─────────────────────────── */}
      {welcomeMsg && (
        <div className="mb-8 px-5 py-4 bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-[14px]">
          <p className="text-[13px] text-[#D4AF37] leading-relaxed">{welcomeMsg}</p>
        </div>
      )}

      {/* ── TODAY'S WORKOUT ─────────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <p className="section-label">Today's Workout</p>
          <Link
            to="/workouts"
            className="text-[12px] text-[#6B7280] dark:text-slate-400 hover:text-[#E5E7EB] dark:hover:text-slate-200 flex items-center gap-0.5 transition-colors"
          >
            All workouts <ChevronRight size={13} />
          </Link>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-slate-800/80 h-[120px] animate-pulse shadow-sm" />
        ) : activeSession ? (
          /* ── Resume in-progress session ── */
          <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-gradient-to-r from-white via-[#F9FAFB] to-[#EFF6FF] dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 md:p-6 flex items-center gap-5">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 text-[#2563EB] dark:text-blue-400 flex items-center gap-1.5">
                  <Timer size={11} />
                  In progress · {formatTime(activeSession.elapsedTime ?? 0)}
                </p>
                <h2
                  className="text-[26px] md:text-[30px] font-black text-[#0F172A] dark:text-slate-100 leading-tight"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                >
                  {activeSession.routineName ?? 'Workout'}
                </h2>
                <p className="text-[13px] text-[#6B7280] dark:text-slate-400 mt-2 flex items-center gap-1.5">
                  <Dumbbell size={13} className="text-[#9CA3AF] dark:text-slate-500" />
                  {activeSetsCompleted} / {activeSetsTotal} sets completed
                </p>
              </div>

              <Link
                to={`/session/${activeSession.routineId}`}
                aria-label="Resume workout"
                className="w-16 h-16 md:w-18 md:h-18 rounded-full flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105 active:scale-95 bg-[#22C55E] text-white shadow-[0_0_24px_rgba(34,197,94,0.45)]"
              >
                <Play size={22} fill="white" stroke="white" strokeWidth={1.5} className="ml-0.5" />
              </Link>
            </div>
            {/* Progress bar */}
            <div className="h-1 bg-black/5 dark:bg-white/10">
              <div
                className="h-full bg-[#22C55E] transition-all"
                style={{ width: activeSetsTotal > 0 ? `${(activeSetsCompleted / activeSetsTotal) * 100}%` : '0%' }}
              />
            </div>
          </div>
        ) : nextRoutine ? (
          /* ── Start a routine ── */
          <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-gradient-to-r from-white via-[#FEFCE8] to-[#FFFBEB] dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 md:p-6 flex items-center gap-5">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2 text-[#CA8A04] dark:text-amber-400">
                  Ready to train
                </p>
                <h2
                  className="text-[26px] md:text-[30px] font-black text-[#0F172A] dark:text-slate-100 leading-tight"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
                >
                  {nextRoutine.name}
                </h2>
                <p className="text-[13px] text-[#6B7280] dark:text-slate-400 mt-2 flex items-center gap-1.5">
                  <Dumbbell size={13} className="text-[#9CA3AF] dark:text-slate-500" />
                  {nextRoutine.routine_exercises?.length ?? 0} exercises
                </p>
              </div>

              <Link
                to={`/session/${nextRoutine.id}`}
                aria-label="Start workout"
                className="w-16 h-16 md:w-18 md:h-18 rounded-full flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105 active:scale-95 bg-[#D4AF37] text-black dark:text-black shadow-[0_0_24px_rgba(212,175,55,0.45)]"
              >
                <Play size={22} fill="black" stroke="black" strokeWidth={1.5} className="ml-0.5" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-white/70 dark:bg-slate-800/80 p-6 text-center shadow-sm">
            <Dumbbell size={32} className="mx-auto mb-3 text-[#CBD5E1] dark:text-slate-500" />
            <p className="text-[15px] font-semibold text-[#0F172A] dark:text-slate-100">No routines yet</p>
            <p className="text-[13px] text-[#6B7280] dark:text-slate-400 mt-1">Create your first routine to get started</p>
            <Link
              to="/workouts"
              className="inline-block mt-4 bg-[#D4AF37] hover:bg-[#E6C766] text-black text-[13px] font-bold px-5 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              Create Routine
            </Link>
          </div>
        )}
      </section>

      {/* ── Stats row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-10">
        <StatCard emoji="🔥" label="Streak"   value={loading ? '—' : `${stats.streak} days`} />
        <StatCard emoji="🏋️" label="Workouts" value={loading ? '—' : stats.sessions} to="/workout-log" />
        <StatCard emoji="🎯" label="This Week" value={loading ? '—' : stats.weekGoal > 0 ? `${stats.weekSessions}/${stats.weekGoal}` : stats.weekSessions} gold={!loading && stats.weekGoal > 0 && stats.weekSessions >= stats.weekGoal} to="/workout-log" />
      </div>

      {/* ── Quick actions ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-10">
        {[
          { to: '/nutrition', icon: Flame, label: 'Nutrition', color: '#D4AF37' },
          { to: '/strength',  icon: Zap,   label: 'Strength',  color: '#A78BFA' },
        ].map(({ to, icon: Icon, label, color }) => (
          <Link
            key={to} to={to}
            className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors px-3 py-5 flex flex-col items-center gap-2 min-h-[80px] md:min-h-[72px] justify-center"
          >
            <Icon size={22} style={{ color }} strokeWidth={2} />
            <p className="text-[12px] font-semibold text-[#9CA3AF]">{label}</p>
          </Link>
        ))}
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

      </div>
    </div>
  );
};

export default Dashboard;
