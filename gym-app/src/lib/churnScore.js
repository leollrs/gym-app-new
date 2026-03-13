/**
 * Churn Intelligence Library v2
 * ─────────────────────────────────────────────────────────────
 * Evidence-based churn risk scoring for gym member retention.
 * Weights derived from published research:
 *
 *   - RandomForest feature importance: lifetime=0.277,
 *     recent_class_freq=0.174, total_class_freq=0.131, age=0.129
 *     (Bolotov 2024; PerfectGym ML studies)
 *   - "dayswfreq" (days with visits) is the single most reliable
 *     dropout predictor (Gómez-Gallego et al., 2021)
 *   - 50% of new members quit within 6 months; first 90 days
 *     are critical — 80% who visit <1x/week in month 1 cancel
 *     within 6 months (IHRSA; GymMaster 2025)
 *   - Group class participants 56% less likely to cancel;
 *     members with a gym friend 40% less likely (SmartHealthClubs)
 *   - Members achieving milestones in first 90 days are 60%
 *     more likely to stay (IHRSA)
 *   - Each additional monthly visit reduces cancel risk by 33%
 *     (FitnessKPI predictive analytics research)
 *
 * Score 0–100. Higher = higher churn risk.
 *
 * SIGNAL WEIGHTS (100 pts total):
 *   1. Visit frequency           — 28 pts  (strongest predictor)
 *   2. Recent attendance trend    — 17 pts  (current vs prior period)
 *   3. Tenure risk               — 15 pts  (first 90 days critical)
 *   4. Social & group engagement  — 14 pts  (friends + challenges)
 *   5. Session gap pattern        — 10 pts  (accelerating gaps)
 *   6. Goal progress / milestones —  9 pts  (early achievement)
 *   7. Engagement depth           —  7 pts  (completion, tracking)
 * ─────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════
//  SIGNAL CALCULATORS
//  Each returns { value, score, maxPts, label }
// ═══════════════════════════════════════════════════════════════

/**
 * 1. VISIT FREQUENCY (28 pts)
 * Research: "dayswfreq" is the single most reliable dropout predictor.
 * Members visiting 2+/week are 50% less likely to cancel.
 * Members visiting <1x/week in first month → 80% cancel within 6 months.
 */
function signalVisitFrequency(avgWeeklyVisits, trainingFrequencyGoal) {
  const MAX = 28;
  // Compare actual visits to either their stated goal or 2x/week baseline
  const target = Math.max(trainingFrequencyGoal || 3, 2);
  const ratio = target > 0 ? avgWeeklyVisits / target : 0;

  let score, label;
  if (avgWeeklyVisits === 0) {
    score = MAX;
    label = 'Zero visits in last 30 days';
  } else if (ratio < 0.25) {
    score = Math.round(MAX * 0.85); // 24
    label = `Only ${avgWeeklyVisits.toFixed(1)}x/week (goal: ${target}x)`;
  } else if (ratio < 0.5) {
    score = Math.round(MAX * 0.65); // 18
    label = `Visiting ${avgWeeklyVisits.toFixed(1)}x/week (50% below goal)`;
  } else if (ratio < 0.75) {
    score = Math.round(MAX * 0.35); // 10
    label = `Visiting ${avgWeeklyVisits.toFixed(1)}x/week (below goal)`;
  } else if (ratio < 1.0) {
    score = Math.round(MAX * 0.15); // 4
    label = `Nearly hitting visit goal (${avgWeeklyVisits.toFixed(1)}x/week)`;
  } else {
    score = 0;
    label = 'Meeting or exceeding visit frequency goal';
    // Bonus: consistent visitors reduce overall risk
    if (ratio >= 1.25) score = -3;
  }

  return { value: avgWeeklyVisits, score, maxPts: MAX, label };
}

/**
 * 2. RECENT ATTENDANCE TREND (17 pts)
 * Research: Behavior changes detectable 60-90 days before churn.
 * Current-month class frequency has ~17% feature importance.
 */
