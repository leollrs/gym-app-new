import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, Dumbbell, Calendar,
  Lock, BarChart2, Star, LogOut, Edit2, Check, Scale, Flame,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Setup option data ─────────────────────────────────────────────────────────
const FITNESS_LEVELS = [
  { value: 'beginner',     label: 'Beginner',     icon: '🌱', desc: 'Less than 1 year of consistent training' },
  { value: 'intermediate', label: 'Intermediate', icon: '⚡', desc: '1–3 years of consistent training' },
  { value: 'advanced',     label: 'Advanced',     icon: '🏆', desc: '3+ years, comfortable with complex movements' },
];

const GOALS = [
  { value: 'muscle_gain',     label: 'Build Muscle',   icon: '💪', desc: 'Maximize hypertrophy and size' },
  { value: 'fat_loss',        label: 'Lose Fat',        icon: '🔥', desc: 'Burn fat while preserving muscle' },
  { value: 'strength',        label: 'Get Stronger',    icon: '🏋️', desc: 'Increase 1RMs and raw strength' },
  { value: 'endurance',       label: 'Build Endurance', icon: '🏃', desc: 'Improve stamina and conditioning' },
  { value: 'general_fitness', label: 'General Fitness', icon: '✨', desc: 'Stay active, healthy and consistent' },
];

const FREQUENCIES = [1, 2, 3, 4, 5, 6, 7];

const EQUIPMENT_OPTIONS = [
  { value: 'Barbell',         label: 'Barbell' },
  { value: 'Dumbbell',        label: 'Dumbbells' },
  { value: 'Cable',           label: 'Cables' },
  { value: 'Machine',         label: 'Machines' },
  { value: 'Bodyweight',      label: 'Bodyweight' },
  { value: 'Kettlebell',      label: 'Kettlebells' },
  { value: 'Resistance Band', label: 'Resistance Bands' },
  { value: 'Smith Machine',   label: 'Smith Machine' },
];

const INJURY_OPTIONS = [
  { value: 'lower_back', label: 'Lower Back' },
  { value: 'knees',      label: 'Knees' },
  { value: 'shoulders',  label: 'Shoulders' },
  { value: 'wrists',     label: 'Wrists' },
  { value: 'elbows',     label: 'Elbows' },
  { value: 'hips',       label: 'Hips' },
  { value: 'neck',       label: 'Neck' },
  { value: 'ankles',     label: 'Ankles' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const computeStreak = (sessions) => {
  const dates = new Set(sessions.map(s => new Date(s.completed_at).toDateString()));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (dates.has(d.toDateString())) streak++;
    else if (i > 0) break;
  }
  return streak;
};

const buildWeeklyChart = (sessions) => {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);

  return Array.from({ length: 8 }, (_, wi) => {
    const weekStart = new Date(sunday);
    weekStart.setDate(sunday.getDate() - (7 - wi) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const volume = sessions
      .filter(s => { const d = new Date(s.completed_at); return d >= weekStart && d < weekEnd; })
      .reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);

    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { week: label, volume: Math.round(volume) };
  });
};

const MUSCLE_COLORS = {
  Chest: '#EF4444', Back: '#3B82F6', Legs: '#10B981', Shoulders: '#D4AF37',
  Biceps: '#F59E0B', Triceps: '#F97316', Core: '#60A5FA', Glutes: '#A78BFA',
  Hamstrings: '#34D399', Quads: '#6EE7B7', Calves: '#FCD34D',
};

