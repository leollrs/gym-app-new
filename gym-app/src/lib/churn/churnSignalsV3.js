/**
 * Churn signals v3 — Attendance-First Behavioral Retention Model
 * ─────────────────────────────────────────────────────────────
 * Mirrors supabase/functions/compute-churn-scores/index.ts.
 * See src/lib/churn/MODEL_V3_SPEC.md for the full design.
 *
 * Core idea — each engagement surface is a SIGNED axis:
 *   active now = bonus (−) · never adopted = neutral (0) · used-then-stopped = risk (+)
 *
 * Points ARE the score (no normalization-over-max like v2):
 *   Layer A attendance core  →  up to 70 risk pts (dominant)
 *   Layer B engagement decline → up to 30 risk pts (fires only on decline from own baseline)
 *   Layer C protective bonus  →  down to −20 (active engagement; never penalizes absence)
 */
import i18n from 'i18next';

const tt = (key, fallback, params = {}) =>
  i18n.t(key, { ns: 'pages', defaultValue: fallback, ...params });

const round1 = (n) => Math.round(n * 10) / 10;

// ═══════════════════════════════════════════════════════════════
//  LAYER A — Attendance core (steady-state, tenure ≥ 75 days)
// ═══════════════════════════════════════════════════════════════

/** A1. Recency — days since last activity, exponential decay. */
export function sigRecency(daysSinceActivity, MAX = 25, tau = 18) {
  if (daysSinceActivity == null) {
    return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.noRecentActivity', 'No recent activity') };
  }
  const d = Math.max(0, daysSinceActivity);
  const score = round1(MAX * (1 - Math.exp(-d / tau)));
  const label = d < 4
    ? tt('admin.churnSignals.recentlyActive', 'Active recently')
    : tt('admin.churnSignals.daysSinceVisit', '{{d}} days since last visit', { d: Math.round(d) });
  return { score, maxPts: MAX, label };
}

/** A2. Frequency level — visits/wk vs the 3×/wk anchor (+ optional cohort shift). */
export function sigFrequency(avgWeekly, goal, cohortPercentile = null, MAX = 18) {
  const anchor = Math.max(goal || 3, 3); // Hormozi: ≥3×/wk sticks, <2×/wk churns
  const r = anchor > 0 ? avgWeekly / anchor : 0;
  let base;
  if (r >= 1.0)       base = 0;
  else if (r >= 0.66) base = Math.round(MAX * 0.22);
  else if (r >= 0.5)  base = Math.round(MAX * 0.39); // ~2×/wk — the intervention line
  else if (r >= 0.33) base = Math.round(MAX * 0.61);
  else if (r >= 0.16) base = Math.round(MAX * 0.78);
  else                base = MAX;
  // Cohort-relative shift: self-tunes per gym
  if (cohortPercentile != null) {
    if (cohortPercentile <= 0.25) base = Math.min(MAX, base + 2);
    else if (cohortPercentile >= 0.75) base = Math.max(0, base - 2);
  }
  const label = base === 0
    ? tt('admin.churnSignals.meetingGoal', 'Meeting visit goal')
    : tt('admin.churnSignals.visitingXWeek', 'Visiting {{n}}×/week', { n: avgWeekly.toFixed(1) });
  return { score: base, maxPts: MAX, label };
}

/** A3. Frequency trend / velocity — recent 2-week rate vs the member's own baseline. */
export function sigTrend(recentRate, baselineRate, MAX = 17) {
  if (baselineRate == null || baselineRate < 0.25) {
    return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.notEnoughTrend', 'Not enough history'), dir: 'stable' };
  }
  const v = baselineRate > 0 ? recentRate / baselineRate : 1;
  let score, dir;
  if (v >= 1.0)       { score = 0;                    dir = recentRate > baselineRate * 1.1 ? 'up' : 'stable'; }
  else if (v >= 0.75) { score = Math.round(MAX * 0.24); dir = 'down'; }
  else if (v >= 0.5)  { score = Math.round(MAX * 0.53); dir = 'down'; }
  else if (v >= 0.25) { score = Math.round(MAX * 0.76); dir = 'down'; }
  else                { score = MAX;                    dir = 'down'; }
  const pct = Math.round((1 - v) * 100);
  const label = score === 0
    ? (dir === 'up'
        ? tt('admin.churnSignals.attendanceUp', 'Attendance trending up')
        : tt('admin.churnSignals.stable', 'Attendance stable'))
    : tt('admin.churnSignals.visitsDownPct', 'Visits down {{pct}}% vs usual', { pct });
  return { score, maxPts: MAX, label, dir };
}

/** A4. Streak integrity — broke an established streak. Neutral when no streak data. */
export function sigStreak(streakActive, brokenStreakLen, MAX = 10) {
  if (streakActive) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.streakActive', 'Streak active') };
  if (!brokenStreakLen || brokenStreakLen < 7) {
    return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.noStreak', 'No active streak') };
  }
  const score = round1(MAX * Math.min(brokenStreakLen / 30, 1));
  return { score, maxPts: MAX, label: tt('admin.churnSignals.streakBroken', 'Broke a {{n}}-day streak', { n: Math.round(brokenStreakLen) }) };
}

// ═══════════════════════════════════════════════════════════════
//  Onboarding regime (tenure < 75 days) — habit formation
// ═══════════════════════════════════════════════════════════════