function signalAttendanceTrend(avgWeeklyVisits, prevAvgWeeklyVisits) {
  const MAX = 17;

  if (prevAvgWeeklyVisits <= 0.2) {
    // No meaningful prior baseline to compare
    if (avgWeeklyVisits === 0) {
      return { value: null, score: 8, maxPts: MAX, label: 'No established visit pattern' };
    }
    return { value: null, score: 0, maxPts: MAX, label: 'New — building baseline' };
  }

  const dropPct = (prevAvgWeeklyVisits - avgWeeklyVisits) / prevAvgWeeklyVisits;

  let score, label;
  if (dropPct >= 0.75) {
    score = MAX;
    label = `Visit frequency crashed ${Math.round(dropPct * 100)}%`;
  } else if (dropPct >= 0.5) {
    score = Math.round(MAX * 0.75); // 13
    label = `Visit frequency dropped ${Math.round(dropPct * 100)}%`;
  } else if (dropPct >= 0.3) {
    score = Math.round(MAX * 0.5); // 9
    label = `Visit frequency declined ${Math.round(dropPct * 100)}%`;
  } else if (dropPct >= 0.15) {
    score = Math.round(MAX * 0.25); // 4
    label = `Slight attendance dip (${Math.round(dropPct * 100)}%)`;
  } else if (dropPct < -0.15) {
    score = -3; // frequency *increasing* — protective factor
    label = 'Attendance trending up';
  } else {
    score = 0;
    label = 'Attendance stable';
  }

  return { value: dropPct, score, maxPts: MAX, label };
}

/**
 * 3. TENURE RISK (15 pts)
 * Research: Dropout probability peaks within the first 3 months
 * then declines. 50% of new members quit within 6 months.
 * "Honeymoon ending" period (1-3 months) is the danger zone.
 * 24 visits in 90 days is the survival threshold.
 */
