/**
 * Churn Intelligence — Risk Scoring & Composite Score
 * ─────────────────────────────────────────────────────────────
 * Combines all signal calculators into a composite churn risk score.
 * Includes risk tier classification and weight configuration.
 */

import {
  signalVisitFrequency,
  signalAttendanceTrend,
  signalSocialEngagement,
  signalSessionGaps,
  signalGoalProgress,
  signalEngagementDepth,
} from './engagement.js';

import { signalTenureRisk } from './retention.js';


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
//  RISK TIERS
// ═══════════════════════════════════════════════════════════════

/**
 * Map a churn score to a risk tier with display properties.
 * Thresholds calibrated to the 100-point weighted system:
 *   Critical >= 80  (hitting 3+ major signals hard)
 *   High     >= 55  (clear multi-signal risk)
 *   Medium   >= 30  (early warning signs)
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
//  COMPOSITE SCORE
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate churn risk score for a single member.
 * Returns score (0-100) + detailed signal breakdown.
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

  // Normalize to 0-100% of this gym's weighted maximum
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
