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

// Preferred loader: reads the nightly precompute + re-applies the inactivity
// override, falling back to the live engine when stale. Use this instead of
// fetchMembersWithChurnScores in page loads.
export {
  loadGymChurnScores,
} from './loadScores.js';

// Risk scoring & composite score
export {
  DEFAULT_WEIGHTS,
  getRiskTier,
  calculateChurnScore,
  calculateChurnScoreSimple,
  estimateChurnScoreFallback,
} from './riskScoring.js';

// Metric computation helpers
export {
  calculateVelocity,
} from './metrics.js';

// Admin-facing churn queries (fallback scoring + auto-return detection)
export {
  fetchChurnFallback,
  autoDetectReturns,
} from './adminQueries.js';
