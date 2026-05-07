import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, AlertTriangle, ChevronRight, Activity,
  UserPlus, Clock, RefreshCw, CalendarCheck, Dumbbell,
  CheckCircle, KeyRound, MessageSquare, BookOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subDays, startOfMonth, formatDistanceToNow } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared admin components
import { FadeIn, StatCard, AdminCard, CardSkeleton, Avatar, AdminPageShell, PageHeader, AdminModal } from '../../components/admin';

// Sub-components (kept)
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';

// ── Helpers ──────────────────────────────────────────────
import { getRiskTier } from '../../lib/churnScore';
import { translateSignal } from '../../lib/churn/signalI18n';

// ── Data fetching function ────────────────────────────────
async function fetchOverviewData(gymId) {
  const now = new Date();
  const twentyEightDaysAgo = subDays(now, 28).toISOString();
  const fortyEightHoursAgo = subDays(now, 2).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [
    membersRes, sessionsRes, churnScoresRes,
    notOnboardedRes, checkInsRes,
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name, username, role, created_at, gym_id, last_active_at, membership_status, avatar_url').eq('gym_id', gymId).eq('role', 'member').limit(2000),
    supabase.from('workout_sessions').select('profile_id, started_at, total_volume_lbs').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', twentyEightDaysAgo).order('started_at', { ascending: false }).limit(1000),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier, key_signals, computed_at').eq('gym_id', gymId).order('score', { ascending: false }).limit(2000),
    supabase.from('profiles').select('id').eq('gym_id', gymId).eq('role', 'member').eq('is_onboarded', false).gte('created_at', fortyEightHoursAgo).limit(500),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', subDays(now, 30).toISOString()).order('checked_in_at', { ascending: false }).limit(1000),
  ]);

  const { data: todayCheckins, error: todayCheckinsErr } = await supabase
    .from('check_ins').select('id, profile_id, checked_in_at')
    .eq('gym_id', gymId).gte('checked_in_at', todayStart)
    .order('checked_in_at', { ascending: false }).limit(500);
  if (todayCheckinsErr) logger.error('AdminOverview todayCheckins:', todayCheckinsErr);

  // Fetch today's classes count (gym_classes with a schedule matching today's day_of_week OR specific_date)
  const todayDow = now.getDay(); // 0=Sun
  const todayDate = format(now, 'yyyy-MM-dd');
  const { data: classSchedules, error: classSchedulesErr } = await supabase
    .from('gym_class_schedules')
    .select('id, gym_class:gym_classes!inner(id, gym_id, is_active)')
    .eq('gym_class.gym_id', gymId)
    .eq('gym_class.is_active', true)
    .or(`day_of_week.eq.${todayDow},specific_date.eq.${todayDate}`)
    .limit(200);
  if (classSchedulesErr) logger.error('AdminOverview classSchedules:', classSchedulesErr);

  // Log errors
  [membersRes, sessionsRes, churnScoresRes, notOnboardedRes, checkInsRes]
    .forEach((res, i) => { if (res.error) logger.error(`AdminOverview fetch ${i}:`, res.error); });

  // Critical query guard
  if (membersRes.error) throw new Error(`Failed to load members: ${membersRes.error.message}`);
  if (sessionsRes.error) throw new Error(`Failed to load sessions: ${sessionsRes.error.message}`);

  const members = membersRes.data || [];
  const sessions = sessionsRes.data || [];
  const churnScores = churnScoresRes.data || [];
  const checkIns = checkInsRes.data || [];

  // De-duplicate churn scores
  const latestScoreMap = {};
  churnScores.forEach(row => {
    if (!latestScoreMap[row.profile_id] || new Date(row.computed_at) > new Date(latestScoreMap[row.profile_id].computed_at)) {
      latestScoreMap[row.profile_id] = row;
    }
  });

  // Build session counts for fallback scoring
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const sessionsLast14 = {};
  const lastSessionAt = {};
  sessions.forEach(s => {
    if (s.started_at >= fourteenDaysAgo) sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
    if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) lastSessionAt[s.profile_id] = s.started_at;
  });

  // Fallback score estimator
  const estimateScore = (daysInactive, recentWorkouts, neverActive) => {
    let score;
    if (neverActive || daysInactive > 30) score = 95;
    else if (daysInactive > 14) score = recentWorkouts === 0 ? 85 : 70;
    else if (daysInactive > 7) score = recentWorkouts === 0 ? 45 : 30;
    else score = Math.max(0, 20 - recentWorkouts * 5);
    score = Math.min(100, Math.max(0, score));
    // Thresholds aligned with churn engine (lib/churn/riskScoring.js): 80 / 55 / 30
    const risk_tier = score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'medium' : 'low';
    const key_signals = [];
    // Note: signal strings are stored in raw English form here so that translateSignal()
    // (lib/churn/signalI18n.js) can map them to admin.churnSignals.* i18n keys at render time.
    if (neverActive) key_signals.push('Never logged a workout');
    else if (daysInactive > 30) key_signals.push('No activity in 30+ days');
    else if (daysInactive > 14) key_signals.push('No activity in 14+ days');
    if (recentWorkouts === 0 && !neverActive) key_signals.push('No workouts in last 14 days');
    return { score, risk_tier, key_signals };
  };

  // Build member lookup
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });

  // Merge DB scores with fallback estimates
  const nowMs = Date.now();
  // daysInactive helper — falls back to 0 when the source date is missing/invalid,
  // and uses Math.max so DST shifts can't ever produce a negative day count.
  const daysSince = (iso) => {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.max(0, Math.floor((nowMs - t) / 86400000));
  };
  const allMemberScores = members.map(m => {
    const dbRow = latestScoreMap[m.id];
    const lastSeenAt = m.last_active_at || lastSessionAt[m.id] || null;
    const neverActive = !lastSeenAt;
    const daysInactive = lastSeenAt ? daysSince(lastSeenAt) : daysSince(m.created_at);
    const recentWorkouts = sessionsLast14[m.id] ?? 0;

    if (dbRow) {
      return { ...m, score: dbRow.score, risk_tier: dbRow.risk_tier, key_signals: dbRow.key_signals, daysInactive, neverActive };
    }
    const fb = estimateScore(daysInactive, recentWorkouts, neverActive);
    return { ...m, score: fb.score, risk_tier: fb.risk_tier, key_signals: fb.key_signals, daysInactive, neverActive };
  });

  // Risk tiers
  const riskTiers = { critical: 0, high: 0, medium: 0, low: 0 };
  allMemberScores.forEach(m => { if (riskTiers[m.risk_tier] !== undefined) riskTiers[m.risk_tier]++; });

  // At-risk members (top 5 for watchlist)
  const atRisk = allMemberScores
    .filter(m => m.risk_tier === 'critical' || m.risk_tier === 'high')
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Stats
  const total = members.length;
  const checkedInIds = new Set(checkIns.map(c => c.profile_id));

  // New members this month
  const monthStart = startOfMonth(now).toISOString();
  const newMembersMonth = members.filter(m => m.created_at >= monthStart).length;

  // Active this week
  const sevenDaysAgo = subDays(now, 7).toISOString();
  const activeThisWeekIds = new Set();
  sessions.forEach(s => {
    if (s.started_at >= sevenDaysAgo) activeThisWeekIds.add(s.profile_id);
  });

  // Check-in average (last 30 days, daily average)
  const checkInDayCounts = {};
  checkIns.forEach(c => {
    const d = format(new Date(c.checked_in_at), 'yyyy-MM-dd');
    checkInDayCounts[d] = (checkInDayCounts[d] || 0) + 1;
  });
  const dayCountValues = Object.values(checkInDayCounts);
  const avgDailyCheckins = dayCountValues.length > 0
    ? Math.round(dayCountValues.reduce((s, v) => s + v, 0) / dayCountValues.length)
    : 0;

  // Recent activity feed: checkins + workouts + new signups, sorted by time
  const todayCheckinsData = todayCheckins || [];
  const recentCheckins = todayCheckinsData.slice(0, 10).map(c => ({
    type: 'checkin', profile_id: c.profile_id, timestamp: c.checked_in_at,
    memberName: memberMap[c.profile_id]?.full_name || null,
    avatarUrl: memberMap[c.profile_id]?.avatar_url || null,
  }));
  const recentWorkouts = sessions.slice(0, 10).map(s => ({
    type: 'workout', profile_id: s.profile_id, timestamp: s.started_at,
    memberName: memberMap[s.profile_id]?.full_name || null,
    avatarUrl: memberMap[s.profile_id]?.avatar_url || null,
    total_volume_lbs: s.total_volume_lbs,
  }));
  // New signups (created in last 7 days)
  const recentSignups = members
    .filter(m => m.created_at >= sevenDaysAgo)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map(m => ({
      type: 'signup', profile_id: m.id, timestamp: m.created_at,
      memberName: m.full_name || null,
      avatarUrl: m.avatar_url || null,
    }));

  const recentActivity = [...recentCheckins, ...recentWorkouts, ...recentSignups]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  // Onboarding gaps (members not onboarded in last 48h)
  const onboardingGaps = notOnboardedRes.data || [];

  // Delta: yesterday's check-ins (from the 30-day check-in data)
  const yesterdayStr = format(subDays(now, 1), 'yyyy-MM-dd');
  const checkInsYesterday = checkInDayCounts[yesterdayStr] || 0;

  // Delta: new members last month (for comparison)
  const lastMonthStart = subDays(startOfMonth(now), 1); // last day of prev month
  const prevMonthStart = new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth(), 1).toISOString();
  const prevMonthEnd = startOfMonth(now).toISOString();
  const newMembersPrevMonth = members.filter(m => m.created_at >= prevMonthStart && m.created_at < prevMonthEnd).length;

  return {
    stats: {
      totalMembers: total,
      // Make the two cards mutually exclusive — when crítico = 26 and en
      // riesgo = 27, the previous count was 26 + 1, so it looked like the
      // critical bucket was nested inside at-risk. Now atRiskCount is only
      // the `high` tier; criticalCount is shown separately.
      atRiskCount: riskTiers.high,
      criticalCount: riskTiers.critical,
      checkInsToday: todayCheckinsData.length,
      checkInsYesterday,
      newMembersMonth,
      newMembersPrevMonth,
      activeThisWeek: activeThisWeekIds.size,
      classesToday: new Set((classSchedules || []).map(s => s.gym_class?.id).filter(Boolean)).size,
      avgDailyCheckins,
    },
    riskTiers, atRisk, recentActivity,
    onboardingCount: onboardingGaps.length,
    _dbScoreCount: churnScores.length, _totalMembers: total,
  };
}

