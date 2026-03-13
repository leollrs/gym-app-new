import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, Dumbbell, Clock, Zap, ChevronDown, ChevronRight,
  TrendingUp, TrendingDown, Minus, Scale, Plus, X, Check,
  Camera, Upload, Award, Users, BarChart3, Target, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getUserPoints } from '../lib/rewardsEngine';
import { LevelCard } from '../components/LevelBadge';
import { ACHIEVEMENT_DEFS } from '../lib/achievements';
import { format, parseISO, subDays, startOfWeek, endOfWeek } from 'date-fns';
import MonthlyProgressReport from '../components/MonthlyProgressReport';

// ── Constants ────────────────────────────────────────────────────────────────
import SwipeableTabView from '../components/SwipeableTabView';
const TABS = ['Overview', 'History', 'Strength', 'Body'];

const tooltipStyle = {
  contentStyle: {
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: '#9CA3AF' },
  itemStyle: { color: '#D4AF37' },
};

// ── Strength standards ──────────────────────────────────────────────────────
const STANDARDS = [
  { exerciseId: 'ex_bp', name: 'Bench Press', tiers: [0.5, 0.75, 1.25, 1.75, 2.0] },
  { exerciseId: 'ex_sq', name: 'Back Squat', tiers: [0.75, 1.25, 1.75, 2.25, 2.75] },
  { exerciseId: 'ex_dl', name: 'Deadlift', tiers: [1.0, 1.5, 2.0, 2.5, 3.0] },
  { exerciseId: 'ex_ohp', name: 'Overhead Press', tiers: [0.35, 0.55, 0.75, 1.1, 1.4] },
  { exerciseId: 'ex_bbr', name: 'Barbell Row', tiers: [0.5, 0.75, 1.0, 1.5, 1.75] },
];
const TIER_LABELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
const TIER_COLORS = ['#6B7280', '#60A5FA', '#10B981', '#D4AF37', '#EF4444'];

const getTier = (orm, bw, tiers) => {
  if (!bw) return -1;
  const ratio = orm / bw;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (ratio >= tiers[i]) return i;
  }
  return -1;
};

const getTierProgress = (orm, bw, tiers, tier) => {
  if (!bw || tier < 0) return 0;
  if (tier >= tiers.length - 1) return 100;
  const lo = tier < 0 ? 0 : tiers[tier] * bw;
  const hi = tiers[tier + 1] * bw;
  return Math.min(100, Math.round(((orm - lo) / (hi - lo)) * 100));
};

// ── Body metrics constants ──────────────────────────────────────────────────
const MEASUREMENT_FIELDS = [
  { key: 'chest_cm', label: 'Chest', unit: 'cm' },
  { key: 'waist_cm', label: 'Waist', unit: 'cm' },
  { key: 'hips_cm', label: 'Hips', unit: 'cm' },
  { key: 'left_arm_cm', label: 'Left Arm', unit: 'cm' },
  { key: 'right_arm_cm', label: 'Right Arm', unit: 'cm' },
  { key: 'left_thigh_cm', label: 'Left Thigh', unit: 'cm' },
  { key: 'right_thigh_cm', label: 'Right Thigh', unit: 'cm' },
  { key: 'body_fat_pct', label: 'Body Fat', unit: '%' },
];

const PERIOD_OPTIONS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const formatMonthYear = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

