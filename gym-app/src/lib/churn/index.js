/**
 * Churn Intelligence Library v2
 * ─────────────────────────────────────────────────────────────
 * Re-exports all public functions from domain sub-modules
 * for backward compatibility.
 */

// Engagement signal calculators
export {
  signalVisitFrequency,
  signalAttendanceTrend,
  signalSocialEngagement,
  signalSessionGaps,
  signalGoalProgress,
  signalEngagementDepth,
} from './engagement.js';

// Retention / churn prediction
export {
  signalTenureRisk,
  fetchMembersWithChurnScores,
} from './retention.js';

// Risk scoring & composite score
export {
  DEFAULT_WEIGHTS,
  getRiskTier,
  calculateChurnScore,
  calculateChurnScoreSimple,
} from './riskScoring.js';

// Metric computation helpers
export {
  calculateVelocity,
} from './metrics.js';
