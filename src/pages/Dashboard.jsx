import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  currentUser, announcements, upcomingWorkouts, progressData
} from '../mockDb';
import {
  Trophy, Flame, TrendingUp, Calendar, ChevronRight, Bell, Play, Dumbbell, Megaphone
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

const StatCard = ({ icon: Icon, label, value, color }) => (
  <div className={`rounded-2xl p-4 border border-white/5 flex flex-col gap-3 cursor-default ${color}`}>
    <Icon size={20} strokeWidth={2} />
    <div>
      <p className="text-[28px] font-bold text-white leading-none tracking-tight">{value}</p>
      <p className="text-[12px] text-slate-400 mt-1 font-medium">{label}</p>
    </div>
  </div>
);

const Dashboard = () => {
  const [workoutsDone, setWorkoutsDone] = useState(currentUser.stats.workoutsCompleted);
  const [volume, setVolume] = useState(currentUser.stats.totalVolumeLbs);
  const [hasCompletedToday, setHasCompletedToday] = useState(false);
  const [chartData, setChartData] = useState([...progressData]);

  const handleCompleteWorkout = () => {
    if (hasCompletedToday) return;
    const vol = 8500;
    setWorkoutsDone(w => w + 1);
    setVolume(v => v + vol);
    setHasCompletedToday(true);
    setChartData(prev => {
      const next = [...prev];
      next[2] = { day: 'Wed', volume: vol };
      return next;
    });
  };

  return (
    <div className="container main-content animate-fade-in pb-24 md:pb-8">

      {/* Header */}
      <header className="flex justify-between items-center mb-7">
        <div className="flex items-center gap-3">
          <img
            src={currentUser.avatarUrl}
            alt="Profile"
            className="w-12 h-12 rounded-2xl border-2 border-blue-500/40 shadow-lg"
          />
          <div>
            <h1 className="text-[20px] font-bold text-white leading-tight">
              Hey, {currentUser.fullName.split(' ')[0]} 👋
            </h1>
            <p className="text-[13px] text-slate-400">{currentUser.homeGym} · Lv.{currentUser.stats.level}</p>
          </div>
        </div>
        <button
          aria-label="Notifications"
          className="w-10 h-10 rounded-xl bg-white/5 border border-white/8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <Bell size={18} />
        </button>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-7">
        <StatCard icon={Flame}      label="Day Streak" value={currentUser.stats.currentStreak}      color="bg-amber-500/10 text-amber-400" />
        <StatCard icon={Trophy}     label="Workouts"   value={workoutsDone}                         color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={TrendingUp} label="Volume"     value={`${(volume / 1000).toFixed(0)}k`}     color="bg-emerald-500/10 text-emerald-400" />
      </div>

      {/* Main + Sidebar */}
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_300px]">

        {/* Left column */}
        <div className="flex flex-col gap-6">

          {/* Up Next */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">Up Next</h2>
              <Link to="/workouts" className="text-[13px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors">
                View all <ChevronRight size={14} />
              </Link>
            </div>

            <div className="bg-[#1C2333]/80 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/8 rounded-full blur-3xl pointer-events-none" />

              <div className="p-5 relative flex justify-between items-center">
                <div className="flex-1 min-w-0 pr-4">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full mb-3 ${
                    hasCompletedToday
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-blue-500/15 text-blue-400'
                  }`}>
                    <Calendar size={10} />
                    {hasCompletedToday ? 'Done for today ✓' : upcomingWorkouts[0].date}
                  </span>

                  <h3 className="text-[22px] font-bold text-white leading-tight mb-1.5" style={{ opacity: hasCompletedToday ? 0.5 : 1 }}>
                    {upcomingWorkouts[0].name}
                  </h3>
                  <p className="text-[13px] text-slate-400 flex items-center gap-2">
                    <Dumbbell size={13} />
                    {upcomingWorkouts[0].exercises} exercises · {upcomingWorkouts[0].duration}
                  </p>
                </div>

                <Link
                  to="/session/cw1"
                  aria-label="Start workout"
                  className="w-14 h-14 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center text-white shadow-[0_0_24px_rgba(59,130,246,0.5)] transition-all hover:scale-105 active:scale-95 flex-shrink-0 cursor-pointer"
                >
                  <Play size={22} fill="currentColor" className="ml-0.5" />
                </Link>
              </div>

              {!hasCompletedToday && (
                <div className="px-5 pb-4">
                  <button
                    onClick={handleCompleteWorkout}
                    className="w-full text-[13px] font-medium text-slate-500 hover:text-slate-300 py-2 rounded-xl border border-white/6 hover:bg-white/4 transition-all cursor-pointer"
                  >
                    Mark done without tracking
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Volume Chart */}
          <section>
            <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-3">Volume This Week</h2>
            <div className="bg-[#1C2333]/80 backdrop-blur-md rounded-2xl border border-white/5 p-4 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
                  <XAxis
                    dataKey="day" axisLine={false} tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false} tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickFormatter={v => v >= 1000 ? `${v / 1000}k` : v}
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
                  <Bar dataKey="volume" radius={[6, 6, 2, 2]} maxBarSize={40}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.volume > 0 ? '#3B82F6' : 'rgba(255,255,255,0.04)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          <section>
            <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-widest mb-3">Gym News</h2>
            <div className="flex flex-col gap-2">
              {announcements.map(ann => (
                <div key={ann.id} className="bg-[#1C2333]/80 backdrop-blur-md rounded-2xl border border-white/5 p-4 flex gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    ann.type === 'event' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'
                  }`}>
                    {ann.type === 'event' ? <Trophy size={15} /> : <Megaphone size={15} />}
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-white mb-0.5">{ann.title}</p>
                    <p className="text-[12px] text-slate-400 leading-snug">{ann.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

      </div>
    </div>
  );
};

export default Dashboard;
