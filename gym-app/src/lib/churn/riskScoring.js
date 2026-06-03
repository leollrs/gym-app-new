/**
 * Churn Intelligence — Risk Scoring & Composite Score
 * v3 — Attendance-First Behavioral Retention Model
 * ─────────────────────────────────────────────────────────────
 * Matches the edge function compute-churn-scores (v3). Full design:
 * src/lib/churn/MODEL_V3_SPEC.md
 *
 * Score = raw weighted points (NOT normalized over max like v2):
 *   Layer A attendance core (≤70)  +  Layer B engagement decline (≤30)
 *   × tenure multiplier  →  attendance gate  →  + protective bonus (≥−20)  →  clamp 0–100
 */
import i18n from 'i18next';
import {
  sigRecency, sigFrequency, sigTrend, sigStreak,
  sigHabitFormation, sigActivation,
  sigAppDecline, sigChallengeDecline, sigLoggingDecline,
  sigRewardsDecline, sigSocialDecline, sigGoalsDecline,
  bonusProtective,
} from './churnSignalsV3.js';

const tt = (key, fallback, params = {}) =>
  i18n.t(key, { ns: 'pages', defaultValue: fallback, ...params });

// ── Tunable model parameters (see MODEL_V3_SPEC §12) ──
export const ONBOARDING_DAYS = 75;     // < this → habit-formation regime
const GRACE_DAYS = 14;                  // < this tenure → insufficient data
const GRACE_MIN_EVENTS = 4;             // fewer lifetime sessions+check-ins → insufficient
const DORMANT_DAYS = 30;               // ≥ this since any activity → dormant (winnable, in queue)
const CHURNED_DAYS = 60;               // ≥ this → churned/"lost" (out of the action queue)
const GATE_THRESHOLD = 18;             // attendance "strong" if Layer A risk ≤ this
const MEDIUM_CAP = 54;                 // engagement alone can't exceed Medium (High = 55)
const ACTIVATION_DEADLINE_DAYS = 21;   // enrolled ≥ this (since created_at) with ZERO footprint → failed activation

// One weight key per scored signal. Per-gym calibration multiplies these.
export const DEFAULT_WEIGHTS = {
  // Layer A (steady-state)
  recency: 1.0,
  frequency: 1.0,
  trend: 1.0,
  streak: 1.0,
  // Onboarding regime
  habit_formation: 1.0,
  activation: 1.0,
  // Layer B (engagement decline)
  app_decline: 1.0,
  challenge_decline: 1.0,
  logging_decline: 1.0,
  rewards_decline: 1.0,
  social_decline: 1.0,
  goals_decline: 1.0,
};

/** Tenure lifecycle multiplier — front-loads the month 2–3 valley, discounts veterans. */
export function tenureMultiplier(tenureMonths) {
  const m = tenureMonths ?? 0;
  if (m < 2.5) return 1.0;     // onboarding regime handles its own weighting
  if (m <= 3) return 1.15;     // the 75–95 day valley — highest-value window
  if (m <= 6) return 1.05;
  if (m <= 12) return 0.95;
  return 0.85;                 // long-tenured: needs a bigger drop to alarm
}

/**
 * Map a churn score (and optional state) to a risk tier with display props.
 * Tiers are unchanged from v2 (80/55/30); adds the `insufficient_data` state.
 */
