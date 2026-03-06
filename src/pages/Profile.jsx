import React, { useState, useEffect } from 'react';
import {
  Trophy, Flame, Dumbbell, TrendingUp, Calendar,
  Lock, Settings, BarChart2, Star, LogOut, Edit2, Check,
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

// ── Hero stat block ───────────────────────────────────────────────────────────
const HeroStat = ({ label, value, sub }) => (
  <div className="flex flex-col items-center text-center py-5 px-3" style={{ borderRight: '1px solid var(--border-subtle)' }}>
    <p className="text-[26px] font-black leading-none" style={{ color: 'var(--accent-gold)' }}>{value}</p>
    {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    <p className="text-[11px] font-medium mt-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</p>
  </div>
);

// ── Main ──────────────────────────────────────────────────────────────────────
const Profile = () => {
  const { user, profile, signOut } = useAuth();
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
      const injuries_notes = (goalsDraft.injury_areas ?? []).length > 0
        ? goalsDraft.injury_areas.join(', ')
        : null;
      const { error } = await supabase
        .from('member_onboarding')
        .upsert({ profile_id: user.id, gym_id: profile.gym_id, ...goalsDraft, injuries_notes });
      if (!error) {
        setOnboarding({ ...goalsDraft, injuries_notes });
        setEditingGoals(false);
      }
    } finally {
      setSavingGoals(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 md:px-8 pt-8 md:pt-12 pb-28 md:pb-12 animate-fade-in">

      {/* ── Profile header card ──────────────────────────────────────────── */}
      <div className="rounded-[14px] border mb-8 overflow-hidden"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>

        {/* Identity row */}
        <div className="flex items-start justify-between p-6 pb-5">
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.full_name}
                  className="w-[72px] h-[72px] rounded-2xl object-cover"
                  style={{ border: '2px solid var(--accent-gold-glow)' }} />
              ) : (
                <div className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center font-black text-[28px]"
                  style={{ background: 'rgba(212,175,55,0.12)', border: '2px solid rgba(212,175,55,0.25)', color: 'var(--accent-gold)' }}>
                  {(profile?.full_name?.[0] ?? '?').toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-[21px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                {loading ? '—' : profile?.full_name}
              </h1>
              <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>@{profile?.username}</p>
              {gymName && (
                <p className="text-[12px] mt-1.5 flex items-center gap-1 font-medium" style={{ color: 'var(--accent-gold)' }}>
                  <Dumbbell size={12} /> {gymName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={signOut}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:opacity-80 active:scale-95"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444' }}
              title="Log out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {joinDate && (
          <p className="text-[11px] flex items-center gap-1.5 px-6 pb-5" style={{ color: 'var(--text-muted)' }}>
            <Calendar size={11} /> Member since {joinDate}
          </p>
        )}

        {/* Hero stats */}
        <div className="grid grid-cols-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <HeroStat label="Workouts" value={loading ? '—' : sessions.length} />
          <HeroStat label="Streak"   value={loading ? '—' : streak} sub="days" />
          <HeroStat label="Volume"   value={loading ? '—' : volumeStr} sub="lbs" />
          <div className="flex flex-col items-center text-center py-5 px-3">
            <p className="text-[26px] font-black leading-none" style={{ color: 'var(--accent-gold)' }}>
              {loading ? '—' : prs.length}
            </p>
            <p className="text-[11px] font-medium mt-1.5" style={{ color: 'var(--text-secondary)' }}>Records</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex mb-8" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {[
          { key: 'prs',          label: 'Records' },
          { key: 'achievements', label: 'Achievements' },
          { key: 'stats',        label: 'Stats' },
          { key: 'goals',        label: 'Goals' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 py-3.5 text-[12px] font-semibold transition-colors border-b-2 -mb-px cursor-pointer"
            style={
              activeTab === tab.key
                ? { color: 'var(--accent-gold)', borderBottomColor: 'var(--accent-gold)' }
                : { color: 'var(--text-muted)', borderBottomColor: 'transparent' }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Records Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'prs' && (
        <div className="flex flex-col gap-8 animate-fade-in">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 rounded-[14px] animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
              ))}
            </div>
          ) : Object.keys(prGroups).length === 0 ? (
            <div className="text-center py-16">
              <Trophy size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
              <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>No records yet</p>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>Complete sets to start tracking your PRs</p>
            </div>
          ) : (
            Object.entries(prGroups).map(([group, groupPrs]) => (
              <section key={group}>
                <h3 className="section-label mb-4">{group}</h3>
                <div className="flex flex-col gap-3">
                  {groupPrs.map(pr => (
                    <div key={pr.exercise_id}
                      className="rounded-[14px] flex items-center gap-4 px-5 py-4 transition-colors"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'rgba(212,175,55,0.1)' }}>
                        <Trophy size={17} style={{ color: 'var(--accent-gold)' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[15px] truncate" style={{ color: 'var(--text-primary)' }}>
                          {pr.exercises?.name ?? pr.exercise_id}
                        </p>
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {pr.achieved_at
                            ? new Date(pr.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            : '—'}
                          {pr.estimated_1rm > 0 && <span className="ml-2">· e1RM {Math.round(pr.estimated_1rm)} lbs</span>}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-black text-[22px] leading-none" style={{ color: 'var(--accent-gold)' }}>
                          {pr.weight_lbs}
                          <span className="text-[12px] font-normal ml-1" style={{ color: 'var(--text-muted)' }}>lbs</span>
                        </p>
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>× {pr.reps} reps</p>
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
            return (
              <div key={a.key}
                className="rounded-[14px] border p-5 flex flex-col items-center text-center gap-3 transition-colors"
                style={unlocked
                  ? { background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }
                  : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', opacity: 0.5 }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={unlocked
                    ? { background: 'rgba(212,175,55,0.12)', color: 'var(--accent-gold)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                  {unlocked ? <a.icon size={22} /> : <Lock size={20} />}
                </div>
                <div>
                  <p className="font-semibold text-[14px]" style={{ color: unlocked ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {a.label}
                  </p>
                  <p className="text-[12px] mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>{a.desc}</p>
                </div>
                {unlocked && (
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent-gold)' }}>
                    Unlocked
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Stats Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'stats' && (
        <div className="flex flex-col gap-8 animate-fade-in">
          <div>
            <h3 className="section-label mb-4">Volume — Last 8 Weeks</h3>
            <div className="rounded-[14px] border p-5"
              style={{ height: 224, background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
              {loading ? (
                <div className="h-full animate-pulse rounded-lg" style={{ background: 'var(--bg-elevated)' }} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#D4AF37" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="week" axisLine={false} tickLine={false}
                      tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'Barlow, sans-serif' }} />
                    <YAxis axisLine={false} tickLine={false}
                      tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'Barlow, sans-serif' }}
                      tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip
                      cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                      contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '10px', fontSize: '12px', color: 'var(--text-primary)', fontFamily: 'Barlow, sans-serif' }}
                      formatter={v => [`${v.toLocaleString()} lbs`, 'Volume']}
                    />
                    <Area type="monotone" dataKey="volume" stroke="#D4AF37" strokeWidth={2} fill="url(#volGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div>
            <h3 className="section-label mb-4">Muscle Balance · This Month</h3>
            <div className="rounded-[14px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
              {loading ? (
                <div className="flex flex-col gap-4">
                  {[1, 2, 3].map(i => <div key={i} className="h-4 rounded-full animate-pulse" style={{ background: 'var(--bg-elevated)' }} />)}
                </div>
              ) : muscleBalance.length === 0 ? (
                <p className="text-center text-[13px] py-6" style={{ color: 'var(--text-muted)' }}>
                  No workout data for this month yet
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {muscleBalance.map(({ muscle, sets }) => (
                    <div key={muscle} className="flex items-center gap-4">
                      <div className="w-20 text-[12px] text-right flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                        {muscle}
                      </div>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${(sets / maxMuscleSets) * 100}%`, background: MUSCLE_COLORS[muscle] ?? 'var(--accent-gold)' }} />
                      </div>
                      <div className="w-6 text-[12px] text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{sets}</div>
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
            <div className="flex flex-col gap-8">

              {/* Fitness Level */}
              <div>
                <h3 className="section-label mb-3">Fitness Level</h3>
                <div className="flex flex-col gap-3">
                  {FITNESS_LEVELS.map(l => (
                    <button key={l.value}
                      onClick={() => setGoalsDraft(d => ({ ...d, fitness_level: l.value }))}
                      className="w-full text-left flex items-center gap-4 px-5 py-4 rounded-[14px] border transition-all"
                      style={goalsDraft.fitness_level === l.value
                        ? { background: 'rgba(212,175,55,0.08)', borderColor: 'rgba(212,175,55,0.5)' }
                        : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                      <span className="text-2xl flex-shrink-0">{l.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[15px]"
                          style={{ color: goalsDraft.fitness_level === l.value ? 'var(--accent-gold)' : 'var(--text-primary)' }}>
                          {l.label}
                        </p>
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{l.desc}</p>
                      </div>
                      {goalsDraft.fitness_level === l.value && <Check size={16} style={{ color: 'var(--accent-gold)', flexShrink: 0 }} />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Primary Goal */}
              <div>
                <h3 className="section-label mb-3">Primary Goal</h3>
                <div className="flex flex-col gap-3">
                  {GOALS.map(g => (
                    <button key={g.value}
                      onClick={() => setGoalsDraft(d => ({ ...d, primary_goal: g.value }))}
                      className="w-full text-left flex items-center gap-4 px-5 py-4 rounded-[14px] border transition-all"
                      style={goalsDraft.primary_goal === g.value
                        ? { background: 'rgba(212,175,55,0.08)', borderColor: 'rgba(212,175,55,0.5)' }
                        : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                      <span className="text-2xl flex-shrink-0">{g.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[15px]"
                          style={{ color: goalsDraft.primary_goal === g.value ? 'var(--accent-gold)' : 'var(--text-primary)' }}>
                          {g.label}
                        </p>
                        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{g.desc}</p>
                      </div>
                      {goalsDraft.primary_goal === g.value && <Check size={16} style={{ color: 'var(--accent-gold)', flexShrink: 0 }} />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Training Days */}
              <div>
                <h3 className="section-label mb-3">Days Per Week</h3>
                <div className="flex gap-2">
                  {FREQUENCIES.map(n => (
                    <button key={n}
                      onClick={() => setGoalsDraft(d => ({ ...d, training_days_per_week: n }))}
                      className="flex-1 py-3 rounded-xl text-[15px] font-bold transition-all border"
                      style={goalsDraft.training_days_per_week === n
                        ? { background: 'rgba(212,175,55,0.12)', borderColor: 'rgba(212,175,55,0.5)', color: 'var(--accent-gold)' }
                        : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Equipment */}
              <div>
                <h3 className="section-label mb-3">Available Equipment</h3>
                <div className="flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map(eq => {
                    const active = (goalsDraft.available_equipment ?? []).includes(eq.value);
                    return (
                      <button key={eq.value}
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          available_equipment: active
                            ? (d.available_equipment ?? []).filter(e => e !== eq.value)
                            : [...(d.available_equipment ?? []), eq.value],
                        }))}
                        className="text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all"
                        style={active
                          ? { background: 'rgba(212,175,55,0.12)', borderColor: 'rgba(212,175,55,0.4)', color: 'var(--accent-gold)' }
                          : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                        {eq.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Injuries */}
              <div>
                <h3 className="section-label mb-3">Injuries / Limitations</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  {INJURY_OPTIONS.map(inj => {
                    const active = (goalsDraft.injury_areas ?? []).includes(inj.value);
                    return (
                      <button key={inj.value}
                        onClick={() => setGoalsDraft(d => ({
                          ...d,
                          injury_areas: active
                            ? (d.injury_areas ?? []).filter(v => v !== inj.value)
                            : [...(d.injury_areas ?? []), inj.value],
                        }))}
                        className="text-[13px] font-semibold px-3.5 py-2 rounded-full border transition-all"
                        style={active
                          ? { background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.4)', color: '#EF4444' }
                          : { background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                        {inj.label}
                      </button>
                    );
                  })}
                </div>
                {(goalsDraft.injury_areas ?? []).length === 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Nothing selected — all exercises available.</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setEditingGoals(false)}
                  className="flex-1 py-3.5 rounded-[14px] border text-[15px] font-semibold transition-colors"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
                  Cancel
                </button>
                <button
                  onClick={saveGoals}
                  disabled={savingGoals}
                  className="flex-1 py-3.5 rounded-[14px] text-[15px] font-bold transition-all disabled:opacity-50"
                  style={{ background: 'var(--accent-gold)', color: '#000' }}>
                  {savingGoals ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            /* ── VIEW MODE ─────────────────────────────────────────────── */
            <div className="flex flex-col gap-4">
              {loading ? (
                <div className="flex flex-col gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-20 rounded-[14px] animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
                  ))}
                </div>
              ) : (
                <>
                  {/* Fitness Level */}
                  <div className="rounded-[14px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                    <p className="section-label mb-3">Fitness Level</p>
                    {(() => {
                      const l = FITNESS_LEVELS.find(x => x.value === onboarding?.fitness_level);
                      return l ? (
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{l.icon}</span>
                          <div>
                            <p className="font-semibold text-[15px]" style={{ color: 'var(--text-primary)' }}>{l.label}</p>
                            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{l.desc}</p>
                          </div>
                        </div>
                      ) : <p style={{ color: 'var(--text-muted)' }}>Not set</p>;
                    })()}
                  </div>

                  {/* Primary Goal */}
                  <div className="rounded-[14px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                    <p className="section-label mb-3">Primary Goal</p>
                    {(() => {
                      const g = GOALS.find(x => x.value === onboarding?.primary_goal);
                      return g ? (
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{g.icon}</span>
                          <div>
                            <p className="font-semibold text-[15px]" style={{ color: 'var(--text-primary)' }}>{g.label}</p>
                            <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{g.desc}</p>
                          </div>
                        </div>
                      ) : <p style={{ color: 'var(--text-muted)' }}>Not set</p>;
                    })()}
                  </div>

                  {/* Training Frequency */}
                  <div className="rounded-[14px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                    <p className="section-label mb-2">Training Frequency</p>
                    <p className="font-semibold text-[15px]" style={{ color: 'var(--text-primary)' }}>
                      {onboarding?.training_days_per_week
                        ? `${onboarding.training_days_per_week} day${onboarding.training_days_per_week !== 1 ? 's' : ''} per week`
                        : 'Not set'}
                    </p>
                  </div>

                  {/* Equipment */}
                  <div className="rounded-[14px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                    <p className="section-label mb-3">Available Equipment</p>
                    {onboarding?.available_equipment?.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {onboarding.available_equipment.map(eq => {
                          const found = EQUIPMENT_OPTIONS.find(e => e.value === eq);
                          return (
                            <span key={eq} className="text-[12px] font-semibold px-3 py-1.5 rounded-full"
                              style={{ background: 'rgba(212,175,55,0.1)', color: 'var(--accent-gold)', border: '1px solid rgba(212,175,55,0.25)' }}>
                              {found?.label ?? eq}
                            </span>
                          );
                        })}
                      </div>
                    ) : <p style={{ color: 'var(--text-muted)' }}>Not set</p>}
                  </div>

                  {/* Injuries */}
                  <div className="rounded-[14px] border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                    <p className="section-label mb-3">Injuries / Limitations</p>
                    {(() => {
                      const areas = onboarding?.injuries_notes
                        ? onboarding.injuries_notes.split(',').map(s => s.trim()).filter(Boolean)
                        : [];
                      return areas.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {areas.map(area => {
                            const found = INJURY_OPTIONS.find(o => o.value === area);
                            return (
                              <span key={area} className="text-[12px] font-semibold px-3 py-1.5 rounded-full"
                                style={{ background: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                                {found?.label ?? area}
                              </span>
                            );
                          })}
                        </div>
                      ) : <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>None noted</p>;
                    })()}
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => {
                      const injury_areas = onboarding?.injuries_notes
                        ? onboarding.injuries_notes.split(',').map(s => s.trim()).filter(s => INJURY_OPTIONS.some(o => o.value === s))
                        : [];
                      setGoalsDraft({ ...onboarding, injury_areas });
                      setEditingGoals(true);
                    }}
                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-[14px] border font-semibold text-[14px] transition-all hover:opacity-80"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
                    <Edit2 size={15} /> Edit Goals &amp; Setup
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default Profile;