function signalTenureRisk(tenureMonths, totalSessionsFirst90Days) {
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

/**
 * 4. SOCIAL & GROUP ENGAGEMENT (14 pts)
 * Research: Group class participants are 56% less likely to cancel.
 * Members with a gym friend are 40% less likely to cancel.
 * Personal trainer clients are 40% more likely to stay.
 *
 * Split: friends (6 pts) + challenges/group (5 pts) + trainer (3 pts)
 */
function signalSocialEngagement(friendCount, challengeParticipation, hasTrainer) {
  const MAX = 14;
  let score = 0;
  const parts = [];

  // Friends (6 pts) — 40% less likely to cancel with a friend
  if (friendCount === 0) {
    score += 6;
    parts.push('No gym connections');
  } else if (friendCount === 1) {
    score += 3;
    parts.push('Only 1 gym connection');
  }
  // 2+ friends = socially anchored

  // Challenge/group participation (5 pts) — 56% less likely to cancel
  if (!challengeParticipation) {
    score += 5;
    parts.push('Not in any challenges');
  }

  // Trainer relationship (3 pts) — 40% more likely to stay
  if (!hasTrainer) {
    score += 3;
    parts.push('No trainer relationship');
  }

  const label = parts.length > 0
    ? parts.join('; ')
    : 'Socially connected & engaged';

  return { value: { friendCount, challengeParticipation, hasTrainer }, score, maxPts: MAX, label };
}

/**
 * 5. SESSION GAP PATTERN (10 pts)
 * Research: Growing intervals between visits is an early behavioral
 * warning signal, detectable before frequency metrics fully reflect it.
 */
function signalSessionGaps(sessionGaps) {
  const MAX = 10;

  if (!sessionGaps || sessionGaps.length < 4) {
    return { value: null, score: 0, maxPts: MAX, label: 'Not enough data for gap analysis' };
  }

  // Compare average gap of recent sessions vs older sessions
  const mid = Math.floor(sessionGaps.length / 2);
  const recentAvg = sessionGaps.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const olderAvg = sessionGaps.slice(mid).reduce((a, b) => a + b, 0) / (sessionGaps.length - mid);

  if (olderAvg <= 0.5) {
    return { value: null, score: 0, maxPts: MAX, label: 'Consistent session timing' };
  }

  const acceleration = (recentAvg - olderAvg) / olderAvg;

  let score, label;
  if (acceleration >= 1.0) {
    score = MAX;
    label = `Session gaps doubled (${recentAvg.toFixed(1)} vs ${olderAvg.toFixed(1)} days)`;
  } else if (acceleration >= 0.5) {
    score = Math.round(MAX * 0.7); // 7
    label = 'Session gaps growing significantly';
  } else if (acceleration >= 0.25) {
    score = Math.round(MAX * 0.4); // 4
    label = 'Session gaps widening';
  } else if (acceleration < -0.15) {
    score = -2; // gaps shrinking — protective
    label = 'Session gaps getting shorter';
  } else {
    score = 0;
    label = 'Consistent session spacing';
  }

  return { value: acceleration, score, maxPts: MAX, label };
}

/**
 * 6. GOAL PROGRESS / MILESTONES (9 pts)
 * Research: Members achieving early fitness milestones in the first
 * 90 days are 60% more likely to stay. PRs, body metric progress,
 * and program completion are measurable milestones.
 */
function signalGoalProgress(hasPRsRecently, hasBodyProgress, completedProgramPct, tenureMonths) {
  const MAX = 9;

  // This signal is most important in the first 6 months
  if (tenureMonths > 6) {
    // For established members, lack of progress is a weaker signal
    if (!hasPRsRecently && !hasBodyProgress) {
      return { value: false, score: 3, maxPts: MAX, label: 'No recent milestones (established member)' };
    }
    return { value: true, score: 0, maxPts: MAX, label: 'Hitting milestones' };
  }

  let score = 0;
  const parts = [];

  if (!hasPRsRecently) {
    score += 4;
    parts.push('No recent PRs');
  }

  if (!hasBodyProgress) {
    score += 3;
    parts.push('No body metric tracking');
  }

  if (completedProgramPct !== null && completedProgramPct < 0.3) {
    score += 2;
    parts.push('Low program completion');
  }

  // Cap at max
  score = Math.min(MAX, score);

  const label = parts.length > 0
    ? parts.join('; ')
    : 'On track with milestones';

  return { value: { hasPRsRecently, hasBodyProgress }, score, maxPts: MAX, label };
}

/**
 * 7. ENGAGEMENT DEPTH (7 pts)
 * Research: Secondary behavioral signals — workout completion rate,
 * session duration trends, and body metric logging frequency.
 */
function signalEngagementDepth(completedSessions, abandonedSessions, avgDurLast30, avgDurPrior30) {
  const MAX = 7;
  let score = 0;
  const parts = [];

  // Workout completion rate (4 pts)
  const totalRecent = completedSessions + abandonedSessions;
  if (totalRecent >= 3) {
    const abandonRate = abandonedSessions / totalRecent;
    if (abandonRate >= 0.4) {
      score += 4;
      parts.push(`${Math.round(abandonRate * 100)}% sessions abandoned`);
    } else if (abandonRate >= 0.2) {
      score += 2;
      parts.push('Some sessions left incomplete');
    }
  }

  // Session duration trend (3 pts)
  if (avgDurPrior30 > 0 && avgDurLast30 > 0) {
    const durChange = (avgDurLast30 - avgDurPrior30) / avgDurPrior30;
    if (durChange <= -0.35) {
      score += 3;
      parts.push('Sessions getting much shorter');
    } else if (durChange <= -0.2) {
      score += 1;
      parts.push('Sessions slightly shorter');
    }
  }

  score = Math.min(MAX, score);

  const label = parts.length > 0
    ? parts.join('; ')
    : 'Good engagement depth';

  return { value: { completedSessions, abandonedSessions }, score, maxPts: MAX, label };
}


// ═══════════════════════════════════════════════════════════════
//  DEFAULT RESEARCH-BASED WEIGHTS
//  Each signal calculator returns a raw score out of its maxPts.
//  These multipliers adjust how much each signal contributes.
//  1.0 = use the research default. >1.0 = this signal matters
//  more for this gym. <1.0 = less.
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_WEIGHTS = {
  visit_frequency:    1.0,
  attendance_trend:   1.0,
  tenure_risk:        1.0,
  social_engagement:  1.0,
  session_gaps:       1.0,
  goal_progress:      1.0,
  engagement_depth:   1.0,
};

// ═══════════════════════════════════════════════════════════════
//  COMPOSITE SCORE
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate churn risk score for a single member.
 * Returns score (0–100) + detailed signal breakdown.
 *
 * @param {Object} m       - member metrics object
 * @param {Object} [weights] - per-gym weight multipliers (defaults to 1.0)
 * @returns {{ score: number, signals: Object, keySignals: string[], riskTier: Object }}
 */
export function calculateChurnScore(m, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const signals = {
    visit_frequency:    signalVisitFrequency(m.avgWeeklyVisits ?? 0, m.trainingFrequency ?? 3),
    attendance_trend:   signalAttendanceTrend(m.avgWeeklyVisits ?? 0, m.prevAvgWeeklyVisits ?? 0),
    tenure_risk:        signalTenureRisk(m.tenureMonths ?? 0, m.totalSessionsFirst90Days ?? null),
    social_engagement:  signalSocialEngagement(m.friendCount ?? 0, m.challengeParticipation ?? false, m.hasTrainer ?? false),
    session_gaps:       signalSessionGaps(m.sessionGaps),
    goal_progress:      signalGoalProgress(m.hasPRsRecently ?? false, m.hasBodyProgress ?? false, m.completedProgramPct ?? null, m.tenureMonths ?? 0),
    engagement_depth:   signalEngagementDepth(m.completedSessions ?? 0, m.abandonedSessions ?? 0, m.avgDurationLast30 ?? 0, m.avgDurationPrior30 ?? 0),
  };

  // Apply per-gym weight multipliers and compute weighted max
  let weightedSum = 0;
  let weightedMax = 0;

  Object.entries(signals).forEach(([key, s]) => {
    const multiplier = w[key] ?? 1.0;
    s.weightedScore = s.score * multiplier;
    s.weightedMax = s.maxPts * multiplier;
    weightedSum += s.weightedScore;
    weightedMax += s.weightedMax;
  });

  // Normalize to 0–100% of this gym's weighted maximum
  // This ensures the score always represents a true percentage
  // regardless of how gym-specific weights shift the total budget
  const normalizedPct = weightedMax > 0
    ? (Math.max(0, weightedSum) / weightedMax) * 100
    : 0;

  // Round to nearest tenth for clean display (e.g. 88.2%)
  const score = Math.min(100, Math.round(normalizedPct * 10) / 10);

  // Build key signals — top 3 contributing signals by weighted score
  const keySignals = Object.entries(signals)
    .filter(([, s]) => s.weightedScore > 0)
    .sort((a, b) => b[1].weightedScore - a[1].weightedScore)
    .slice(0, 3)
    .map(([, s]) => s.label);

  if (keySignals.length === 0) keySignals.push('Engagement looks healthy');

  const riskTier = getRiskTier(score);

  return { score, signals, keySignals, riskTier };
}

/**
 * Legacy-compatible wrapper: returns just the numeric score.
 */
export function calculateChurnScoreSimple(m, weights) {
  return calculateChurnScore(m, weights).score;
}


// ═══════════════════════════════════════════════════════════════
//  RISK TIERS
// ═══════════════════════════════════════════════════════════════

/**
 * Map a churn score to a risk tier with display properties.
 * Thresholds calibrated to the 100-point weighted system:
 *   Critical ≥ 80  (hitting 3+ major signals hard)
 *   High     ≥ 55  (clear multi-signal risk)
 *   Medium   ≥ 30  (early warning signs)
 *   Low      < 30  (healthy engagement)
 */
export function getRiskTier(score) {
  if (score >= 80) return {
    label: 'Critical',
    tier: 'critical',
    color: '#DC2626',
    bg: 'rgba(220,38,38,0.12)',
    dot: '🔴',
    textClass: 'text-[#DC2626]',
    bgClass: 'bg-[#DC2626]/10',
    borderClass: 'border-[#DC2626]/20',
  };
  if (score >= 55) return {
    label: 'High Risk',
    tier: 'high',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.12)',
    dot: '🔴',
    textClass: 'text-[#EF4444]',
    bgClass: 'bg-[#EF4444]/10',
    borderClass: 'border-[#EF4444]/20',
  };
  if (score >= 30) return {
    label: 'Medium Risk',
    tier: 'medium',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.12)',
    dot: '🟡',
    textClass: 'text-[#F59E0B]',
    bgClass: 'bg-[#F59E0B]/10',
    borderClass: 'border-[#F59E0B]/20',
  };
  return {
    label: 'Low Risk',
    tier: 'low',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.12)',
    dot: '🟢',
    textClass: 'text-[#10B981]',
    bgClass: 'bg-[#10B981]/10',
    borderClass: 'border-[#10B981]/20',
  };
}


