import { supabase } from '../supabase';
import logger from '../logger';
import { format, subDays, startOfMonth } from 'date-fns';
import { fetchMembersWithChurnScores, estimateChurnScoreFallback } from '../churnScore';

/**
 * Single fetch that powers the Admin → Overview page. Runs the v2 churn
 * engine alongside the supporting member/session/check-in queries so the
 * Critical / At Risk counts line up with AdminChurn. Returns a fully
 * derived shape ready for render: stats card numbers, risk-tier histogram,
 * top-5 watchlist, recent-activity feed, onboarding-gap count, and the
 * deltas used by `DeltaSub`.
 */
export async function fetchOverviewData(gymId) {
  const now = new Date();
  const twentyEightDaysAgo = subDays(now, 28).toISOString();
  const fortyEightHoursAgo = subDays(now, 2).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [
    scoredMembers,
    membersRes, sessionsRes, churnScoresRes,
    notOnboardedRes, checkInsRes,
  ] = await Promise.all([
    fetchMembersWithChurnScores(gymId, supabase).catch(err => {
      logger.error('AdminOverview v2 churn scoring failed:', err);
      return null;
    }),
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

  // Today's classes count (active gym_class with schedule for this dow OR today's date)
  const todayDow = now.getDay();
  const todayDate = format(now, 'yyyy-MM-dd');
  const { data: classSchedules, error: classSchedulesErr } = await supabase
    .from('gym_class_schedules')
    .select('id, gym_class:gym_classes!inner(id, gym_id, is_active)')
    .eq('gym_class.gym_id', gymId)
    .eq('gym_class.is_active', true)
    .or(`day_of_week.eq.${todayDow},specific_date.eq.${todayDate}`)
    .limit(200);
  if (classSchedulesErr) logger.error('AdminOverview classSchedules:', classSchedulesErr);

  [membersRes, sessionsRes, churnScoresRes, notOnboardedRes, checkInsRes]
    .forEach((res, i) => { if (res.error) logger.error(`AdminOverview fetch ${i}:`, res.error); });

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

  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const sessionsLast14 = {};
  const lastSessionAt = {};
  sessions.forEach(s => {
    if (s.started_at >= fourteenDaysAgo) sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
    if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) lastSessionAt[s.profile_id] = s.started_at;
  });

  const memberMap = {};
  members.forEach(m => { memberMap[m.id] = m; });

  const nowMs = Date.now();
  // Math.max guards against DST shifts producing negative day counts.
  const daysSince = (iso) => {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.max(0, Math.floor((nowMs - t) / 86400000));
  };
  // Index v2 scores by member id — keeps Overview and AdminChurn in sync on
  // who is critical vs at risk vs healthy.
  const v2ScoreMap = {};
  if (Array.isArray(scoredMembers)) {
    scoredMembers.forEach(s => {
      v2ScoreMap[s.id] = {
        score: Math.round(s.churnScore ?? 0),
        risk_tier: s.riskTier?.tier ?? 'low',
        key_signals: s.keySignals ?? (s.keySignal ? [s.keySignal] : []),
      };
    });
  }
  const allMemberScores = members.map(m => {
    const lastSeenAt = m.last_active_at || lastSessionAt[m.id] || null;
    const neverActive = !lastSeenAt;
    const daysInactive = lastSeenAt ? daysSince(lastSeenAt) : daysSince(m.created_at);
    const recentWorkouts = sessionsLast14[m.id] ?? 0;

    // 1. v2 engine (matches AdminChurn). 2. DB row from edge fn. 3. Local estimate.
    const v2 = v2ScoreMap[m.id];
    if (v2) {
      return { ...m, ...v2, daysInactive, neverActive };
    }
    const dbRow = latestScoreMap[m.id];
    if (dbRow) {
      return { ...m, score: dbRow.score, risk_tier: dbRow.risk_tier, key_signals: dbRow.key_signals, daysInactive, neverActive };
    }
    const fb = estimateChurnScoreFallback(daysInactive, recentWorkouts, neverActive);
    return { ...m, score: fb.score, risk_tier: fb.risk_tier, key_signals: fb.key_signals, daysInactive, neverActive };
  });

  const riskTiers = { critical: 0, high: 0, medium: 0, low: 0 };
  allMemberScores.forEach(m => { if (riskTiers[m.risk_tier] !== undefined) riskTiers[m.risk_tier]++; });

  const atRisk = allMemberScores
    .filter(m => m.risk_tier === 'critical' || m.risk_tier === 'high')
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const total = members.length;

  const monthStart = startOfMonth(now).toISOString();
  const newMembersMonth = members.filter(m => m.created_at >= monthStart).length;

  const sevenDaysAgo = subDays(now, 7).toISOString();
  const activeThisWeekIds = new Set();
  sessions.forEach(s => {
    if (s.started_at >= sevenDaysAgo) activeThisWeekIds.add(s.profile_id);
  });

  const checkInDayCounts = {};
  checkIns.forEach(c => {
    const d = format(new Date(c.checked_in_at), 'yyyy-MM-dd');
    checkInDayCounts[d] = (checkInDayCounts[d] || 0) + 1;
  });
  const dayCountValues = Object.values(checkInDayCounts);
  const avgDailyCheckins = dayCountValues.length > 0
    ? Math.round(dayCountValues.reduce((s, v) => s + v, 0) / dayCountValues.length)
    : 0;

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

  const onboardingGaps = notOnboardedRes.data || [];

  const yesterdayStr = format(subDays(now, 1), 'yyyy-MM-dd');
  const checkInsYesterday = checkInDayCounts[yesterdayStr] || 0;

  const lastMonthStart = subDays(startOfMonth(now), 1);
  const prevMonthStart = new Date(lastMonthStart.getFullYear(), lastMonthStart.getMonth(), 1).toISOString();
  const prevMonthEnd = startOfMonth(now).toISOString();
  const newMembersPrevMonth = members.filter(m => m.created_at >= prevMonthStart && m.created_at < prevMonthEnd).length;

  return {
    stats: {
      totalMembers: total,
      // Mutually exclusive counts: atRiskCount = 'high' only, criticalCount =
      // 'critical' only. Avoids the earlier UI bug where critical looked
      // nested inside at-risk.
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