export function getRiskTier(score, state = 'scored') {
  if (state === 'insufficient_data') return {
    label: 'Not enough data', tier: 'insufficient_data', color: '#94A3B8',
    bg: 'rgba(148,163,184,0.12)', dot: '⚪',
    textClass: 'text-[#94A3B8]', bgClass: 'bg-[#94A3B8]/10', borderClass: 'border-[#94A3B8]/20',
  };
  if (state === 'paused') return {
    label: 'Paused', tier: 'paused', color: '#94A3B8',
    bg: 'rgba(148,163,184,0.12)', dot: '⏸️',
    textClass: 'text-[#94A3B8]', bgClass: 'bg-[#94A3B8]/10', borderClass: 'border-[#94A3B8]/20',
  };
  if (state === 'churned') return {
    label: 'Lost', tier: 'churned', color: '#6B7280',
    bg: 'rgba(107,114,128,0.14)', dot: '⚫',
    textClass: 'text-[#6B7280]', bgClass: 'bg-[#6B7280]/10', borderClass: 'border-[#6B7280]/20',
  };
  if (score >= 80) return {
    label: 'Critical', tier: 'critical', color: '#DC2626',
    bg: 'rgba(220,38,38,0.12)', dot: '🔴',
    textClass: 'text-[#DC2626]', bgClass: 'bg-[#DC2626]/10', borderClass: 'border-[#DC2626]/20',
  };
  if (score >= 55) return {
    label: 'High Risk', tier: 'high', color: '#EF4444',
    bg: 'rgba(239,68,68,0.12)', dot: '🔴',
    textClass: 'text-[#EF4444]', bgClass: 'bg-[#EF4444]/10', borderClass: 'border-[#EF4444]/20',
  };
  if (score >= 30) return {
    label: 'Medium Risk', tier: 'medium', color: '#F59E0B',
    bg: 'rgba(245,158,11,0.12)', dot: '🟡',
    textClass: 'text-[#F59E0B]', bgClass: 'bg-[#F59E0B]/10', borderClass: 'border-[#F59E0B]/20',
  };
  return {
    label: 'Low Risk', tier: 'low', color: '#10B981',
    bg: 'rgba(16,185,129,0.12)', dot: '🟢',
    textClass: 'text-[#10B981]', bgClass: 'bg-[#10B981]/10', borderClass: 'border-[#10B981]/20',
  };
}

/** Which dimension is driving the risk — powers the human explanation (REQUIRED for trust). */
function classifyDriver(attRisk, engRisk, score, isOnboarding) {
  if (score < 30) return 'healthy';
  if (isOnboarding) return 'onboarding';
  if (attRisk >= 30 && engRisk >= 12) return 'both';
  if (attRisk >= 25) return 'attendance';
  if (engRisk >= 12) return 'engagement';
  return 'attendance';
}

/** Human, localized reason for the score. The flagship case: a still-attending
 *  member flagged on engagement must say WHY, or the owner thinks it's wrong.
 *  Exported so the precompute read path (loadScores.js) can localize from the
 *  persisted `primary_driver` rather than the edge function's English string. */
export function buildExplanation(driver, m = {}) {
  const days = m.daysSinceLastCheckIn != null
    ? Math.round(m.daysSinceLastCheckIn)
    : (m.daysSinceLastActivity != null ? Math.round(m.daysSinceLastActivity) : null);
  const freq = (m.avgWeeklyVisits ?? 0).toFixed(1);
  switch (driver) {
    case 'healthy':
      return tt('admin.churn.expl.healthy', 'Showing up consistently — looks healthy.');
    case 'engagement':
      return tt('admin.churn.expl.engagement', 'Attendance is stable, but engagement dropped sharply from previous behavior.');
    case 'both':
      return tt('admin.churn.expl.both', 'Attendance is falling and app engagement has dropped.');
    case 'onboarding':
      return tt('admin.churn.expl.onboarding', 'New member — not yet building a routine.');
    case 'dormant':
      return days != null
        ? tt('admin.churn.expl.dormant', 'No activity for {{d}}+ days.', { d: days })
        : tt('admin.churn.expl.dormantNever', 'No workouts or check-ins on record.');
    case 'new':
      return tt('admin.churn.expl.new', 'New member — not enough data yet to score.');
    case 'never_activated': {
      const enrolled = m.accountAgeDays != null ? Math.round(m.accountAgeDays) : null;
      return enrolled != null
        ? tt('admin.churn.expl.neverActivated', 'Enrolled {{d}} days ago but never checked in or logged a workout.', { d: enrolled })
        : tt('admin.churn.expl.neverActivatedShort', 'Never checked in or logged a workout.');
    }
    case 'paused':
      return tt('admin.churn.expl.paused', 'On a membership hold — churn alerts paused.');
    case 'churned':
      return days != null
        ? tt('admin.churn.expl.churned', 'Likely lost — no activity for {{d}}+ days.', { d: days })
        : tt('admin.churn.expl.churnedNever', 'Likely lost — no activity on record.');
    case 'attendance':
    default:
      if (days != null && (m.avgWeeklyVisits ?? 0) > 0)
        return tt('admin.churn.expl.attendance', "Hasn't checked in for {{d}} days (was {{f}}×/week).", { d: days, f: freq });
      if (days != null)
        return tt('admin.churn.expl.attendanceDays', "Hasn't checked in for {{d}} days.", { d: days });
      return tt('admin.churn.expl.attendanceGeneric', 'Attendance has dropped off.');
  }
}

