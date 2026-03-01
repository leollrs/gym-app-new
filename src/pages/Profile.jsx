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
  Back:      '#3B82F6',
  Chest:     '#EF4444',
  Legs:      '#10B981',
  Shoulders: '#D4AF37',
  Biceps:    '#F59E0B',
  Triceps:   '#F97316',
  Core:      '#60A5FA',
  Glutes:    '#F97316',
};

const groupPRsByCategory = (prs) => {
  const map = {
    'Chest & Triceps': ['ex_bp', 'ex_idbp', 'ex_tpd'],
    'Back':            ['ex_dl', 'ex_bbr', 'ex_lp'],
    'Shoulders':       ['ex_ohp'],
    'Biceps':          ['ex_bbc'],
    'Legs':            ['ex_sq', 'ex_hth'],
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

/* ── Hero stat block ─────────────────────────────────────────────── */
const HeroStat = ({ label, value, sub }) => (
  <div className="flex flex-col items-center text-center py-5 px-3 border-r border-white/6 last:border-r-0">
    <p className="text-[26px] font-black text-[#D4AF37] leading-none">{value}</p>
    {sub && <p className="text-[10px] text-[#6B7280] mt-0.5">{sub}</p>}
    <p className="text-[11px] text-[#9CA3AF] font-medium mt-1.5">{label}</p>
  </div>
);

const Profile = () => {
  const [activeTab, setActiveTab] = useState('prs');
  const prGroups = groupPRsByCategory(personalRecords);

  const muscleData = [
    { muscle: 'Back',      sets: 38 },
    { muscle: 'Chest',     sets: 32 },
    { muscle: 'Legs',      sets: 28 },
    { muscle: 'Shoulders', sets: 22 },
    { muscle: 'Biceps',    sets: 18 },
    { muscle: 'Triceps',   sets: 16 },
    { muscle: 'Core',      sets: 12 },
    { muscle: 'Glutes',    sets: 10 },
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* ── Profile header card ────────────────────────────────────── */}
      <div className="bg-[#0F172A] rounded-[14px] border border-white/6 mb-8 overflow-hidden">

        {/* Identity row */}
        <div className="flex items-start justify-between p-6 pb-5">
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.fullName}
                className="w-[72px] h-[72px] rounded-2xl border border-[#D4AF37]/30"
              />
              <div className="absolute -bottom-1 -right-1 bg-[#D4AF37] text-black text-[10px] font-black px-1.5 py-0.5 rounded-full border-2 border-[#0F172A] leading-none">
                {currentUser.stats.level}
              </div>
            </div>
            <div>
              <h1 className="text-[21px] font-bold text-[#E5E7EB] leading-tight">{currentUser.fullName}</h1>
              <p className="text-[13px] text-[#6B7280] mt-0.5">@{currentUser.username}</p>
              <p className="text-[12px] text-[#D4AF37] mt-1.5 flex items-center gap-1 font-medium">
                <Dumbbell size={12} /> {currentUser.homeGym}
              </p>
            </div>
          </div>
          <button className="w-9 h-9 flex items-center justify-center text-[#6B7280] hover:text-[#E5E7EB] transition-colors bg-white/4 rounded-xl border border-white/8">
            <Settings size={16} />
          </button>
        </div>

        <p className="text-[11px] text-[#6B7280] flex items-center gap-1.5 px-6 pb-5">
          <Calendar size={11} />
          Member since {new Date(currentUser.joinDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>

        {/* Hero stats row */}
        <div className="grid grid-cols-4 border-t border-white/6">
          <HeroStat label="Workouts" value={currentUser.stats.workoutsCompleted} />
          <HeroStat label="Streak"   value={currentUser.stats.currentStreak} sub="days" />
          <HeroStat
            label="Volume"
            value={`${(currentUser.stats.totalVolumeLbs / 1000000).toFixed(2)}M`}
            sub="lbs"
          />
          <HeroStat label="Records" value={Object.keys(personalRecords).length} />
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="flex border-b border-white/8 mb-8">
        {[
          { key: 'prs',          label: 'Personal Records' },
          { key: 'achievements', label: 'Achievements' },
          { key: 'stats',        label: 'Volume Stats' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3.5 text-[13px] font-semibold transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === tab.key
                ? 'text-[#D4AF37] border-[#D4AF37]'
                : 'text-[#6B7280] border-transparent hover:text-[#9CA3AF]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── PR Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'prs' && (
        <div className="flex flex-col gap-8 animate-fade-in">
          {Object.entries(prGroups).map(([group, prs]) => (
            <section key={group}>
              <h3 className="section-label mb-4">{group}</h3>
              <div className="flex flex-col gap-3">
                {prs.map(pr => (
                  <div key={pr.id} className="bg-[#0F172A] rounded-[14px] border border-white/6 hover:border-white/12 transition-colors flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center flex-shrink-0">
                      <Trophy size={17} className="text-[#D4AF37]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#E5E7EB] font-semibold text-[15px] truncate">{pr.label}</p>
                      <p className="text-[#6B7280] text-[12px] mt-0.5">
                        {new Date(pr.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[#D4AF37] font-black text-[22px] leading-none">
                        {pr.weight}
                        <span className="text-[#6B7280] text-[12px] font-normal ml-1">lbs</span>
                      </p>
                      <p className="text-[#9CA3AF] text-[12px] mt-0.5">× {pr.reps} reps</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Achievements Tab ───────────────────────────────────────── */}
      {activeTab === 'achievements' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-fade-in">
          {ACHIEVEMENTS.map(a => (
            <div
              key={a.id}
              className={`rounded-[14px] border p-5 flex flex-col items-center text-center gap-3 transition-colors ${
                a.unlocked
                  ? 'bg-[#0F172A] border-white/8 hover:border-white/15'
                  : 'bg-[#0F172A]/50 border-white/4 opacity-40'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                a.unlocked ? 'bg-[#D4AF37]/12 text-[#D4AF37]' : 'bg-white/4 text-[#4B5563]'
              }`}>
                {a.unlocked ? <a.icon size={22} /> : <Lock size={20} />}
              </div>
              <div>
                <p className={`font-semibold text-[14px] ${a.unlocked ? 'text-[#E5E7EB]' : 'text-[#6B7280]'}`}>
                  {a.label}
                </p>
                <p className="text-[12px] text-[#6B7280] mt-1 leading-snug">{a.desc}</p>
              </div>
              {a.unlocked && (
                <span className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-wider">Unlocked</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Stats Tab ──────────────────────────────────────────────── */}
      {activeTab === 'stats' && (
        <div className="flex flex-col gap-8 animate-fade-in">

          {/* Weekly Volume */}
          <div>
            <h3 className="section-label mb-4">Weekly Volume</h3>
            <div className="bg-[#0F172A] rounded-[14px] border border-white/6 p-5 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={progressData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#D4AF37" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 11 }} />
                  <Tooltip
                    cursor={{ stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 }}
                    contentStyle={{
                      backgroundColor: '#111827',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '10px',
                      fontSize: '12px',
                    }}
                  />
                  <Area type="monotone" dataKey="volume" stroke="#D4AF37" strokeWidth={2} fill="url(#volGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Muscle group balance */}
          <div>
            <h3 className="section-label mb-4">Muscle Balance · This Month</h3>
            <div className="bg-[#0F172A] rounded-[14px] border border-white/6 p-5 flex flex-col gap-4">
              {muscleData.map(({ muscle, sets }) => (
                <div key={muscle} className="flex items-center gap-4">
                  <div className="w-20 text-[12px] text-[#9CA3AF] text-right flex-shrink-0">{muscle}</div>
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${(sets / 38) * 100}%`,
                        backgroundColor: MUSCLE_COLORS[muscle] || '#D4AF37',
                      }}
                    />
                  </div>
                  <div className="w-7 text-[12px] text-[#6B7280] text-right flex-shrink-0">{sets}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Profile;
