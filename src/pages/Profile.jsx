import React, { useState } from 'react';
import {
  Trophy, Flame, Dumbbell, TrendingUp, Calendar,
  Lock, Settings, BarChart2, Star
} from 'lucide-react';
import { currentUser, personalRecords, progressData } from '../mockDb';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';

const ACHIEVEMENTS = [
  { id: 'a1', label: 'First Workout',  icon: Dumbbell,  unlocked: true,  desc: 'Log your first session' },
  { id: 'a2', label: '7-Day Streak',   icon: Flame,     unlocked: true,  desc: 'Train 7 days in a row' },
  { id: 'a3', label: 'Century Club',   icon: Trophy,    unlocked: true,  desc: '100 workouts completed' },
  { id: 'a4', label: 'Volume King',    icon: BarChart2, unlocked: true,  desc: '1M lbs total volume' },
  { id: 'a5', label: '30-Day Streak',  icon: Flame,     unlocked: false, desc: 'Train 30 days in a row' },
  { id: 'a6', label: 'PR Machine',     icon: Star,      unlocked: false, desc: 'Set 10 personal records' },
];

const MUSCLE_COLORS = {
  Back: '#3b82f6', Chest: '#f43f5e', Legs: '#10b981',
  Shoulders: '#8b5cf6', Biceps: '#f59e0b', Triceps: '#f97316',
  Core: '#06b6d4', Glutes: '#ec4899',
};

// Group PRs by broad category
const groupPRsByCategory = (prs) => {
  const map = {
    'Chest & Triceps': ['ex_bp', 'ex_idbp', 'ex_tpd'],
    'Back': ['ex_dl', 'ex_bbr', 'ex_lp'],
    'Shoulders': ['ex_ohp'],
    'Biceps': ['ex_bbc'],
    'Legs': ['ex_sq', 'ex_hth'],
  };
  const result = {};
  Object.entries(map).forEach(([cat, ids]) => {
    ids.forEach(id => {
      if (prs[id]) {
        if (!result[cat]) result[cat] = [];
        result[cat].push({ id, ...prs[id] });
      }
    });
  });
  return result;
};