function trendFromSignal(trendSig) {
  if (!trendSig) return 'stable';
  if (trendSig.dir === 'down') return 'declining';
  if (trendSig.dir === 'up') return 'improving';
  return 'stable';
}

/**
 * @param {Object} m  member metrics (built by retention.js / loadScores.js / edge fn)
 * @param {Object} [weights] per-gym weight multipliers (DEFAULT_WEIGHTS shape)
 * @returns {{ score, riskTier, tier, state, signals, keySignals, keySignal,
 *             primaryDriver, explanation, trend, bonus, attRisk, engRisk }}
 */
export function calculateChurnScore(m, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const tenureMonths = m.tenureMonths ?? 0;
  const tenureDays = tenureMonths * 30.44;
  const isOnboarding = tenureDays < ONBOARDING_DAYS;

  const totalSessions = m.totalSessions ?? 0;
  const observedCheckIns = m.observedCheckIns ?? 0;
  const dsa = m.daysSinceLastActivity; // null = no activity on record at all

  // ── State 0: paused (vacation / membership hold) — set by the caller ──
  if (m.isPaused) {
    return {
      score: 0, state: 'paused', tier: 'paused', riskTier: getRiskTier(0, 'paused'),
      signals: {}, keySignals: ['On hold'], keySignal: 'On hold',
      primaryDriver: 'paused', explanation: buildExplanation('paused', m),
      trend: 'stable', bonus: 0, attRisk: 0, engRisk: 0,
    };
  }

  // ── State 1: insufficient data — never Critical ──
  // Gate on REAL ATTENDANCE footprint (ever logged a workout OR ever checked in),
  // NOT on dsa. last_active_at is just an app-open timestamp set at signup/import,
  // so a member who never attended still has a non-null dsa — which used to skip
  // the grace and drop them into the dormant override (95). No attendance on
  // record → no churn signal → insufficient data, regardless of last_active_at.
  const hasFootprint = totalSessions > 0 || observedCheckIns > 0;
  // accountAgeDays = how long we've been able to OBSERVE them (since created_at),
  // NOT membership tenure — so a freshly-imported roster (old membership_started_at,
  // recent created_at) isn't flagged on day one. Falls back to tenureDays if absent.
  const accountAgeDays = m.accountAgeDays ?? tenureDays;

  // ── State 1a: failed activation — enrolled long enough to start, did NOTHING ──
  // Zero check-ins AND zero workouts EVER, past the activation window → a real
  // churn risk (per owner choice), not "insufficient data". Flagged High, scaling
  // with how long they've been a no-show, but kept below the dormant/critical band
  // so recently-lapsed members always rank above never-activated ones.
  if (!hasFootprint && tenureDays >= GRACE_DAYS && accountAgeDays >= ACTIVATION_DEADLINE_DAYS) {
    const weeksOverdue = Math.max(0, Math.floor((accountAgeDays - ACTIVATION_DEADLINE_DAYS) / 7));
    const score = Math.min(78, 60 + weeksOverdue * 4);
    return {
      score, state: 'scored', tier: getRiskTier(score).tier, riskTier: getRiskTier(score),
      signals: {}, keySignals: ['Never activated'], keySignal: 'Never activated',
      primaryDriver: 'never_activated', explanation: buildExplanation('never_activated', m),
      trend: 'declining', bonus: 0, attRisk: score, engRisk: 0,
    };
  }

  // ── State 1b: insufficient data — genuinely new, or no footprint within window ──
  if (tenureDays < GRACE_DAYS || !hasFootprint) {
    return {
      score: 0, state: 'insufficient_data', tier: 'insufficient_data',
      riskTier: getRiskTier(0, 'insufficient_data'),
      signals: {}, keySignals: ['New member — not enough data yet'],
      keySignal: 'New member — not enough data yet',
      primaryDriver: 'new', explanation: buildExplanation('new', m),
      trend: 'stable', bonus: 0, attRisk: 0, engRisk: 0,
    };
  }

  // ── State 2: churned (mathematically gone) — out of the primary action queue ──
  if (dsa != null && dsa >= CHURNED_DAYS) {
    const sig = `No activity in ${Math.round(dsa)}+ days`;
    return {
      score: 100, state: 'churned', tier: 'churned', riskTier: getRiskTier(100, 'churned'),
      signals: {}, keySignals: [sig], keySignal: sig,
      primaryDriver: 'churned', explanation: buildExplanation('churned', m),
      trend: 'declining', bonus: 0, attRisk: 70, engRisk: 0,
    };
  }

  // ── State 3: dormant (gone dark, still winnable) — forced Critical ──
  // Reaches here only WITH an attendance footprint (grace handled the rest), so a
  // null dsa means "had activity, none recent" — not "never logged a workout".
  if (dsa == null || dsa >= DORMANT_DAYS) {
    const sig = dsa == null
      ? 'No recent activity'
      : `No activity in ${Math.round(dsa)}+ days`;
    return {
      score: 95, state: 'dormant', tier: 'critical',
      riskTier: getRiskTier(95),
      signals: {}, keySignals: [sig], keySignal: sig,
      primaryDriver: 'dormant', explanation: buildExplanation('dormant', m),
      trend: 'declining', bonus: 0, attRisk: 70, engRisk: 0,
    };
  }

  // ── Layer A — attendance core (regime by tenure) ──
  let layerA;
  if (isOnboarding) {
    layerA = {
      habit_formation: sigHabitFormation(m.visitsSoFar ?? 0, tenureDays),
      recency: sigRecency(dsa, 28, 10),
      activation: sigActivation(m.firstWorkoutLogged ?? false, tenureDays),
    };
  } else {
    layerA = {
      recency: sigRecency(dsa, 25, 18),
      frequency: sigFrequency(m.avgWeeklyVisits ?? 0, m.trainingFrequency ?? 3, m.cohortPercentile ?? null),
      trend: sigTrend(m.recentWeeklyRate ?? 0, m.baselineWeeklyRate ?? null),
      streak: sigStreak(m.streakActive ?? false, m.brokenStreakLen ?? 0),
    };
    // Low-frequency baseline guard: a member STABLE at their own (low) cadence
    // shouldn't be over-penalized by the 3×/wk anchor. Weight personal velocity
    // over the global ideal — dampen the level penalty when there is no decline.
    if (layerA.frequency && layerA.trend && layerA.trend.score === 0
        && layerA.trend.dir !== 'down' && (m.baselineWeeklyRate ?? 0) >= 0.25) {
      layerA.frequency = { ...layerA.frequency, score: Math.round(layerA.frequency.score * 0.55 * 10) / 10 };
    }
  }

  // ── Layer B — engagement decline (steady-state only; never in onboarding) ──
  const layerB = isOnboarding ? {} : {
    app_decline: sigAppDecline(m.appActivity?.baseline, m.appActivity?.recent),
    challenge_decline: sigChallengeDecline(m.challenge?.baseline, m.challenge?.recent),
    logging_decline: sigLoggingDecline(m.logging?.baseline, m.logging?.recent),
    rewards_decline: sigRewardsDecline(m.rewards?.baseline, m.rewards?.recent),
    social_decline: sigSocialDecline(m.social?.baseline, m.social?.recent),
    goals_decline: sigGoalsDecline(m.goalsPRs?.baseline, m.goalsPRs?.recent),
  };

  const sumLayer = (layer) =>
    Object.entries(layer).reduce((acc, [k, s]) => acc + s.score * (w[k] ?? 1), 0);
  const attRisk = Math.max(0, sumLayer(layerA));
  const engRisk = Math.max(0, sumLayer(layerB));

  // ── Layer C — protective bonus ──
  const { bonus } = bonusProtective({
    activeReferrer: m.activeReferrer ?? false,
    activeChallenge: m.activeChallenge ?? false,
    recentPRs: m.recentPRs ?? false,
    strongAppCard: m.strongAppCard ?? false,
    activeSocial: m.activeSocial ?? false,
  });

  // ── Compose: multiplier → attendance gate → bonus → clamp ──
  let risk = (attRisk + engRisk) * tenureMultiplier(tenureMonths);
  const attendanceStrong = attRisk <= GATE_THRESHOLD;
  if (attendanceStrong) risk = Math.min(risk, MEDIUM_CAP); // engagement alone can't exceed Medium
  risk = Math.max(0, Math.min(100, risk + bonus));
  const score = Math.round(risk * 10) / 10;

  const signals = { ...layerA, ...layerB };
  const driver = classifyDriver(attRisk, engRisk, score, isOnboarding);
  const keySignals = Object.values(signals)
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.label);
  if (keySignals.length === 0) keySignals.push('Engagement looks healthy');

  return {
    score,
    state: 'scored',
    tier: getRiskTier(score).tier,
    riskTier: getRiskTier(score),
    signals,
    keySignals,
    keySignal: keySignals[0],
    primaryDriver: driver,
    explanation: buildExplanation(driver, m),
    trend: trendFromSignal(layerA.trend),
    bonus,
    attRisk,
    engRisk,
  };
}

