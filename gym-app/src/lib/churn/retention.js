/**
 * Churn Intelligence — Retention & Churn Prediction
 * ─────────────────────────────────────────────────────────────
 * Tenure risk signal, velocity calculation, and the full
 * data-fetching pipeline that computes churn scores for all
 * members in a gym.
 */

import { DEFAULT_WEIGHTS, calculateChurnScore, getRiskTier } from './riskScoring.js';
import { calculateVelocity } from './metrics.js';


// ═══════════════════════════════════════════════════════════════
//  TENURE RISK SIGNAL
// ═══════════════════════════════════════════════════════════════

/**
 * 3. TENURE RISK (15 pts)
 * Research: Dropout probability peaks within the first 3 months
 * then declines. 50% of new members quit within 6 months.
 * "Honeymoon ending" period (1-3 months) is the danger zone.
 * 24 visits in 90 days is the survival threshold.
 */
export function signalTenureRisk(tenureMonths, totalSessionsFirst90Days) {
  const MAX = 15;
  let score, label;

  if (tenureMonths < 1) {
    // Brand new — too early to tell, moderate concern
    score = Math.round(MAX * 0.55); // 8
    label = 'Brand new member (< 1 month)';
  } else if (tenureMonths <= 3) {
    // THE danger zone — check if they hit the 24-visit threshold
    if (totalSessionsFirst90Days !== null && totalSessionsFirst90Days >= 24) {
      score = Math.round(MAX * 0.25); // 4 — they crossed the threshold
      label = 'In 90-day window but hit visit milestone';
    } else {
      score = MAX; // 15 — maximum tenure risk
      label = 'In critical 90-day dropout window';
    }
  } else if (tenureMonths <= 6) {
    score = Math.round(MAX * 0.55); // 8
    label = 'Still in early risk period (3-6 months)';
  } else if (tenureMonths <= 12) {
    score = Math.round(MAX * 0.25); // 4
    label = 'Established member (6-12 months)';
  } else {
    score = Math.round(MAX * 0.07); // 1
    label = 'Long-tenure member — low base risk';
  }

  return { value: tenureMonths, score, maxPts: MAX, label };
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
      // Blend learned weights with defaults based on confidence
      // confidence = min(1, labeled_outcomes / 200)
      const c = wRow.confidence;
      gymWeights = {
        visit_frequency:    wRow.w_visit_frequency * c + DEFAULT_WEIGHTS.visit_frequency * (1 - c),
        attendance_trend:   wRow.w_attendance_trend * c + DEFAULT_WEIGHTS.attendance_trend * (1 - c),
        tenure_risk:        wRow.w_tenure_risk * c + DEFAULT_WEIGHTS.tenure_risk * (1 - c),
        social_engagement:  wRow.w_social_engagement * c + DEFAULT_WEIGHTS.social_engagement * (1 - c),
        session_gaps:       wRow.w_session_gaps * c + DEFAULT_WEIGHTS.session_gaps * (1 - c),
        goal_progress:      wRow.w_goal_progress * c + DEFAULT_WEIGHTS.goal_progress * (1 - c),
        engagement_depth:   wRow.w_engagement_depth * c + DEFAULT_WEIGHTS.engagement_depth * (1 - c),
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
    .select('id, full_name, username, created_at, gym_id, training_frequency, membership_status, assigned_program_id')
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .order('full_name', { ascending: true });

  if (membersError || !memberRows?.length) return [];

  const memberIds = memberRows.map(m => m.id);

  // ── 2-10. Parallel data fetches ───────────────────────────────
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
  ] = await Promise.all([
    // 2. Check-ins — last 60 days
    supabase
      .from('check_ins')
      .select('profile_id, checked_in_at')
      .eq('gym_id', gymId)
      .gte('checked_in_at', sixtyDaysAgo)
      .in('profile_id', memberIds)
      .order('checked_in_at', { ascending: false }),

    // 3. Workout sessions — last 90 days (need more for gap analysis)
    supabase
      .from('workout_sessions')
      .select('profile_id, status, started_at, completed_at, duration_seconds, total_volume_lbs, program_enrollment_id')
      .eq('gym_id', gymId)
      .gte('started_at', ninetyDaysAgo)
      .in('profile_id', memberIds)
      .order('started_at', { ascending: false }),

    // 4. Total session count (all time) — for tenure/engagement ratio
    supabase
      .from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .in('profile_id', memberIds),

    // 5. Friendships
    supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(
        memberIds.map(id => `requester_id.eq.${id}`).join(',') +
        ',' +
        memberIds.map(id => `addressee_id.eq.${id}`).join(',')
      ),

    // 6. Challenge participation
    supabase
      .from('challenge_participants')
      .select('profile_id')
      .in('profile_id', memberIds),

    // 7. Body weight logs — last 60 days (goal progress signal)
    supabase
      .from('body_weight_logs')
      .select('profile_id, logged_at')
      .eq('gym_id', gymId)
      .gte('logged_at', sixtyDaysAgo)
      .in('profile_id', memberIds)
      .order('logged_at', { ascending: false }),

    // 8. Trainer-client relationships
    supabase
      .from('trainer_clients')
      .select('client_id')
      .eq('gym_id', gymId)
      .in('client_id', memberIds),

    // 9. Historical churn scores for velocity
    supabase
      .from('churn_risk_scores')
      .select('profile_id, score, computed_at')
      .eq('gym_id', gymId)
      .in('profile_id', memberIds)
      .order('computed_at', { ascending: false }),

    // 10. Recent PRs (activity feed PR events in last 30 days)
    supabase
      .from('activity_feed_items')
      .select('actor_id')
      .eq('gym_id', gymId)
      .eq('type', 'pr_hit')
      .gte('created_at', thirtyDaysAgo)
      .in('actor_id', memberIds),
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

    const avgWeeklyVisits = (checkInsLast30[m.id] || 0) / 4.33;
    const prevAvgWeeklyVisits = (checkInsPrior30[m.id] || 0) / 4.33;

    const sm = sessionMetrics[m.id] || {};
    const avgDurLast30 = sm.durationsLast30?.length
      ? sm.durationsLast30.reduce((a, b) => a + b, 0) / sm.durationsLast30.length
      : 0;
    const avgDurPrior30 = sm.durationsPrior30?.length
      ? sm.durationsPrior30.reduce((a, b) => a + b, 0) / sm.durationsPrior30.length
      : 0;

    const memberData = {
      avgWeeklyVisits,
      prevAvgWeeklyVisits,
      trainingFrequency: m.training_frequency || 3,
      tenureMonths,
      totalSessionsFirst90Days: tenureMonths <= 4 ? (sessionsFirst90Map[m.id] ?? null) : null,
      friendCount: friendCountMap[m.id] || 0,
      challengeParticipation: challengeSet.has(m.id),
      hasTrainer: trainerSet.has(m.id),
      sessionGaps: sm.gaps || [],
      hasPRsRecently: prSet.has(m.id),
      hasBodyProgress: bodyTrackingSet.has(m.id),
      completedProgramPct: null, // TODO: compute from program enrollment data
      completedSessions: (sm.completedLast30 || 0),
      abandonedSessions: (sm.abandonedLast30 || 0),
      avgDurationLast30: avgDurLast30,
      avgDurationPrior30: avgDurPrior30,
    };

    const result = calculateChurnScore(memberData, gymWeights);
    const velocityData = calculateVelocity(historyMap[m.id] || []);

    return {
      ...m,
      username: m.username || m.full_name,
      tenureMonths,
      daysSinceLastCheckIn,
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
