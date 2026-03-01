import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  currentUser, announcements, upcomingWorkouts, progressData
} from '../mockDb';
import { Bell, Play, Dumbbell, ChevronRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

/* ── Stat card ─────────────────────────────────────────────────── */
const StatCard = ({ emoji, label, value }) => (
  <div className="bg-[#111318] rounded-2xl p-4 flex flex-col border border-white/5">
    <p className="text-[38px] font-black text-white leading-none tracking-tight">{value}</p>
    <p className="text-[10px] text-slate-500 uppercase tracking-[0.14em] font-bold mt-2.5">
      {emoji}&nbsp; {label}
    </p>
  </div>
);

/* ── Gym News card ─────────────────────────────────────────────── */
const AnnCard = ({ ann }) => (
  <div className={`bg-[#111318] rounded-2xl px-4 py-3.5 border border-white/5 border-l-4 ${
    ann.type === 'event' ? 'border-l-amber-500' : 'border-l-blue-500'
  }`}>
    <p className="text-[14px] font-semibold text-white leading-snug">{ann.title}</p>
    <p className="text-[12px] text-slate-500 mt-1 leading-snug">{ann.message}</p>
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

      {/* ── Greeting ─────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-7">
        <div className="flex items-center gap-3">
          <img
            src={currentUser.avatarUrl}
            alt="Profile"
            className="w-11 h-11 rounded-2xl border border-white/10"
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
        <StatCard emoji="🔥" label="Streak"   value={currentUser.stats.currentStreak} />
        <StatCard emoji="🏋️" label="Workouts" value={workoutsDone} />
        <StatCard emoji="📊" label="Volume"   value={`${(volume / 1000).toFixed(0)}k`} />
      </div>

      {/* ── Main + sidebar ───────────────────────────────────────── */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_280px]">

        {/* LEFT */}
        <div className="flex flex-col gap-6">

          {/* Today's Workout */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em]">Today's Workout</p>
              <Link
                to="/workouts"
                className="text-[12px] text-slate-500 hover:text-white flex items-center gap-0.5 transition-colors"
              >
                All <ChevronRight size={13} />
              </Link>
            </div>

            <div className="bg-[#111318] rounded-2xl border border-white/5 overflow-hidden">
              <div className="p-5 flex justify-between items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-bold uppercase tracking-[0.12em] mb-2 ${
                    done ? 'text-emerald-400' : 'text-blue-400'
                  }`}>
                    {done ? 'Done for today ✓' : `Today · ${upcomingWorkouts[0].duration}`}
                  </p>
                  <h3
                    className="text-[22px] font-bold text-white leading-tight"
                    style={{ opacity: done ? 0.4 : 1 }}
                  >
                    {upcomingWorkouts[0].name}
                  </h3>
                  <p className="text-[13px] text-slate-500 mt-1.5 flex items-center gap-1.5">
                    <Dumbbell size={13} className="text-slate-600" />
                    {upcomingWorkouts[0].exercises} exercises
                  </p>
                </div>

                <Link
                  to="/session/cw1"
                  aria-label="Start workout"
                  className="w-14 h-14 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-white flex-shrink-0 shadow-[0_0_24px_rgba(59,130,246,0.35)] hover:shadow-[0_0_32px_rgba(59,130,246,0.5)] transition-all hover:scale-105 active:scale-95"
                >
                  <Play size={22} fill="currentColor" className="ml-0.5" />
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
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-3">Volume This Week</p>
            <div className="bg-[#111318] rounded-2xl border border-white/5 p-4" style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 4, left: -26, bottom: 0 }}>
                  <XAxis
                    dataKey="day" axisLine={false} tickLine={false}
                    tick={{ fill: '#475569', fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false} tickLine={false}
                    tick={{ fill: '#475569', fontSize: 11 }}
                    tickFormatter={v => v >= 1000 ? `${v / 1000}k` : v}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{
                      backgroundColor: '#111318',
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
            <div className="flex justify-between items-center mb-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em]">Gym News</p>
              <button className="text-[12px] text-slate-500 hover:text-white transition-colors flex items-center gap-0.5">
                All <ChevronRight size={13} />
              </button>
            </div>
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
