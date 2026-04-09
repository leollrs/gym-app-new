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
import { FadeIn, StatCard, AdminCard, CardSkeleton, Avatar, AdminPageShell, PageHeader } from '../../components/admin';

// Sub-components (kept)
import PasswordResetApprovalModal from './components/PasswordResetApprovalModal';

// ── Helpers ──────────────────────────────────────────────
import { getRiskTier } from '../../lib/churnScore';

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
    supabase.from('profiles').select('id, full_name, username, role, created_at, gym_id, last_active_at, membership_status, avatar_url').eq('gym_id', gymId).eq('role', 'member'),
    supabase.from('workout_sessions').select('profile_id, started_at, total_volume_lbs').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', twentyEightDaysAgo).order('started_at', { ascending: false }).limit(1000),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier, key_signals, computed_at').eq('gym_id', gymId).order('score', { ascending: false }).limit(2000),
    supabase.from('profiles').select('id').eq('gym_id', gymId).eq('role', 'member').eq('is_onboarded', false).gte('created_at', fortyEightHoursAgo).limit(500),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', subDays(now, 30).toISOString()).order('checked_in_at', { ascending: false }).limit(1000),
  ]);

  const { data: todayCheckins } = await supabase.from('check_ins').select('id, profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', todayStart).order('checked_in_at', { ascending: false });

  // Fetch today's classes count (gym_classes with a schedule matching today's day_of_week OR specific_date)
  const todayDow = now.getDay(); // 0=Sun
  const todayDate = format(now, 'yyyy-MM-dd');
  const { data: classSchedules } = await supabase
    .from('gym_class_schedules')
    .select('id, gym_class:gym_classes!inner(id, gym_id, is_active)')
    .eq('gym_class.gym_id', gymId)
    .eq('gym_class.is_active', true)
    .or(`day_of_week.eq.${todayDow},specific_date.eq.${todayDate}`);

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
    const risk_tier = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
    const key_signals = [];
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
  const allMemberScores = members.map(m => {
    const dbRow = latestScoreMap[m.id];
    const lastSeenAt = m.last_active_at || lastSessionAt[m.id] || null;
    const neverActive = !lastSeenAt;
    const daysInactive = lastSeenAt
      ? Math.floor((nowMs - new Date(lastSeenAt)) / 86400000)
      : Math.floor((nowMs - new Date(m.created_at)) / 86400000);
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
    memberName: memberMap[c.profile_id]?.full_name || 'Unknown',
    avatarUrl: memberMap[c.profile_id]?.avatar_url || null,
  }));
  const recentWorkouts = sessions.slice(0, 10).map(s => ({
    type: 'workout', profile_id: s.profile_id, timestamp: s.started_at,
    memberName: memberMap[s.profile_id]?.full_name || 'Unknown',
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
      memberName: m.full_name || 'Unknown',
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
      atRiskCount: riskTiers.critical + riskTiers.high,
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
      <div className="h-8 bg-white/[0.04] rounded-lg w-64 animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-[#0F172A] border border-white/[0.06] rounded-2xl p-5 h-[90px] animate-pulse" />
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
      style={{ background: `${color}08`, border: `1px solid ${color}18` }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
          transition-transform duration-200 group-hover:scale-110"
        style={{ background: `${color}15` }}
      >
        <Icon size={14} style={{ color }} />
      </div>
      <p className="flex-1 text-[12.5px] text-[#E5E7EB] leading-snug">{text}</p>
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
function ActivityItem({ item, dateFnsLocale }) {
  const actionMap = {
    checkin: { label: 'checked in', color: '#8B5CF6', icon: CalendarCheck },
    workout: { label: 'completed workout', color: '#3B82F6', icon: Dumbbell },
    signup: { label: 'joined', color: '#10B981', icon: UserPlus },
  };
  const meta = actionMap[item.type] || actionMap.checkin;
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-3 py-2.5 group hover:bg-white/[0.015]      -mx-1 px-1 rounded-lg transition-colors duration-150">
      <div className="relative flex-shrink-0">
        <Avatar name={item.memberName} size="sm" src={item.avatarUrl} />
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center
            border-2 border-[#0F172A]"
          style={{ background: `${meta.color}20` }}
        >
          <Icon size={8} style={{ color: meta.color }} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] text-[#E5E7EB] truncate">
          <span className="font-medium">{item.memberName}</span>
          <span className="text-[#6B7280] ml-1.5">{meta.label}</span>
        </p>
      </div>
      <span className="text-[10px] text-[#4B5563] flex-shrink-0 tabular-nums
        opacity-60 group-hover:opacity-100 transition-opacity duration-150">
        {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, ...(dateFnsLocale || {}) })}
      </span>
    </div>
  );
}

// ── Watchlist Row ────────────────────────────────────────
function WatchlistRow({ member, t, onMessage }) {
  const tier = getRiskTier(member.score);
  return (
    <div className="flex items-center gap-3 py-2.5 hover:bg-white/[0.015]      -mx-1 px-1 rounded-lg transition-colors duration-150">
      <Avatar name={member.full_name} size="sm" src={member.avatar_url} />
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium text-[#E5E7EB] truncate">{member.full_name}</p>
        <p className="text-[10.5px] text-[#6B7280]">
          {member.neverActive
            ? t('admin.overview.neverLogged')
            : t('admin.overview.daysInactive', { count: member.daysInactive })}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onMessage?.(member); }}
        className="flex-shrink-0 w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06]
          flex items-center justify-center
          hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/20
          active:scale-95 transition-all duration-150"
        title={t('admin.overview.navMessages', 'Message')}
      >
        <MessageSquare size={12} className="text-[#6B7280] hover:text-[#D4AF37]" />
      </button>
      <span
        className="text-[10.5px] font-bold px-2.5 py-0.5 rounded-full flex-shrink-0 tabular-nums"
        style={{ color: tier.color, background: tier.bg }}
      >
        {member.score}%
      </span>
    </div>
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
    ? 'var(--color-text-muted)'
    : isPositive ? 'var(--color-success, #10B981)' : 'var(--color-danger, #EF4444)';
  return (
    <span className="text-[10.5px] font-medium tabular-nums" style={{ color }}>
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
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11.5px] font-semibold
        border transition-all duration-200
        ${disabled
          ? 'text-[#4B5563] bg-white/[0.02] border-white/[0.04] cursor-not-allowed opacity-50'
          : `text-[#9CA3AF] bg-white/[0.04] border-white/[0.06]
             hover:text-[#E5E7EB] hover:border-white/[0.15] hover:bg-white/[0.07]
             hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)] hover:-translate-y-px
             active:translate-y-0 active:shadow-none`
        }`}
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

  useEffect(() => { document.title = `Admin - Overview | ${window.__APP_NAME || 'TuGymPR'}`; }, []);

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
        <p className="text-[#EF4444] text-[14px] font-semibold">{t('admin.overview.accessDenied')}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <AdminPageShell>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#EF4444]/10 flex items-center justify-center">
            <AlertTriangle size={24} className="text-[#EF4444]" />
          </div>
          <div className="text-center">
            <p className="text-[15px] font-semibold text-[#EF4444]">{t('admin.overview.loadError', 'Failed to load overview data')}</p>
            <p className="text-[12.5px] text-[#6B7280] max-w-md mt-1.5">{error?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12.5px] font-medium
              text-[#E5E7EB] bg-white/[0.05] border border-white/10
              hover:bg-white/[0.08] hover:border-white/[0.15]
              active:scale-[0.98] transition-all duration-200"
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
      color: stats.criticalCount > 0 ? '#EF4444' : '#F59E0B',
      onClick: () => navigate('/admin/churn'),
    });
  }
  if (pendingResets.length > 0) {
    alerts.push({
      icon: KeyRound,
      text: t('admin.overview.pendingResetsDesc', { count: pendingResets.length }),
      actionLabel: t('admin.overview.review'),
      color: '#F59E0B',
      onClick: () => setResetApprovalId(pendingResets[0]?.id),
    });
  }
  if (onboardingCount > 0) {
    alerts.push({
      icon: UserPlus,
      text: t('admin.overview.onboardingGapsDesc', { count: onboardingCount }),
      actionLabel: t('admin.overview.viewAction'),
      color: '#F97316',
      onClick: () => navigate('/admin/members'),
    });
  }
  if (checkInsBelowAvg) {
    alerts.push({
      icon: Activity,
      text: t('admin.overview.unusualActivityDesc', { avg: stats.avgDailyCheckins, today: stats.checkInsToday }),
      actionLabel: t('admin.overview.viewAction'),
      color: '#EF4444',
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
            <div className="flex items-center gap-2 flex-wrap">
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
        <p className="text-[11.5px] font-semibold text-[#D4AF37] uppercase tracking-[0.1em] mb-3">
          {t('admin.overview.todayGlance', 'Today at a Glance')}
        </p>
      </FadeIn>
      <div className={`grid gap-4 mb-8 ${classesEnabled ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'}`}>
        <FadeIn delay={60}>
          <StatCard
            label={t('admin.overview.glanceCritical', 'Critical')}
            value={stats.criticalCount}
            icon={AlertTriangle}
            borderColor="#EF4444"
            sub={stats.criticalCount > 0
              ? <span className="text-[10.5px] font-medium text-[#EF4444]">{t('admin.overview.needsAction', 'Needs action')}</span>
              : <span className="text-[10.5px] font-medium text-[#10B981]">{t('admin.overview.allClear', 'All clear')}</span>}
          />
        </FadeIn>
        <FadeIn delay={80}>
          <StatCard
            label={t('admin.overview.glanceAtRisk')}
            value={stats.atRiskCount}
            icon={Activity}
            borderColor="#F59E0B"
            sub={stats.atRiskCount > 0
              ? <span className="text-[10.5px] font-medium text-[#F59E0B]">{t('admin.overview.actionFollowUp', 'Follow up')}</span>
              : <span className="text-[10.5px] font-medium text-[#10B981]">{t('admin.overview.everyoneActive', 'Everyone active')}</span>}
          />
        </FadeIn>
        <FadeIn delay={100}>
          <StatCard
            label={t('admin.overview.glanceCheckins')}
            value={stats.checkInsToday}
            icon={CalendarCheck}
            borderColor="#8B5CF6"
            sub={<DeltaSub delta={formatDelta(stats.checkInsToday, stats.checkInsYesterday, t('admin.overview.vsYesterday', 'vs yesterday'))} />}
          />
        </FadeIn>
        {classesEnabled && (
          <FadeIn delay={110}>
            <StatCard label={t('admin.overview.glanceClasses')} value={stats.classesToday} icon={BookOpen} borderColor="#D4AF37" />
          </FadeIn>
        )}
        <FadeIn delay={120}>
          <StatCard
            label={t('admin.overview.glanceNewMonth')}
            value={stats.newMembersMonth}
            icon={UserPlus}
            borderColor="#10B981"
            sub={<DeltaSub delta={formatDelta(stats.newMembersMonth, stats.newMembersPrevMonth, t('admin.overview.vsLastMonth', 'vs last month'))} />}
          />
        </FadeIn>
        <FadeIn delay={140}>
          <StatCard
            label={t('admin.overview.glanceTotal')}
            value={stats.totalMembers}
            icon={Users}
            borderColor="#6366F1"
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
            <div className="rounded-2xl border border-[#EF4444]/15 bg-gradient-to-br from-[#EF4444]/[0.03] to-[#F59E0B]/[0.02] p-5 space-y-3">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-[#EF4444]/10 flex items-center justify-center">
                  <AlertTriangle size={16} className="text-[#EF4444]" />
                </div>
                <div>
                  <p className="text-[14.5px] font-bold text-[#E5E7EB] tracking-tight">
                    {t('admin.overview.needsAttention', 'Needs Attention Now')}
                  </p>
                  <p className="text-[11.5px] text-[#6B7280]">
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
                <div className="mt-3 pt-3.5 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-[11px] font-semibold text-[#F59E0B] uppercase tracking-[0.1em]">
                      {t('admin.overview.watchlistAtRisk')}
                    </p>
                    <button
                      onClick={() => navigate('/admin/churn')}
                      className="flex-shrink-0 text-[11px] text-[#D4AF37] hover:text-[#E5C158]
                        flex items-center gap-0.5 whitespace-nowrap
                        transition-colors duration-200"
                    >
                      {t('admin.overview.viewAll')} <ChevronRight size={12} />
                    </button>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {atRisk.slice(0, 3).map(m => (
                      <WatchlistRow key={m.id} member={m} t={t} onMessage={() => navigate('/admin/churn')} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#10B981]/15 bg-[#10B981]/[0.03] p-5 flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-[#10B981]/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle size={16} className="text-[#10B981]" />
              </div>
              <div>
                <p className="text-[13.5px] font-semibold text-[#E5E7EB]">{t('admin.overview.allClear', 'All Clear')}</p>
                <p className="text-[11.5px] text-[#6B7280]">{t('admin.overview.noAtRisk')} {t('admin.overview.everyoneActive')}</p>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* ════════════════════════════════════════════════════
           SECTION 4 -- RECENT ACTIVITY + FULL WATCHLIST
           Two-column operational view
         ════════════════════════════════════════════════════ */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        {/* Recent Activity Feed */}
        <FadeIn delay={200}>
          <AdminCard hover padding="p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center">
                <Activity size={13} className="text-[#9CA3AF]" />
              </div>
              <p className="text-[13.5px] font-semibold text-[#E5E7EB]">
                {t('admin.overview.recentActivity')}
              </p>
              {recentActivity.length > 0 && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/[0.05] text-[#6B7280] ml-auto">
                  {recentActivity.length}
                </span>
              )}
            </div>
            {recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center mb-3">
                  <Clock size={18} className="text-[#4B5563]" />
                </div>
                <p className="text-[12.5px] text-[#6B7280]">{t('admin.overview.noActivity')}</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {recentActivity.map((item, i) => (
                  <ActivityItem key={`${item.type}-${item.profile_id}-${item.timestamp}-${i}`} item={item} dateFnsLocale={dateFnsLocale} />
                ))}
              </div>
            )}
          </AdminCard>
        </FadeIn>

        {/* Full Watchlist */}
        <FadeIn delay={240}>
          <AdminCard hover padding="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center">
                  <AlertTriangle size={13} className="text-[#F59E0B]" />
                </div>
                <p className="text-[13.5px] font-semibold text-[#E5E7EB]">
                  {t('admin.overview.watchlist')}
                </p>
              </div>
              <button
                onClick={() => navigate('/admin/churn')}
                className="flex-shrink-0 text-[11px] text-[#D4AF37] hover:text-[#E5C158]
                  flex items-center gap-0.5 whitespace-nowrap
                  transition-colors duration-200"
              >
                {t('admin.overview.viewAll')} <ChevronRight size={12} />
              </button>
            </div>

            {atRisk.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center mb-3">
                  <CheckCircle size={18} className="text-[#10B981]" />
                </div>
                <p className="text-[12.5px] text-[#6B7280]">{t('admin.overview.noAtRisk')}</p>
                <p className="text-[11px] text-[#4B5563] mt-1">{t('admin.overview.everyoneActive')}</p>
              </div>
            ) : (
              <>
                <p className="text-[10.5px] font-medium text-[#6B7280] uppercase tracking-[0.08em] mb-2.5">
                  {t('admin.overview.glanceAtRisk')} — {stats.atRiskCount}
                </p>
                <div className="divide-y divide-white/[0.04]">
                  {atRisk.map(m => (
                    <WatchlistRow key={m.id} member={m} t={t} onMessage={() => navigate('/admin/churn')} />
                  ))}
                </div>
              </>
            )}
          </AdminCard>
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