const StatBlock = ({ label, value, sub, icon: Icon, color }) => (
  <div className="bg-[#1C1C1E]/60 rounded-2xl p-4 border border-white/5">
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${color}`}>
      <Icon size={18} />
    </div>
    <p className="text-[26px] font-bold text-white leading-none">{value}</p>
    {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    <p className="text-[12px] text-slate-400 mt-1">{label}</p>
  </div>
);

const Profile = () => {
  const [activeTab, setActiveTab] = useState('prs');
  const prGroups = groupPRsByCategory(personalRecords);

  return (
    <div className="animate-fade-in pb-24 md:pb-8">

      {/* Hero header */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-900/30 via-violet-900/10 to-transparent" />
        <div className="relative container max-w-2xl mx-auto px-4 pt-8 pb-6">

          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.fullName}
                  className="w-20 h-20 rounded-3xl border-2 border-blue-500/50 shadow-xl"
                />
                <div className="absolute -bottom-1 -right-1 bg-blue-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full border-2 border-[#0A0D14]">
                  Lv.{currentUser.stats.level}
                </div>
              </div>
              <div>
                <h1 className="text-[22px] font-bold text-white leading-tight">{currentUser.fullName}</h1>
                <p className="text-[14px] text-slate-400">@{currentUser.username}</p>
                <p className="text-[12px] text-blue-400 mt-1 flex items-center gap-1">
                  <Dumbbell size={12} /> {currentUser.homeGym}
                </p>
              </div>
            </div>
            <button className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white transition-colors bg-white/5 rounded-xl border border-white/8">
              <Settings size={18} />
            </button>
          </div>

          <p className="text-[12px] text-slate-500 flex items-center gap-1.5 mb-5">
            <Calendar size={12} />
            Member since {new Date(currentUser.joinDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBlock label="Workouts"      value={currentUser.stats.workoutsCompleted} icon={Dumbbell}  color="text-blue-400 bg-blue-500/10" />
            <StatBlock label="Day Streak"    value={currentUser.stats.currentStreak} sub="days"           icon={Flame}     color="text-amber-400 bg-amber-500/10" />
            <StatBlock label="Total Volume"  value={`${(currentUser.stats.totalVolumeLbs / 1000000).toFixed(2)}M`} sub="lbs lifted" icon={TrendingUp} color="text-emerald-400 bg-emerald-500/10" />
            <StatBlock label="Records"       value={Object.keys(personalRecords).length}                  icon={Trophy}    color="text-amber-400 bg-amber-500/10" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="container max-w-2xl mx-auto px-4">
        <div className="flex border-b border-white/8 mb-6">
          {[
            { key: 'prs',          label: 'PRs' },
            { key: 'achievements', label: 'Achievements' },
            { key: 'stats',        label: 'Volume Stats' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-3 text-[13px] font-semibold transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-white border-blue-500'
                  : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* PR Tab */}
        {activeTab === 'prs' && (
          <div className="flex flex-col gap-5 animate-fade-in">
            {Object.entries(prGroups).map(([group, prs]) => (
              <section key={group}>
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-2 px-1">{group}</h3>
                <div className="flex flex-col gap-2">
                  {prs.map(pr => (
                    <div key={pr.id} className="bg-[#1C1C1E]/60 rounded-2xl border border-white/5 flex items-center gap-4 px-4 py-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <Trophy size={18} className="text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-[14px] truncate">{pr.label}</p>
                        <p className="text-slate-500 text-[12px]">
                          {new Date(pr.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-white font-bold text-[18px]">
                          {pr.weight} <span className="text-slate-500 text-[13px] font-normal">lbs</span>
                        </p>
                        <p className="text-slate-400 text-[12px]">× {pr.reps} reps</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Achievements Tab */}
        {activeTab === 'achievements' && (
          <div className="grid grid-cols-2 gap-3 animate-fade-in">
            {ACHIEVEMENTS.map(a => (
              <div
                key={a.id}
                className={`rounded-2xl border p-4 flex flex-col items-center text-center gap-2 ${
                  a.unlocked
                    ? 'bg-[#1C1C1E]/60 border-white/8'
                    : 'bg-white/[0.02] border-white/5 opacity-45'
                }`}
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  a.unlocked ? 'bg-blue-500/15 text-blue-400' : 'bg-white/5 text-slate-600'
                }`}>
                  {a.unlocked ? <a.icon size={22} /> : <Lock size={20} />}
                </div>
                <div>
                  <p className={`font-semibold text-[13px] ${a.unlocked ? 'text-white' : 'text-slate-500'}`}>{a.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{a.desc}</p>
                </div>
                {a.unlocked && (
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide mt-1">Unlocked</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          <div className="flex flex-col gap-5 animate-fade-in">
            <div>
              <h3 className="text-[13px] font-bold text-slate-300 mb-3">Weekly Volume</h3>
              <div className="bg-[#1C1C1E]/60 rounded-2xl border border-white/5 p-4 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={progressData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Tooltip
                      cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }}
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' }}
                    />
                    <Area type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={2} fill="url(#volGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <h3 className="text-[13px] font-bold text-slate-300 mb-3">Muscle Group Balance (this month)</h3>
              <div className="bg-[#1C1C1E]/60 rounded-2xl border border-white/5 p-4 flex flex-col gap-3">
                {[
                  { muscle: 'Back',      sets: 38 },
                  { muscle: 'Chest',     sets: 32 },
                  { muscle: 'Legs',      sets: 28 },
                  { muscle: 'Shoulders', sets: 22 },
                  { muscle: 'Biceps',    sets: 18 },
                  { muscle: 'Triceps',   sets: 16 },
                  { muscle: 'Core',      sets: 12 },
                  { muscle: 'Glutes',    sets: 10 },
                ].map(({ muscle, sets }) => (
                  <div key={muscle} className="flex items-center gap-3">
                    <div className="w-20 text-[12px] text-slate-400 text-right flex-shrink-0">{muscle}</div>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${(sets / 38) * 100}%`, backgroundColor: MUSCLE_COLORS[muscle] || '#3b82f6' }}
                      />
                    </div>
                    <div className="w-8 text-[12px] text-slate-500 text-right flex-shrink-0">{sets}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  );
};

export default Profile;