// ═══════════════════════════════════════════════════════════════
//  VELOCITY — SCORE TREND OVER TIME
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate score velocity from historical scores.
 * Uses linear regression over recent score history.
 * Positive = risk increasing, negative = risk decreasing.
 *
 * @param {Array<{ score: number, computed_at: string }>} history
 *   Sorted newest-first. Needs at least 2 entries.
 * @returns {{ velocity: number, trend: 'rising'|'falling'|'stable', label: string }}
 */
export function calculateVelocity(history) {
  if (!history || history.length < 2) {
    return { velocity: 0, trend: 'stable', label: 'Not enough history' };
  }

  const newest = new Date(history[0].computed_at);
  const points = history.map(h => ({
    x: (newest - new Date(h.computed_at)) / (1000 * 60 * 60 * 24),
    y: h.score,
  }));

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;

  if (denom === 0) return { velocity: 0, trend: 'stable', label: 'Flat' };

  // Negate because x = "days ago" (positive = past)
  const slope = -(n * sumXY - sumX * sumY) / denom;
  const velocity = Math.round(slope * 10) / 10;

  let trend = 'stable';
  let label = 'Risk stable';
  if (velocity >= 2)        { trend = 'rising';  label = `Risk rising fast (+${velocity}/day)`; }
  else if (velocity >= 0.5) { trend = 'rising';  label = `Risk trending up (+${velocity}/day)`; }
  else if (velocity <= -2)  { trend = 'falling'; label = `Risk dropping fast (${velocity}/day)`; }
  else if (velocity <= -0.5){ trend = 'falling'; label = `Risk improving (${velocity}/day)`; }

  return { velocity, trend, label };
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

  // ── 2–10. Parallel data fetches ───────────────────────────────
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
