/**
 * Engagement Score Library
 * ─────────────────────────────────────────────────────────────
 * Positive 0–100 engagement scoring for gym members.
 * This is the OPPOSITE of churn risk — higher = better engaged.
 *
 * SIGNAL WEIGHTS (100 pts total):
 *   1. Workout Consistency    — 30 pts  (goal adherence)
 *   2. Streak Strength        — 18 pts  (active streak length)
 *   3. Social Engagement      — 15 pts  (friends + social activity)
 *   4. Challenge Participation— 12 pts  (active challenges)
 *   5. Progress Tracking      — 10 pts  (body metrics + PRs)
 *   6. Session Quality        — 10 pts  (completion rate + duration)
 *   7. Check-in Regularity    —  5 pts  (gym visit consistency)
 * ─────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════
//  SIGNAL CALCULATORS
//  Each returns { score, maxPts, label }
// ═══════════════════════════════════════════════════════════════

/**
 * 1. WORKOUT CONSISTENCY (30 pts)
 * How close is their weekly workout frequency to their training goal?
 * Ratio: completedSessionsLast30 / (trainingFrequency * 4.33)
 */
function signalWorkoutConsistency(completedSessionsLast30, trainingFrequency) {
  const MAX = 30;
  const expectedSessions = (trainingFrequency || 3) * 4.33;
  const ratio = expectedSessions > 0 ? completedSessionsLast30 / expectedSessions : 0;

  let score, label;
  if (ratio >= 1.0) {
    score = MAX;
    label = 'Meeting or exceeding training goal';
  } else if (ratio >= 0.75) {
    score = 22;
    label = `${Math.round(ratio * 100)}% of training goal`;
  } else if (ratio >= 0.5) {
    score = 15;
    label = `Hitting about half of training goal`;
  } else if (ratio >= 0.25) {
    score = 8;
    label = `Below training goal (${Math.round(ratio * 100)}%)`;
  } else {
    score = 0;
    label = completedSessionsLast30 === 0
      ? 'No completed sessions in last 30 days'
      : 'Far below training goal';
  }

  return { score, maxPts: MAX, label };
}

/**
 * 2. STREAK STRENGTH (18 pts)
 * Current active streak in days.
 */
function signalStreakStrength(currentStreakDays) {
  const MAX = 18;

  let score, label;
  if (currentStreakDays >= 30) {
    score = MAX;
    label = `${currentStreakDays}-day streak — outstanding`;
  } else if (currentStreakDays >= 14) {
    score = 13;
    label = `${currentStreakDays}-day streak — strong`;
  } else if (currentStreakDays >= 7) {
    score = 8;
    label = `${currentStreakDays}-day streak — building momentum`;
  } else if (currentStreakDays >= 3) {
    score = 4;
    label = `${currentStreakDays}-day streak — getting started`;
  } else {
    score = 0;
    label = currentStreakDays > 0
      ? `${currentStreakDays}-day streak — just started`
      : 'No active streak';
  }

  return { score, maxPts: MAX, label };
}

/**
 * 3. SOCIAL ENGAGEMENT (15 pts)
 * Friends (8 pts) + social activity in last 30 days (7 pts).
 */
function signalSocialEngagement(friendCount, hasSocialActivity) {
  const MAX = 15;
  let score = 0;
  const parts = [];

  // Friends sub-score (8 pts max)
  if (friendCount >= 5) {
    score += 8;
    parts.push(`${friendCount} gym connections`);
  } else if (friendCount >= 2) {
    score += 5;
    parts.push(`${friendCount} gym connections`);
  } else if (friendCount >= 1) {
    score += 2;
    parts.push('1 gym connection');
  } else {
    parts.push('No gym connections');
  }

  // Social activity sub-score (7 pts max)
  if (hasSocialActivity) {
    score += 7;
    parts.push('Active in feed');
  } else {
    parts.push('No recent social activity');
  }

  const label = parts.join('; ');
  return { score, maxPts: MAX, label };
}

/**
 * 4. CHALLENGE PARTICIPATION (12 pts)
 * Number of active challenges.
 */
function signalChallengeParticipation(activeChallengeCount) {
  const MAX = 12;

  let score, label;
  if (activeChallengeCount >= 2) {
    score = MAX;
    label = `In ${activeChallengeCount} active challenges`;
  } else if (activeChallengeCount === 1) {
    score = 7;
    label = 'In 1 active challenge';
  } else {
    score = 0;
    label = 'Not participating in any challenges';
  }

  return { score, maxPts: MAX, label };
}