const fmtW = (w) => (w != null ? `${parseFloat(w).toFixed(1)}` : '—');
const today = () => new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════════════
// ── OVERVIEW TAB ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const OverviewTab = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState({ total_points: 0, lifetime_points: 0 });
  const [weekStats, setWeekStats] = useState({ sessions: 0, volume: 0, prs: 0 });
  const [volumeChart, setVolumeChart] = useState([]);
  const [challengeRankings, setChallengeRankings] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      // Date range for "this week"
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

      const [pts, weekSessions, volumeData, achievementData, myChallenges] = await Promise.all([
        getUserPoints(user.id),
        // This week's completed sessions
        supabase
          .from('workout_sessions')
          .select(`
            id, total_volume_lbs, completed_at,
            session_exercises(session_sets(is_pr, is_completed))
          `)
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', weekStart.toISOString())
          .lte('completed_at', weekEnd.toISOString()),
        // Last 8 weeks of volume for chart
        supabase
          .from('workout_sessions')
          .select('completed_at, total_volume_lbs')
          .eq('profile_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', subDays(new Date(), 56).toISOString())
          .order('completed_at', { ascending: true }),
        // Achievements: count of total sessions, PRs, streak for checking
        supabase
          .from('workout_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id)
          .eq('status', 'completed'),
        // Challenges the user has joined
        profile?.gym_id
          ? supabase
              .from('challenge_participants')
              .select('challenge_id, challenges(*)')
              .eq('profile_id', user.id)
          : { data: [] },
      ]);

      if (cancelled) return;

      setPointsData(pts);

      // Week stats
      const ws = weekSessions.data ?? [];
      const weekPRs = ws.reduce((sum, s) => {
        const prCount = (s.session_exercises ?? [])
          .flatMap(e => e.session_sets ?? [])
          .filter(set => set.is_pr && set.is_completed).length;
        return sum + prCount;
      }, 0);
      const weekVol = ws.reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
      setWeekStats({ sessions: ws.length, volume: weekVol, prs: weekPRs });

      // Volume chart — group by week
      const volRaw = volumeData.data ?? [];
      const weeklyMap = {};
      volRaw.forEach(s => {
        const wk = format(startOfWeek(new Date(s.completed_at), { weekStartsOn: 1 }), 'MMM d');
        weeklyMap[wk] = (weeklyMap[wk] || 0) + (parseFloat(s.total_volume_lbs) || 0);
      });
      setVolumeChart(
        Object.entries(weeklyMap).map(([week, vol]) => ({
          week,
          volume: Math.round(vol),
        }))
      );

      // Challenge rankings — find live challenges user is in and compute their rank
      const now = new Date();
      const liveChallenges = (myChallenges.data ?? [])
        .map(r => r.challenges)
        .filter(c => c && new Date(c.start_date) <= now && new Date(c.end_date) >= now);

      const rankings = [];
      for (const challenge of liveChallenges) {
        const { data: participants } = await supabase
          .from('challenge_participants')
          .select('profile_id, profiles(full_name)')
          .eq('challenge_id', challenge.id);

        const participantMap = {};
        (participants || []).forEach(p => { participantMap[p.profile_id] = p.profiles?.full_name ?? '—'; });
        const participantIds = Object.keys(participantMap);
        if (participantIds.length === 0) continue;

        let list = [];
        const SCORE_UNIT_MAP = { consistency: 'workouts', volume: 'lbs', pr_count: 'PRs', team: 'pts', specific_lift: 'lbs' };

        if (challenge.type === 'consistency' || challenge.type === 'volume') {
          const { data } = await supabase
            .from('workout_sessions')
            .select('profile_id, total_volume_lbs')
            .eq('gym_id', profile.gym_id)
            .eq('status', 'completed')
            .gte('started_at', challenge.start_date)
            .lte('started_at', challenge.end_date)
            .in('profile_id', participantIds);

          const agg = {};
          participantIds.forEach(id => { agg[id] = { name: participantMap[id], count: 0, volume: 0 }; });
          (data || []).forEach(s => {
            agg[s.profile_id].count++;
            agg[s.profile_id].volume += parseFloat(s.total_volume_lbs || 0);
          });
          list = Object.entries(agg)
            .map(([id, v]) => ({ id, name: v.name, score: challenge.type === 'volume' ? Math.round(v.volume) : v.count }))
            .sort((a, b) => b.score - a.score);
        } else if (challenge.type === 'pr_count') {
          const { data } = await supabase
            .from('pr_history')
            .select('profile_id')
            .eq('gym_id', profile.gym_id)
            .gte('achieved_at', challenge.start_date)
            .lte('achieved_at', challenge.end_date)
            .in('profile_id', participantIds);

          const agg = {};
          participantIds.forEach(id => { agg[id] = { name: participantMap[id], score: 0 }; });
          (data || []).forEach(r => { agg[r.profile_id].score++; });
          list = Object.entries(agg).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score);
        }

        const myIdx = list.findIndex(e => e.id === user.id);
        if (myIdx >= 0) {
          rankings.push({
            challengeId: challenge.id,
            challengeName: challenge.name,
            challengeType: challenge.type,
            rank: myIdx + 1,
            total: list.length,
            score: list[myIdx].score,
            unit: SCORE_UNIT_MAP[challenge.type] ?? '',
          });
        }
      }
      setChallengeRankings(rankings);

      // Achievements — compute earned ones
      const totalSessions = achievementData.count ?? 0;
      const achieveData = { totalSessions, currentStreak: 0, totalPRs: 0, friendCount: 0, sessionsInFirst6Weeks: 0, challengesCompleted: 0, totalVolumeLbs: 0 };
      const earned = ACHIEVEMENT_DEFS.filter(a => a.check(achieveData));
      setEarnedAchievements(earned.slice(-3));

      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user?.id, profile?.gym_id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  const volFormatted = weekStats.volume >= 1000
    ? `${(weekStats.volume / 1000).toFixed(1)}k`
    : `${Math.round(weekStats.volume)}`;

  return (
    <div className="flex flex-col gap-5 stagger-fade-in">
      {/* Level / XP Card */}
      <LevelCard totalPoints={pointsData.total_points} lifetimePoints={pointsData.lifetime_points} />

      {/* This week stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Sessions', value: weekStats.sessions, icon: Activity, color: '#60A5FA' },
          { label: 'Volume', value: `${volFormatted} lbs`, icon: Zap, color: '#D4AF37' },
          { label: 'PRs Hit', value: weekStats.prs, icon: Trophy, color: '#EF4444' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-[#0F172A] rounded-[14px] border border-white/8 p-3 flex flex-col items-center gap-1 text-center"
          >
            <Icon size={14} style={{ color }} strokeWidth={2} />
            <p className="text-[28px] font-black leading-none text-white">{value}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {/* Weekly volume chart */}
      {volumeChart.length >= 2 && (
        <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-3">Weekly Volume</p>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={volumeChart} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(v) => [`${v.toLocaleString()} lbs`, 'Volume']}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#D4AF37"
                strokeWidth={2}
                fill="url(#volGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#D4AF37' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Challenge Rankings */}
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-semibold text-[#E5E7EB]">Challenge Rankings</p>
          <button
            onClick={() => navigate('/leaderboard')}
            className="text-[11px] font-semibold text-[#D4AF37]"
          >
            View all
          </button>
        </div>
        {challengeRankings.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-[12px] text-[#6B7280]">No live challenges</p>
            <p className="text-[11px] text-[#4B5563] mt-1">Join a challenge to see your ranking</p>
          </div>
        ) : (
          <div className="space-y-2">
            {challengeRankings.map(cr => {
              const isTop3 = cr.rank <= 3;
              const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
              return (
                <div
                  key={cr.challengeId}
                  className="flex items-center gap-3 px-3 py-3 rounded-xl bg-[#D4AF37]/8 border border-[#D4AF37]/20"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/15 flex items-center justify-center flex-shrink-0">
                    {isTop3 ? (
                      <span className="text-[16px]">{medals[cr.rank]}</span>
                    ) : (
                      <span className="text-[14px] font-black text-[#D4AF37]">#{cr.rank}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">{cr.challengeName}</p>
                    <p className="text-[11px] text-[#6B7280]">
                      {cr.score.toLocaleString()} {cr.unit} · {cr.total} competitor{cr.total !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[16px] font-black text-[#D4AF37]">#{cr.rank}</p>
                    <p className="text-[10px] text-[#6B7280]">of {cr.total}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Achievements preview */}
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] font-semibold text-[#E5E7EB]">Achievements</p>
          <button
            onClick={() => navigate('/profile')}
            className="text-[11px] font-semibold text-[#D4AF37]"
          >
            View all
          </button>
        </div>
        {earnedAchievements.length === 0 ? (
          <p className="text-[12px] text-[#6B7280] text-center py-4">
            Complete workouts to earn achievements
          </p>
        ) : (
          <div className="flex gap-3">
            {earnedAchievements.map(a => (
              <div
                key={a.key}
                className="flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl bg-[#111827]"
              >
                <span className="text-2xl">{a.icon}</span>
                <p className="text-[10px] font-semibold text-[#E5E7EB] text-center leading-tight">{a.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── HISTORY TAB ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const SessionCard = ({ session }) => {
  const [expanded, setExpanded] = useState(false);

  const exercises = session.session_exercises ?? [];
  const allSets = exercises.flatMap(e => e.session_sets ?? []).filter(s => s.is_completed);
  const prSets = allSets.filter(s => s.is_pr);
  const volumeK = parseFloat(session.total_volume_lbs) || 0;
  const volumeStr = volumeK >= 1000
    ? `${(volumeK / 1000).toFixed(1)}k lbs`
    : `${Math.round(volumeK)} lbs`;

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden transition-all">
      <button
        className="w-full text-left px-5 py-4 flex items-start gap-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-shrink-0 w-10 text-center pt-0.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#D4AF37]">
            {new Date(session.completed_at).toLocaleDateString('en-US', { month: 'short' })}
          </p>
          <p className="text-[24px] font-black leading-none text-[#E5E7EB]">
            {new Date(session.completed_at).getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[16px] leading-tight truncate text-[#E5E7EB]">
            {session.name}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <Clock size={11} /> {formatDuration(session.duration_seconds)}
            </span>
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <Zap size={11} /> {volumeStr}
            </span>
            <span className="flex items-center gap-1 text-[12px] text-[#9CA3AF]">
              <Dumbbell size={11} /> {exercises.length} exercise{exercises.length !== 1 ? 's' : ''}
            </span>
            {prSets.length > 0 && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-[#D4AF37]">
                <Trophy size={11} /> {prSets.length} PR{prSets.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={18}
          className="flex-shrink-0 mt-1 transition-transform duration-200 text-[#9CA3AF]"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-4 border-t border-white/8">
          <div className="pt-3 flex flex-col gap-3">
            {exercises
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map((ex) => {
                const completedSets = (ex.session_sets ?? []).filter(s => s.is_completed);
                const hasPR = completedSets.some(s => s.is_pr);
                return (
                  <div key={ex.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="font-semibold text-[14px] text-[#E5E7EB]">
                        {ex.snapshot_name}
                      </p>
                      {hasPR && <Trophy size={13} className="text-[#D4AF37]" />}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {completedSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map((set, i) => (
                          <div
                            key={i}
                            className="rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                            style={
                              set.is_pr
                                ? { background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.25)' }
                                : { background: '#111827', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.08)' }
                            }
                          >
                            {set.weight_lbs} x {set.reps}
                            {set.is_pr && ' PR'}
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};

const HistoryTab = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState(new Set());

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('workout_sessions')
        .select(`
          id, name, completed_at, duration_seconds, total_volume_lbs,
          session_exercises(
            id, snapshot_name, position,
            session_sets(set_number, weight_lbs, reps, is_completed, is_pr)
          )
        `)
        .eq('profile_id', user.id)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      if (!cancelled) {
        setSessions(data ?? []);
        // Auto-expand the current month
        const currentMonth = formatMonthYear(new Date().toISOString());
        setExpandedMonths(new Set([currentMonth]));
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // Group sessions by month
  const grouped = sessions.reduce((acc, s) => {
    const key = formatMonthYear(s.completed_at);
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});
  const months = Object.keys(grouped);

  const toggleMonth = (month) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-[14px] animate-pulse bg-[#111827]" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-20">
        <Dumbbell size={40} className="mx-auto mb-4 text-[#9CA3AF] opacity-40" />
        <p className="font-semibold text-[16px] text-[#E5E7EB]">No workouts yet</p>
        <p className="text-[13px] mt-1.5 text-[#9CA3AF]">
          Complete your first session to see it here
        </p>
        <button
          onClick={() => navigate('/workouts')}
          className="mt-6 font-bold text-[14px] px-6 py-2.5 rounded-xl transition-colors bg-[#D4AF37] text-black"
        >
          Go to Workouts
        </button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] mb-4 text-[#9CA3AF]">
        {sessions.length} workout{sessions.length !== 1 ? 's' : ''} completed
      </p>
      {months.map(month => {
        const isExpanded = expandedMonths.has(month);
        const count = grouped[month].length;
        return (
          <div key={month} className="mb-4">
            <button
              onClick={() => toggleMonth(month)}
              className="w-full flex items-center justify-between mb-3 group"
            >
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9CA3AF]">
                  {month}
                </p>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white/6 text-[#6B7280]">
                  {count}
                </span>
              </div>
              <ChevronDown
                size={15}
                className="text-[#4B5563] transition-transform duration-200"
                style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>
            {isExpanded ? (
              <div className="flex flex-col gap-3">
                {grouped[month].map(session => (
                  <SessionCard key={session.id} session={session} />
                ))}
              </div>
            ) : (
              <div className="bg-[#0F172A] rounded-[14px] border border-white/8 px-4 py-3">
                <p className="text-[12px] text-[#6B7280]">
                  {count} workout{count !== 1 ? 's' : ''} · Tap to expand
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── STRENGTH TAB ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const StandardCard = ({ standard, pr, bodyweight }) => {
  const orm = pr ? parseFloat(pr.estimated_1rm) : null;
  const tier = orm != null ? getTier(orm, bodyweight, standard.tiers) : -1;

  const tierLabel = tier < 0 ? 'No data' : tier < TIER_LABELS.length ? TIER_LABELS[tier] : 'Elite';
  const tierColor = tier < 0 ? '#4B5563' : TIER_COLORS[Math.min(tier, TIER_COLORS.length - 1)];
  const progress = orm != null ? getTierProgress(orm, bodyweight, standard.tiers, tier) : 0;
  const nextTierLbs = (tier < standard.tiers.length - 1 && bodyweight)
    ? Math.ceil(standard.tiers[tier + 1] * bodyweight)
    : null;

  return (
    <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-[14px] font-semibold text-[#E5E7EB]">{standard.name}</p>
        <span
          className="text-[11px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: `${tierColor}18`, color: tierColor }}
        >
          {tierLabel}
        </span>
      </div>

      {orm != null ? (
        <>
          <p className="text-[28px] font-black text-white leading-none mb-1">
            {Math.round(orm)}
            <span className="text-[13px] font-medium ml-1 text-[#9CA3AF]">lbs</span>
          </p>
          <p className="text-[11px] mb-3 text-[#9CA3AF]">
            {pr.weight_lbs} lbs x {pr.reps} reps
          </p>
          <div className="space-y-1.5">
            <div className="h-1.5 rounded-full w-full overflow-hidden bg-white/6">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progress}%`, background: tierColor }}
              />
            </div>
            {nextTierLbs && tier < TIER_LABELS.length - 1 && (
              <p className="text-[10px] text-[#9CA3AF]">
                {nextTierLbs - Math.round(orm)} lbs to{' '}
                <span style={{ color: TIER_COLORS[Math.min(tier + 1, TIER_COLORS.length - 1)] }}>
                  {TIER_LABELS[tier + 1]}
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 mt-3">
            {TIER_LABELS.map((t, i) => (
              <div
                key={t}
                className="flex-1 h-1 rounded-full"
                style={{ background: i <= tier ? TIER_COLORS[i] : 'rgba(255,255,255,0.08)' }}
                title={t}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="text-[12px] mt-1 text-[#9CA3AF]">Log this lift to see your level</p>
      )}
    </div>
  );
};

const PRRow = ({ pr, history }) => {
  const [open, setOpen] = useState(false);

  const chartData = (history ?? []).map(h => ({
    date: format(parseISO(h.achieved_at.slice(0, 10)), 'MMM d'),
    orm: Math.round(parseFloat(h.estimated_1rm)),
  }));

  const yMin = chartData.length ? Math.floor(Math.min(...chartData.map(d => d.orm)) - 5) : undefined;
  const yMax = chartData.length ? Math.ceil(Math.max(...chartData.map(d => d.orm)) + 5) : undefined;

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
          style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37' }}
        >
          <Trophy size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold truncate text-[#E5E7EB]">
            {pr.exercises?.name}
          </p>
          <p className="text-[11px] text-[#9CA3AF]">
            {pr.weight_lbs} lbs x {pr.reps} · {format(parseISO(pr.achieved_at.slice(0, 10)), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className="text-[17px] font-black text-[#D4AF37]">
            {Math.round(parseFloat(pr.estimated_1rm))}
            <span className="text-[11px] font-medium ml-0.5 text-[#9CA3AF]">lbs</span>
          </p>
          <ChevronDown
            size={15}
            className="text-[#9CA3AF]"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/4">
          {chartData.length < 2 ? (
            <p className="text-[12px] pt-3 text-[#9CA3AF]">
              Hit this lift again to see your 1RM trend
            </p>
          ) : (
            <div className="pt-3">
              <p className="text-[12px] font-medium mb-2 text-[#9CA3AF]">Estimated 1RM over time</p>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.max(0, Math.floor(chartData.length / 4) - 1)}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${v} lbs`, 'Est. 1RM']} />
                  <Line
                    type="monotone"
                    dataKey="orm"
                    stroke="#D4AF37"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#D4AF37', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#D4AF37' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const StrengthTab = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prs, setPrs] = useState([]);
  const [prHistory, setPrHistory] = useState({});
  const [bodyweight, setBodyweight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllPrs, setShowAllPrs] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const [{ data: prData }, { data: histData }, { data: bwData }] = await Promise.all([
        supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
          .eq('profile_id', user.id)
          .order('estimated_1rm', { ascending: false }),
        supabase
          .from('pr_history')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at')
          .eq('profile_id', user.id)
          .order('achieved_at', { ascending: true }),
        supabase
          .from('body_weight_logs')
          .select('weight_lbs')
          .eq('profile_id', user.id)
          .order('logged_at', { ascending: false })
          .limit(1)
          .single(),
      ]);

      if (cancelled) return;

      setPrs(prData ?? []);
      setBodyweight(bwData?.weight_lbs ? parseFloat(bwData.weight_lbs) : null);

      const grouped = {};
      (histData ?? []).forEach(h => {
        if (!grouped[h.exercise_id]) grouped[h.exercise_id] = [];
        grouped[h.exercise_id].push(h);
      });
      setPrHistory(grouped);
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  const prByExercise = prs.reduce((acc, pr) => ({ ...acc, [pr.exercise_id]: pr }), {});
  const standardExerciseIds = new Set(STANDARDS.map(s => s.exerciseId));
  const otherPrs = prs.filter(pr => !standardExerciseIds.has(pr.exercise_id));

  return (
    <div>
      {/* Strength standards */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-bold text-[#E5E7EB]">Strength Standards</p>
            <button
              onClick={() => navigate('/personal-records')}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-xl transition-colors"
              style={{ background: 'rgba(212,175,55,0.08)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
            >
              <Trophy size={11} />
              Personal Records
            </button>
          </div>
          {!bodyweight && (
            <button
              onClick={() => navigate('/metrics')}
              className="text-[11px] font-semibold px-3 py-1 rounded-xl"
              style={{ background: 'rgba(212,175,55,0.08)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
            >
              Log weight to unlock
            </button>
          )}
        </div>
        {bodyweight && (
          <p className="text-[12px] mb-3 text-[#9CA3AF]">
            Based on your bodyweight of <span className="text-[#E5E7EB]">{bodyweight} lbs</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
        {STANDARDS.map(std => (
          <StandardCard
            key={std.exerciseId}
            standard={std}
            pr={prByExercise[std.exerciseId] ?? null}
            bodyweight={bodyweight}
          />
        ))}
      </div>

      {/* All PRs */}
      <p className="text-[15px] font-bold mb-3 text-[#E5E7EB]">
        Top Exercises
        {prs.length > 0 && (
          <span
            className="ml-2 text-[12px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37' }}
          >
            {prs.length}
          </span>
        )}
      </p>

      {prs.length === 0 ? (
        <div className="bg-[#0F172A] rounded-[14px] border border-white/8 py-16 flex flex-col items-center gap-3">
          <TrendingUp size={32} className="text-[#4B5563]" strokeWidth={1.5} />
          <p className="text-[14px] text-[#9CA3AF]">No PRs yet</p>
          <p className="text-[12px] text-[#6B7280]">Complete workouts to start tracking</p>
        </div>
      ) : (
        <>
          <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden divide-y divide-white/4">
            {(showAllPrs ? prs : prs.slice(0, 5)).map(pr => (
              <PRRow key={pr.exercise_id} pr={pr} history={prHistory[pr.exercise_id] ?? []} />
            ))}
          </div>
          {prs.length > 5 && !showAllPrs && (
            <button
              onClick={() => setShowAllPrs(true)}
              className="w-full mt-3 py-3 rounded-xl text-[13px] font-semibold text-[#D4AF37] bg-[#D4AF37]/8 border border-[#D4AF37]/15 transition-colors hover:bg-[#D4AF37]/12"
            >
              Show {prs.length - 5} more exercise{prs.length - 5 !== 1 ? 's' : ''}
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── BODY TAB ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const MeasurementsModal = ({ existing, gymId, profileId, onSaved, onClose }) => {
  const empty = MEASUREMENT_FIELDS.reduce((a, f) => ({ ...a, [f.key]: '' }), {});
  const [form, setForm] = useState(() => {
    if (!existing) return empty;
    return MEASUREMENT_FIELDS.reduce(
      (a, f) => ({ ...a, [f.key]: existing[f.key] != null ? String(existing[f.key]) : '' }),
      {}
    );
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState(null);
  const fileRef = useRef(null);

  const handleScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => setScanPreview(ev.target.result);
    reader.readAsDataURL(file);

    setScanning(true);
    setError('');

    try {
      // Compress image for upload
      const compressed = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 1200;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(resolve, 'image/jpeg', 0.8);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });

      // Convert to base64
      const base64 = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(',')[1]);
        r.readAsDataURL(compressed);
      });

      // Call Supabase edge function for AI analysis
      const { data, error: fnError } = await supabase.functions.invoke('analyze-body-photo', {
        body: { image: base64, existingMeasurements: form },
      });

      if (fnError) throw fnError;

      if (data?.estimates) {
        // Pre-fill form with AI estimates
        const est = data.estimates;
        setForm(prev => {
          const next = { ...prev };
          MEASUREMENT_FIELDS.forEach(f => {
            if (est[f.key] != null && (prev[f.key] === '' || prev[f.key] === undefined)) {
              next[f.key] = String(est[f.key]);
            }
          });
          return next;
        });
      }
    } catch (err) {
      setError(err.message || 'Photo analysis failed — enter measurements manually');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    const payload = { profile_id: profileId, gym_id: gymId, measured_at: today() };
    MEASUREMENT_FIELDS.forEach(f => {
      payload[f.key] = form[f.key] !== '' ? parseFloat(form[f.key]) : null;
    });
    const { error: err } = await supabase
      .from('body_measurements')
      .upsert(payload, { onConflict: 'profile_id,measured_at' });
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-2xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/6">
          <p className="text-[16px] font-bold text-[#E5E7EB]">
            {existing ? 'Update Measurements' : 'Add Measurements'}
          </p>
          <button onClick={onClose}><X size={20} className="text-[#6B7280]" /></button>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {/* AI Photo Scan */}
          <div className="mb-4">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed transition-colors"
              style={{
                borderColor: scanPreview ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.12)',
                background: scanPreview ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.02)',
              }}
            >
              {scanning ? (
                <>
                  <div className="w-4 h-4 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
                  <span className="text-[12px] font-semibold text-[#D4AF37]">Analyzing photo...</span>
                </>
              ) : scanPreview ? (
                <>
                  <Check size={14} className="text-[#10B981]" />
                  <span className="text-[12px] font-semibold text-[#10B981]">Estimates applied — verify & adjust below</span>
                </>
              ) : (
                <>
                  <Camera size={16} className="text-[#D4AF37]" />
                  <span className="text-[12px] font-semibold text-[#D4AF37]">Estimate from Photo</span>
                  <span className="text-[10px] text-[#6B7280] ml-1">(AI body fat estimate)</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="hidden"
              onChange={handleScan}
            />
          </div>

          {/* Manual fields */}
          <div className="grid grid-cols-2 gap-3">
            {MEASUREMENT_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  {f.label} ({f.unit})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="—"
                  value={form[f.key]}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '' || v === '-') return setForm(p => ({ ...p, [f.key]: v }));
                    const n = parseFloat(v);
                    setForm(p => ({ ...p, [f.key]: !isNaN(n) && n < 0 ? '0' : v }));
                  }}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40"
                />
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-[12px] text-red-400 px-5 pb-2">{error}</p>}
        <div className="px-5 pb-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] disabled:opacity-50 transition-opacity"
          >
            {saving ? 'Saving...' : 'Save Measurements'}
          </button>
        </div>
      </div>
    </div>
  );
};

const BodyTab = () => {
  const { user, profile } = useAuth();

  const [weightLogs, setWeightLogs] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [period, setPeriod] = useState(90);
  const [weightInput, setWeightInput] = useState('');
  const [loggingWeight, setLoggingWeight] = useState(false);
  const [weightError, setWeightError] = useState('');
  const [latestMeasurements, setLatestMeasurements] = useState(null);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const from = subDays(new Date(), period).toISOString().slice(0, 10);

    const [{ data: logs }, { data: meas }] = await Promise.all([
      supabase
        .from('body_weight_logs')
        .select('id, weight_lbs, logged_at, notes')
        .eq('profile_id', user.id)
        .gte('logged_at', from)
        .order('logged_at', { ascending: true }),
      supabase
        .from('body_measurements')
        .select('*')
        .eq('profile_id', user.id)
        .order('measured_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const allLogs = logs ?? [];
    setWeightLogs([...allLogs].reverse());
    setChartData(
      allLogs.map(l => ({
        date: format(parseISO(l.logged_at), 'MMM d'),
        weight: parseFloat(l.weight_lbs),
      }))
    );
    setLatestMeasurements(meas ?? null);
    setLoading(false);
  }, [user, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLogWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w <= 0) {
      setWeightError('Enter a valid weight');
      return;
    }
    setLoggingWeight(true);
    setWeightError('');

    const { error } = await supabase
      .from('body_weight_logs')
      .upsert(
        { profile_id: user.id, gym_id: profile.gym_id, weight_lbs: w, logged_at: today() },
        { onConflict: 'profile_id,logged_at' }
      );

    if (error) {
      setWeightError(error.message);
      setLoggingWeight(false);
      return;
    }
    setWeightInput('');
    loadData();
    setLoggingWeight(false);
  };

  const latest = weightLogs[0];
  const earliest = weightLogs[weightLogs.length - 1];
  const currentW = latest ? parseFloat(latest.weight_lbs) : null;
  const startingW = earliest ? parseFloat(earliest.weight_lbs) : null;
  const delta =
    currentW != null && startingW != null && weightLogs.length > 1
      ? currentW - startingW
      : null;

  const DeltaIcon = delta == null ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const deltaColor = delta == null ? '#6B7280' : delta > 0 ? '#EF4444' : '#10B981';

  const yMin = chartData.length
    ? Math.floor(Math.min(...chartData.map(d => d.weight)) - 2)
    : undefined;
  const yMax = chartData.length
    ? Math.ceil(Math.max(...chartData.map(d => d.weight)) + 2)
    : undefined;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#D4AF37]/30 border-t-[#D4AF37] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Log weight bar + monthly report */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 flex items-center gap-1.5 bg-[#0F172A] border border-white/8 rounded-xl px-3 py-1.5">
          <Scale size={14} className="text-[#D4AF37] flex-shrink-0" />
          <input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder={weightLogs[0]?.logged_at === today() ? fmtW(weightLogs[0].weight_lbs) : 'Log weight...'}
            value={weightInput}
            onChange={e => {
              const v = e.target.value;
              setWeightError('');
              if (v === '' || v === '-') return setWeightInput(v);
              const n = parseFloat(v);
              setWeightInput(!isNaN(n) && n < 0 ? '0' : v);
            }}
            onKeyDown={e => e.key === 'Enter' && handleLogWeight()}
            className="flex-1 min-w-0 bg-transparent text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none"
          />
          <span className="text-[11px] text-[#6B7280] flex-shrink-0 mr-1">lbs</span>
          <button
            onClick={handleLogWeight}
            disabled={loggingWeight || !weightInput}
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-[#D4AF37] disabled:opacity-30 transition-opacity"
          >
            {loggingWeight ? (
              <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <Check size={14} strokeWidth={2.5} className="text-black" />
            )}
          </button>
        </div>
        <button
          onClick={() => setShowMonthlyReport(true)}
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2.5 rounded-xl transition-colors flex-shrink-0"
          style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
        >
          <BarChart3 size={14} />
          Monthly Report
        </button>
      </div>
      {weightError && <p className="text-[12px] text-red-400 -mt-2 mb-3">{weightError}</p>}
      {!weightError && weightLogs[0]?.logged_at === today() && (
        <p className="text-[11px] text-[#6B7280] -mt-2 mb-3">
          Today: <span className="text-[#D4AF37]">{fmtW(weightLogs[0].weight_lbs)} lbs</span> — enter a new value to update
        </p>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Current', value: currentW != null ? `${fmtW(currentW)} lbs` : '—', icon: Scale, color: '#D4AF37' },
          { label: `Change (${period}d)`, value: delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} lbs` : '—', icon: DeltaIcon, color: deltaColor },
          { label: 'Entries', value: weightLogs.length, icon: TrendingUp, color: '#60A5FA' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-[#0F172A] rounded-[14px] border border-white/8 p-4 flex flex-col items-center gap-1.5 text-center"
          >
            <Icon size={16} style={{ color }} strokeWidth={2} />
            <p className="text-[22px] font-black leading-none text-white">{value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {/* Weight chart */}
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">Weight Trend</p>
          <div className="flex gap-1.5">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => setPeriod(opt.days)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors"
                style={
                  period === opt.days
                    ? { background: 'rgba(212,175,55,0.15)', color: '#D4AF37' }
                    : { background: '#111827', color: '#6B7280', border: '1px solid rgba(255,255,255,0.08)' }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {chartData.length < 2 ? (
          <div className="h-[160px] flex items-center justify-center">
            <p className="text-[13px] text-[#6B7280]">Log at least 2 entries to see a trend</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 5) - 1)}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v} lbs`, 'Weight']} />
              <Area
                type="monotone"
                dataKey="weight"
                stroke="#D4AF37"
                strokeWidth={2}
                fill="url(#wGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#D4AF37' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Body measurements */}
      <div className="bg-[#0F172A] rounded-[14px] border border-white/8 p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[14px] font-semibold text-[#E5E7EB]">Measurements</p>
          <button
            onClick={() => setShowMeasurements(true)}
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
            style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
          >
            <Plus size={13} strokeWidth={2.5} />
            {latestMeasurements ? 'Update' : 'Add'}
          </button>
        </div>

        {latestMeasurements ? (
          <>
            <p className="text-[11px] mb-3 text-[#6B7280]">
              Last recorded {format(parseISO(latestMeasurements.measured_at), 'MMMM d, yyyy')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {MEASUREMENT_FIELDS.filter(f => latestMeasurements[f.key] != null).map(f => (
                <div key={f.key} className="rounded-xl p-3 text-center bg-[#111827]">
                  <p className="text-[18px] font-black text-white leading-none">
                    {parseFloat(latestMeasurements[f.key]).toFixed(1)}
                    <span className="text-[11px] font-medium ml-0.5 text-[#6B7280]">{f.unit}</span>
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mt-1.5 text-[#6B7280]">
                    {f.label}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[#6B7280]">No measurements recorded yet</p>
            <p className="text-[11px] mt-1 text-[#4B5563]">Track chest, waist, arms, and more</p>
          </div>
        )}
      </div>

      {/* Weight history */}
      {weightLogs.length > 0 && (
        <div className="bg-[#0F172A] rounded-[14px] border border-white/8 overflow-hidden">
          <p className="text-[14px] font-semibold px-5 pt-4 pb-3 text-[#E5E7EB]">History</p>
          <div className="divide-y divide-white/4">
            {weightLogs.map((log, i) => {
              const prev = weightLogs[i + 1];
              const diff = prev
                ? parseFloat(log.weight_lbs) - parseFloat(prev.weight_lbs)
                : null;
              return (
                <div key={log.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">
                      {format(parseISO(log.logged_at), 'EEE, MMM d')}
                    </p>
                    {log.notes && (
                      <p className="text-[11px] mt-0.5 text-[#6B7280]">{log.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {diff != null && (
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: diff === 0 ? '#6B7280' : diff > 0 ? '#EF4444' : '#10B981' }}
                      >
                        {diff > 0 ? '+' : ''}
                        {diff.toFixed(1)}
                      </span>
                    )}
                    <p className="text-[15px] font-bold text-white">
                      {fmtW(log.weight_lbs)}{' '}
                      <span className="text-[11px] font-medium text-[#6B7280]">lbs</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Measurements modal */}
      {showMeasurements && (
        <MeasurementsModal
          existing={latestMeasurements}
          gymId={profile.gym_id}
          profileId={user.id}
          onSaved={loadData}
          onClose={() => setShowMeasurements(false)}
        />
      )}

      {/* Monthly report */}
      {showMonthlyReport && (
        <MonthlyProgressReport
          isOpen={showMonthlyReport}
          onClose={() => setShowMonthlyReport(false)}
        />
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ── MAIN PROGRESS PAGE ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export default function Progress() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [loadedTabs, setLoadedTabs] = useState(new Set(['Overview']));

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setLoadedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  };

  const tabIndex = TABS.indexOf(activeTab);
  const handleSwipe = (i) => handleTabChange(TABS[i]);

  return (
    <div className="min-h-screen bg-[#05070B]">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl bg-[#05070B]/95 border-b border-white/6">
        <div className="max-w-[720px] mx-auto px-4 md:px-6 pt-3 pb-3">
          <h1
            className="text-[22px] font-black text-[#E5E7EB] mb-3"
            style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
          >
            Progress
          </h1>

          {/* Tab pills */}
          <div className="flex bg-[#111827] p-1 rounded-xl overflow-x-auto no-scrollbar">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`flex-1 min-w-0 py-2 px-3 rounded-xl text-[13px] font-semibold transition-all whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-[#D4AF37] text-black'
                    : 'text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content (swipeable) */}
      <div className="max-w-[720px] mx-auto px-4 md:px-6 pt-5 pb-28 md:pb-12">
        <SwipeableTabView activeIndex={tabIndex} onChangeIndex={handleSwipe}>
          <div>{loadedTabs.has('Overview') && <OverviewTab />}</div>
          <div>{loadedTabs.has('History') && <HistoryTab />}</div>
          <div>{loadedTabs.has('Strength') && <StrengthTab />}</div>
          <div>{loadedTabs.has('Body') && <BodyTab />}</div>
        </SwipeableTabView>
      </div>
    </div>
  );
}
