import { supabase } from '../supabase';
import logger from '../logger';
import { selectAllRows } from '../churn/batchedSelect';
import { format, subDays, startOfMonth } from 'date-fns';
import { loadGymChurnScores, estimateChurnScoreFallback } from '../churnScore';
import { withQueryTimeout } from '../queryWithTimeout';

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

  // Wrapped in withQueryTimeout so a stalled Supabase fetch surfaces as an
  // error to React Query instead of hanging React forever. Without this,
  // a single dead socket on any of these six parallel calls would freeze
  // the entire admin overview on its skeleton — see queryWithTimeout.js.
  const [
    scoredMembers,
    membersRes, sessionsRes, churnScoresRes,
    notOnboardedRes, checkInsRes,
  ] = await withQueryTimeout(Promise.all([
    loadGymChurnScores(gymId, supabase).catch(err => {
      logger.error('AdminOverview v2 churn scoring failed:', err);
      return null;
    }),
    // Page the full sets — .limit(N) is clamped to the ~1000-row max_rows cap,
    // so member count / retention / active-rate and the churn histogram were
    // wrong for any gym over ~1000 members or 1000 recent sessions.
    selectAllRows((from, to) => supabase.from('profiles').select('id, full_name, username, role, created_at, gym_id, last_active_at, membership_status, avatar_url').eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false).range(from, to)),
    selectAllRows((from, to) => supabase.from('workout_sessions').select('profile_id, started_at, total_volume_lbs').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', twentyEightDaysAgo).order('started_at', { ascending: false }).range(from, to)),
    selectAllRows((from, to) => supabase.from('churn_risk_scores').select('profile_id, score, risk_tier, key_signals, computed_at').eq('gym_id', gymId).order('score', { ascending: false }).range(from, to)),
    supabase.from('profiles').select('id').eq('gym_id', gymId).eq('role', 'member').eq('is_onboarded', false).eq('imported_archived', false).gte('created_at', fortyEightHoursAgo).limit(500),
    // Left-join the member's name/avatar (no !inner) so a check-in still renders
    // in the activity feed even when its profile is outside the members query's
    // filters (e.g. archived imports) or otherwise not in memberMap. The weekly
    // pulse uses this same array and just ignores the extra columns.
    selectAllRows((from, to) => supabase.from('check_ins').select('profile_id, checked_in_at, profiles(full_name, avatar_url)').eq('gym_id', gymId).gte('checked_in_at', subDays(now, 30).toISOString()).order('checked_in_at', { ascending: false }).range(from, to)),
  ]), 15_000, 'fetchOverviewData:primary');

  const { data: todayCheckins, error: todayCheckinsErr } = await withQueryTimeout(
    supabase
      .from('check_ins').select('id, profile_id, checked_in_at')
      .eq('gym_id', gymId).gte('checked_in_at', todayStart)
      .order('checked_in_at', { ascending: false }).limit(500),
    10_000,
    'fetchOverviewData:todayCheckins',
  );
  if (todayCheckinsErr) logger.error('AdminOverview todayCheckins:', todayCheckinsErr);

  // Today's classes count (active gym_class with schedule for this dow OR today's date)
  const todayDow = now.getDay();
  const todayDate = format(now, 'yyyy-MM-dd');
  const { data: classSchedules, error: classSchedulesErr } = await withQueryTimeout(
    supabase
      .from('gym_class_schedules')
      .select('id, gym_class:gym_classes!inner(id, gym_id, is_active)')
      .eq('gym_class.gym_id', gymId)
      .eq('gym_class.is_active', true)
      .or(`day_of_week.eq.${todayDow},specific_date.eq.${todayDate}`)
      .limit(200),
    10_000,
    'fetchOverviewData:classSchedules',
  );
  if (classSchedulesErr) logger.error('AdminOverview classSchedules:', classSchedulesErr);

  // KPI extras — card-delivery backlog + active-challenge count (two retention
  // levers surfaced on the strip). Cheap head counts; non-critical, so any
  // failure just leaves them at 0 rather than failing the whole overview.
  let cardsPending = 0, cardsDelivered = 0, activeChallenges = 0, activeChallengesPrev = 0;
  try {
    const nowIso = now.toISOString();
    const monthAgoIso = subDays(now, 30).toISOString();
    const [pendingCardsRes, deliveredCardsRes, activeChallengesRes, activeChallengesPrevRes] = await withQueryTimeout(Promise.all([
      supabase.from('print_cards').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).in('status', ['pending', 'printed']),
      supabase.from('print_cards').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('status', 'delivered'),
      supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).lte('start_date', nowIso).gte('end_date', nowIso),
      // Challenges that were live ~30 days ago → the "vs last month" baseline.
      supabase.from('challenges').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).lte('start_date', monthAgoIso).gte('end_date', monthAgoIso),
    ]), 10_000, 'fetchOverviewData:kpiExtras');
    cardsPending = pendingCardsRes?.count ?? 0;
    cardsDelivered = deliveredCardsRes?.count ?? 0;
    activeChallenges = activeChallengesRes?.count ?? 0;
    activeChallengesPrev = activeChallengesPrevRes?.count ?? 0;
  } catch (err) {
    logger.error('AdminOverview kpiExtras:', err);
  }

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

  // ── Real retention (NOT churn-risk). "Churned" = explicitly left (membership
  // cancelled/deactivated) OR activity too stale to assume they're still around
  // (≥30 days inactive, 7-day grace for brand-new joins) — the same activity
  // rule as AdminChurn's "Churned" tab. Critical RISK ≠ churned: an at-risk
  // member is still here, just trending out. Among retained members we still
  // count how many are at risk so the card can show the full health split.
  const CHURN_STALE_DAYS = 30;
  const NEW_JOIN_GRACE_DAYS = 7;
  const isChurnedMember = (m) => {
    // Explicitly left: any status that isn't active or frozen (frozen = paused,
    // still a member). Catches cancelled / deactivated / expired / etc.
    const st = m.membership_status;
    if (st && st !== 'active' && st !== 'frozen') return true;
    if (daysSince(m.created_at) < NEW_JOIN_GRACE_DAYS) return false; // too new to judge
    return (m.daysInactive ?? 0) >= CHURN_STALE_DAYS;
  };
  let churnedCount = 0, retainedAtRisk = 0, retainedHealthy = 0;
  allMemberScores.forEach((m) => {
    if (isChurnedMember(m)) { churnedCount++; return; }
    if (m.risk_tier === 'critical' || m.risk_tier === 'high') retainedAtRisk++;
    else retainedHealthy++;
  });
  const retention = {
    total,
    churned: churnedCount,
    retained: total - churnedCount,
    atRisk: retainedAtRisk,
    healthy: retainedHealthy,
    retentionPct: total > 0 ? Math.round(((total - churnedCount) / total) * 100) : 0,
  };

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
  // Recent-activity check-ins come from the 30-day `checkIns` array (same source
  // as the weekly pulse), NOT the today-only query — otherwise they vanish from
  // the feed any time nobody happened to check in *today* (early morning, sparse
  // gyms), even though there are plenty of recent ones. `checkIns` is already
  // ordered checked_in_at desc, so slice(0, 10) is the 10 most recent. This now
  // matches the wide-window pattern used by recentWorkouts (28d) / recentSignups (7d).
  const recentCheckins = checkIns.slice(0, 10).map(c => ({
    type: 'checkin', profile_id: c.profile_id, timestamp: c.checked_in_at,
    // Prefer the joined profile, fall back to memberMap (covers either source
    // returning the name) so the row never shows a blank/Unknown member.
    memberName: c.profiles?.full_name || memberMap[c.profile_id]?.full_name || null,
    avatarUrl: c.profiles?.avatar_url || memberMap[c.profile_id]?.avatar_url || null,
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

  // ── Weekly pulse — this week vs the prior week, derived entirely from data
  // already fetched above (no extra queries). Powers "Pulso de la semana" so
  // the overview reads as a business dashboard, not just a churn list.
  let ciThis = 0, ciPrev = 0;
  checkIns.forEach(c => {
    if (c.checked_in_at >= sevenDaysAgo) ciThis++;
    else if (c.checked_in_at >= fourteenDaysAgo) ciPrev++;
  });
  let woThis = 0, woPrev = 0;
  const activePrevWeekIds = new Set();
  sessions.forEach(s => {
    if (s.started_at >= sevenDaysAgo) woThis++;
    else if (s.started_at >= fourteenDaysAgo) { woPrev++; activePrevWeekIds.add(s.profile_id); }
  });
  let nmThis = 0, nmPrev = 0;
  members.forEach(m => {
    if (m.created_at >= sevenDaysAgo) nmThis++;
    else if (m.created_at >= fourteenDaysAgo) nmPrev++;
  });
  // 14-day check-in sparkline (oldest → newest).
  const series14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = subDays(now, i);
    series14.push({ count: checkInDayCounts[format(d, 'yyyy-MM-dd')] || 0, label: format(d, 'd'), dow: d.getDay(), iso: format(d, 'yyyy-MM-dd') });
  }
  // Re-derive this-week / last-week check-in totals from the SAME 14 calendar
  // days the sparkline draws (last 7 bars = this week, first 7 = last week), so
  // the pulse headline always equals the sum of the highlighted bars exactly.
  ciThis = series14.slice(7).reduce((a, d) => a + d.count, 0);
  ciPrev = series14.slice(0, 7).reduce((a, d) => a + d.count, 0);
  const pulse = {
    checkins:   { current: ciThis, prev: ciPrev },
    workouts:   { current: woThis, prev: woPrev },
    newMembers: { current: nmThis, prev: nmPrev },
    active:     { current: activeThisWeekIds.size, prev: activePrevWeekIds.size,
                 pct: total > 0 ? Math.round((activeThisWeekIds.size / total) * 100) : 0 },
    series14,
  };

  // New members per MONTH across the current calendar year (Jan–Dec), derived
  // from the already-fetched members list (no extra query). Months that haven't
  // started yet are flagged isFuture so the chart greys them out — the year's
  // growth shape, and any drop-off, reads at a glance.
  const growthYear = now.getFullYear();
  const currentMonth = now.getMonth();
  // Per-day join counts for this year → lets us build per-month weekly buckets
  // (powering the Crecimiento hover tooltip: joins per week + date range) cheaply.
  const joinDayCounts = {};
  members.forEach((mem) => {
    const c = new Date(mem.created_at);
    if (c.getFullYear() === growthYear) {
      const key = format(c, 'yyyy-MM-dd');
      joinDayCounts[key] = (joinDayCounts[key] || 0) + 1;
    }
  });
  const growthSeries = [];
  for (let m = 0; m < 12; m++) {
    const isFuture = m > currentMonth;
    const daysInMonth = new Date(growthYear, m + 1, 0).getDate();
    const weeks = [];
    let monthCount = 0;
    if (!isFuture) {
      // 7-day buckets from the 1st (last bucket may be partial), each with its
      // day range + join count.
      for (let startDay = 1; startDay <= daysInMonth; startDay += 7) {
        const endDay = Math.min(startDay + 6, daysInMonth);
        let wkCount = 0;
        for (let d = startDay; d <= endDay; d++) {
          wkCount += joinDayCounts[format(new Date(growthYear, m, d), 'yyyy-MM-dd')] || 0;
        }
        weeks.push({ startDay, endDay, count: wkCount });
        monthCount += wkCount;
      }
    }
    growthSeries.push({ count: monthCount, month: m, isFuture, isCurrent: m === currentMonth, weeks });
  }

  return {
    pulse,
    growthSeries,
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
      activeRate: total > 0 ? Math.round((activeThisWeekIds.size / total) * 100) : 0,
      classesToday: new Set((classSchedules || []).map(s => s.gym_class?.id).filter(Boolean)).size,
      avgDailyCheckins,
      cardsPending, cardsDelivered, activeChallenges, activeChallengesPrev,
    },
    retention, riskTiers, atRisk, recentActivity,
    onboardingCount: onboardingGaps.length,
    _dbScoreCount: churnScores.length, _totalMembers: total,
  };
}
