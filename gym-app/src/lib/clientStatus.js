// Canonical client status / risk model for the trainer side.
// Single source of truth — TrainerHome, TrainerClients (list, chips, preview)
// must all derive a client's label from here so the same person never reads
// "On track" on one page and "Churn" on another.
//
// Thresholds follow the roster semantics (the surface trainers use most):
//   churn   = churn score ≥ 80 OR inactive > 30 days (or never active, >30d member)
//   at_risk = churn score ≥ 30 OR inactive > 14 days
//   new     = joined < 7 days ago and never active yet
//   on_track otherwise

export const RISK = {
  AT_RISK_SCORE: 30,
  CHURN_SCORE: 80,
  AT_RISK_DAYS: 14,
  CHURN_DAYS: 30,
  NEW_DAYS: 7,
};

const DAY_MS = 86400000;

export function daysSince(dateLike) {
  if (!dateLike) return null;
  const t = new Date(dateLike).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

/**
 * @param {object} c
 * @param {string|null} c.lastActiveAt   profiles.last_active_at
 * @param {string|null} c.createdAt      profiles.created_at (member since)
 * @param {number|null} c.churnScore     churn_risk_scores.score (0–100)
 * @param {string|null} c.churnComputedAt churn_risk_scores.computed_at — scores
 *        older than 48h are treated as absent (stale model output).
 * @returns {'churn'|'at_risk'|'new'|'on_track'}
 */
export function deriveClientStatus({ lastActiveAt, createdAt, churnScore, churnComputedAt } = {}) {
  const inactiveDays = daysSince(lastActiveAt);
  const memberDays = daysSince(createdAt);

  let score = typeof churnScore === 'number' ? churnScore : null;
  const scoreAge = daysSince(churnComputedAt);
  if (score != null && churnComputedAt !== undefined && (scoreAge == null || scoreAge > 2)) score = null;

  const neverActive = inactiveDays == null;
  if (neverActive && memberDays != null && memberDays < RISK.NEW_DAYS) return 'new';

  if ((score != null && score >= RISK.CHURN_SCORE) ||
      (inactiveDays != null && inactiveDays > RISK.CHURN_DAYS) ||
      (neverActive && memberDays != null && memberDays > RISK.CHURN_DAYS)) return 'churn';

  if ((score != null && score >= RISK.AT_RISK_SCORE) ||
      (inactiveDays != null && inactiveDays > RISK.AT_RISK_DAYS) ||
      neverActive) return 'at_risk';

  return 'on_track';
}

export const needsAttention = (c) => {
  const s = deriveClientStatus(c);
  return s === 'churn' || s === 'at_risk';
};

/**
 * Weekly adherence = completed workouts this week vs the client's actual
 * plan days/week (member_onboarding.training_days_per_week or the assigned
 * program's days). Falls back to 3 when no plan info exists — NOT an
 * arbitrary 4/5/6 divisor per page.
 */
export function weeklyAdherence(sessionsThisWeek, planDaysPerWeek) {
  const target = Number(planDaysPerWeek) >= 1 ? Math.min(7, Math.round(Number(planDaysPerWeek))) : 3;
  const done = Math.max(0, Number(sessionsThisWeek) || 0);
  return { done, target, pct: Math.min(100, Math.round((done / target) * 100)) };
}