// ── Overview Loading Skeleton ─────────────────────────────
function OverviewSkeleton() {
  return (
    <AdminPageShell className="space-y-6">
      <div className="h-8 rounded-lg w-64 animate-pulse" style={{ background: 'var(--color-admin-panel)' }} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 md:gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="admin-card p-3 sm:p-4 md:p-5 h-[80px] md:h-[90px] animate-pulse" />
        ))}
      </div>
      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <CardSkeleton h="h-[360px]" />
        <CardSkeleton h="h-[360px]" />
      </div>
    </AdminPageShell>
  );
}

// ── Alert Banner (compact action-needed indicator) ──────
function AlertBanner({ icon: Icon, text, actionLabel, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left
        transition-all duration-200 hover:brightness-110 hover:translate-x-0.5
        active:scale-[0.995]"
      style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-admin-border)' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          transition-transform duration-200 group-hover:scale-110"
        style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
      >
        <Icon size={14} style={{ color }} />
      </div>
      <p className="flex-1 text-[12.5px] leading-snug" style={{ color: 'var(--color-admin-text)' }}>{text}</p>
      <span
        className="text-[11px] font-semibold flex items-center gap-0.5 flex-shrink-0
          transition-transform duration-200 hover:translate-x-0.5"
        style={{ color }}
      >
        {actionLabel} <ChevronRight size={11} />
      </span>
    </button>
  );
}

