/**
 * goalRealism.js — realistic timelines + near-term milestones for member goals.
 *
 * Onboarding v2 lets members set specific targets (a body weight, a lift, a body-
 * fat %). To keep those targets honest we translate a gap into a realistic time
 * using scientific progression rates, offered as an intensity BAND
 * (steady / moderate / aggressive) all inside the safe range. Big goals (honest
 * timeline > ~16 weeks) also get a ~12-week milestone so there's a near-term win
 * to celebrate while the long-term target stays intact.
 *
 * This is the single source of truth for progression math. GoalsSection.jsx's
 * inline suggestTargetDate() predates it and clamps to a max number of weeks;
 * onboarding deliberately DROPS that clamp (an honest 34-week goal should read
 * as 34 weeks, not a rosy 16). Pure functions only — no React, no Supabase.
 */

// Progression rates in lbs/week by fitness level (same values GoalsSection uses).
export const PROGRESSION_RATES = {
  beginner:     { compound: 5,    isolation: 2.5 },
  intermediate: { compound: 2.5,  isolation: 1.25 },
  advanced:     { compound: 1.25, isolation: 0.5 },
};

// Body-composition rates (per week), midpoints of the accepted-safe ranges.
const BODY_WEIGHT_RATE = 1.5; // lb/week (safe range ~1–2)
const BODY_FAT_RATE    = 0.5; // %/week  (safe range ~0.25–0.75, ~2%/month)

// Intensity band multipliers applied to the base (max-safe) weekly rate.
// aggressive = the base rate (fastest still-safe); slower bands take longer.
const BAND_MULTIPLIER = { aggressive: 1.0, moderate: 0.75, steady: 0.55 };
export const BANDS = ['steady', 'moderate', 'aggressive'];
export const DEFAULT_BAND = 'moderate';

const ISOLATION_KEYWORDS = [
  'curl', 'extension', 'fly', 'flye', 'raise', 'kickback',
  'pullover', 'shrug', 'wrist', 'calf', 'forearm',
];

export function isIsolationExercise(exerciseName) {
  if (!exerciseName) return false;
  const lower = String(exerciseName).toLowerCase();
  return ISOLATION_KEYWORDS.some((kw) => lower.includes(kw));
}

// Base (max-safe) weekly rate for a goal type, in the goal's own units.
function baseWeeklyRate({ goalType, fitnessLevel, exerciseName }) {
  if (goalType === 'lift_1rm') {
    const rates = PROGRESSION_RATES[fitnessLevel] || PROGRESSION_RATES.intermediate;
    return isIsolationExercise(exerciseName) ? rates.isolation : rates.compound;
  }
  if (goalType === 'body_weight') return BODY_WEIGHT_RATE;
  if (goalType === 'body_fat')    return BODY_FAT_RATE;
  return null;
}

const clampWeeks = (w) => Math.max(1, Math.ceil(w));

function isoAfterWeeks(weeks) {
  const d = new Date();
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d.toISOString().split('T')[0];
}

/**
 * Honest number of weeks to close `gap` (absolute units) at the given band.
 * NO maximum clamp — a big goal returns a big number of weeks on purpose.
 * Returns null when we can't estimate (no gap or unsupported goal type).
 */
export function honestWeeks({ goalType, gap, fitnessLevel, exerciseName, band = DEFAULT_BAND }) {
  const absGap = Math.abs(Number(gap));
  if (!absGap || Number.isNaN(absGap)) return null;
  const rate = baseWeeklyRate({ goalType, fitnessLevel, exerciseName });
  if (!rate) return null;
  const effectiveRate = rate * (BAND_MULTIPLIER[band] ?? BAND_MULTIPLIER[DEFAULT_BAND]);
  return clampWeeks(absGap / effectiveRate);
}

/**
 * The full intensity band for a goal → { steady, moderate, aggressive }, each
 * { weeks, date }. Faster band = fewer weeks = sooner date, all still inside the
 * safe rate range. Returns null when the gap can't be estimated.
 */
export function realisticBand({ goalType, gap, fitnessLevel, exerciseName }) {
  const absGap = Math.abs(Number(gap));
  if (!absGap || Number.isNaN(absGap)) return null;
  const out = {};
  for (const band of BANDS) {
    const weeks = honestWeeks({ goalType, gap: absGap, fitnessLevel, exerciseName, band });
    if (weeks == null) return null;
    out[band] = { weeks, date: isoAfterWeeks(weeks) };
  }
  return out;
}

// Weeks past which a goal is "big" enough to warrant a near-term milestone.
export const MILESTONE_THRESHOLD_WEEKS = 16;
// The near-term chunk we carve off a big goal.
export const MILESTONE_WEEKS = 12;

/**
 * A ~12-week milestone for a big goal, so the member has a proximal win to hit
 * while the long-term target stays active. Returns null when the honest timeline
 * is already short (≤ threshold) — no need to split a goal you'll hit soon.
 *
 * The milestone value is a realistic PARTIAL toward the target based on the same
 * pace: startValue moved MILESTONE_WEEKS worth of progress in the goal's
 * direction (never overshooting the final target).
 *
 * @returns {{ weeks, date, value, direction }|null}
 */
export function milestone({ goalType, startValue, targetValue, fitnessLevel, exerciseName, band = DEFAULT_BAND }) {
  const start = Number(startValue);
  const target = Number(targetValue);
  if (Number.isNaN(start) || Number.isNaN(target) || start === target) return null;

  const gap = target - start;               // signed
  const direction = gap > 0 ? 'up' : 'down';
  const weeksToTarget = honestWeeks({ goalType, gap, fitnessLevel, exerciseName, band });
  if (weeksToTarget == null || weeksToTarget <= MILESTONE_THRESHOLD_WEEKS) return null;

  const rate = baseWeeklyRate({ goalType, fitnessLevel, exerciseName });
  if (!rate) return null;
  const effectiveRate = rate * (BAND_MULTIPLIER[band] ?? BAND_MULTIPLIER[DEFAULT_BAND]);
  const move = effectiveRate * MILESTONE_WEEKS;           // magnitude of 12-week progress

  // Move from start toward target, but never past it.
  let value = direction === 'up' ? start + move : start - move;
  value = direction === 'up' ? Math.min(value, target) : Math.max(value, target);
  // Round to a sensible precision per goal type.
  value = goalType === 'body_fat' ? Math.round(value * 10) / 10 : Math.round(value);

  return { weeks: MILESTONE_WEEKS, date: isoAfterWeeks(MILESTONE_WEEKS), value, direction };
}