/** O1. Habit-formation gap — actual vs the ~3×/wk ramp toward ~12 visits by week 6. */
export function sigHabitFormation(visitsSoFar, tenureDays, MAX = 30) {
  const weeks = Math.max(tenureDays / 7, 0.5);
  const expected = Math.min(weeks * 3, 18); // ~3/wk target
  if (expected <= 0) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.tooEarly', 'Too early to tell') };
  const gap = Math.max(0, Math.min((expected - (visitsSoFar || 0)) / expected, 1));
  const score = round1(MAX * gap);
  const label = gap <= 0.15
    ? tt('admin.churnSignals.buildingHabit', 'Building a routine')
    : tt('admin.churnSignals.notBuildingHabit', 'Not building a routine ({{v}} visits in {{w}}w)', { v: visitsSoFar || 0, w: Math.round(weeks) });
  return { score, maxPts: MAX, label };
}

/** O3. Activation — first workout logged in the early window. */
export function sigActivation(firstWorkoutLogged, tenureDays, MAX = 12) {
  if (firstWorkoutLogged) return { score: 0, maxPts: MAX, label: tt('admin.churnSignals.activated', 'Completed first workout') };
  if (tenureDays < 7) return { score: Math.round(MAX * 0.4), maxPts: MAX, label: tt('admin.churnSignals.notActivatedYet', 'No first workout yet') };
  return { score: MAX, maxPts: MAX, label: tt('admin.churnSignals.noFirstWorkout', 'No workout in first week') };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER B — Engagement decline (signed; fires ONLY on decline)
// ═══════════════════════════════════════════════════════════════
//  never adopted / trivial baseline → 0 (NEUTRAL, never a penalty)
//  recent ≥ baseline (stable or growing) → 0
//  recent << baseline (withdrew) → up to MAX, scaled by drop magnitude

function declineScore(baseline, recent, MAX, minBaseline) {
  if (baseline == null || baseline < minBaseline) return 0;
  if ((recent || 0) >= baseline) return 0;
  return round1(MAX * Math.min((baseline - (recent || 0)) / baseline, 1));
}

export function sigAppDecline(baseline, recent, MAX = 8) {
  const s = declineScore(baseline, recent, MAX, 4);
  return { score: s, maxPts: MAX, label: s > 0 ? tt('admin.churnSignals.appActivityDropped', 'App activity dropped off') : tt('admin.churnSignals.appActive', 'Active in app') };
}
export function sigChallengeDecline(baseline, recent, MAX = 6) {
  const s = declineScore(baseline, recent, MAX, 1);
  return { score: s, maxPts: MAX, label: s > 0 ? tt('admin.churnSignals.challengeStopped', 'Stopped joining challenges') : tt('admin.churnSignals.challengeOk', 'Challenge engagement ok') };
}
export function sigLoggingDecline(baseline, recent, MAX = 6) {
  const s = declineScore(baseline, recent, MAX, 3);
  return { score: s, maxPts: MAX, label: s > 0 ? tt('admin.churnSignals.loggingStopped', 'Stopped logging workouts') : tt('admin.churnSignals.loggingOk', 'Logging workouts') };
}
export function sigRewardsDecline(baseline, recent, MAX = 4) {
  // v1: points/card history not yet wired into the engine → baseline is null → neutral.
  const s = declineScore(baseline, recent, MAX, 2);
  return { score: s, maxPts: MAX, label: s > 0 ? tt('admin.churnSignals.rewardsDormant', 'Stopped using rewards') : tt('admin.churnSignals.rewardsOk', 'Rewards engaged') };
}
export function sigSocialDecline(baseline, recent, MAX = 3) {
  const s = declineScore(baseline, recent, MAX, 2);
  return { score: s, maxPts: MAX, label: s > 0 ? tt('admin.churnSignals.socialWithdrew', 'Pulled back socially') : tt('admin.churnSignals.socialOk', 'Socially engaged') };
}
export function sigGoalsDecline(baseline, recent, MAX = 3) {
  const s = declineScore(baseline, recent, MAX, 1);
  return { score: s, maxPts: MAX, label: s > 0 ? tt('admin.churnSignals.goalsDormant', 'Goal/PR activity stalled') : tt('admin.churnSignals.goalsOk', 'Hitting milestones') };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER C — Protective bonus (negative = lowers risk; never penalizes)
// ═══════════════════════════════════════════════════════════════

export function bonusProtective({ activeReferrer, activeChallenge, recentPRs, strongAppCard, activeSocial }) {
  let bonus = 0;
  const parts = [];
  if (activeReferrer) { bonus -= 5; parts.push(tt('admin.churnSignals.bonusReferrer', 'Active referrer')); }
  if (activeChallenge) { bonus -= 5; parts.push(tt('admin.churnSignals.bonusChallenge', 'In a challenge')); }
  if (recentPRs)      { bonus -= 4; parts.push(tt('admin.churnSignals.bonusPRs', 'Hitting PRs')); }
  if (strongAppCard)  { bonus -= 4; parts.push(tt('admin.churnSignals.bonusEngaged', 'Highly engaged')); }
  if (activeSocial)   { bonus -= 2; parts.push(tt('admin.churnSignals.bonusSocial', 'Socially active')); }
  return { bonus: Math.max(-20, bonus), parts };
}