// ── Activity Feed Item ──────────────────────────────────
function ActivityItem({ item, dateFnsLocale, t, onClick }) {
  const actionMap = {
    checkin: { label: t('admin.overview.actions.checkin', 'checked in'), color: 'var(--color-coach)', icon: CalendarCheck },
    workout: { label: t('admin.overview.actions.workout', 'completed workout'), color: 'var(--color-info)', icon: Dumbbell },
    signup: { label: t('admin.overview.actions.joined', 'joined'), color: 'var(--color-success)', icon: UserPlus },
  };
  const meta = actionMap[item.type] || actionMap.checkin;
  const Icon = meta.icon;
  const displayName = item.memberName || t('admin.overview.unknownMember', 'Unknown');

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      className="w-full flex items-center gap-3 py-2.5 group -mx-1 px-1 rounded-lg transition-colors duration-150 hover:bg-[color:var(--color-admin-panel)] text-left"
    >
      <div className="relative flex-shrink-0">
        <Avatar name={displayName} size="sm" src={item.avatarUrl} />
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2"
          style={{ background: `color-mix(in srgb, ${meta.color} 20%, transparent)`, borderColor: 'var(--color-bg-card)' }}
        >
          <Icon size={8} style={{ color: meta.color }} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] truncate" style={{ color: 'var(--color-admin-text)' }}>
          <span className="font-medium">{displayName}</span>
          <span className="ml-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{meta.label}</span>
        </p>
      </div>
      <span className="admin-mono text-[10px] flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-150"
        style={{ color: 'var(--color-admin-text-faint)' }}>
        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, ...(dateFnsLocale || {}) })}
      </span>
    </button>
  );
}

