/**
 * Churn Intelligence — Retention & Churn Prediction
 * ─────────────────────────────────────────────────────────────
 * Tenure risk signal, velocity calculation, and the full
 * data-fetching pipeline that computes churn scores for all
 * members in a gym.
 */

import { DEFAULT_WEIGHTS, calculateChurnScore } from './riskScoring.js';
import { calculateVelocity } from './metrics.js';
import { signalTenureRiskV2 } from './churnSignalsV2.js';

/** @deprecated Use churnSignalsV2 (12-signal model). Kept for callers expecting { value, score, maxPts, label }. */
export function signalTenureRisk(tenureMonths, totalSessionsFirst90Days) {
  const r = signalTenureRiskV2(tenureMonths, totalSessionsFirst90Days);
  return { ...r, value: tenureMonths };
}

function getDayOfWeekUtc(dateStr) {
  return new Date(dateStr).getUTCDay();
}


// ═══════════════════════════════════════════════════════════════
//  DATA FETCHING — FULL PIPELINE
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch all members for a gym, compute churn metrics and scores.
 * Loads per-gym adaptive weights if available, otherwise uses defaults.
 * Returns array sorted by churnScore descending.
 */
export async function fetchMembersWithChurnScores(gymId, supabase) {
  const now = new Date();
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  const ninetyDaysAgo = new Date(now - 90 * MS_PER_DAY).toISOString();
  const sixtyDaysAgo = new Date(now - 60 * MS_PER_DAY).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * MS_PER_DAY).toISOString();

  // ── 0. Load per-gym adaptive weights ────────────────────────
  let gymWeights = DEFAULT_WEIGHTS;
  let gymWeightsMeta = null;
  try {
    const { data: wRow } = await supabase
      .from('gym_churn_weights')
      .select('*')
      .eq('gym_id', gymId)
      .single();

    if (wRow && wRow.confidence > 0) {
      const c = wRow.confidence;
      const blend = (col, key) =>
        (wRow[col] != null ? wRow[col] : DEFAULT_WEIGHTS[key]) * c + DEFAULT_WEIGHTS[key] * (1 - c);
      gymWeights = {
        visit_frequency: blend('w_visit_frequency', 'visit_frequency'),
        attendance_trend: blend('w_attendance_trend', 'attendance_trend'),
        tenure_risk: blend('w_tenure_risk', 'tenure_risk'),
        social_engagement: blend('w_social_engagement', 'social_engagement'),
        session_gaps: blend('w_session_gaps', 'session_gaps'),
        goal_progress: blend('w_goal_progress', 'goal_progress'),
        engagement_depth: blend('w_engagement_depth', 'engagement_depth'),
        anchor_day: blend('w_anchor_day', 'anchor_day'),
        app_engagement: blend('w_app_engagement', 'app_engagement'),
        comms_responsiveness: blend('w_comms_responsiveness', 'comms_responsiveness'),
        referral_activity: blend('w_referral_activity', 'referral_activity'),
        workout_type_shift: blend('w_workout_type_shift', 'workout_type_shift'),
      };
      gymWeightsMeta = {
        confidence: c,
        labeledOutcomes: wRow.labeled_outcomes,
        lastCalibratedAt: wRow.last_calibrated_at,
        calibrationAuc: wRow.calibration_auc,
      };
    }
  } catch (_) {
    // Table may not exist yet — use defaults
  }

  // ── 1. Member profiles ───────────────────────────────────────
  const { data: memberRows, error: membersError } = await supabase
    .from('profiles')
    .select('id, full_name, username, created_at, gym_id, training_frequency')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .order('full_name', { ascending: true });

  if (membersError || !memberRows?.length) return [];

  const memberIds = memberRows.map(m => m.id);

  const OUTREACH_TYPES_ARR = ['churn_followup', 'admin_message', 'win_back'];

  // ── 2–14. Parallel data fetches ───────────────────────────────
  const [
    attendanceRes,
    sessionsRes,
    allSessionsRes,
    friendshipRes,
    challengeRes,
    bodyWeightRes,
    trainerClientsRes,
    historyRes,
    prsRes,
    scheduleRes,
    notifRes,
    outreachRes,
    referralsRes,
    socialFeedRes,
  ] = await Promise.all([
    supabase
      .from('check_ins')
      .select('profile_id, checked_in_at')
      .eq('gym_id', gymId)
      .gte('checked_in_at', sixtyDaysAgo)
      .in('profile_id', memberIds)
      .order('checked_in_at', { ascending: false }),

    supabase
      .from('workout_sessions')
      .select('profile_id, status, started_at, completed_at, duration_seconds, total_volume_lbs, program_enrollment_id')
      .eq('gym_id', gymId)
      .gte('started_at', ninetyDaysAgo)
      .in('profile_id', memberIds)
      .order('started_at', { ascending: false }),

    supabase
      .from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .in('profile_id', memberIds),

    supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(
        memberIds.map(id => `requester_id.eq.${id}`).join(',') +
        ',' +
        memberIds.map(id => `addressee_id.eq.${id}`).join(',')
      ),

    supabase
      .from('challenge_participants')
      .select('profile_id')
      .in('profile_id', memberIds),

    supabase
      .from('body_weight_logs')
      .select('profile_id, logged_at')
      .eq('gym_id', gymId)
      .gte('logged_at', sixtyDaysAgo)
      .in('profile_id', memberIds)
      .order('logged_at', { ascending: false }),

    supabase
      .from('trainer_clients')
      .select('client_id')
      .eq('gym_id', gymId)
      .in('client_id', memberIds),

    supabase
      .from('churn_risk_scores')
      .select('profile_id, score, computed_at')
      .eq('gym_id', gymId)
      .in('profile_id', memberIds)
      .order('computed_at', { ascending: false }),

    supabase
      .from('activity_feed_items')
      .select('actor_id')
      .eq('gym_id', gymId)
      .eq('type', 'pr_hit')
      .gte('created_at', thirtyDaysAgo)
      .in('actor_id', memberIds),

    supabase
      .from('workout_schedule')
      .select('profile_id, day_of_week')
      .in('profile_id', memberIds)
      .limit(5000),

    supabase
      .from('notifications')
      .select('profile_id, read_at, created_at')
      .gte('created_at', thirtyDaysAgo)
      .in('profile_id', memberIds)
      .limit(10000),

    supabase
      .from('notifications')
      .select('profile_id, created_at, type')
      .in('type', OUTREACH_TYPES_ARR)
      .in('profile_id', memberIds)
      .limit(5000),

    supabase
      .from('referrals')
      .select('referrer_id')
      .in('referrer_id', memberIds)
      .limit(5000),

    supabase
      .from('activity_feed_items')
      .select('actor_id, created_at')
      .eq('gym_id', gymId)
      .gte('created_at', thirtyDaysAgo)
      .in('actor_id', memberIds)
      .order('created_at', { ascending: false })
      .limit(5000),
  ]);

  const checkInRows = attendanceRes.data || [];
  const sessionRows = sessionsRes.data || [];
  const allSessionRows = allSessionsRes.data || [];
  const friendshipRows = friendshipRes.data || [];
  const challengeRows = challengeRes.data || [];
  const bodyWeightRows = bodyWeightRes.data || [];
  const trainerClientRows = trainerClientsRes.data || [];
  const historyRows = historyRes.data || [];
  const prRows = prsRes.data || [];
  const scheduleRows = scheduleRes.data || [];
  const notifRows = notifRes.data || [];
  const outreachRows = outreachRes.data || [];
  const referralRows = referralsRes.data || [];
  const socialFeedRows = socialFeedRes.data || [];

  const { data: sidL30 } = await supabase
    .from('workout_sessions')
    .select('id, profile_id')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', thirtyDaysAgo)
    .in('profile_id', memberIds)
    .limit(5000);
  const { data: sidP30 } = await supabase
    .from('workout_sessions')
    .select('id, profile_id')
    .eq('gym_id', gymId)
    .eq('status', 'completed')
    .gte('started_at', sixtyDaysAgo)
    .lt('started_at', thirtyDaysAgo)
    .in('profile_id', memberIds)
    .limit(5000);

  const sessionToProfile = {};
  (sidL30 || []).forEach((s) => { sessionToProfile[s.id] = s.profile_id; });
  (sidP30 || []).forEach((s) => { sessionToProfile[s.id] = s.profile_id; });
  const idsL = (sidL30 || []).map((s) => s.id).slice(0, 2000);
  const idsP = (sidP30 || []).map((s) => s.id).slice(0, 2000);

  let exL = [];
  let exP = [];
  if (idsL.length) {
    const { data } = await supabase.from('session_exercises').select('session_id, muscle_group').in('session_id', idsL).limit(10000);
    exL = data || [];
  }
  if (idsP.length) {
    const { data } = await supabase.from('session_exercises').select('session_id, muscle_group').in('session_id', idsP).limit(10000);
    exP = data || [];
  }

  const muscleGroupSetsL = {};
  const muscleGroupSetsP = {};
  exL.forEach((r) => {
    const pid = sessionToProfile[r.session_id];
    if (!pid || !r.muscle_group) return;
    if (!muscleGroupSetsL[pid]) muscleGroupSetsL[pid] = new Set();
    muscleGroupSetsL[pid].add(r.muscle_group);
  });
  exP.forEach((r) => {
    const pid = sessionToProfile[r.session_id];
    if (!pid || !r.muscle_group) return;
    if (!muscleGroupSetsP[pid]) muscleGroupSetsP[pid] = new Set();
    muscleGroupSetsP[pid].add(r.muscle_group);
  });

  // ── Build lookup maps ──────────────────────────────────────────

  // Last check-in per member
  const lastCheckInMap = {};
  checkInRows.forEach(row => {
    if (!lastCheckInMap[row.profile_id]) lastCheckInMap[row.profile_id] = row.checked_in_at;
  });

  // Check-ins bucketed by 30-day windows
  const checkInsLast30 = {};
  const checkInsPrior30 = {};
  checkInRows.forEach(row => {
    const uid = row.profile_id;
    if (row.checked_in_at >= thirtyDaysAgo) {
      checkInsLast30[uid] = (checkInsLast30[uid] || 0) + 1;
    } else {
      checkInsPrior30[uid] = (checkInsPrior30[uid] || 0) + 1;
    }
  });

  // Session metrics per member (90-day window)
  const sessionMetrics = {};
  sessionRows.forEach(row => {
    const uid = row.profile_id;
    if (!sessionMetrics[uid]) {
      sessionMetrics[uid] = {
        completedLast30: 0, abandonedLast30: 0,
        completedPrior: 0, abandonedPrior: 0,
        durationsLast30: [], durationsPrior30: [],
        sessionDates: [],
      };
    }
    const sm = sessionMetrics[uid];
    const isRecent = row.started_at >= thirtyDaysAgo;

    if (row.status === 'completed') {
      if (isRecent) sm.completedLast30++;
      else sm.completedPrior++;
      if (row.duration_seconds) {
        if (isRecent) sm.durationsLast30.push(row.duration_seconds);
        else sm.durationsPrior30.push(row.duration_seconds);
      }
    } else if (row.status === 'abandoned') {
      if (isRecent) sm.abandonedLast30++;
      else sm.abandonedPrior++;
    }

    if (row.started_at) sm.sessionDates.push(new Date(row.started_at));
  });

  // Compute session gaps per member
  Object.values(sessionMetrics).forEach(sm => {
    sm.sessionDates.sort((a, b) => b - a);
    sm.gaps = [];
    for (let i = 0; i < sm.sessionDates.length - 1; i++) {
      sm.gaps.push((sm.sessionDates[i] - sm.sessionDates[i + 1]) / MS_PER_DAY);
    }
  });

  // Total sessions (all time) + sessions in first 90 days of membership
  const totalSessionsMap = {};
  const sessionsFirst90Map = {};
  allSessionRows.forEach(row => {
    totalSessionsMap[row.profile_id] = (totalSessionsMap[row.profile_id] || 0) + 1;
  });

  // Count sessions in each member's first 90 days
  memberRows.forEach(m => {
    const joinDate = new Date(m.created_at);
    const cutoff = new Date(joinDate.getTime() + 90 * MS_PER_DAY);
    const count = allSessionRows.filter(
      r => r.profile_id === m.id && new Date(r.started_at) <= cutoff
    ).length;
    sessionsFirst90Map[m.id] = count;
  });

  // Friend count
  const friendCountMap = {};
  friendshipRows.forEach(row => {
    friendCountMap[row.requester_id] = (friendCountMap[row.requester_id] || 0) + 1;
    friendCountMap[row.addressee_id] = (friendCountMap[row.addressee_id] || 0) + 1;
  });

  // Challenge participation
  const challengeSet = new Set(challengeRows.map(r => r.profile_id));

  // Trainer relationships
  const trainerSet = new Set(trainerClientRows.map(r => r.client_id));

  // Body tracking (has logs in last 60 days)
  const bodyTrackingSet = new Set(bodyWeightRows.map(r => r.profile_id));

  // Recent PRs
  const prSet = new Set(prRows.map(r => r.actor_id));

  const scheduledDays = {};
  scheduleRows.forEach((r) => {
    if (!scheduledDays[r.profile_id]) scheduledDays[r.profile_id] = [];
    if (!scheduledDays[r.profile_id].includes(r.day_of_week)) scheduledDays[r.profile_id].push(r.day_of_week);
  });

  const recentSessionWeeks = {};
  const twentyOneMs = now.getTime() - 21 * MS_PER_DAY;
  sessionRows.forEach((r) => {
    if (r.status !== 'completed' || !r.started_at) return;
    if (new Date(r.started_at).getTime() < twentyOneMs) return;
    const pid = r.profile_id;
    if (!recentSessionWeeks[pid]) recentSessionWeeks[pid] = [[], [], []];
    const daysAgo = (now.getTime() - new Date(r.started_at).getTime()) / MS_PER_DAY;
    const weekIdx = Math.min(2, Math.floor(daysAgo / 7));
    const dow = getDayOfWeekUtc(r.started_at);
    if (!recentSessionWeeks[pid][weekIdx].includes(dow)) recentSessionWeeks[pid][weekIdx].push(dow);
  });

  const notifTotal = {};
  const notifRead = {};
  notifRows.forEach((r) => {
    notifTotal[r.profile_id] = (notifTotal[r.profile_id] || 0) + 1;
    if (r.read_at) notifRead[r.profile_id] = (notifRead[r.profile_id] || 0) + 1;
  });

  const outreachByMember = {};
  outreachRows.forEach((r) => {
    if (!outreachByMember[r.profile_id]) outreachByMember[r.profile_id] = [];
    outreachByMember[r.profile_id].push({ created_at: r.created_at });
  });

  const referralCount = {};
  referralRows.forEach((r) => {
    referralCount[r.referrer_id] = (referralCount[r.referrer_id] || 0) + 1;
  });

  const lastSocialAt = {};
  socialFeedRows.forEach((r) => {
    if (!lastSocialAt[r.actor_id]) lastSocialAt[r.actor_id] = new Date(r.created_at);
  });

  const memberActivityDates = {};
  sessionRows.forEach((r) => {
    if (!r.started_at) return;
    if (!memberActivityDates[r.profile_id]) memberActivityDates[r.profile_id] = [];
    memberActivityDates[r.profile_id].push(new Date(r.started_at));
  });
  checkInRows.forEach((r) => {
    if (!memberActivityDates[r.profile_id]) memberActivityDates[r.profile_id] = [];
    memberActivityDates[r.profile_id].push(new Date(r.checked_in_at));
  });

  // Historical scores for velocity
  const historyMap = {};
  historyRows.forEach(row => {
    if (!historyMap[row.profile_id]) historyMap[row.profile_id] = [];
    historyMap[row.profile_id].push(row);
  });

  // ── Compute scores ─────────────────────────────────────────────
  const scored = memberRows.map(m => {
    const createdAt = new Date(m.created_at);
    const tenureMonths = (now - createdAt) / (MS_PER_DAY * 30.44);

    const lastCheckIn = lastCheckInMap[m.id] ?? null;
    const daysSinceLastCheckIn = lastCheckIn
      ? (now - new Date(lastCheckIn)) / MS_PER_DAY
      : null;

    const sm = sessionMetrics[m.id] || {};

    const checkInMs = lastCheckIn ? new Date(lastCheckIn).getTime() : 0;
    const lastWorkoutMs = sm.sessionDates?.length
      ? Math.max(...sm.sessionDates.map((d) => d.getTime()))
      : 0;
    const socialMs = lastSocialAt[m.id] ? lastSocialAt[m.id].getTime() : 0;
    const lastActivityMs = Math.max(checkInMs, lastWorkoutMs, socialMs);
    const daysSinceLastActivity = lastActivityMs > 0
      ? (now - lastActivityMs) / MS_PER_DAY
      : null;
    const lastActivityAt = lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null;

    const avgWeeklyVisits = (checkInsLast30[m.id] || 0) / 4.33;
    const prevAvgWeeklyVisits = (checkInsPrior30[m.id] || 0) / 4.33;
    const avgDurLast30 = sm.durationsLast30?.length
      ? sm.durationsLast30.reduce((a, b) => a + b, 0) / sm.durationsLast30.length
      : 0;
    const avgDurPrior30 = sm.durationsPrior30?.length
      ? sm.durationsPrior30.reduce((a, b) => a + b, 0) / sm.durationsPrior30.length
      : 0;

    const outreach = outreachByMember[m.id] || [];
    let respondedCount = 0;
    const activityDates = memberActivityDates[m.id] || [];
    for (const o of outreach) {
      const outreachDate = new Date(o.created_at);
      const sevenDaysAfter = new Date(outreachDate.getTime() + 7 * MS_PER_DAY);
      if (activityDates.some((d) => d > outreachDate && d <= sevenDaysAfter)) respondedCount++;
    }

    const memberData = {
      avgWeeklyVisits,
      prevAvgWeeklyVisits,
      trainingFrequency: m.training_frequency ?? 3,
      tenureMonths,
      totalSessionsFirst90Days: tenureMonths <= 4 ? (sessionsFirst90Map[m.id] ?? null) : null,
      friendCount: friendCountMap[m.id] || 0,
      challengeParticipation: challengeSet.has(m.id),
      hasTrainer: trainerSet.has(m.id),
      sessionGaps: sm.gaps || [],
      hasPRsRecently: prSet.has(m.id),
      hasBodyProgress: bodyTrackingSet.has(m.id),
      completedProgramPct: null,
      completedSessions: (sm.completedLast30 || 0),
      abandonedSessions: (sm.abandonedLast30 || 0),
      avgDurationLast30: avgDurLast30,
      avgDurationPrior30: avgDurPrior30,
      scheduledDays: scheduledDays[m.id] || [],
      recentSessionWeeks: recentSessionWeeks[m.id] || [[], [], []],
      notifTotal: notifTotal[m.id] || 0,
      notifRead: notifRead[m.id] || 0,
      daysSinceLastAction: lastActivityMs > 0
        ? Math.floor((now.getTime() - lastActivityMs) / MS_PER_DAY)
        : 999,
      outreachCount: outreach.length,
      respondedCount,
      referralCount: referralCount[m.id] || 0,
      muscleGroupsLast30: muscleGroupSetsL[m.id]?.size ?? 0,
      muscleGroupsPrev30: muscleGroupSetsP[m.id]?.size ?? 0,
    };

    const result = calculateChurnScore(memberData, gymWeights);
    const velocityData = calculateVelocity(historyMap[m.id] || []);

    return {
      ...m,
      username: m.username || m.full_name,
      tenureMonths,
      daysSinceLastCheckIn,
      daysSinceLastActivity,
      lastActivityAt,
      lastCheckInAt: lastCheckIn,
      avgWeeklyVisits,
      prevAvgWeeklyVisits,
      challengeParticipation: challengeSet.has(m.id),
      friendCount: friendCountMap[m.id] || 0,
      totalSessions: totalSessionsMap[m.id] || 0,
      // v2 — detailed breakdown
      churnScore: result.score,
      riskTier: result.riskTier,
      signals: result.signals,
      keySignals: result.keySignals,
      keySignal: result.keySignals[0] || 'Engagement looks healthy',
      velocity: velocityData.velocity,
      velocityTrend: velocityData.trend,
      velocityLabel: velocityData.label,
      // Adaptive weights metadata
      gymWeightsMeta,
      metrics: memberData,
    };
  });

  return scored.sort((a, b) => b.churnScore - a.churnScore);
}
