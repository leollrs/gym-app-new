/**
 * Churn Intelligence — Risk Scoring & Composite Score (v2 — 12 signals)
 * Matches edge function compute-churn-scores budget & normalization.
 */

import {
  signalVisitFrequencyV2,
  signalAttendanceTrendV2,
  signalTenureRiskV2,
  signalSocialEngagementV2,
  signalSessionGapsV2,
  signalGoalProgressV2,
  signalEngagementDepthV2,
  signalAnchorDayV2,
  signalAppEngagementV2,
  signalCommsResponsivenessV2,
  signalReferralActivityV2,
  signalWorkoutTypeShiftV2,
} from './churnSignalsV2.js';

export const DEFAULT_WEIGHTS = {
  visit_frequency: 1.0,
  attendance_trend: 1.0,
  tenure_risk: 1.0,
  social_engagement: 1.0,
  session_gaps: 1.0,
  goal_progress: 1.0,
  engagement_depth: 1.0,
  anchor_day: 1.0,
  app_engagement: 1.0,
  comms_responsiveness: 1.0,
  referral_activity: 1.0,
  workout_type_shift: 1.0,
};

/**
 * Map a churn score to a risk tier with display properties.
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

/**
 * @param {Object} m - member metrics (see retention.js)
 * @param {Object} [weights] - per-gym weight multipliers
 */
export function calculateChurnScore(m, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  const weeks = m.recentSessionWeeks || [[], [], []];
  const scheduled = m.scheduledDays || [];

  const signals = {
    visit_frequency: signalVisitFrequencyV2(m.avgWeeklyVisits ?? 0, m.trainingFrequency ?? 3),
    attendance_trend: signalAttendanceTrendV2(m.avgWeeklyVisits ?? 0, m.prevAvgWeeklyVisits ?? 0),
    tenure_risk: signalTenureRiskV2(m.tenureMonths ?? 0, m.totalSessionsFirst90Days ?? null),
    social_engagement: signalSocialEngagementV2(m.friendCount ?? 0, m.challengeParticipation ?? false, m.hasTrainer ?? false),
    session_gaps: signalSessionGapsV2(m.sessionGaps),
    goal_progress: signalGoalProgressV2(m.hasPRsRecently ?? false, m.hasBodyProgress ?? false, m.tenureMonths ?? 0),
    engagement_depth: signalEngagementDepthV2(
      m.completedSessions ?? 0,
      m.abandonedSessions ?? 0,
      m.avgDurationLast30 ?? 0,
      m.avgDurationPrior30 ?? 0,
    ),
    anchor_day: signalAnchorDayV2(scheduled, weeks),
    app_engagement: signalAppEngagementV2(
      m.notifTotal ?? 0,
      m.notifRead ?? 0,
      m.daysSinceLastAction ?? 999,
    ),
    comms_responsiveness: signalCommsResponsivenessV2(m.outreachCount ?? 0, m.respondedCount ?? 0),
    referral_activity: signalReferralActivityV2(m.referralCount ?? 0),
    workout_type_shift: signalWorkoutTypeShiftV2(m.muscleGroupsLast30 ?? 0, m.muscleGroupsPrev30 ?? 0),
  };

  let weightedSum = 0;
  let weightedMax = 0;

  Object.entries(signals).forEach(([key, s]) => {
    const multiplier = w[key] ?? 1.0;
    s.weightedScore = s.score * multiplier;
    s.weightedMax = s.maxPts * multiplier;
    weightedSum += s.weightedScore;
    weightedMax += s.weightedMax;
  });

  const normalizedPct = weightedMax > 0
    ? (Math.max(0, weightedSum) / weightedMax) * 100
    : 0;

  const score = Math.min(100, Math.round(normalizedPct * 10) / 10);

  const keySignals = Object.entries(signals)
    .filter(([, s]) => s.weightedScore > 0)
    .sort((a, b) => b[1].weightedScore - a[1].weightedScore)
    .slice(0, 3)
    .map(([, s]) => s.label);

  if (keySignals.length === 0) keySignals.push('Engagement looks healthy');

  const riskTier = getRiskTier(score);

  return { score, signals, keySignals, riskTier };
}

export function calculateChurnScoreSimple(m, weights) {
  return calculateChurnScore(m, weights).score;
}
