import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Trophy, Zap, Activity, BarChart3, ChevronDown, ChevronRight, Clock, Dumbbell, Calendar,
  Apple, Flame, MapPin, Trash2,
} from 'lucide-react';
import MonthlyProgressReport from '../../components/MonthlyProgressReport';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
// recharts removed — using CSS bar chart
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getUserPoints } from '../../lib/rewardsEngine';
import { LevelCard } from '../../components/LevelBadge';
import { ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { format, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
// ChartTooltip removed — using CSS bar chart
import { sanitize } from '../../lib/sanitize';
import { formatStatNumber, statFontSize } from '../../lib/formatStatValue';
import GoalsSection from '../../components/GoalsSection';
import { usePostHog } from '@posthog/react';
import { useCachedState, hasCachedState } from '../../hooks/useCachedState';

export default function ProgressOverview() {
  const { t, i18n } = useTranslation('pages');
  const { user, profile, lifetimePoints: ctxLifetimePoints } = useAuth();
  const navigate = useNavigate();

  // Cache keys are user-scoped so switching accounts doesn't leak data
  const uid = user?.id || 'anon';
  const cacheKey = `progress-overview-${uid}`;

  // Only show the skeleton when we have no cached data — otherwise paint from
  // cache and silently refresh behind the scenes. We treat the week-stats
  // cache entry as the "seen before" sentinel since every successful load
  // writes it.
  const [loading, setLoading] = useState(() => !hasCachedState(`${cacheKey}-week-stats`));
  const [pointsData, setPointsData] = useCachedState(`${cacheKey}-points`, { total_points: 0, lifetime_points: ctxLifetimePoints ?? 0 });
  const [weekStats, setWeekStats] = useCachedState(`${cacheKey}-week-stats`, { sessions: 0, volume: 0, prs: 0 });
  const [volumeChart, setVolumeChart] = useCachedState(`${cacheKey}-volume-chart`, []);
  const [earnedAchievements, setEarnedAchievements] = useCachedState(`${cacheKey}-achievements`, []);
  const [showMonthlyReport, setShowMonthlyReport] = useState(false);
  const [weeklyCardio, setWeeklyCardio] = useCachedState(`${cacheKey}-weekly-cardio`, { minutes: 0, distance: 0, calories: 0, hasData: false });

  // Sync lifetime points from context when it loads
  useEffect(() => { if (ctxLifetimePoints != null) setPointsData(prev => ({ ...prev, lifetime_points: ctxLifetimePoints })); }, [ctxLifetimePoints]);

  // Refresh trigger — bumped on visibility/focus to bust the cardio cache so
  // newly logged cardio distance/calories reflects without a hard reload.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const onFocus = () => setRefreshKey(k => k + 1);
    const onVisibility = () => { if (document.visibilityState === 'visible') setRefreshKey(k => k + 1); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      // Only show the skeleton on the very first load for this user — if we
      // already have cached data from a previous mount, paint it immediately
      // and revalidate silently.
      if (!hasCachedState(`${cacheKey}-week-stats`)) setLoading(true);

      // Date range for "this week"
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

      // allSettled so one bad query (e.g. a missing column) can't blank the
      // whole page — the cards just render zeros for the failing slot.
      const settled = await Promise.allSettled([
        getUserPoints(user.id),
        // This week's completed lifting sessions
        supabase
          .from('workout_sessions')
          .select('id, total_volume_lbs, completed_at')
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
        // This week's cardio sessions (counted toward Sessions stat + cardio summary)
        supabase
          .from('cardio_sessions')
          .select('id, started_at, duration_seconds, distance_km, calories_burned')
          .eq('profile_id', user.id)
          .gte('started_at', weekStart.toISOString())
          .lte('started_at', weekEnd.toISOString()),
        // This week's PRs — pull straight from personal_records so the count
        // matches the Strength tab + lifetime stat instead of relying on the
        // is_pr flag inside session_sets (which can drift if a PR was deleted).
        supabase
          .from('personal_records')
          .select('id', { count: 'exact', head: true })
          .eq('profile_id', user.id)
          .gte('achieved_at', weekStart.toISOString())
          .lte('achieved_at', weekEnd.toISOString()),
      ]);

      if (cancelled) return;

      // Helper: pull the resolved value or fall back to a default
      const valueOf = (idx, fallback) => settled[idx].status === 'fulfilled'
        ? settled[idx].value
        : fallback;
      const pts             = valueOf(0, { total_points: 0, lifetime_points: 0 });
      const weekSessions    = valueOf(1, { data: [] });
      const volumeData      = valueOf(2, { data: [] });
      const achievementData = valueOf(3, { count: 0 });
      const streakData      = valueOf(4, { data: null });
      const prCountData     = valueOf(5, { count: 0 });
      const friendCountData = valueOf(6, { count: 0 });
      const totalVolumeData = valueOf(7, { data: [] });
      const weekCardioData  = valueOf(8, { data: [] });
      const weekPRsData     = valueOf(9, { count: 0 });

      setPointsData(pts);

      // Top stats card uses LIFETIME totals (matches the Profile page strip:
      // workouts / volume / records). The previous week-scoped variant looked
      // empty for casual users and was the source of the "stats don't show"
      // complaint. We reuse the existing lifetime queries below so we don't
      // need extra round trips.
      const totalSessions  = achievementData?.count ?? 0;
      const totalPRs       = prCountData?.count ?? 0;
      const totalVolumeLbs = (totalVolumeData?.data ?? [])
        .reduce((sum, s) => sum + (parseFloat(s.total_volume_lbs) || 0), 0);
      setWeekStats({ sessions: totalSessions, volume: totalVolumeLbs, prs: totalPRs });

      // Volume chart — group by week
      const volRaw = volumeData?.data ?? [];
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

      // Achievements — compute earned ones (uses the lifetime totals above)
      const currentStreak = streakData?.data?.current_streak_days ?? 0;
      const friendCount = friendCountData?.count ?? 0;
      const achieveData = { totalSessions, currentStreak, totalPRs, friendCount, sessionsInFirst6Weeks: 0, challengesCompleted: 0, totalVolumeLbs };
      const earned = ACHIEVEMENT_DEFS.filter(a => a.check(achieveData));
      setEarnedAchievements(earned.slice(-3));

      // Weekly cardio stats
      const cardioRows = weekCardioData?.data ?? [];
      if (cardioRows.length > 0) {
        const cardioMinutes = Math.round(cardioRows.reduce((s, r) => s + (r.duration_seconds || 0), 0) / 60);
        const cardioDistance = cardioRows.reduce((s, r) => s + (parseFloat(r.distance_km) || 0), 0);
        const cardioCals = cardioRows.reduce((s, r) => s + (r.calories_burned || 0), 0);
        const next = { minutes: cardioMinutes, distance: Math.round(cardioDistance * 10) / 10, calories: cardioCals, hasData: true };
        setWeeklyCardio(next);
      } else {
        setWeeklyCardio({ minutes: 0, distance: 0, calories: 0, hasData: false });
      }

      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [user?.id, refreshKey]);

  // Sparkline data — normalized 0..1 arrays for last 7 data points
  // Must be before early return so hook count is stable
  const sparkFromChart = useMemo(() => {
    const vols = volumeChart.map(d => d.volume);
    const last7 = vols.slice(-7);
    while (last7.length < 7) last7.unshift(0);
    const max = Math.max(...last7, 1);
    return last7.map(v => v / max);
  }, [volumeChart]);

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

  const TU_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
  const TU_ACCENT = 'var(--color-accent, #2EC4C4)';

  // Show the welcome / "first session" banner only when the account is
  // genuinely brand new: hasn't completed onboarding, hasn't earned any
  // lifetime points, no week activity, no 8-week volume history. Without the
  // onboarding + lifetime gates the banner re-appeared after a quiet week
  // (or whenever one of the parallel queries silently returned zero), which
  // looked like a bug to anyone who'd already finished onboarding.
  const lifetimePts = ctxLifetimePoints ?? pointsData.lifetime_points ?? 0;
  const isOnboarded = profile?.is_onboarded === true;
  const isNewUser = !isOnboarded
    && lifetimePts === 0
    && weekStats.sessions === 0
    && volumeChart.length === 0;

  // For sessions/PRs we don't have per-week breakdown readily, so show volume spark for all
  const sparkSessions = sparkFromChart;
  const sparkVolume = sparkFromChart;
  const sparkPRs = sparkFromChart.map(() => 0); // PRs don't have weekly chart data

  return (
    <div className="flex flex-col gap-5">
      {/* Level card with Report inside */}
      <LevelCard
        totalPoints={pointsData.total_points}
        lifetimePoints={pointsData.lifetime_points}
        onReport={() => setShowMonthlyReport(true)}
      />

      {/* Onboarding checklist for new users */}
      {isNewUser && (
        <div className="rounded-[22px] overflow-hidden" style={{ background: `${TU_ACCENT}08`, border: `1px solid ${TU_ACCENT}18` }}>
          <div className="px-5 pt-5 pb-4">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: TU_ACCENT, letterSpacing: '0.1em' }}>
              {t('progress.overview.welcomeLabel', 'Welcome to Progress')}
            </div>
            <div style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.5, lineHeight: 1.2 }}>
              {t('progress.overview.welcomeTitle', 'Your first session unlocks your stats')}
            </div>
            <button className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-bold active:scale-95"
              style={{ background: TU_ACCENT, color: 'var(--color-text-on-accent, #001512)' }}
              onClick={() => navigate('/workouts')}>
              {t('progress.overview.startFirstWorkout', 'Start your first workout')} {'\u2192'}
            </button>
          </div>
        </div>
      )}

      {isNewUser && (
        <div className="rounded-[22px] p-5" style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
            {t('progress.overview.getStarted', 'Get started')}
          </div>
          <div className="flex flex-col gap-1">
            {[
              { label: t('progress.overview.checkSetUpProfile', 'Set up your profile'), done: true, href: '/profile' },
              { label: t('progress.overview.checkLogWorkout', 'Log your first workout'), done: false, cta: t('progress.overview.next', 'NEXT'), href: '/workouts' },
              { label: t('progress.overview.checkSetGoal', 'Set a goal'), done: false, href: '/profile?openGoals=1' },
              { label: t('progress.overview.checkAddBody', 'Add body measurements'), done: false, href: '/progress/body' },
            ].map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { if (item.href) navigate(item.href); }}
                className="flex items-center gap-3 w-full text-left py-2.5 px-1 rounded-xl active:scale-[0.99] transition-transform focus:outline-none"
                style={{ background: 'transparent' }}
              >
                <div className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: item.done ? TU_ACCENT : 'transparent',
                    border: item.done ? 'none' : '1.5px solid var(--color-border-subtle)',
                  }}>
                  {item.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" style={{ stroke: 'var(--color-text-on-accent, #fff)' }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                </div>
                <span className="flex-1 text-[14px] font-medium" style={{
                  color: item.done ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  textDecoration: item.done ? 'line-through' : 'none',
                }}>{item.label}</span>
                {item.cta && <span className="text-[11px] font-bold" style={{ color: TU_ACCENT }}>{item.cta}</span>}
                {!item.done && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-subtle)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lifetime stats — workouts, volume, records (mirrors Profile strip) */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: t('progress.overview.workouts', 'Workouts'), value: weekStats.sessions, sub: weekStats.sessions === 0 ? t('progress.overview.startToday', 'Start today') : '', icon: Activity, color: 'var(--color-accent, #2EC4C4)', spark: sparkSessions },
          { label: t('progress.overview.volume', 'Volume'), value: weekStats.volume > 0 ? `${volFormatted}` : '\u2014', unit: weekStats.volume > 0 ? 'lbs' : 'lbs', sub: weekStats.volume === 0 ? t('progress.overview.log1set', 'Log 1 set') : '', icon: Zap, color: '#6D5FDB', spark: sparkVolume },
          { label: t('progress.overview.records', 'Records'), value: weekStats.prs, sub: weekStats.prs === 0 ? t('progress.overview.beatALift', 'Beat a lift') : '', icon: Trophy, color: '#FF5A2E', spark: sparkPRs },
        ].map(({ label, value, unit, sub, icon: Icon, color, spark }) => {
          const allZero = spark.every(v => v === 0);
          return (
            <div key={label} className="rounded-[22px] p-3.5 flex flex-col items-center text-center gap-1"
              style={{ background: 'var(--color-bg-card)', boxShadow: 'var(--color-shadow-card, 0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05))' }}>
              <Icon size={14} style={{ color }} strokeWidth={2} />
              <div className="flex items-baseline justify-center gap-1 mt-1.5">
                <p style={{ fontFamily: TU_DISPLAY, fontSize: 26, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.8, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {typeof value === 'number' ? formatStatNumber(value) : value}
                </p>
                {unit && <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>{unit}</span>}
              </div>
              <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em', marginTop: 2 }}>{label}</p>
              {/* Sparkline mini-bars */}
              <div className="flex items-end justify-center gap-[2px] mt-2 w-full" style={{ height: 18 }}>
                {allZero ? (
                  <p className="text-[9px] font-semibold" style={{ color: 'var(--color-text-subtle)' }}>{sub}</p>
                ) : spark.map((v, i) => (
                  <div key={i} className="flex-1 rounded-[2px]"
                    style={{ height: `${Math.max(v * 100, 4)}%`, background: color, opacity: 0.5 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cardio This Week */}
      {weeklyCardio.hasData && (
        <div className="rounded-[22px] p-[18px]" style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05)' }}>
          <p style={{ fontFamily: TU_DISPLAY, fontSize: 16, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3, marginBottom: 12 }}>{t('progress.overview.cardioThisWeek')}</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('progress.overview.cardioTime'), value: weeklyCardio.minutes, unit: t('progress.overview.cardioMin'), icon: Clock, color: 'var(--color-blue-soft)' },
              { label: t('progress.overview.cardioDistance'), value: weeklyCardio.distance > 0 ? weeklyCardio.distance : '--', unit: weeklyCardio.distance > 0 ? t('progress.overview.cardioKm') : '', icon: MapPin, color: 'var(--color-success)' },
              { label: t('progress.overview.cardioCals'), value: weeklyCardio.calories, unit: t('progress.overview.cardioKcal'), icon: Flame, color: 'var(--color-danger)' },
            ].map(({ label, value, unit, icon: Icon, color }) => (
              <div key={label} className="flex flex-col items-center gap-1 text-center">
                <Icon size={14} style={{ color }} strokeWidth={2} />
                <p style={{ fontFamily: TU_DISPLAY, fontSize: 20, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {value}{unit ? <span className="text-[10px] font-semibold ml-0.5" style={{ color: 'var(--color-text-muted)' }}>{unit}</span> : null}
                </p>
                <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Goals Section */}
      <GoalsSection />

      {/* Weekly volume — CSS bar chart with tap-to-reveal value */}
      {volumeChart.length >= 2 && (
        <WeeklyVolumeBarChart volumeChart={volumeChart} />
      )}

      {/* Nutrition Impact Insight */}
      <NutritionImpactCard userId={user?.id} />

      {/* Workout History */}
      <MonthlyTimeline userId={user?.id} />

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

// ── Weekly Volume Bar Chart (tap-to-reveal value) ──────────────────────────
function WeeklyVolumeBarChart({ volumeChart }) {
  const { t } = useTranslation('pages');
  const last7 = volumeChart.slice(-7);
  const maxVol = Math.max(...last7.map(d => d.volume), 1);
  const TU_DISPLAY_LOCAL = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
  const TU_ACCENT_LOCAL = 'var(--color-accent, #2EC4C4)';
  // Default-select the most recent bar so the value is always visible.
  const [activeIdx, setActiveIdx] = useState(last7.length - 1);

  // Keep activeIdx valid when data array length changes.
  useEffect(() => {
    setActiveIdx(prev => {
      if (prev >= last7.length) return last7.length - 1;
      if (prev < 0) return last7.length - 1;
      return prev;
    });
  }, [last7.length]);

  const active = last7[activeIdx];
  const activeVol = active?.volume ?? 0;
  const activeVolStr = activeVol >= 1000
    ? `${(activeVol / 1000).toFixed(1)}k`
    : `${Math.round(activeVol)}`;

  return (
    <div>
      <div className="px-1 mb-2.5 flex items-baseline justify-between">
        <p style={{ fontFamily: TU_DISPLAY_LOCAL, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
          {t('progress.overview.weeklyVolume')}
        </p>
        {active && (
          <p className="text-[12px] font-bold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
            <span style={{ color: 'var(--color-text-primary)' }}>{activeVolStr}</span>{' '}
            <span style={{ color: 'var(--color-text-subtle)' }}>lbs · {activeIdx === last7.length - 1 ? t('progress.overview.now', 'NOW') : active.week}</span>
          </p>
        )}
      </div>
      <div className="rounded-[22px] p-[18px]" style={{ background: 'var(--color-bg-card)', boxShadow: 'var(--color-shadow-card, 0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05))' }}>
        <div className="flex items-end gap-1.5 mb-2.5" style={{ height: 100 }}>
          {last7.map((d, i) => {
            const pct = d.volume / maxVol;
            const isActive = i === activeIdx;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveIdx(i)}
                aria-label={t('progressOverview.barAriaLabel', { week: d.week, volume: d.volume, defaultValue: '{{week}}: {{volume}} lbs' })}
                aria-pressed={isActive}
                className="flex-1 rounded-[6px] transition-all duration-300 active:scale-95"
                style={{
                  height: `${Math.max(pct * 100, 3)}%`,
                  background: isActive ? TU_ACCENT_LOCAL : `color-mix(in srgb, ${TU_ACCENT_LOCAL} 25%, transparent)`,
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  outline: 'none',
                }}
              />
            );
          })}
        </div>
        <div className="flex justify-between">
          {last7.map((d, i) => {
            const isActive = i === activeIdx;
            const isLast = i === last7.length - 1;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveIdx(i)}
                className="flex-1 text-center text-[10px] font-bold"
                style={{
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-subtle)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  outline: 'none',
                }}
              >
                {isLast ? t('progress.overview.now', 'NOW') : d.week}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Nutrition Impact Card ─────────────────────────────────────────────────
function NutritionImpactCard({ userId }) {
  const { t } = useTranslation('pages');
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const compute = async () => {
      setLoading(true);

      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const [targetsRes, logsRes, sessionsRes] = await Promise.all([
        supabase.from('nutrition_targets').select('daily_calories, daily_protein_g').eq('profile_id', userId).maybeSingle(),
        supabase.from('food_logs').select('log_date, calories, protein_g').eq('profile_id', userId).gte('log_date', format(subDays(new Date(), 30), 'yyyy-MM-dd')),
        supabase.from('workout_sessions').select('completed_at, total_volume_lbs, session_exercises(session_sets(is_pr, is_completed))').eq('profile_id', userId).eq('status', 'completed').gte('completed_at', thirtyDaysAgo).order('completed_at', { ascending: true }),
      ]);

      if (cancelled) return;

      const targets = targetsRes.data;
      const logs = logsRes.data ?? [];
      const sessions = sessionsRes.data ?? [];

      // Aggregate food_logs per day
      const dailyNutrition = {};
      for (const log of logs) {
        if (!dailyNutrition[log.log_date]) dailyNutrition[log.log_date] = { calories: 0, protein: 0 };
        dailyNutrition[log.log_date].calories += parseFloat(log.calories) || 0;
        dailyNutrition[log.log_date].protein += parseFloat(log.protein_g) || 0;
      }

      const nutritionDays = Object.keys(dailyNutrition);

      // Not enough data
      if (nutritionDays.length < 7) {
        setInsight({ type: 'insufficient' });
        setLoading(false);
        return;
      }

      const calTarget = targets?.daily_calories || 2000;
      const proTarget = targets?.daily_protein_g || 120;

      // Build session list with date, volume, PR count
      const sessionsByDate = sessions.map(s => ({
        date: format(new Date(s.completed_at), 'yyyy-MM-dd'),
        volume: parseFloat(s.total_volume_lbs) || 0,
        prs: (s.session_exercises ?? []).flatMap(e => e.session_sets ?? []).filter(set => set.is_pr && set.is_completed).length,
      }));

      // For each nutrition day, find the NEXT workout session (same day or up to 2 days later)
      const proteinHitVolumes = [];
      const proteinMissVolumes = [];
      const calHitVolumes = [];
      const calMissVolumes = [];
      const highProteinPRDays = [];

      for (const day of nutritionDays) {
        const dayDate = new Date(day + 'T12:00:00');
        const nextWorkout = sessionsByDate.find(s => {
          const sDate = new Date(s.date + 'T12:00:00');
          return sDate >= dayDate && sDate <= new Date(dayDate.getTime() + 2 * 86400000);
        });
        if (!nextWorkout) continue;

        const n = dailyNutrition[day];
        if (n.protein >= proTarget) {
          proteinHitVolumes.push(nextWorkout.volume);
          if (nextWorkout.prs > 0) highProteinPRDays.push(Math.round(n.protein));
        } else {
          proteinMissVolumes.push(nextWorkout.volume);
        }

        if (n.calories >= calTarget) {
          calHitVolumes.push(nextWorkout.volume);
        } else {
          calMissVolumes.push(nextWorkout.volume);
        }
      }

      const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const results = [];

      if (proteinHitVolumes.length >= 2 && proteinMissVolumes.length >= 2) {
        const hitAvg = avg(proteinHitVolumes);
        const missAvg = avg(proteinMissVolumes);
        if (missAvg > 0) {
          const pctDiff = Math.round(((hitAvg - missAvg) / missAvg) * 100);
          if (pctDiff > 0) results.push({ key: 'proteinVolume', pct: pctDiff });
        }
      }

      if (calHitVolumes.length >= 2 && calMissVolumes.length >= 2) {
        const hitAvg = avg(calHitVolumes);
        const missAvg = avg(calMissVolumes);
        if (missAvg > 0) {
          const pctDiff = Math.round(((hitAvg - missAvg) / missAvg) * 100);
          if (pctDiff > 0) results.push({ key: 'calorieVolume', pct: pctDiff });
        }
      }

      if (highProteinPRDays.length >= 2) {
        const avgPro = Math.round(avg(highProteinPRDays.map(Number)));
        results.push({ key: 'prProtein', grams: avgPro });
      }

      setInsight(results.length > 0 ? { type: 'data', results } : { type: 'noCorrelation' });
      setLoading(false);
    };

    compute();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading || !insight) return null;

  if (insight.type === 'insufficient') {
    return (
      <div className="rounded-[22px] p-4 flex items-start gap-3"
        style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.04)' }}>
        <Apple size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#10B981' }} strokeWidth={2} />
        <div>
          <p className="text-[13px] font-bold mb-0.5" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.1 }}>{t('progress.overview.nutritionImpact')}</p>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{t('progress.overview.nutritionInsufficient')}</p>
        </div>
      </div>
    );
  }

  if (insight.type === 'noCorrelation') return null;

  return (
    <div className="rounded-[22px] p-4"
      style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.04)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Apple size={14} style={{ color: '#10B981' }} strokeWidth={2} />
        <p className="text-[13px] font-bold" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.1 }}>{t('progress.overview.nutritionImpact')}</p>
      </div>
      <div className="flex flex-col gap-2">
        {insight.results.map((r) => (
          <div key={r.key} className="flex items-start gap-2.5 rounded-[14px] px-3.5 py-3"
            style={{ background: 'color-mix(in srgb, #10B981 8%, transparent)', border: '1px solid color-mix(in srgb, #10B981 15%, transparent)' }}>
            <Zap size={12} className="flex-shrink-0 mt-0.5" style={{ color: '#10B981' }} strokeWidth={2} />
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {r.key === 'proteinVolume' && t('progress.overview.proteinVolumeInsight', { pct: r.pct })}
              {r.key === 'calorieVolume' && t('progress.overview.calorieVolumeInsight', { pct: r.pct })}
              {r.key === 'prProtein' && t('progress.overview.prProteinInsight', { grams: r.grams })}
            </p>
          </div>
        ))}
      </div>
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

// ── Design tokens (shared by timeline components) ────────────────────────
const TL_DISPLAY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';
const TL_ACCENT = 'var(--color-accent, #2EC4C4)';

// ── Compact Session Row ──────────────────────────────────────────────────
function SessionRow({ session, onDelete }) {
  const { t, i18n } = useTranslation('pages');
  const [expanded, setExpanded] = useState(false);
  const exercises = session.session_exercises ?? [];
  const allSets = exercises.flatMap(e => e.session_sets ?? []).filter(s => s.is_completed);
  const prCount = allSets.filter(s => s.is_pr).length;
  const vol = parseFloat(session.total_volume_lbs) || 0;
  const volStr = vol >= 1000 ? `${(vol / 1000).toFixed(1)}k` : `${Math.round(vol)}`;

  return (
    <div className="relative rounded-[18px] overflow-hidden"
      style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.04)' }}>
      <button
        className="w-full text-left px-4 pr-10 py-3.5 flex items-start gap-3 focus:outline-none rounded-[18px]"
        onClick={() => setExpanded(e => !e)}
        aria-label={`Toggle details for ${sanitize(session.name)}`}
      >
        <div className="flex-shrink-0 w-10 text-center pt-0.5">
          <p className="text-[9px] font-bold uppercase" style={{ color: TL_ACCENT, letterSpacing: '0.08em' }}>
            {new Date(session.completed_at).toLocaleDateString(i18n.language === 'es' ? 'es-ES' : 'en-US', { month: 'short' })}
          </p>
          <p style={{ fontFamily: TL_DISPLAY, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {new Date(session.completed_at).getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[14px] leading-tight truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
            {sanitize(session.name)}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={10} strokeWidth={2} /> {formatDuration(session.duration_seconds)}
            </span>
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <Zap size={10} strokeWidth={2} /> {volStr} lbs
            </span>
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <Dumbbell size={10} strokeWidth={2} /> {exercises.length}
            </span>
            {prCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: '#FF5A2E' }}>
                <Trophy size={10} strokeWidth={2} /> {prCount} PR{prCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={15}
          className="flex-shrink-0 mt-1 transition-transform duration-200"
          strokeWidth={2}
          style={{
            color: 'var(--color-text-subtle)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(session.id, session.name); }}
          className="absolute top-3 right-2 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
          style={{ color: '#EF4444' }}
          aria-label={t('dashboard.deleteSession', 'Delete session')}
        >
          <Trash2 size={13} />
        </button>
      )}
      {expanded && (
        <div className="px-4 pb-3.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <div className="pt-3 flex flex-col gap-3">
            {exercises
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              .map(ex => {
                const completedSets = (ex.session_sets ?? []).filter(s => s.is_completed);
                const hasPR = completedSets.some(s => s.is_pr);
                return (
                  <div key={ex.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="font-bold text-[12px]" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.1 }}>{sanitize(ex.snapshot_name)}</p>
                      {hasPR && <Trophy size={11} style={{ color: '#FF5A2E' }} strokeWidth={2} />}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {completedSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map(set => (
                          <div
                            key={`${set.set_number}-${set.weight_lbs}-${set.reps}`}
                            className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                            style={
                              set.is_pr
                                ? { background: `color-mix(in srgb, ${TL_ACCENT} 12%, transparent)`, color: TL_ACCENT, border: `1px solid color-mix(in srgb, ${TL_ACCENT} 25%, transparent)` }
                                : { background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
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

// ── Cardio Session Row ──────────────────────────────────────────────────
function CardioSessionRow({ session }) {
  const { t, i18n } = useTranslation('pages');
  const navigate = useNavigate();
  const dur = formatDuration(session.duration_seconds);
  const dist = session.distance_km ? `${parseFloat(session.distance_km).toFixed(1)} km` : null;
  const cals = session.calories_burned ? `${session.calories_burned} kcal` : null;
  const typeLabel = t(`cardio.types.${session.cardio_type}`, session.cardio_type.replace(/_/g, ' '));

  return (
    <div
      onClick={() => navigate(`/cardio/${session.id}`)}
      className="relative rounded-[18px] overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
      style={{ background: 'var(--color-bg-card)', boxShadow: '0 1px 2px rgba(15,20,25,0.04), 0 4px 12px rgba(15,20,25,0.04)' }}
    >
      <div className="w-full text-left px-4 py-3.5 flex items-start gap-3">
        <div className="flex-shrink-0 w-10 text-center pt-0.5">
          <p className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-success)', letterSpacing: '0.08em' }}>
            {new Date(session.completed_at).toLocaleDateString(i18n.language === 'es' ? 'es-ES' : 'en-US', { month: 'short' })}
          </p>
          <p style={{ fontFamily: TL_DISPLAY, fontSize: 22, fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {new Date(session.completed_at).getDate()}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Activity size={13} style={{ color: 'var(--color-success)' }} strokeWidth={2} />
            <p className="font-bold text-[14px] leading-tight truncate" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
              {typeLabel}
            </p>
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              <Clock size={10} strokeWidth={2} /> {dur}
            </span>
            {dist && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                <MapPin size={10} strokeWidth={2} /> {dist}
              </span>
            )}
            {cals && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                <Flame size={10} strokeWidth={2} /> {cals}
              </span>
            )}
            {session.intensity && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                style={{ background: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}>
                {session.intensity}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Month Block ──────────────────────────────────────────────────────────
function MonthBlock({ monthLabel, sessions, defaultOpen, onDelete }) {
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
        className="flex items-center gap-2 w-full text-left py-2.5 group"
      >
        <div className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
          <ChevronDown size={13} style={{ color: 'var(--color-text-subtle)' }} strokeWidth={2.2} />
        </div>
        <p className="text-[12px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
          {monthLabel}
        </p>
        <span className="text-[11px] font-semibold ml-1 tabular-nums" style={{ color: 'var(--color-text-subtle)' }}>
          {t('progress.overview.sessions_count', { count: sessions.length })}
        </span>
      </button>
      {open && (
        <div className="ml-1 pl-4" style={{ borderLeft: '1.5px solid var(--color-border-subtle)' }}>
          <div className="flex flex-col gap-2.5 pt-1 pb-3">
            {visible.map(s => s._type === 'cardio'
              ? <CardioSessionRow key={s.id} session={s} />
              : <SessionRow key={s.id} session={s} onDelete={onDelete} />
            )}
          </div>
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-[12px] font-bold transition-colors pb-3 pl-1"
              style={{ color: TL_ACCENT }}
            >
              {t('progress.overview.showMore', { count: sessions.length - 5 })}
            </button>
          )}
          {hasMore && showAll && (
            <button
              onClick={() => setShowAll(false)}
              className="text-[12px] font-semibold transition-colors pb-3 pl-1"
              style={{ color: 'var(--color-text-muted)' }}
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
function YearBlock({ year, monthsData, onDelete }) {
  const { t } = useTranslation('pages');
  const [open, setOpen] = useState(false);
  const totalSessions = Object.values(monthsData).reduce((sum, arr) => sum + arr.length, 0);

  const sortedMonths = Object.keys(monthsData).sort((a, b) => b - a);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left py-2.5 group"
      >
        <div className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>
          <ChevronDown size={15} style={{ color: 'var(--color-text-subtle)' }} strokeWidth={2} />
        </div>
        <Calendar size={14} style={{ color: TL_ACCENT }} strokeWidth={2} />
        <p style={{ fontFamily: TL_DISPLAY, fontSize: 15, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
          {year}
        </p>
        <span className="text-[12px] font-semibold ml-1 tabular-nums" style={{ color: 'var(--color-text-subtle)' }}>
          {t('progress.overview.sessions_count', { count: totalSessions })}
        </span>
      </button>
      {open && (
        <div className="ml-2 pl-4 flex flex-col gap-1 pt-1 pb-2" style={{ borderLeft: '1.5px solid var(--color-border-subtle)' }}>
          {sortedMonths.map(monthIdx => (
            <MonthBlock
              key={monthIdx}
              monthLabel={t(`months.${MONTH_KEYS[monthIdx]}`)}
              sessions={monthsData[monthIdx]}
              onDelete={onDelete}
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
  const { showToast } = useToast();
  const timelineCacheKey = `progress-overview-timeline-${userId || 'anon'}`;
  const [sessions, setSessions] = useCachedState(timelineCacheKey, []);
  // Only show skeleton if we've never loaded this timeline before
  const [loading, setLoading] = useState(() => !hasCachedState(timelineCacheKey));
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const handleDeleteSession = async () => {
    if (!deleteConfirm) return;
    const { error } = await supabase.from('workout_sessions').delete().eq('id', deleteConfirm.id);
    if (error) {
      showToast(t('dashboard.deleteError', 'Failed to delete'), 'error');
    } else {
      showToast(t('dashboard.sessionDeleted', 'Session deleted'), 'success');
      setSessions(prev => prev.filter(s => s.id !== deleteConfirm.id));
    }
    setDeleteConfirm(null);
  };

  const onDelete = (id, name) => setDeleteConfirm({ id, name });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const load = async () => {
      // Only show skeleton if there's no cached timeline — otherwise revalidate silently
      if (!hasCachedState(timelineCacheKey)) setLoading(true);
      const [workoutRes, cardioRes] = await Promise.all([
        supabase
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
          .order('completed_at', { ascending: false }),
        supabase
          .from('cardio_sessions')
          .select('id, cardio_type, started_at, duration_seconds, distance_km, calories_burned, intensity')
          .eq('profile_id', userId)
          .order('started_at', { ascending: false }),
      ]);

      if (!cancelled) {
        // workoutRes.error is silently ignored — UI gracefully handles missing data
        // Normalize cardio sessions to share the same shape keys used for grouping
        const cardioSessions = (cardioRes.data ?? []).map(c => ({
          ...c,
          completed_at: c.started_at,
          _type: 'cardio',
        }));
        const workoutSessions = (workoutRes.data ?? []).map(w => ({ ...w, _type: 'workout' }));
        // Merge and sort descending by completed_at
        const merged = [...workoutSessions, ...cardioSessions]
          .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
        setSessions(merged);
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
      <div className="flex items-center gap-2 mb-3 px-1">
        <BarChart3 size={15} style={{ color: TL_ACCENT }} strokeWidth={2} />
        <p style={{ fontFamily: TL_DISPLAY, fontSize: 17, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3 }}>
          {t('progress.overview.workoutHistory', { year: currentYear })}
        </p>
      </div>

      {/* Current year months */}
      {currentYearMonths.map(({ monthIdx, sessions: monthSessions }) => {
        const isActive = monthIdx === currentMonth;
        if (monthSessions.length === 0) {
          return (
            <div key={monthIdx} className="flex items-center gap-2 py-2 opacity-35">
              <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} strokeWidth={2} />
              <p className="text-[12px] font-bold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.1em' }}>
                {t(`months.${MONTH_KEYS[monthIdx]}`)}
              </p>
              <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{'\u2014'}</span>
            </div>
          );
        }
        return (
          <MonthBlock
            key={monthIdx}
            monthLabel={t(`months.${MONTH_KEYS[monthIdx]}`)}
            sessions={monthSessions}
            defaultOpen={isActive}
            onDelete={onDelete}
          />
        );
      })}

      {/* Past years (compressed) */}
      {pastYears.map(({ year, monthsData }) => (
        <YearBlock key={year} year={year} monthsData={monthsData} onDelete={onDelete} />
      ))}

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center px-6"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-[22px] p-6"
              style={{ background: 'var(--color-bg-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
            >
              <p style={{ fontFamily: TL_DISPLAY, fontSize: 18, fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: -0.3, marginBottom: 8 }}>
                {t('dashboard.deleteSessionTitle', 'Delete session?')}
              </p>
              <p className="text-[13px] mb-1" style={{ color: 'var(--color-text-muted)' }}>
                <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{deleteConfirm.name}</span>
              </p>
              <p className="text-[12px] mb-5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                {t('dashboard.deleteSessionWarning', 'This will permanently remove this session and all its data. This cannot be undone.')}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-3 rounded-2xl text-[13px] font-bold transition-colors active:scale-95"
                  style={{ background: 'var(--color-surface-hover, rgba(0,0,0,0.04))', color: 'var(--color-text-primary)' }}>
                  {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
                </button>
                <button onClick={handleDeleteSession}
                  className="flex-1 py-3 rounded-2xl text-[13px] font-bold transition-colors active:scale-95"
                  style={{ background: '#EF4444', color: '#fff' }}>
                  {t('dashboard.deleteConfirm', 'Delete')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
