import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp, AlertTriangle, ChevronRight, Activity,
  UserPlus, Trophy, Clock, RefreshCw, CalendarCheck, Dumbbell,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import ChartTooltip from '../../components/ChartTooltip';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { format, subDays, formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { adminKeys } from '../../lib/adminQueryKeys';

// Shared admin components
import { FadeIn, StatCard, AdminCard, SectionLabel, CardSkeleton } from '../../components/admin';

// Sub-components
import AtRiskPreview from './components/AtRiskPreview';
import RecentActivity from './components/RecentActivity';
import FollowUpSettings from './components/FollowUpSettings';

// ── Risk tier mini-bar ────────────────────────────────────
const TierRow = ({ label, count, color, total }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[11px] font-medium w-14 text-right" style={{ color }}>{label}</span>
      <div className="flex-1 h-1 bg-white/6 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold text-[#9CA3AF] w-7 text-right">{count}</span>
    </div>
  );
};

// ── Data fetching function ────────────────────────────────
async function fetchOverviewData(gymId) {
  const now = new Date();
  const twentyEightDaysAgo = subDays(now, 28).toISOString();
  const fortyEightHoursAgo = subDays(now, 2).toISOString();
  const threeDaysFromNow = subDays(now, -3).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [
    membersRes, sessionsRes, churnScoresRes, fupRes,
    notOnboardedRes, challengesEndingSoonRes, dripStepsRes, checkInsRes,
  ] = await Promise.all([
    supabase.from('mv_gym_member_summary').select('*').eq('gym_id', gymId).limit(2000),
    supabase.from('workout_sessions').select('profile_id, started_at, total_volume_lbs').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', twentyEightDaysAgo).order('started_at', { ascending: false }).limit(5000),
    supabase.from('churn_risk_scores').select('profile_id, score, risk_tier, key_signals, computed_at').eq('gym_id', gymId).order('score', { ascending: false }).limit(2000),
    supabase.from('churn_followup_settings').select('*').eq('gym_id', gymId).single(),
    supabase.from('profiles').select('id').eq('gym_id', gymId).eq('role', 'member').eq('is_onboarded', false).gte('created_at', fortyEightHoursAgo).limit(500),
    supabase.from('challenges').select('id, name, end_date').eq('gym_id', gymId).eq('status', 'active').gte('end_date', now.toISOString()).lte('end_date', threeDaysFromNow).limit(20),
    supabase.from('drip_campaign_steps').select('*').eq('gym_id', gymId).order('step_number').limit(50),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', subDays(now, 30).toISOString()).order('checked_in_at', { ascending: false }).limit(5000),
  ]);

  const { data: todayCheckins } = await supabase.from('check_ins').select('id').eq('gym_id', gymId).gte('checked_in_at', todayStart);

  // Log errors
  [membersRes, sessionsRes, churnScoresRes, notOnboardedRes, challengesEndingSoonRes, dripStepsRes, checkInsRes]
    .forEach((res, i) => { if (res.error) logger.error(`AdminOverview fetch ${i}:`, res.error); });

  const { data: topExRows } = await supabase.from('mv_gym_exercise_popularity').select('*').eq('gym_id', gymId).order('usage_count', { ascending: false }).limit(6);

  const members = (membersRes.data || []).map(m => ({ ...m, id: m.profile_id }));
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

  // Fallback score estimator (mirrors AdminMembers logic)
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

  // Build member lookup for recent activity display
  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });

  // Merge DB scores with fallback estimates for all members
  const nowMs = Date.now();
  const allMemberScores = members.map(m => {
    const dbRow = latestScoreMap[m.id];
    const lastSeenAt = m.last_active_at ?? lastSessionAt[m.id] ?? m.created_at;
    const daysInactive = Math.floor((nowMs - new Date(lastSeenAt)) / 86400000);
    const neverActive = !m.last_active_at && !lastSessionAt[m.id];
    const recentWorkouts = sessionsLast14[m.id] ?? 0;

    if (dbRow) {
      return { ...m, score: dbRow.score, risk_tier: dbRow.risk_tier, key_signals: dbRow.key_signals, daysInactive, neverActive };
    }
    const fb = estimateScore(daysInactive, recentWorkouts, neverActive);
    return { ...m, score: fb.score, risk_tier: fb.risk_tier, key_signals: fb.key_signals, daysInactive, neverActive };
  });

  // Risk tiers (now includes all members, not just those with DB rows)
  const riskTiers = { critical: 0, high: 0, medium: 0, low: 0 };
  allMemberScores.forEach(m => { if (riskTiers[m.risk_tier] !== undefined) riskTiers[m.risk_tier]++; });

  // At-risk members
  const atRisk = allMemberScores
    .filter(m => m.risk_tier === 'critical' || m.risk_tier === 'high')
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Stats
  const total = members.length;
  const checkedInIds = new Set(checkIns.map(c => c.profile_id));
  const activePct = total > 0 ? Math.round((checkedInIds.size / total) * 100) : 0;

  const retentionCalc = (days) => {
    const cutoff = subDays(now, days).toISOString();
    const starting = members.filter(m => m.created_at <= cutoff);
    if (starting.length === 0) return { pct: 0, days, starting: 0, retained: 0 };
    const retained = starting.filter(m => m.membership_status !== 'cancelled' && m.membership_status !== 'banned').length;
    return { pct: Math.round((retained / starting.length) * 100), days, starting: starting.length, retained };
  };
  const retentionBest = [retentionCalc(30), retentionCalc(60), retentionCalc(90)].find(r => r.starting >= 3) || retentionCalc(30);

  // Action items
  const actionItems = [];
  const notOnboarded = notOnboardedRes.data || [];
  if (notOnboarded.length > 0) {
    actionItems.push({ icon: UserPlus, iconColor: 'text-[#D4AF37]', text: `${notOnboarded.length} new member${notOnboarded.length !== 1 ? 's' : ''} haven't completed onboarding`, link: '/admin/members' });
  }
  if (riskTiers.critical > 0) {
    actionItems.push({ icon: AlertTriangle, iconColor: 'text-[#DC2626]', text: `${riskTiers.critical} member${riskTiers.critical !== 1 ? 's' : ''} at critical churn risk`, link: '/admin/churn' });
  }
  (challengesEndingSoonRes.data || []).forEach(ch => {
    const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date) - now) / 86400000));
    actionItems.push({ icon: Trophy, iconColor: 'text-amber-400', text: `"${ch.name}" ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, link: '/admin/challenges' });
  });

  // Chart data
  const dayMap = {};
  for (let i = 13; i >= 0; i--) {
    const d = format(subDays(now, i), 'MMM d');
    dayMap[d] = { workouts: 0, checkins: 0 };
  }
  sessions.forEach(s => { const d = format(new Date(s.started_at), 'MMM d'); if (d in dayMap) dayMap[d].workouts++; });
  checkIns.forEach(c => { const d = format(new Date(c.checked_in_at), 'MMM d'); if (d in dayMap) dayMap[d].checkins++; });
  const chartData = Object.entries(dayMap).map(([date, vals]) => ({ date, ...vals }));

  // Recent activity
  const recentWorkouts = sessions.slice(0, 10).map(s => ({
    type: 'workout', profile_id: s.profile_id, timestamp: s.started_at,
    memberName: memberMap[s.profile_id]?.full_name || 'Unknown',
    memberInitial: memberMap[s.profile_id]?.full_name?.[0]?.toUpperCase() || '?',
    total_volume_lbs: s.total_volume_lbs,
  }));
  const recentCheckins = checkIns.slice(0, 10).map(c => ({
    type: 'checkin', profile_id: c.profile_id, timestamp: c.checked_in_at,
    memberName: memberMap[c.profile_id]?.full_name || 'Unknown',
    memberInitial: memberMap[c.profile_id]?.full_name?.[0]?.toUpperCase() || '?',
  }));
  const recentActivity = [...recentWorkouts, ...recentCheckins]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

  return {
    stats: {
      totalMembers: total, activeMembers: checkedInIds.size, activePct,
      retentionPct: retentionBest.pct, retentionDays: retentionBest.days,
      retentionDetail: `${retentionBest.retained}/${retentionBest.starting}`,
      atRiskCount: riskTiers.critical + riskTiers.high,
      workoutsMonth: sessions.length, checkInsToday: (todayCheckins || []).length,
    },
    riskTiers, atRisk, chartData, recentActivity, actionItems,
    _dbScoreCount: churnScores.length, _totalMembers: total,
    topExercises: (topExRows || []).map(r => ({ id: r.exercise_id, name: r.exercise_name, count: r.usage_count })),
    fupSettings: fupRes.data || null,
    dripSteps: dripStepsRes.data || [],
  };
}

// ── Overview Loading Skeleton ─────────────────────────────
function OverviewSkeleton() {
  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-4">
      <div className="h-7 bg-white/6 rounded-lg w-64 animate-pulse" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-[#0F172A] border border-white/6 rounded-[14px] p-4 h-[80px] animate-pulse">
            <div className="h-6 bg-white/6 rounded w-16 mb-2" />
            <div className="h-3 bg-white/4 rounded w-24" />
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-[1fr_320px] gap-3">
        <CardSkeleton h="h-[240px]" />
        <CardSkeleton h="h-[240px]" />
      </div>
    </div>
  );
}

export default function AdminOverview() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  // SECURITY: Always derive gymId from the authenticated user's profile.
  // Never accept gymId from URL params, query strings, or other user input.
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  const [refreshingChurn, setRefreshingChurn] = useState(false);
  const [greetingHour] = useState(() => new Date().getHours());

  useEffect(() => { document.title = 'Admin - Overview | TuGymPR'; }, []);

  const { data, isLoading, refetch } = useQuery({
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

  const handleRefreshChurn = async () => {
    if (!gymId) return;
    setRefreshingChurn(true);
    await supabase.rpc('compute_churn_scores', { p_gym_id: gymId });
    await refetch();
    setRefreshingChurn(false);
  };

  // Guard: only admins/super_admins with a valid gym_id may access this page
  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[#EF4444] text-[14px] font-semibold">Access denied. You are not authorized to view this page.</p>
      </div>
    );
  }

  if (isLoading || !data) return <OverviewSkeleton />;

  const { stats, riskTiers, atRisk, chartData, recentActivity, actionItems, topExercises, fupSettings, dripSteps } = data;
  const totalScored = riskTiers.critical + riskTiers.high + riskTiers.medium + riskTiers.low;
  const greetingLabel = greetingHour < 12 ? 'morning' : greetingHour < 17 ? 'afternoon' : 'evening';
  const firstName = profile?.full_name?.split(' ')[0] || '';

  const lastRunLabel = fupSettings?.last_run_at
    ? formatDistanceToNow(new Date(fupSettings.last_run_at), { addSuffix: true })
    : null;

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
      {/* Page header */}
      <FadeIn>
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-[20px] font-bold text-[#E5E7EB]">
            Good {greetingLabel}{firstName ? `, ${firstName}` : ''}
          </h1>
          <span className="text-[12px] text-[#6B7280]">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span>
        </div>
      </FadeIn>

      {/* Action items */}
      {actionItems.length > 0 && (
        <FadeIn delay={60}>
          <AdminCard className="mb-4">
            <SectionLabel>Action Required</SectionLabel>
            <div className="space-y-1 mt-2">
              {actionItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 px-2.5 py-2 bg-[#111827]/60 rounded-lg cursor-pointer hover:bg-[#111827] hover:translate-x-0.5 transition-all duration-200"
                  onClick={() => navigate(item.link)}>
                  <item.icon size={13} className={item.iconColor} />
                  <p className="text-[12px] text-[#E5E7EB] flex-1">{item.text}</p>
                  <ChevronRight size={13} className="text-[#4B5563]" />
                </div>
              ))}
            </div>
          </AdminCard>
        </FadeIn>
      )}

      {/* Stat cards — hero size for Total Members */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
        <StatCard label="Total Members" value={stats.totalMembers} sub="registered" borderColor="#6366F1" delay={100} size="hero" icon={Users} />
        <StatCard label="Active (30d)" value={`${stats.activePct ?? 0}%`} sub={`${stats.activeMembers ?? 0} checked in`} borderColor="#3B82F6" delay={130} icon={CalendarCheck} />
        <StatCard label={`Retention (${stats.retentionDays ?? 30}d)`} value={`${stats.retentionPct ?? 0}%`} sub={stats.retentionDetail ?? ''} borderColor="#10B981" delay={160} icon={TrendingUp} />
        <StatCard label="At Risk" value={stats.atRiskCount} sub="critical + high" borderColor="#EF4444" delay={190} icon={AlertTriangle} />
        <StatCard label="Check-ins Today" value={stats.checkInsToday ?? 0} sub="gym visits" borderColor="#8B5CF6" delay={220} />
        <StatCard label="Workouts (30d)" value={stats.workoutsMonth} sub="completed sessions" borderColor="#D4AF37" delay={250} icon={Dumbbell} />
      </div>

      {/* Chart + Churn Risk Summary */}
      <FadeIn delay={350}>
        <div className="grid md:grid-cols-[1fr_320px] gap-3 mb-4">
          <AdminCard hover>
            <p className="text-[13px] font-semibold text-[#E5E7EB] mb-3">Activity — Last 14 Days</p>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#D4AF37" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="purpleGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(212, 175, 55, 0.06)' }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#9CA3AF', paddingTop: 4 }} />
                <Area type="monotone" dataKey="checkins" name="Check-ins" stroke="#8B5CF6" strokeWidth={2} fill="url(#purpleGrad)" dot={false} activeDot={{ r: 6, strokeWidth: 2 }} animationDuration={1200} animationEasing="ease-out" />
                <Area type="monotone" dataKey="workouts" name="Workouts" stroke="#D4AF37" strokeWidth={2} fill="url(#goldGrad)" dot={false} activeDot={{ r: 6, strokeWidth: 2 }} animationDuration={1200} animationEasing="ease-out" />
              </AreaChart>
            </ResponsiveContainer>
          </AdminCard>

          {/* Churn Risk Summary */}
          <AdminCard hover>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-[#E5E7EB]">Churn Risk</p>
                <button onClick={handleRefreshChurn} disabled={refreshingChurn} title="Recompute churn scores"
                  className="p-1 rounded-md text-[#6B7280] hover:text-[#D4AF37] hover:bg-white/5 transition-colors disabled:opacity-40">
                  <RefreshCw size={12} className={refreshingChurn ? 'animate-spin' : ''} />
                </button>
              </div>
              <button onClick={() => navigate('/admin/churn')} className="text-[11px] text-[#D4AF37] hover:underline flex items-center gap-0.5">
                View all <ChevronRight size={12} />
              </button>
            </div>
            {totalScored === 0 ? (
              <div className="flex flex-col items-center justify-center h-28 text-center">
                <Clock size={18} className="text-[#4B5563] mb-2" />
                <p className="text-[12px] text-[#6B7280]">No scores yet</p>
                <p className="text-[11px] text-[#4B5563] mt-1">Scores are computed daily at 2 AM UTC</p>
              </div>
            ) : (
              <div className="space-y-2">
                <TierRow label="Critical" count={riskTiers.critical} color="#DC2626" total={totalScored} />
                <TierRow label="High" count={riskTiers.high} color="#EF4444" total={totalScored} />
                <TierRow label="Medium" count={riskTiers.medium} color="#F59E0B" total={totalScored} />
                <TierRow label="Low" count={riskTiers.low} color="#10B981" total={totalScored} />
              </div>
            )}
            {fupSettings?.last_run_at && (
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-white/6">
                <Activity size={11} className="text-emerald-500 flex-shrink-0" />
                <p className="text-[11px] text-[#6B7280]">
                  Auto follow-up ran {lastRunLabel} · {fupSettings.last_run_count} sent
                </p>
              </div>
            )}
          </AdminCard>
        </div>
      </FadeIn>

      {/* At-risk members + Top exercises */}
      <FadeIn delay={420}>
        <div className="grid md:grid-cols-[1fr_300px] gap-3 mb-4">
          <AtRiskPreview atRisk={atRisk} />

          <AdminCard hover>
            <p className="text-[13px] font-semibold text-[#E5E7EB] mb-2.5">Top Exercises (30d)</p>
            {topExercises.length === 0 ? (
              <p className="text-[12px] text-[#6B7280] text-center py-6">No data yet</p>
            ) : (
              <div className="space-y-2">
                {topExercises.map((ex, i) => {
                  const maxCount = topExercises[0].count;
                  return (
                    <div key={ex.id}>
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-[12px] text-[#E5E7EB] truncate flex-1 mr-2">{ex.name}</p>
                        <p className="text-[10px] text-[#6B7280] flex-shrink-0">{ex.count}x</p>
                      </div>
                      <div className="h-1 rounded-full bg-white/6 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${Math.round((ex.count / maxCount) * 100)}%`, background: i === 0 ? '#D4AF37' : 'rgba(212,175,55,0.4)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </AdminCard>
        </div>
      </FadeIn>

      {/* Recent Activity */}
      <RecentActivity activity={recentActivity} delay={490} />

      {/* Follow-Up Settings */}
      <div className="mt-4">
        <FollowUpSettings
          gymId={gymId}
          initialSettings={fupSettings}
          initialSteps={dripSteps}
          atRiskCount={stats.atRiskCount}
          delay={560}
        />
      </div>
    </div>
  );
}
