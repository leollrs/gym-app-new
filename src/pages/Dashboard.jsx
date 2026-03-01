import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  currentUser, announcements, upcomingWorkouts, progressData
} from '../mockDb';
import { Bell, Play, Dumbbell, ChevronRight } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';

/* ── Stat card ─────────────────────────────────────────────────────── */
const StatCard = ({ emoji, label, value }) => (
  <div className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors p-5 flex flex-col">
    <p className="text-[36px] font-black text-white leading-none tracking-tight">{value}</p>
    <p className="text-[11px] text-[#6B7280] uppercase tracking-[0.15em] font-bold mt-3">
      {emoji}&nbsp;{label}
    </p>
  </div>
);

/* ── Gym News card ─────────────────────────────────────────────────── */
const AnnCard = ({ ann }) => (
  <div className={`bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors px-5 py-4 border-l-[3px] ${
    ann.type === 'event' ? 'border-l-[#D4AF37]' : 'border-l-[#3B82F6]'
  }`}>
    <p className="text-[15px] font-semibold text-[#E5E7EB] leading-snug">{ann.title}</p>
    <p className="text-[13px] text-[#6B7280] mt-1.5 leading-relaxed">{ann.message}</p>
  </div>
);

/* ── Main ──────────────────────────────────────────────────────────── */
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
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* ── Greeting ──────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-3.5">
          <img
            src={currentUser.avatarUrl}
            alt="Profile"
            className="w-11 h-11 rounded-xl border border-white/10"
          />
          <div>
            <h1 className="text-[20px] font-bold text-[#E5E7EB] leading-tight">
              Hey, {currentUser.fullName.split(' ')[0]} 👋
            </h1>
            <p className="text-[12px] text-[#6B7280] mt-0.5">
              {currentUser.homeGym} ·{' '}
              <span className="text-[#D4AF37]">Lv.{currentUser.stats.level}</span>
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

      {/* ── TODAY'S WORKOUT — dominant primary card ────────────────── */}
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

        <div className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/10 transition-colors overflow-hidden">
          <div className="p-6 flex items-center gap-5">
            <div className="flex-1 min-w-0">
              <p className={`text-[11px] font-bold uppercase tracking-[0.13em] mb-2.5 ${
                done ? 'text-[#10B981]' : 'text-[#D4AF37]'
              }`}>
                {done ? 'Done for today ✓' : `Today · ${upcomingWorkouts[0].duration}`}
              </p>
              <h2
                className="text-[28px] font-black text-white leading-tight"
                style={{ fontFamily: "'Barlow Condensed', sans-serif", opacity: done ? 0.4 : 1 }}
              >
                {upcomingWorkouts[0].name}
              </h2>
              <p className="text-[13px] text-[#6B7280] mt-2 flex items-center gap-1.5">
                <Dumbbell size={13} className="text-[#4B5563]" />
                {upcomingWorkouts[0].exercises} exercises
              </p>
            </div>

            <Link
              to="/session/cw1"
              aria-label="Start workout"
              className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 transition-all hover:scale-105 active:scale-95"
              style={{
                background: done ? '#111827' : '#D4AF37',
                color: done ? '#6B7280' : '#000',
                boxShadow: done ? 'none' : '0 0 24px rgba(212,175,55,0.35)',
              }}
            >
              <Play size={22} fill="currentColor" className="ml-0.5" />
            </Link>
          </div>

          {!done && (
            <div className="px-6 pb-5 -mt-1">
              <button
                onClick={handleMarkDone}
                className="w-full text-[12px] font-medium text-[#4B5563] hover:text-[#9CA3AF] py-3 rounded-xl border border-white/6 hover:border-white/10 hover:bg-white/3 transition-all"
              >
                Mark done without tracking
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Stats row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        <StatCard emoji="🔥" label="Streak"   value={currentUser.stats.currentStreak} />
        <StatCard emoji="🏋️" label="Workouts" value={workoutsDone} />
        <StatCard emoji="📊" label="Volume"   value={`${(volume / 1000).toFixed(0)}k`} />
      </div>

      {/* ── Chart + Sidebar ───────────────────────────────────────── */}
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
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontFamily: 'Barlow, sans-serif',
                  }}
                  formatter={v => [`${v.toLocaleString()} lbs`, 'Volume']}
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
            <button className="text-[12px] text-[#6B7280] hover:text-[#E5E7EB] transition-colors flex items-center gap-0.5">
              All <ChevronRight size={13} />
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {announcements.map(ann => <AnnCard key={ann.id} ann={ann} />)}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Dashboard;
