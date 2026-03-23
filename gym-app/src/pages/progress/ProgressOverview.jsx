import { useState, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Trophy, Zap, Activity, BarChart3,
} from 'lucide-react';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
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
import ChartTooltip from '../../components/ChartTooltip';

const WorkoutLog = lazy(() => import('../WorkoutLog'));

export default function ProgressOverview() {
  const { t } = useTranslation('pages');
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState({ total_points: 0, lifetime_points: 0 });
  const [weekStats, setWeekStats] = useState({ sessions: 0, volume: 0, prs: 0 });
  const [volumeChart, setVolumeChart] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      // Date range for "this week"
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

      const [pts, weekSessions, volumeData, achievementData, streakData, prCountData, friendCountData, totalVolumeData] = await Promise.all([
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
        // Current streak
        supabase
          .from('streak_cache')
          .select('current_streak_days')
          .eq('profile_id', user.id)
          .maybeSingle(),
        // Total PRs
        supabase
          .from('personal_records')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id),
        // Friend count
        supabase
          .from('friendships')
          .select('id', { count: 'exact', head: true })
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted'),
        // Total volume
        supabase
          .from('workout_sessions')
          .select('total_volume_lbs')
          .eq('profile_id', user.id)
          .eq('status', 'completed'),
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

      // Achievements — compute earned ones
      const totalSessions = achievementData.count ?? 0;
      const currentStreak = streakData.data?.current_streak_days ?? 0;
      const totalPRs = prCountData.count ?? 0;
      const friendCount = friendCountData.count ?? 0;
      const totalVolumeLbs = (totalVolumeData.data ?? []).reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
      const achieveData = { totalSessions, currentStreak, totalPRs, friendCount, sessionsInFirst6Weeks: 0, challengesCompleted: 0, totalVolumeLbs };
      const earned = ACHIEVEMENT_DEFS.filter(a => a.check(achieveData));
      setEarnedAchievements(earned.slice(-3));

      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user?.id]);

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
      {/* Monthly Report button (right-aligned) + Level / XP */}
      <div className="flex justify-end -mb-1">
        <button
          onClick={() => setShowMonthlyReport(true)}
          aria-label="View monthly report"
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
          style={{ background: 'rgba(212,175,55,0.1)', color: '#D4AF37', border: '1px solid rgba(212,175,55,0.2)' }}
        >
          <BarChart3 size={14} />
          {t('progress.overview.monthlyReport')}
        </button>
      </div>
      <LevelCard totalPoints={pointsData.total_points} lifetimePoints={pointsData.lifetime_points} />

      {/* This week stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t('progress.overview.sessions'), value: weekStats.sessions, icon: Activity, color: '#60A5FA' },
          { label: t('progress.overview.volume'), value: `${volFormatted} lbs`, icon: Zap, color: '#D4AF37' },
          { label: t('progress.overview.prsHit'), value: weekStats.prs, icon: Trophy, color: '#EF4444' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-[#0F172A] rounded-2xl border border-white/8 p-3 flex flex-col items-center gap-1 text-center"
          >
            <Icon size={14} style={{ color }} strokeWidth={2} />
            <p className="text-[28px] font-black leading-none text-white">{value}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {/* Weekly volume chart */}
      {volumeChart.length >= 2 && (
        <div className="bg-[#0F172A] rounded-2xl border border-white/8 p-4">
          <p className="text-[13px] font-semibold text-[#E5E7EB] mb-3">{t('progress.overview.weeklyVolume')}</p>
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
              <Tooltip content={<ChartTooltip formatter={(v) => `${v.toLocaleString()} lbs`} />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#D4AF37"
                strokeWidth={2}
                fill="url(#volGrad)"
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Workout History */}
      <div className="mt-6">
        <Suspense fallback={<Skeleton variant="list-item" count={3} />}>
          <WorkoutLog embedded />
        </Suspense>
      </div>

      {showMonthlyReport && createPortal(
        <MonthlyProgressReport
          isOpen={showMonthlyReport}
          onClose={() => setShowMonthlyReport(false)}
        />,
        document.body
      )}
    </div>
  );
}