/**
 * 5. PROGRESS TRACKING (10 pts)
 * Body tracking (5 pts) + recent PRs (5 pts).
 */
function signalProgressTracking(hasBodyTracking, hasPRsRecently) {
  const MAX = 10;
  let score = 0;
  const parts = [];

  if (hasBodyTracking) {
    score += 5;
    parts.push('Tracking body metrics');
  } else {
    parts.push('No recent body tracking');
  }

  if (hasPRsRecently) {
    score += 5;
    parts.push('Hit a PR recently');
  } else {
    parts.push('No recent PRs');
  }

  const label = parts.join('; ');
  return { score, maxPts: MAX, label };
}

/**
 * 6. SESSION QUALITY (10 pts)
 * Completion rate (6 pts) + average duration (4 pts).
 */
function signalSessionQuality(completedSessions, abandonedSessions, avgDurationLast30) {
  const MAX = 10;
  let score = 0;
  const parts = [];

  // Completion rate sub-score (6 pts max)
  const totalSessions = completedSessions + abandonedSessions;
  if (totalSessions > 0) {
    const completionRate = completedSessions / totalSessions;
    if (completionRate >= 0.9) {
      score += 6;
      parts.push(`${Math.round(completionRate * 100)}% completion rate`);
    } else if (completionRate >= 0.7) {
      score += 3;
      parts.push(`${Math.round(completionRate * 100)}% completion rate`);
    } else {
      parts.push(`Low completion rate (${Math.round(completionRate * 100)}%)`);
    }
  } else {
    parts.push('No sessions to evaluate');
  }

  // Average duration sub-score (4 pts max)
  // 2400s = 40 minutes, 1800s = 30 minutes
  if (avgDurationLast30 >= 2400) {
    score += 4;
    parts.push(`${Math.round(avgDurationLast30 / 60)}min avg sessions`);
  } else if (avgDurationLast30 >= 1800) {
    score += 2;
    parts.push(`${Math.round(avgDurationLast30 / 60)}min avg sessions`);
  } else if (avgDurationLast30 > 0) {
    parts.push(`Short sessions (${Math.round(avgDurationLast30 / 60)}min avg)`);
  }

  const label = parts.join('; ');
  return { score, maxPts: MAX, label };
}

/**
 * 7. CHECK-IN REGULARITY (5 pts)
 * Gym check-in consistency over last 30 days.
 */
function signalCheckInRegularity(checkInsLast30) {
  const MAX = 5;

  let score, label;
  if (checkInsLast30 >= 12) {
    score = MAX;
    label = `${checkInsLast30} check-ins in 30 days — very consistent`;
  } else if (checkInsLast30 >= 8) {
    score = 3;
    label = `${checkInsLast30} check-ins in 30 days — good`;
  } else if (checkInsLast30 >= 4) {
    score = 1;
    label = `${checkInsLast30} check-ins in 30 days — moderate`;
  } else {
    score = 0;
    label = checkInsLast30 > 0
      ? `Only ${checkInsLast30} check-ins in 30 days`
      : 'No check-ins in 30 days';
  }

  return { score, maxPts: MAX, label };
}


// ═══════════════════════════════════════════════════════════════
//  DEFAULT WEIGHTS
//  Each signal calculator returns a raw score out of its maxPts.
//  These multipliers adjust how much each signal contributes.
//  1.0 = default. >1.0 = this signal matters more. <1.0 = less.
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_WEIGHTS = {
  workout_consistency:      1.0,
  streak_strength:          1.0,
  social_engagement:        1.0,
  challenge_participation:  1.0,
  progress_tracking:        1.0,
  session_quality:          1.0,
  checkin_regularity:       1.0,
};


// ═══════════════════════════════════════════════════════════════
//  ENGAGEMENT TIERS
// ═══════════════════════════════════════════════════════════════

/**
 * Map an engagement score to a tier with display properties.
 * Thresholds:
 *   Highly Engaged ≥ 80
 *   Engaged        ≥ 55
 *   Moderate       ≥ 30
 *   Low Engagement < 30
 *
 * @param {number} score - 0–100 engagement score
 * @returns {{ label, tier, color, bg, textClass, bgClass, borderClass }}
 */
