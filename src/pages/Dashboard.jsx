import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  currentUser, announcements, upcomingWorkouts, progressData
} from '../mockDb';
import {
  Trophy, Flame, TrendingUp, Calendar, ChevronRight,
  Bell, Play, Dumbbell, Megaphone
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

/* ── Stat card ─────────────────────────────────────────────────── */
const STAT_STYLES = {
  amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   icon: 'bg-amber-500/15'   },
  blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400',    icon: 'bg-blue-500/15'    },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: 'bg-emerald-500/15' },
};

const StatCard = ({ icon: Icon, label, value, theme }) => {
  const s = STAT_STYLES[theme];
  return (
    <div className={`rounded-2xl p-4 border border-white/6 flex flex-col gap-3 ${s.bg}`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${s.icon} ${s.text}`}>
        <Icon size={17} strokeWidth={2.5} />
      </div>
      <div>
        <p className={`text-[26px] font-bold leading-none tracking-tight ${s.text}`}>{value}</p>
        <p className="text-[12px] text-slate-500 mt-1.5 font-medium">{label}</p>
      </div>
    </div>
  );
};

/* ── Announcement card ─────────────────────────────────────────── */
const AnnCard = ({ ann }) => (
  <div className="bg-[#131929] rounded-2xl border border-white/6 p-4 flex gap-3">
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
      ann.type === 'event' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'
    }`}>
      {ann.type === 'event' ? <Trophy size={16} /> : <Megaphone size={16} />}
    </div>
    <div>
      <p className="text-[14px] font-semibold text-white leading-snug">{ann.title}</p>
      <p className="text-[12px] text-slate-500 mt-1 leading-snug">{ann.message}</p>
    </div>
  </div>
);

/* ── Main ──────────────────────────────────────────────────────── */
const Dashboard = () => {
  const [workoutsDone, setWorkoutsDone] = useState(currentUser.stats.workoutsCompleted);
  const [volume, setVolume]             = useState(currentUser.stats.totalVolumeLbs);
  const [done, setDone]                 = useState(false);
  const [chartData, setChartData]       = useState([...progressData]);

  const handleMarkDone = () => {
    if (done) return;
    const vol = 8500;
    setWorkoutsDone(w => w + 1);
    setVolume(v => v + vol);
    setDone(true);
    setChartData(prev => {
      const next = [...prev];
      next[2] = { day: 'Wed', volume: vol };
      return next;
    });
  };

  return (
    <div className="container main-content animate-fade-in pb-24 md:pb-8">

      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-7">
        <div className="flex items-center gap-3">
          <img
            src={currentUser.avatarUrl}
            alt="Profile"
            className="w-11 h-11 rounded-2xl border border-blue-500/30"
          />
          <div>
            <h1 className="text-[20px] font-bold text-white leading-tight">
              Hey, {currentUser.fullName.split(' ')[0]} 👋
            </h1>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {currentUser.homeGym} · <span className="text-blue-400">Lv.{currentUser.stats.level}</span>
            </p>
          </div>
        </div>
        <button
          aria-label="Notifications"
          className="w-9 h-9 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/8 transition-colors"
        >
          <Bell size={17} />
        </button>
      </div>

      {/* ── Stats row ────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-7">
        <StatCard icon={Flame}      label="Day Streak" value={currentUser.stats.currentStreak} theme="amber" />
        <StatCard icon={Trophy}     label="Workouts"   value={workoutsDone}                    theme="blue" />
        <StatCard icon={TrendingUp} label="Volume"     value={`${(volume/1000).toFixed(0)}k`}  theme="emerald" />
      </div>

      {/* ── Main + sidebar ───────────────────────────────────────── */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_280px]">

        {/* LEFT */}
        <div className="flex flex-col gap-6">

          {/* Up Next */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em]">Up Next</p>
              <Link to="/workouts" className="text-[12px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors">
                View all <ChevronRight size={13} />
              </Link>
            </div>

            <div className="bg-[#131929] rounded-2xl border border-white/6 overflow-hidden">
              <div className="p-5 flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full mb-3 ${
                    done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'
                  }`}>
                    <Calendar size={10} />
                    {done ? 'Done for today ✓' : upcomingWorkouts[0].date}
                  </span>

                  <h3
                    className="text-[21px] font-bold text-white leading-tight mb-1.5"
                    style={{ opacity: done ? 0.45 : 1 }}
                  >
                    {upcomingWorkouts[0].name}
                  </h3>
                  <p className="text-[13px] text-slate-500 flex items-center gap-1.5">
                    <Dumbbell size={13} className="text-slate-600" />
                    {upcomingWorkouts[0].exercises} exercises · {upcomingWorkouts[0].duration}
                  </p>
                </div>

                <Link
                  to="/session/cw1"
                  aria-label="Start workout"
                  className="w-13 h-13 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-white flex-shrink-0 mt-1 shadow-[0_0_24px_rgba(59,130,246,0.4)] hover:shadow-[0_0_32px_rgba(59,130,246,0.55)] transition-all hover:scale-105 active:scale-95"
                >
                  <Play size={20} fill="currentColor" className="ml-0.5" />
                </Link>
              </div>

              {!done && (
                <div className="px-5 pb-4 -mt-1">
                  <button
                    onClick={handleMarkDone}
                    className="w-full text-[13px] font-medium text-slate-600 hover:text-slate-300 py-2.5 rounded-xl border border-white/6 hover:bg-white/4 transition-all"
                  >
                    Mark done without tracking
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Volume Chart */}
          <section>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-3">Volume This Week</p>
            <div className="bg-[#131929] rounded-2xl border border-white/6 p-4" style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 4, left: -26, bottom: 0 }}>
                  <XAxis
                    dataKey="day" axisLine={false} tickLine={false}
                    tick={{ fill: '#475569', fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false} tickLine={false}
                    tick={{ fill: '#475569', fontSize: 11 }}
                    tickFormatter={v => v >= 1000 ? `${v/1000}k` : v}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{
                      backgroundColor: '#1C2333',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      fontSize: '13px',
                    }}
                    formatter={v => [`${v.toLocaleString()} lbs`, 'Volume']}
                  />
                  <Bar dataKey="volume" radius={[6, 6, 2, 2]} maxBarSize={36}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.volume > 0 ? '#3B82F6' : 'rgba(255,255,255,0.04)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* RIGHT sidebar */}
        <div className="flex flex-col gap-5">
          <section>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-3">Gym News</p>
            <div className="flex flex-col gap-2.5">
              {announcements.map(ann => <AnnCard key={ann.id} ann={ann} />)}
            </div>
          </section>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