// ── Watchlist Row ────────────────────────────────────────
function WatchlistRow({ member, t, onMessage, onClick }) {
  const tier = getRiskTier(member.score);
  return (
    <button
      type="button"
      onClick={() => onClick?.(member)}
      className="w-full flex items-center gap-3 py-2.5 -mx-1 px-1 rounded-lg transition-colors duration-150 hover:bg-[color:var(--color-admin-panel)] text-left"
    >
      <Avatar name={member.full_name} size="sm" src={member.avatar_url} />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--color-admin-text)' }}>{member.full_name}</p>
        <p className="text-[10.5px]" style={{ color: 'var(--color-admin-text-muted)' }}>
          {member.neverActive
            ? t('admin.overview.neverLogged')
            : t('admin.overview.daysInactive', { count: member.daysInactive })}
        </p>
      </div>
      <span
        onClick={(e) => { e.stopPropagation(); onMessage?.(member); }}
        role="button"
        tabIndex={0}
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
          active:scale-95 transition-all duration-150 cursor-pointer"
        style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}
        title={t('admin.overview.navMessages', 'Message')}
      >
        <MessageSquare size={12} style={{ color: 'var(--color-admin-text-sub)' }} />
      </span>
      <span
        className="admin-pill admin-pill--hot admin-mono flex-shrink-0"
      >
        {member.score}%
      </span>
    </button>
  );
}