export function getEngagementTier(score) {
  if (score >= 80) return {
    label: 'Highly Engaged',
    tier: 'highly_engaged',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.12)',
    textClass: 'text-[#10B981]',
    bgClass: 'bg-[#10B981]/10',
    borderClass: 'border-[#10B981]/20',
  };
  if (score >= 55) return {
    label: 'Engaged',
    tier: 'engaged',
    color: '#34D399',
    bg: 'rgba(52,211,153,0.12)',
    textClass: 'text-[#34D399]',
    bgClass: 'bg-[#34D399]/10',
    borderClass: 'border-[#34D399]/20',
  };
  if (score >= 30) return {
    label: 'Moderate',
    tier: 'moderate',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.12)',
    textClass: 'text-[#F59E0B]',
    bgClass: 'bg-[#F59E0B]/10',
    borderClass: 'border-[#F59E0B]/20',
  };
  return {
    label: 'Low Engagement',
    tier: 'low',
    color: '#EF4444',
    bg: 'rgba(239,68,68,0.12)',
    textClass: 'text-[#EF4444]',
    bgClass: 'bg-[#EF4444]/10',
    borderClass: 'border-[#EF4444]/20',
  };
}


// ═══════════════════════════════════════════════════════════════
//  COMPOSITE SCORE
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate engagement score for a single member.
 * Returns score (0–100) + detailed signal breakdown.
 *
 * @param {Object} memberData - member metrics object
 * @param {number} memberData.completedSessionsLast30 - completed workout sessions in last 30 days
 * @param {number} memberData.trainingFrequency - target workouts per week
 * @param {number} memberData.currentStreakDays - current active streak in days
 * @param {number} memberData.friendCount - number of gym friends
 * @param {boolean} memberData.hasSocialActivity - likes/comments in last 30 days
 * @param {number} memberData.activeChallengeCount - number of active challenges
 * @param {boolean} memberData.hasBodyTracking - logged weight/measurements in last 60 days
 * @param {boolean} memberData.hasPRsRecently - hit a PR in last 30 days
 * @param {number} memberData.completedSessions - completed sessions in last 30 days
 * @param {number} memberData.abandonedSessions - abandoned sessions in last 30 days
 * @param {number} memberData.avgDurationLast30 - average session duration in seconds (last 30 days)
 * @param {number} memberData.checkInsLast30 - gym check-ins in last 30 days
 * @param {Object} [weights] - per-gym weight multipliers (defaults to 1.0)
 * @returns {{ score: number, tier: Object, signals: Object, keyStrengths: string[] }}
 */
export function calculateEngagementScore(memberData, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const m = memberData;

  const signals = {
    workout_consistency:     signalWorkoutConsistency(
                               m.completedSessionsLast30 ?? 0,
                               m.trainingFrequency ?? 3,
                             ),
    streak_strength:         signalStreakStrength(m.currentStreakDays ?? 0),
    social_engagement:       signalSocialEngagement(
                               m.friendCount ?? 0,
                               m.hasSocialActivity ?? false,
                             ),
    challenge_participation: signalChallengeParticipation(m.activeChallengeCount ?? 0),
    progress_tracking:       signalProgressTracking(
                               m.hasBodyTracking ?? false,
                               m.hasPRsRecently ?? false,
                             ),
    session_quality:         signalSessionQuality(
                               m.completedSessions ?? 0,
                               m.abandonedSessions ?? 0,
                               m.avgDurationLast30 ?? 0,
                             ),
    checkin_regularity:      signalCheckInRegularity(m.checkInsLast30 ?? 0),
  };

  // Apply per-gym weight multipliers and compute weighted max
  let weightedSum = 0;
  let weightedMax = 0;

  Object.entries(signals).forEach(([key, s]) => {
    const multiplier = w[key] ?? 1.0;
    s.weightedScore = s.score * multiplier;
    s.weightedMax = s.maxPts * multiplier;
    weightedSum += s.score * multiplier;
    weightedMax += s.maxPts * multiplier;
  });

  // Normalize to 0–100% of this gym's weighted maximum
  const pct = weightedMax > 0
    ? (Math.max(0, weightedSum) / weightedMax) * 100
    : 0;

  // Round to nearest tenth for clean display (e.g. 72.5)
  const score = Math.min(100, Math.round(pct * 10) / 10);

  // Build key strengths — top 3 contributing signals by weighted score
  const keyStrengths = Object.entries(signals)
    .filter(([, s]) => s.weightedScore > 0)
    .sort((a, b) => b[1].weightedScore - a[1].weightedScore)
    .slice(0, 3)
    .map(([, s]) => s.label);

  if (keyStrengths.length === 0) keyStrengths.push('No strong engagement signals detected');

  const tier = getEngagementTier(score);

  return { score, tier, signals, keyStrengths };
}