const ACHIEVEMENT_DEFS = [
  { key: 'first_workout', label: 'First Workout',  icon: Dumbbell,  desc: 'Log your first session',     check: (d) => d.sessions >= 1 },
  { key: 'streak_7',      label: '7-Day Streak',   icon: Flame,     desc: 'Train 7 days in a row',      check: (d) => d.streak >= 7 },
  { key: 'streak_30',     label: '30-Day Streak',  icon: Flame,     desc: 'Train 30 days in a row',     check: (d) => d.streak >= 30 },
  { key: 'century_club',  label: 'Century Club',   icon: Trophy,    desc: '100 workouts completed',     check: (d) => d.sessions >= 100 },
  { key: 'volume_king',   label: 'Volume King',    icon: BarChart2, desc: '1 million lbs total volume', check: (d) => d.totalVolume >= 1_000_000 },
  { key: 'pr_machine',    label: 'PR Machine',     icon: Star,      desc: 'Set 10 personal records',    check: (d) => d.prCount >= 10 },
];

// Fixed UUIDs matching migration 0019_seed_achievement_definitions.sql
const ACHIEVEMENT_UUID_MAP = {
  first_workout: 'a1000000-0000-0000-0000-000000000001',
  streak_7:      'a1000000-0000-0000-0000-000000000002',
  streak_30:     'a1000000-0000-0000-0000-000000000003',
  century_club:  'a1000000-0000-0000-0000-000000000004',
  volume_king:   'a1000000-0000-0000-0000-000000000005',
  pr_machine:    'a1000000-0000-0000-0000-000000000006',
};

