import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy, Zap, Activity,
} from 'lucide-react';
import Skeleton from '../../components/Skeleton';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getUserPoints } from '../../lib/rewardsEngine';
import { LevelCard } from '../../components/LevelBadge';
import { ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { format, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { tooltipStyle } from './progressConstants';

export default function ProgressOverview() {
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
      <div className="flex flex-col gap-5">
        <Skeleton variant="card" height="h-[100px]" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton variant="stat" />
          <Skeleton variant="stat" />
          <Skeleton variant="stat" />
        </div>
        <Skeleton variant="chart" />
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
              const medals = { 1: '\u{1F947}', 2: '\u{1F948}', 3: '\u{1F949}' };
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
}