export function calculateChurnScoreSimple(m, weights) {
  return calculateChurnScore(m, weights).score;
}

/**
 * Lightweight cold-start fallback (adminQueries.fetchChurnFallback) for when the
 * pipeline returns nothing. Attendance-based, tiers match getRiskTier (80/55/30).
 * New members (< 14 days OR < 4 lifetime events) report `insufficient_data`.
 *
 * @returns {{ score, risk_tier, key_signals, state }}
 */
export function estimateChurnScoreFallback(daysInactive, recentWorkouts, neverActive, tenureDays = null, lifetimeEvents = null) {
  // Never-active (no check-in + no recent workout), brand-new, or barely-seen
  // members carry NO behavioral signal → "not enough data", NOT Critical.
  // Mirrors the v3 insufficient-data grace so even this cold fallback can never
  // stamp a no-activity member 95 ("never logged a workout") — which is exactly
  // the over-flagging v3 set out to kill.
  if (neverActive
      || (tenureDays != null && tenureDays < GRACE_DAYS)
      || (lifetimeEvents != null && lifetimeEvents < GRACE_MIN_EVENTS)) {
    return { score: 0, risk_tier: 'insufficient_data', key_signals: ['New member — not enough data yet'], state: 'insufficient_data' };
  }
  let score;
  if (daysInactive > 30) score = 95;
  else if (daysInactive > 14) score = recentWorkouts === 0 ? 85 : 70;
  else if (daysInactive > 7) score = recentWorkouts === 0 ? 45 : 30;
  else score = Math.max(0, 20 - recentWorkouts * 5);
  score = Math.min(100, Math.max(0, score));
  const risk_tier = score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'medium' : 'low';
  const key_signals = [];
  if (daysInactive > 30) key_signals.push(`No activity in ${daysInactive}+ days`);
  else if (daysInactive > 14) key_signals.push('No activity in 14+ days');
  if (recentWorkouts === 0) key_signals.push('No workouts in last 14 days');
  return { score, risk_tier, key_signals, state: 'scored' };
}