// ── Hero stat block ───────────────────────────────────────────────────────────
const HeroStat = ({ label, value, sub }) => (
  <div className="flex flex-col items-center justify-center text-center py-5 px-2 min-w-0 border-r border-white/8 last:border-r-0">
    <p className="text-[26px] font-black leading-none text-[#D4AF37] flex items-baseline justify-center gap-1 flex-wrap">
      {value}
      {sub && <span className="text-[12px] font-semibold text-[#6B7280] normal-case">{sub}</span>}
    </p>
    <p className="text-[11px] font-medium mt-1.5 text-[#6B7280] uppercase tracking-wider">{label}</p>
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────────────
const Profile = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('prs');

  // Data state
  const [gymName, setGymName]             = useState('');
  const [sessions, setSessions]           = useState([]);
  const [prs, setPrs]                     = useState([]);
  const [muscleBalance, setMuscleBalance] = useState([]);
  const [weeklyChart, setWeeklyChart]     = useState([]);
  const [loading, setLoading]             = useState(true);

  // Goals state
  const [onboarding, setOnboarding]     = useState(null);
  const [editingGoals, setEditingGoals] = useState(false);
  const [goalsDraft, setGoalsDraft]     = useState(null);
  const [savingGoals, setSavingGoals]   = useState(false);

  useEffect(() => {
    if (!user || !profile) return;

    const load = async () => {
      setLoading(true);

      // 1. Gym name
      const { data: gym } = await supabase
        .from('gyms').select('name').eq('id', profile.gym_id).single();
      setGymName(gym?.name ?? '');

      // 2. All completed sessions
      const { data: sessionData } = await supabase
        .from('workout_sessions')
        .select('id, completed_at, total_volume_lbs')
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      const allSessions = sessionData ?? [];
      setSessions(allSessions);
      setWeeklyChart(buildWeeklyChart(allSessions));

      // 3. Personal records
      const { data: prData } = await supabase
        .from('personal_records')
        .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
        .eq('profile_id', user.id)
        .order('estimated_1rm', { ascending: false });
      setPrs(prData ?? []);

      // 4. Muscle balance (this month)
      const startOfMonth = new Date();
      startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const monthIds = allSessions.filter(s => new Date(s.completed_at) >= startOfMonth).map(s => s.id);

      if (monthIds.length > 0) {
        const { data: seData } = await supabase
          .from('session_exercises')
          .select('exercises(muscle_group), session_sets(is_completed)')
          .in('session_id', monthIds);

        const muscleMap = {};
        seData?.forEach(se => {
          const group = se.exercises?.muscle_group ?? 'Other';
          const count = (se.session_sets ?? []).filter(s => s.is_completed).length;
          muscleMap[group] = (muscleMap[group] ?? 0) + count;
        });
        setMuscleBalance(Object.entries(muscleMap)
          .map(([muscle, sets]) => ({ muscle, sets }))
          .sort((a, b) => b.sets - a.sets));
      }

      // 5. Onboarding / goals
      const { data: ob } = await supabase
        .from('member_onboarding')
        .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes')
        .eq('profile_id', user.id)
        .single();
      setOnboarding(ob ?? null);

      // 6. Persist newly unlocked achievements
      const achData = {
        sessions:    allSessions.length,
        streak:      computeStreak(allSessions),
        totalVolume: allSessions.reduce((s, x) => s + (parseFloat(x.total_volume_lbs) || 0), 0),
        prCount:     (prData ?? []).length,
      };
      const unlocked = ACHIEVEMENT_DEFS
        .filter(a => a.check(achData))
        .map(a => ({ profile_id: user.id, gym_id: profile.gym_id, achievement_id: ACHIEVEMENT_UUID_MAP[a.key] }));
      if (unlocked.length > 0) {
        await supabase
          .from('user_achievements')
          .upsert(unlocked, { onConflict: 'profile_id,achievement_id', ignoreDuplicates: true });
      }

      setLoading(false);
    };

    load();
  }, [user, profile]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const streak      = computeStreak(sessions);
  const totalVolume = sessions.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
  const volumeStr   = totalVolume >= 1_000_000
    ? `${(totalVolume / 1_000_000).toFixed(2)}M`
    : totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(0)}k`
    : `${Math.round(totalVolume)}`;

  const achievementData = { sessions: sessions.length, streak, totalVolume, prCount: prs.length };
  const prGroups = prs.reduce((acc, pr) => {
    const group = pr.exercises?.muscle_group ?? 'Other';
    if (!acc[group]) acc[group] = [];
    acc[group].push(pr);
    return acc;
  }, {});

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const joinDate  = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';
  const maxMuscleSets = muscleBalance[0]?.sets ?? 1;

  // ── Save goals ──────────────────────────────────────────────────────────────
  const saveGoals = async () => {
    setSavingGoals(true);
    try {
      const { injury_areas, ...dbFields } = goalsDraft;
      const injuries_notes = (injury_areas ?? []).length > 0
        ? injury_areas.join(', ')
        : null;
      const { error } = await supabase
        .from('member_onboarding')
        .upsert({ profile_id: user.id, gym_id: profile.gym_id, ...dbFields, injuries_notes });
      if (error) {
        console.error('saveGoals error:', error);
        alert('Failed to save: ' + error.message);
      } else {
        setOnboarding({ ...dbFields, injuries_notes });
        setEditingGoals(false);
      }
    } finally {
      setSavingGoals(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#05070B] pb-28 md:pb-12">
      <div className="max-w-[680px] mx-auto px-4 pt-6 pb-8">

      {/* ── Profile header card ──────────────────────────────────────────── */}
      <div className="rounded-[14px] bg-[#0F172A] border border-white/8 mb-6 overflow-hidden">

        {/* Identity row */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name}
                  className="w-[72px] h-[72px] rounded-[14px] object-cover border-2 border-[#D4AF37]/40"
                />
              ) : (
                <div className="w-[72px] h-[72px] rounded-[14px] flex items-center justify-center font-black text-[28px] bg-amber-900/40 border-2 border-[#D4AF37]/30 text-[#D4AF37]">
                  {(profile?.full_name?.[0] ?? '?').toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-[22px] font-bold leading-tight text-[#E5E7EB]">
                {loading ? '—' : profile?.full_name}
              </h1>
              <p className="text-[13px] mt-0.5 text-[#9CA3AF]">@{profile?.username}</p>
              {gymName && (
                <p className="text-[13px] mt-1.5 flex items-center gap-1.5 font-semibold text-[#D4AF37]">
                  <Dumbbell size={14} /> {gymName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={signOut}
              className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors hover:opacity-80 active:scale-95 bg-red-900/30 border border-red-800 text-red-400"
              title="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {joinDate && (
          <p className="text-[12px] flex items-center gap-1.5 px-6 pb-4 text-[#6B7280]">
            <Calendar size={12} /> Member since {joinDate}
          </p>
        )}

        {/* Hero stats */}
        <div className="border-t border-white/8">
          <div className="grid grid-cols-4 gap-0 w-full">
            <HeroStat label="Workouts" value={loading ? '—' : sessions.length} />
            <HeroStat label="Streak"   value={loading ? '—' : streak} sub="days" />
            <HeroStat label="Volume"   value={loading ? '—' : volumeStr} sub="lbs" />
            <div className="flex flex-col items-center justify-center text-center py-5 px-2 min-w-0 border-r border-white/8 last:border-r-0">
              <p className="text-[26px] font-black leading-none text-[#D4AF37]">{loading ? '—' : prs.length}</p>
              <p className="text-[11px] font-medium mt-1.5 text-[#6B7280] uppercase tracking-wider">Records</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body Metrics shortcut ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigate('/metrics')}
        className="w-full flex items-center gap-3 px-4 py-4 rounded-[14px] bg-[#0F172A] border border-white/8 hover:border-white/12 transition-all text-left mb-6"
      >
        <div className="w-10 h-10 rounded-xl bg-amber-900/40 flex items-center justify-center flex-shrink-0">
          <Scale size={18} className="text-[#D4AF37]" strokeWidth={2} />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-[#E5E7EB]">Body Metrics</p>
          <p className="text-[12px] text-[#9CA3AF]">Weight & measurements</p>
        </div>
      </button>

      {/* ── Pill tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 bg-[#111827] p-1 rounded-xl">
        {[
          { key: 'prs',          label: 'Records' },
          { key: 'achievements', label: 'Achievements' },
          { key: 'stats',        label: 'Stats' },
          { key: 'goals',        label: 'Goals' },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all ${
              activeTab === t.key
                ? 'bg-[#D4AF37] text-black font-semibold'
                : 'text-[#6B7280] hover:text-[#9CA3AF]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Records Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'prs' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-[14px] bg-[#0F172A] border border-white/8 animate-pulse" />
              ))}
            </div>
          ) : Object.keys(prGroups).length === 0 ? (
            <div className="text-center py-16 rounded-[14px] bg-[#0F172A] border border-white/8">
              <div className="w-14 h-14 rounded-[14px] bg-[#111827] flex items-center justify-center mx-auto mb-4">
                <Trophy size={28} className="text-[#6B7280]" />
              </div>
              <p className="font-semibold text-[#E5E7EB]">No records yet</p>
              <p className="text-[13px] mt-1 text-[#9CA3AF]">Complete sets to start tracking your PRs</p>
            </div>
          ) : (
            Object.entries(prGroups).map(([group, groupPrs]) => (
              <section key={group}>
                <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">{group}</h3>
                <div className="flex flex-col gap-3">
                  {groupPrs.map(pr => (
                    <div key={pr.exercise_id}
                      className="rounded-[14px] flex items-center gap-4 px-5 py-4 bg-[#0F172A] border border-white/8">
                      <div className="w-11 h-11 rounded-xl bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                        <Trophy size={18} className="text-[#D4AF37]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[15px] truncate text-[#E5E7EB]">
                          {pr.exercises?.name ?? pr.exercise_id}
                        </p>
                        <p className="text-[12px] mt-0.5 text-[#9CA3AF]">
                          {pr.achieved_at
                            ? new Date(pr.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                          {pr.estimated_1rm > 0 && <span className="ml-2">· e1RM {Math.round(pr.estimated_1rm)} lbs</span>}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-black text-[22px] leading-none text-[#D4AF37]">
                          {pr.weight_lbs}
                          <span className="text-[12px] font-normal ml-1 text-[#6B7280]">lbs</span>
                        </p>
                        <p className="text-[12px] mt-0.5 text-[#9CA3AF]">× {pr.reps} reps</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {/* ── Achievements Tab ─────────────────────────────────────────────── */}
      {activeTab === 'achievements' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-fade-in">
          {ACHIEVEMENT_DEFS.map(a => {
            const unlocked = a.check(achievementData);
            const Icon = a.icon;
            return (
              <div key={a.key}
                className={`rounded-[14px] border p-5 flex flex-col items-center text-center gap-3 transition-all ${
                  unlocked
                    ? 'bg-[#0F172A] border-[#D4AF37]/30'
                    : 'bg-[#111827] border-white/6 opacity-60'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  unlocked ? 'bg-amber-900/40 text-[#D4AF37]' : 'bg-[#0F172A] text-[#6B7280]'
                }`}>
                  {unlocked ? <Icon size={22} /> : <Lock size={20} />}
                </div>
                <div>
                  <p className={`font-semibold text-[14px] ${unlocked ? 'text-[#E5E7EB]' : 'text-[#6B7280]'}`}>
                    {a.label}
                  </p>
                  <p className="text-[12px] mt-1 leading-snug text-[#9CA3AF]">{a.desc}</p>
                </div>
                {unlocked && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#D4AF37]">Unlocked</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Stats Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'stats' && (
        <div className="flex flex-col gap-6 animate-fade-in">
          <div>
            <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Volume — Last 8 Weeks</h3>
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5 h-[224px]">
              {loading ? (
                <div className="h-full animate-pulse rounded-xl bg-[#111827]" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="week" axisLine={false} tickLine={false}
                      tick={{ fill: '#6B7280', fontSize: 10 }} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: '#6B7280', fontSize: 10 }}
                      tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip
                      cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }}
                      contentStyle={{ backgroundColor: '#0F172A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12, color: '#E5E7EB' }}
                      formatter={v => [`${v.toLocaleString()} lbs`, 'Volume']}
                    />
                    <Area type="monotone" dataKey="volume" stroke="#D4AF37" strokeWidth={2} fill="url(#volGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Muscle Balance · This Month</h3>
            <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
              {loading ? (
                <div className="flex flex-col gap-4">
                  {[1, 2, 3].map(i => <div key={i} className="h-4 rounded-full animate-pulse bg-[#111827]" />)}
                </div>
              ) : muscleBalance.length === 0 ? (
                <p className="text-center text-[13px] py-6 text-[#9CA3AF]">No workout data for this month yet</p>
              ) : (
                <div className="flex flex-col gap-4">
                  {muscleBalance.map(({ muscle, sets }) => (
                    <div key={muscle} className="flex items-center gap-4">
                      <div className="w-20 text-[12px] text-right flex-shrink-0 text-[#9CA3AF]">{muscle}</div>
                      <div className="flex-1 h-2 rounded-full overflow-hidden bg-[#111827]">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${(sets / maxMuscleSets) * 100}%`, background: MUSCLE_COLORS[muscle] ?? '#D4AF37' }} />
                      </div>
                      <div className="w-6 text-[12px] text-right flex-shrink-0 text-[#6B7280]">{sets}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Goals Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'goals' && (
        <div className="animate-fade-in">
          {editingGoals && goalsDraft ? (
            /* ── EDIT MODE ─────────────────────────────────────────────── */
            <div className="flex flex-col gap-6 pb-2">

              {/* Fitness Level */}
              <div>
                <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Fitness Level</h3>
                <div className="flex flex-col gap-3">
                  {FITNESS_LEVELS.map(l => (
                    <button key={l.value} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, fitness_level: l.value }))}
                      className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-[14px] border transition-all ${
                        goalsDraft.fitness_level === l.value
                          ? 'bg-amber-900/30 border-[#D4AF37]/50'
                          : 'bg-[#0F172A] border-white/8'
                      }`}
                    >
                      <span className="text-2xl flex-shrink-0">{l.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[15px] ${goalsDraft.fitness_level === l.value ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{l.label}</p>
                        <p className="text-[12px] mt-0.5 text-[#9CA3AF]">{l.desc}</p>
                      </div>
                      {goalsDraft.fitness_level === l.value && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Goal */}
              <div>
                <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Primary Goal</h3>
                <div className="flex flex-col gap-3">
                  {GOALS.map(g => (
                    <button key={g.value} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, primary_goal: g.value }))}
                      className={`w-full text-left flex items-center gap-4 px-5 py-4 rounded-[14px] border transition-all ${
                        goalsDraft.primary_goal === g.value
                          ? 'bg-amber-900/30 border-[#D4AF37]/50'
                          : 'bg-[#0F172A] border-white/8'
                      }`}
                    >
                      <span className="text-2xl flex-shrink-0">{g.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-[15px] ${goalsDraft.primary_goal === g.value ? 'text-[#D4AF37]' : 'text-[#E5E7EB]'}`}>{g.label}</p>
                        <p className="text-[12px] mt-0.5 text-[#9CA3AF]">{g.desc}</p>
                      </div>
                      {goalsDraft.primary_goal === g.value && <Check size={16} className="text-[#D4AF37] flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Training Days */}
              <div>
                <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Days Per Week</h3>
                <div className="flex gap-2">
                  {FREQUENCIES.map(n => (
                    <button key={n} type="button"
                      onClick={() => setGoalsDraft(d => ({ ...d, training_days_per_week: n }))}
                      className={`flex-1 py-3 rounded-xl text-[15px] font-bold transition-all border ${
                        goalsDraft.training_days_per_week === n
                          ? 'bg-amber-900/40 border-[#D4AF37]/50 text-[#D4AF37]'
                          : 'bg-[#111827] border-white/8 text-[#6B7280]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Equipment */}
              <div>
                <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Available Equipment</h3>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map(eq => {
                    const active = (goalsDraft.available_equipment ?? []).includes(eq.value);
                    return (
                      <button key={eq.value} type="button"
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          available_equipment: active
                            ? (d.available_equipment ?? []).filter(e => e !== eq.value)
                            : [...(d.available_equipment ?? []), eq.value],
                        }))}
                        className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                          active
                            ? 'bg-amber-900/40 border-[#D4AF37]/50 text-[#D4AF37]'
                            : 'bg-[#111827] border-white/8 text-[#6B7280]'
                        }`}
                      >
                        {eq.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Injuries */}
              <div>
                <h3 className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Injuries / Limitations</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  {INJURY_OPTIONS.map(inj => {
                    const active = (goalsDraft.injury_areas ?? []).includes(inj.value);
                    return (
                      <button key={inj.value} type="button"
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          injury_areas: active
                            ? (d.injury_areas ?? []).filter(v => v !== inj.value)
                            : [...(d.injury_areas ?? []), inj.value],
                        }))}
                        className={`text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all ${
                          active
                            ? 'bg-red-900/30 border-red-700 text-red-400'
                            : 'bg-[#111827] border-white/8 text-[#6B7280]'
                        }`}
                      >
                        {inj.label}
                      </button>
                    );
                  })}
                </div>
                {(goalsDraft.injury_areas ?? []).length === 0 && (
                  <p className="text-[11px] text-[#6B7280]">Nothing selected — all exercises available.</p>
                )}
              </div>

              {/* Spacer so last field isn't hidden behind sticky bar */}
              <div className="h-24" />
            </div>
          ) : (
            /* ── VIEW MODE ─────────────────────────────────────────────── */
            <div className="flex flex-col gap-4">
              {loading ? (
                <div className="flex flex-col gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-20 rounded-[14px] bg-[#0F172A] border border-white/8 animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  {/* Fitness Level */}
                  <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Fitness Level</p>
                    {(() => {
                      const l = FITNESS_LEVELS.find(x => x.value === onboarding?.fitness_level);
                      return l ? (
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{l.icon}</span>
                          <div>
                            <p className="font-semibold text-[15px] text-[#E5E7EB]">{l.label}</p>
                            <p className="text-[12px] mt-0.5 text-[#9CA3AF]">{l.desc}</p>
                          </div>
                        </div>
                      ) : <p className="text-[#9CA3AF]">Not set</p>;
                    })()}
                  </div>

                  {/* Primary Goal */}
                  <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Primary Goal</p>
                    {(() => {
                      const g = GOALS.find(x => x.value === onboarding?.primary_goal);
                      return g ? (
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{g.icon}</span>
                          <div>
                            <p className="font-semibold text-[15px] text-[#E5E7EB]">{g.label}</p>
                            <p className="text-[12px] mt-0.5 text-[#9CA3AF]">{g.desc}</p>
                          </div>
                        </div>
                      ) : <p className="text-[#9CA3AF]">Not set</p>;
                    })()}
                  </div>

                  {/* Training Frequency */}
                  <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-2">Training Frequency</p>
                    <p className="font-semibold text-[15px] text-[#E5E7EB]">
                      {onboarding?.training_days_per_week
                        ? `${onboarding.training_days_per_week} day${onboarding.training_days_per_week !== 1 ? 's' : ''} per week`
                        : 'Not set'}
                    </p>
                  </div>

                  {/* Equipment */}
                  <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Available Equipment</p>
                    {onboarding?.available_equipment?.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {onboarding.available_equipment.map(eq => {
                          const found = EQUIPMENT_OPTIONS.find(e => e.value === eq);
                          return (
                            <span key={eq} className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-amber-900/40 text-[#D4AF37] border border-[#D4AF37]/30">
                              {found?.label ?? eq}
                            </span>
                          );
                        })}
                      </div>
                    ) : <p className="text-[#9CA3AF]">Not set</p>}
                  </div>

                  {/* Injuries */}
                  <div className="rounded-[14px] bg-[#0F172A] border border-white/8 p-5">
                    <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest mb-3">Injuries / Limitations</p>
                    {(() => {
                      const areas = onboarding?.injuries_notes
                        ? onboarding.injuries_notes.split(',').map(s => s.trim()).filter(Boolean)
                        : [];
                      return areas.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {areas.map(area => {
                            const found = INJURY_OPTIONS.find(o => o.value === area);
                            return (
                              <span key={area} className="text-[12px] font-semibold px-3 py-1.5 rounded-full bg-red-900/30 text-red-400 border border-red-800">
                                {found?.label ?? area}
                              </span>
                            );
                          })}
                        </div>
                      ) : <p className="text-[14px] text-[#9CA3AF]">None noted</p>;
                    })()}
                  </div>

                  {/* Edit button */}
                  <button type="button"
                    onClick={() => {
                      const injury_areas = onboarding?.injuries_notes
                        ? onboarding.injuries_notes.split(',').map(s => s.trim()).filter(s => INJURY_OPTIONS.some(o => o.value === s))
                        : [];
                      setGoalsDraft({ ...onboarding, injury_areas });
                      setEditingGoals(true);
                    }}
                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-[14px] border border-white/8 font-semibold text-[14px] text-[#9CA3AF] bg-[#0F172A] hover:bg-[#111827] transition-colors"
                  >
                    <Edit2 size={15} /> Edit Goals &amp; Setup
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Sticky save bar ────────────────────────────────────── */}
          {editingGoals && goalsDraft && (
            <div className="fixed bottom-[56px] md:bottom-0 left-0 right-0 z-50 flex gap-3 px-4 py-3 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-[#05070B] border-t border-white/10">
              <button type="button"
                onClick={() => setEditingGoals(false)}
                className="flex-1 py-3.5 rounded-xl border border-white/15 text-[15px] font-semibold text-[#E5E7EB] bg-white/10">
                Cancel
              </button>
              <button type="button"
                onClick={saveGoals}
                disabled={savingGoals}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-bold bg-[#D4AF37] text-black disabled:opacity-50">
                {savingGoals ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      )}

      </div>
    </div>
  );
};

export default Profile;
