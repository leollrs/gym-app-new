import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Trophy, Zap, Activity, BarChart3, ChevronDown, ChevronRight, Clock, Dumbbell, Calendar,
} from 'lucide-react';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
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
import { es as esLocale } from 'date-fns/locale/es';
import ChartTooltip from '../../components/ChartTooltip';
import { sanitize } from '../../lib/sanitize';

export default function ProgressOverview() {
  const { t, i18n } = useTranslation('pages');
  const { user, lifetimePoints: ctxLifetimePoints } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pointsData, setPointsData] = useState({ total_points: 0, lifetime_points: ctxLifetimePoints ?? 0 });
  const [weekStats, setWeekStats] = useState({ sessions: 0, volume: 0, prs: 0 });
  const [volumeChart, setVolumeChart] = useState([]);
  const [earnedAchievements, setEarnedAchievements] = useState([]);
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);

  // Sync lifetime points from context when it loads
  useEffect(() => { if (ctxLifetimePoints != null) setPointsData(prev => ({ ...prev, lifetime_points: ctxLifetimePoints })); }, [ctxLifetimePoints]);

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
        const wk = format(startOfWeek(new Date(s.completed_at), { weekStartsOn: 1 }), 'MMM d', { locale: i18n.language === 'es' ? esLocale : undefined });
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
    <div className="flex flex-col gap-6 stagger-fade-in">
      {/* Monthly Report button (right-aligned) + Level / XP */}
      <div className="flex justify-end -mb-1">
        <button
          onClick={() => setShowMonthlyReport(true)}
          aria-label="View monthly report"
          className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-xl transition-colors"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)' }}
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
            className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-3 flex flex-col items-center gap-1 text-center"
          >
            <Icon size={14} style={{ color }} strokeWidth={2} />
            <p className="text-[28px] font-bold leading-none text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</p>
          </div>
        ))}
      </div>

      {/* Weekly volume chart */}
      {volumeChart.length >= 2 && (
        <div className="bg-[#0F172A] rounded-2xl border border-white/[0.06] p-5">
          <p className="text-[14px] font-semibold text-[#E5E7EB] mb-3">{t('progress.overview.weeklyVolume')}</p>
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
                name={t('progress.overview.volume')}
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

      {/* Workout History — Monthly Timeline */}
      <div className="mt-6">
        <MonthlyTimeline userId={user?.id} />
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

// ── Helpers ───────────────────────────────────────────────────────────────
const MONTH_KEYS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

const formatDuration = (seconds) => {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// ── Compact Session Row ──────────────────────────────────────────────────
function SessionRow({ session }) {
  const { i18n } = useTranslation('pages');
  const [expanded, setExpanded] = useState(false);
  const exercises = session.session_exercises ?? [];
  const allSets = exercises.flatMap(e => e.session_sets ?? []).filter(s => s.is_completed);
  const prCount = allSets.filter(s => s.is_pr).length;
  const vol = parseFloat(session.total_volume_lbs) || 0;
  const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;

  return (
    <div className="bg-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden hover:bg-white/[0.06] transition-colors duration-200">
      <button
        className="w-full text-left px-4 py-3.5 flex items-start gap-3"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-shrink-0 w-9 text-center pt-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#D4AF37]">
            {new Date(session.completed_at).toLocaleDateString(i18n.language === 'es' ? 'es-ES' : 'en-US', { month: 'short' })}
          </p>
          <p className="text-[22px] font-bold leading-none text-[#E5E7EB]" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {new Date(session.completed_at).getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[15px] leading-tight truncate text-[#E5E7EB]">
            {sanitize(session.name)}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
            <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
              <Clock size={10} /> {formatDuration(session.duration_seconds)}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
              <Zap size={10} /> {volStr} lbs
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
              <Dumbbell size={10} /> {exercises.length}
            </span>
            {prCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#D4AF37]">
                <Trophy size={10} /> {prCount} PR{prCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={16}
          className="flex-shrink-0 mt-1 transition-transform duration-200 text-[#9CA3AF]"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-3 border-t border-white/[0.06]">
          <div className="pt-2.5 flex flex-col gap-2.5">
            {exercises
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map(ex => {
                const completedSets = (ex.session_sets ?? []).filter(s => s.is_completed);
                const hasPR = completedSets.some(s => s.is_pr);
                return (
                  <div key={ex.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-[13px] text-[#E5E7EB]">{sanitize(ex.snapshot_name)}</p>
                      {hasPR && <Trophy size={12} className="text-[#D4AF37]" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {completedSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map(set => (
                          <div
                            key={`${set.set_number}-${set.weight_lbs}-${set.reps}`}
                            className="rounded-lg px-2 py-0.5 text-[11px] font-semibold"
                            style={
                              set.is_pr
                                ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }
                                : { background: '#111827', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.06)' }
                            }
                          >
                            {set.weight_lbs} × {set.reps}{set.is_pr && ' PR'}
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
}

// ── Month Block ──────────────────────────────────────────────────────────
function MonthBlock({ monthLabel, sessions, defaultOpen }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? sessions : sessions.slice(0, 5);
  const hasMore = sessions.length > 5;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left py-2 group"
      >
        <div className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
          <ChevronDown size={14} className="text-[#6B7280]" />
        </div>
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF] group-hover:text-[#E5E7EB] transition-colors">
          {monthLabel}
        </p>
        <span className="text-[11px] font-medium text-[#6B7280] ml-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {t('progress.overview.sessions_count', { count: sessions.length })}
        </span>
      </button>
      {open && (
        <div className="ml-1 pl-4 border-l border-white/[0.06]">
          <div className="flex flex-col gap-2.5 pt-1 pb-3">
            {visible.map(s => <SessionRow key={s.id} session={s} />)}
          </div>
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-[12px] font-semibold text-[#D4AF37] hover:text-[#E6C766] transition-colors pb-3 pl-1"
            >
              {t('progress.overview.showMore', { count: sessions.length - 5 })}
            </button>
          )}
          {hasMore && showAll && (
            <button
              onClick={() => setShowAll(false)}
              className="text-[12px] font-semibold text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors pb-3 pl-1"
            >
              {t('progress.overview.showLess')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Year Block (for past years) ──────────────────────────────────────────
function YearBlock({ year, monthsData }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  const totalSessions = Object.values(monthsData).reduce((sum, arr) => sum + arr.length, 0);

  // Sort months descending (Dec → Jan)
  const sortedMonths = Object.keys(monthsData).sort((a, b) => b - a);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left py-2.5 group"
      >
        <div className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
          <ChevronDown size={16} className="text-[#6B7280]" />
        </div>
        <Calendar size={14} className="text-[#D4AF37]" />
        <p className="text-[14px] font-bold text-[#E5E7EB] group-hover:text-white transition-colors">
          {year}
        </p>
        <span className="text-[12px] font-medium text-[#6B7280] ml-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {t('progress.overview.sessions_count', { count: totalSessions })}
        </span>
      </button>
      {open && (
        <div className="ml-2 pl-4 border-l border-white/[0.06] flex flex-col gap-1 pt-1 pb-2">
          {sortedMonths.map(monthIdx => (
            <MonthBlock
              key={monthIdx}
              monthLabel={t(`months.${MONTH_KEYS[monthIdx]}`)}
              sessions={monthsData[monthIdx]}
              defaultOpen={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Monthly Timeline ─────────────────────────────────────────────────────
function MonthlyTimeline({ userId }) {
  const { t } = useTranslation('pages');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('workout_sessions')
        .select(`
          id, name, completed_at, duration_seconds, total_volume_lbs,
          session_exercises(
            id, snapshot_name, position,
            session_sets(set_number, weight_lbs, reps, is_completed, is_pr)
          )
        `)
        .eq('profile_id', userId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });

      if (!cancelled) {
        if (error) console.error('MonthlyTimeline: load error', error);
        setSessions(data ?? []);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Group sessions: { year: { monthIndex: [sessions] } }
  const { currentYearMonths, pastYears, currentYear } = useMemo(() => {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth();
    const years = {};

    for (const s of sessions) {
      const d = new Date(s.completed_at);
      const y = d.getFullYear();
      const m = d.getMonth();
      if (!years[y]) years[y] = {};
      if (!years[y][m]) years[y][m] = [];
      years[y][m].push(s);
    }

    // Current year: show all months from January to current month
    const currentYearData = years[cy] || {};
    const monthsArr = [];
    for (let m = cm; m >= 0; m--) {
      monthsArr.push({ monthIdx: m, sessions: currentYearData[m] || [] });
    }

    // Past years sorted descending
    const pastYearsArr = Object.keys(years)
      .map(Number)
      .filter(y => y < cy)
      .sort((a, b) => b - a)
      .map(y => ({ year: y, monthsData: years[y] }));

    return { currentYearMonths: monthsArr, pastYears: pastYearsArr, currentYear: cy };
  }, [sessions]);

  if (loading) {
    return <Skeleton variant="list-item" count={3} />;
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Dumbbell}
        title={t('progress.overview.noWorkoutsYet')}
        description={t('progress.overview.noWorkoutsHint')}
      />
    );
  }

  const currentMonth = new Date().getMonth();

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6B7280] mb-2">
        {t('progress.overview.workoutHistory', { year: currentYear })}
      </p>

      {/* Current year months */}
      {currentYearMonths.map(({ monthIdx, sessions: monthSessions }) => {
        const isActive = monthIdx === currentMonth;
        if (monthSessions.length === 0) {
          // Empty month — show as disabled row
          return (
            <div key={monthIdx} className="flex items-center gap-2 py-2 opacity-40">
              <ChevronRight size={14} className="text-[#4B5563]" />
              <p className="text-[12px] font-semibold text-[#4B5563] uppercase tracking-[0.12em]">
                {t(`months.${MONTH_KEYS[monthIdx]}`)}
              </p>
              <span className="text-[11px] text-[#4B5563]">—</span>
            </div>
          );
        }
        return (
          <MonthBlock
            key={monthIdx}
            monthLabel={t(`months.${MONTH_KEYS[monthIdx]}`)}
            sessions={monthSessions}
            defaultOpen={isActive}
          />
        );
      })}

      {/* Past years (compressed) */}
      {pastYears.map(({ year, monthsData }) => (
        <YearBlock key={year} year={year} monthsData={monthsData} />
      ))}
    </div>
  );
}