// ── Delta Indicator Helper ───────────────────────────────
function formatDelta(current, previous, label) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { text: `↑ ${label}`, positive: true };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: `— ${label}`, positive: null };
  return {
    text: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% ${label}`,
    positive: pct > 0,
  };
}

function DeltaSub({ delta, invert = false }) {
  if (!delta) return null;
  const isPositive = invert ? !delta.positive : delta.positive;
  const color = delta.positive === null
    ? 'var(--color-admin-text-muted)'
    : isPositive ? 'var(--color-success)' : 'var(--color-danger)';
  return (
    <span className="admin-mono text-[10.5px] font-medium" style={{ color }}>
      {delta.text}
    </span>
  );
}

// ── Quick Action Button ──────────────────────────────────
function QuickActionButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:translate-y-0"
    >
      <Icon size={12.5} />
      {label}
    </button>
  );
}

export default function AdminOverview() {
  const { profile, gymConfig } = useAuth();
  const navigate = useNavigate();

  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const { t, i18n } = useTranslation('pages');
  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const [resetApprovalId, setResetApprovalId] = useState(null);
  const [activityDetail, setActivityDetail] = useState(null);
  const [watchlistDetail, setWatchlistDetail] = useState(null);

  // Fetch pending password reset requests
  const { data: pendingResets = [], refetch: refetchResets } = useQuery({
    queryKey: [...adminKeys.overview(gymId), 'pending-resets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('password_reset_requests')
        .select('id, profile_id, status, created_at, expires_at, profiles!inner(full_name, username, avatar_url)')
        .eq('gym_id', gymId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return [];
      return data || [];
    },
    enabled: !!gymId,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => { document.title = `${t('admin.overview.pageTitle', 'Admin - Overview')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: adminKeys.overview(gymId),
    queryFn: () => fetchOverviewData(gymId),
    enabled: !!gymId,
    staleTime: 30_000,
  });

  // Auto-trigger server-side churn scoring once when most members lack DB scores
  const churnComputeTriggered = useRef(false);
  useEffect(() => {
    if (!gymId || !data || data._totalMembers === 0 || churnComputeTriggered.current) return;
    if (data._dbScoreCount < data._totalMembers * 0.5) {
      churnComputeTriggered.current = true;
      supabase.rpc('compute_churn_scores', { p_gym_id: gymId })
        .then(({ error }) => {
          if (error) logger.error('Auto compute_churn_scores:', error);
          else refetch();
        });
    }
  }, [gymId, data?._dbScoreCount, data?._totalMembers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard: only admins/super_admins with a valid gym_id
  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger)' }}>{t('admin.overview.accessDenied')}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <AdminPageShell>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-5">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--color-danger-soft)' }}>
            <AlertTriangle size={24} style={{ color: 'var(--color-danger)' }} />
          </div>
          <div className="text-center">
            <p className="text-[15px] font-semibold" style={{ color: 'var(--color-danger)' }}>{t('admin.overview.loadError', 'Failed to load overview data')}</p>
            <p className="text-[12.5px] max-w-md mt-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>{error?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="admin-pill admin-pill--outline flex items-center gap-2"
          >
            <RefreshCw size={13} />
            {t('admin.overview.refresh')}
          </button>
        </div>
      </AdminPageShell>
    );
  }

  if (isLoading || !data) return <OverviewSkeleton />;

  const { stats, atRisk, recentActivity, onboardingCount } = data;
  const classesEnabled = gymConfig?.classesEnabled ?? false;

  // Determine if today's check-ins are unusually low
  const checkInsBelowAvg = stats.avgDailyCheckins > 0 && stats.checkInsToday < stats.avgDailyCheckins * 0.5;

  // Build alert banners (only shown when something needs attention)
  const alerts = [];
  if (stats.atRiskCount > 0) {
    alerts.push({
      icon: AlertTriangle,
      text: t('admin.overview.atRiskDesc', { critical: stats.criticalCount, high: data.riskTiers?.high || 0 }),
      actionLabel: t('admin.overview.actionFollowUp'),
      color: stats.criticalCount > 0 ? 'var(--color-danger)' : 'var(--color-warning)',
      onClick: () => navigate('/admin/churn'),
    });
  }
  if (pendingResets.length > 0) {
    alerts.push({
      icon: KeyRound,
      text: t('admin.overview.pendingResetsDesc', { count: pendingResets.length }),
      actionLabel: t('admin.overview.review'),
      color: 'var(--color-warning)',
      onClick: () => setResetApprovalId(pendingResets[0]?.id),
    });
  }
  if (onboardingCount > 0) {
    alerts.push({
      icon: UserPlus,
      text: t('admin.overview.onboardingGapsDesc', { count: onboardingCount }),
      actionLabel: t('admin.overview.viewAction'),
      color: 'var(--color-danger)',
      onClick: () => navigate('/admin/members'),
    });
  }
  if (checkInsBelowAvg) {
    alerts.push({
      icon: Activity,
      text: t('admin.overview.unusualActivityDesc', { avg: stats.avgDailyCheckins, today: stats.checkInsToday }),
      actionLabel: t('admin.overview.viewAction'),
      color: 'var(--color-danger)',
      onClick: () => navigate('/admin/attendance'),
    });
  }

  const needsAttentionCount = alerts.length + (atRisk.length > 0 ? 1 : 0);

  return (
    <AdminPageShell>
      {/* ── Password reset approval modal ────────────────── */}
      {resetApprovalId && (
        <PasswordResetApprovalModal
          requestId={resetApprovalId}
          onClose={() => setResetApprovalId(null)}
          onComplete={() => {
            setResetApprovalId(null);
            refetchResets();
          }}
        />
      )}

      {/* ════════════════════════════════════════════════════
           SECTION 1 -- HEADER + QUICK-ACTION BUTTONS
         ════════════════════════════════════════════════════ */}
      <FadeIn>
        <PageHeader
          title={t('admin.overview.title')}
          subtitle={`${format(new Date(), 'EEEE, MMMM d, yyyy', dateFnsLocale)} · ${stats.checkInsToday} ${t('admin.overview.glanceCheckins').toLowerCase()}`}
          actions={
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap pb-1 md:pb-0">
              <QuickActionButton icon={Users} label={t('admin.overview.navMembers')} onClick={() => navigate('/admin/members')} />
              <QuickActionButton icon={AlertTriangle} label={t('admin.overview.navChurn')} onClick={() => navigate('/admin/churn')} />
              {classesEnabled && (
                <QuickActionButton icon={BookOpen} label={t('admin.overview.navClasses')} onClick={() => navigate('/admin/classes')} />
              )}
              <QuickActionButton icon={MessageSquare} label={t('admin.overview.navMessages')} onClick={() => navigate('/admin/messages')} />
            </div>
          }
          className="mb-8"
        />
      </FadeIn>

      {/* ════════════════════════════════════════════════════
           SECTION 2 -- HERO KPI STRIP ("Today at a Glance")
           Stat cards are the first visual hero element
         ════════════════════════════════════════════════════ */}
      <FadeIn delay={40}>
        <span className="admin-eyebrow block mb-3">
          {t('admin.overview.todayGlance', 'Today at a Glance')}
        </span>
      </FadeIn>
      <div className={`grid gap-2.5 md:gap-4 mb-8 ${classesEnabled ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'}`}>
        <FadeIn delay={60}>
          <StatCard
            label={t('admin.overview.glanceCritical', 'Critical')}
            value={stats.criticalCount}
            icon={AlertTriangle}
            borderColor="var(--color-danger)"
            sub={stats.criticalCount > 0
              ? <span className="text-[10.5px] font-medium" style={{ color: 'var(--color-danger)' }}>{t('admin.overview.needsAction', 'Needs action')}</span>
              : <span className="text-[10.5px] font-medium" style={{ color: 'var(--color-success)' }}>{t('admin.overview.allClear', 'All clear')}</span>}
          />
        </FadeIn>
        <FadeIn delay={80}>
          <StatCard
            label={t('admin.overview.glanceAtRisk')}
            value={stats.atRiskCount}
            icon={Activity}
            borderColor="var(--color-warning)"
            sub={stats.atRiskCount > 0
              ? <span className="text-[10.5px] font-medium" style={{ color: 'var(--color-warning)' }}>{t('admin.overview.actionFollowUp', 'Follow up')}</span>
              : <span className="text-[10.5px] font-medium" style={{ color: 'var(--color-success)' }}>{t('admin.overview.everyoneActive', 'Everyone active')}</span>}
          />
        </FadeIn>
        <FadeIn delay={100}>
          <StatCard
            label={t('admin.overview.glanceCheckins')}
            value={stats.checkInsToday}
            icon={CalendarCheck}
            borderColor="var(--color-coach)"
            sub={<DeltaSub delta={formatDelta(stats.checkInsToday, stats.checkInsYesterday, t('admin.overview.vsYesterday', 'vs yesterday'))} />}
          />
        </FadeIn>
        {classesEnabled && (
          <FadeIn delay={110}>
            <StatCard label={t('admin.overview.glanceClasses')} value={stats.classesToday} icon={BookOpen} borderColor="var(--color-accent)" />
          </FadeIn>
        )}
        <FadeIn delay={120}>
          <StatCard
            label={t('admin.overview.glanceNewMonth')}
            value={stats.newMembersMonth}
            icon={UserPlus}
            borderColor="var(--color-success)"
            sub={<DeltaSub delta={formatDelta(stats.newMembersMonth, stats.newMembersPrevMonth, t('admin.overview.vsLastMonth', 'vs last month'))} />}
          />
        </FadeIn>
        <FadeIn delay={140}>
          <StatCard
            label={t('admin.overview.glanceTotal')}
            value={stats.totalMembers}
            icon={Users}
            borderColor="var(--color-coach)"
          />
        </FadeIn>
      </div>

      {/* ════════════════════════════════════════════════════
           SECTION 3 -- "NEEDS ATTENTION NOW" ALERTS
           Separated from KPIs with breathing room
         ════════════════════════════════════════════════════ */}
      <FadeIn delay={160}>
        <div className="mb-8">
          {needsAttentionCount > 0 ? (
            <div
              className="rounded-2xl p-3 sm:p-4 md:p-5 space-y-3"
              style={{
                background: 'var(--color-danger-soft)',
                border: '1px solid color-mix(in srgb, var(--color-danger) 15%, transparent)',
              }}
            >
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--color-danger) 15%, transparent)' }}>
                  <AlertTriangle size={16} style={{ color: 'var(--color-danger)' }} />
                </div>
                <div>
                  <p className="admin-page-title text-[14.5px] font-bold tracking-tight" style={{ color: 'var(--color-admin-text)' }}>
                    {t('admin.overview.needsAttention', 'Needs Attention Now')}
                  </p>
                  <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>
                    {t('admin.overview.needsAttentionSub', '{{count}} item(s) requiring your action', { count: needsAttentionCount })}
                  </p>
                </div>
              </div>

              {/* Alert banners */}
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <AlertBanner key={i} icon={a.icon} text={a.text} actionLabel={a.actionLabel} color={a.color} onClick={a.onClick} />
                ))}
              </div>

              {/* Inline at-risk watchlist preview */}
              {atRisk.length > 0 && (
                <div className="mt-3 pt-3.5" style={{ borderTop: '1px solid var(--color-admin-border)' }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="admin-eyebrow" style={{ color: 'var(--color-warning)' }}>
                      {t('admin.overview.watchlistAtRisk')}
                    </span>
                    <button
                      onClick={() => navigate('/admin/churn')}
                      className="flex-shrink-0 text-[11px] flex items-center gap-0.5 whitespace-nowrap transition-colors duration-200"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      {t('admin.overview.viewAll')} <ChevronRight size={12} />
                    </button>
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                    {atRisk.slice(0, 3).map(m => (
                      <WatchlistRow key={m.id} member={m} t={t} onMessage={() => navigate('/admin/churn')} onClick={setWatchlistDetail} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl p-3 sm:p-4 md:p-5 flex items-center gap-3.5"
              style={{ background: 'var(--color-success-soft)', border: '1px solid color-mix(in srgb, var(--color-success) 15%, transparent)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--color-success) 15%, transparent)' }}>
                <CheckCircle size={16} style={{ color: 'var(--color-success)' }} />
              </div>
              <div>
                <p className="text-[13.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t('admin.overview.allClear', 'All Clear')}</p>
                <p className="text-[11.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.overview.noAtRisk')} {t('admin.overview.everyoneActive')}</p>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ════════════════════════════════════════════════════
           SECTION 4 -- RECENT ACTIVITY + FULL WATCHLIST
           Two-column operational view
         ════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 md:gap-5">
        {/* Recent Activity Feed */}
        <FadeIn delay={200}>
          <AdminCard hover padding="p-3 sm:p-4 md:p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--color-admin-panel)' }}>
                <Activity size={13} style={{ color: 'var(--color-admin-text-sub)' }} />
              </div>
              <p className="text-[13.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.overview.recentActivity')}
              </p>
              {recentActivity.length > 0 && (
                <span className="admin-eyebrow ml-auto">
                  {t('admin.overview.lastNCount', 'LAST {{count}}', { count: recentActivity.length })}
                </span>
              )}
            </div>
            {recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: 'var(--color-admin-panel)' }}>
                  <Clock size={18} style={{ color: 'var(--color-admin-text-faint)' }} />
                </div>
                <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.overview.noActivity')}</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                {recentActivity.map((item, i) => (
                  <ActivityItem key={`${item.type}-${item.profile_id}-${item.timestamp}-${i}`} item={item} dateFnsLocale={dateFnsLocale} t={t} onClick={setActivityDetail} />
                ))}
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Full Watchlist */}
        <FadeIn delay={240}>
          <AdminCard hover padding="p-3 sm:p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--color-warning-soft)' }}>
                  <AlertTriangle size={13} style={{ color: 'var(--color-warning)' }} />
                </div>
                <p className="text-[13.5px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>
                  {t('admin.overview.watchlist')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="admin-pill admin-pill--hot">
                  {t('admin.overview.atRiskPill', 'AT RISK · {{count}}', { count: stats.atRiskCount })}
                </span>
                <button
                  onClick={() => navigate('/admin/churn')}
                  className="flex-shrink-0 text-[11px] flex items-center gap-0.5 whitespace-nowrap transition-colors duration-200"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {t('admin.overview.viewAll')} <ChevronRight size={12} />
                </button>
              </div>
            </div>

            {atRisk.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                  style={{ background: 'var(--color-success-soft)' }}>
                  <CheckCircle size={18} style={{ color: 'var(--color-success)' }} />
                </div>
                <p className="text-[12.5px]" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.overview.noAtRisk')}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-admin-text-faint)' }}>{t('admin.overview.everyoneActive')}</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--color-admin-border)' }}>
                {atRisk.map(m => (
                  <WatchlistRow key={m.id} member={m} t={t} onMessage={() => navigate('/admin/churn')} onClick={setWatchlistDetail} />
                ))}
              </div>
            )}
          </AdminCard>
        </FadeIn>
      </div>

      {/* ── Activity detail modal ─────────────────────────── */}
      <AdminModal
        isOpen={!!activityDetail}
        onClose={() => setActivityDetail(null)}
        title={
          activityDetail
            ? (activityDetail.type === 'workout' ? t('admin.overview.actions.workout', 'completed workout')
              : activityDetail.type === 'signup' ? t('admin.overview.actions.joined', 'joined')
              : t('admin.overview.actions.checkin', 'checked in'))
            : ''
        }
        titleIcon={
          activityDetail?.type === 'workout' ? Dumbbell
          : activityDetail?.type === 'signup' ? UserPlus
          : CalendarCheck
        }
        size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button
              onClick={() => setActivityDetail(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
            >
              {t('admin.overview.close', 'Close')}
            </button>
            <button
              onClick={() => { const id = activityDetail?.profile_id; setActivityDetail(null); if (id) navigate(`/admin/members?member=${id}`); }}
              className="px-4 py-2 rounded-xl text-[13px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
            >
              {t('admin.overview.viewMember', 'View member')}
            </button>
          </div>
        }
      >
        {activityDetail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar name={activityDetail.memberName} size="md" src={activityDetail.avatarUrl} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {activityDetail.memberName || t('admin.overview.unknownMember', 'Unknown')}
                </p>
                <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                  {formatDistanceToNow(new Date(activityDetail.timestamp), { addSuffix: true, ...(dateFnsLocale || {}) })}
                </p>
              </div>
            </div>
            <div className="rounded-xl p-3" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
              <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.overview.eventTime', 'Time')}
              </p>
              <p className="text-[13px] font-mono" style={{ color: 'var(--color-text-primary)' }}>
                {format(new Date(activityDetail.timestamp), 'PPp', dateFnsLocale)}
              </p>
              {/* The activity row carries the workout volume as `total_volume_lbs`
                  (DB column shape). Coerce to number defensively so a null/string
                  never reaches Math.round (which would render `NaN lbs`). */}
              {activityDetail.type === 'workout' && (() => {
                const raw = activityDetail.total_volume_lbs ?? activityDetail.totalVolume;
                const vol = Number(raw);
                if (!Number.isFinite(vol) || vol <= 0) return null;
                return (
                  <>
                    <p className="text-[11px] uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('admin.overview.totalVolume', 'Total volume')}
                    </p>
                    <p className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
                      {Math.round(vol).toLocaleString()} lbs
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </AdminModal>

      {/* ── Watchlist detail modal ────────────────────────── */}
      <AdminModal
        isOpen={!!watchlistDetail}
        onClose={() => setWatchlistDetail(null)}
        title={watchlistDetail?.full_name || ''}
        titleIcon={AlertTriangle}
        subtitle={t('admin.overview.atRiskSub', 'At-risk member')}
        size="sm"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <button
              onClick={() => setWatchlistDetail(null)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium"
              style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
            >
              {t('admin.overview.close', 'Close')}
            </button>
            <button
              onClick={() => { setWatchlistDetail(null); navigate('/admin/churn'); }}
              className="px-4 py-2 rounded-xl text-[13px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent, #000)' }}
            >
              {t('admin.overview.openWinBack', 'Open win-back')}
            </button>
          </div>
        }
      >
        {watchlistDetail && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar name={watchlistDetail.full_name} size="md" src={watchlistDetail.avatar_url} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{watchlistDetail.full_name}</p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{watchlistDetail.username || ''}</p>
              </div>
              <span className="ml-auto admin-pill admin-pill--hot admin-mono">{watchlistDetail.score}%</span>
            </div>
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.overview.daysInactiveLabel', 'Days inactive')}
                </span>
                <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {watchlistDetail.neverActive ? t('admin.overview.neverLogged') : watchlistDetail.daysInactive}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
                  {t('admin.overview.riskTier', 'Risk tier')}
                </span>
                <span className="text-[13px] font-semibold capitalize" style={{ color: 'var(--color-warning)' }}>
                  {watchlistDetail.risk_tier || getRiskTier(watchlistDetail.score)}
                </span>
              </div>
              {Array.isArray(watchlistDetail.key_signals) && watchlistDetail.key_signals.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('admin.overview.signals', 'Signals')}
                  </p>
                  <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--color-text-primary)' }}>
                    {watchlistDetail.key_signals.slice(0, 4).map((s, i) => (
                      <li key={i}>• {translateSignal(t, s)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </AdminModal>
    </AdminPageShell>
  );
}
