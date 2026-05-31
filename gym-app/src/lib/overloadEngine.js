// ── Progressive Overload Engine ────────────────────────────────────────────
// Computes per-exercise weight/rep suggestions using double progression.
//
// Double progression:
//   1. Stay at current weight, increase reps toward top of range.
//   2. Once top of range is hit → increase weight, drop back to lower end.
//
// Adjustments per goal (rep range + 1RM %) and fitness level (increment size).
//
// Also provides:
//   - Body-weight-based starting weight estimates for first-time exercises
//   - Intra-session set-by-set progression (bump weight mid-workout)
// ──────────────────────────────────────────────────────────────────────────────

// Rep range + approximate % 1RM per goal
const GOAL_CONFIG = {
  muscle_gain:    { min: 8,  max: 12, label: 'Hypertrophy' },
  strength:       { min: 3,  max: 6,  label: 'Strength'    },
  fat_loss:       { min: 12, max: 15, label: 'Fat Loss'     },
  endurance:      { min: 15, max: 20, label: 'Endurance'    },
  general_fitness:{ min: 10, max: 12, label: 'General'      },
};

// Weight increments per fitness level (in lbs)
const INCREMENTS = {
  beginner:    { compound: 5,    isolation: 2.5 },
  intermediate:{ compound: 2.5,  isolation: 2.5 },
  advanced:    { compound: 2.5,  isolation: 1.25 },
};

// ── Starting weight multipliers (% of body weight) per movement pattern ──
// These are conservative starting points — better to start too light than too heavy.
// Keys: movementPattern from exercise library.
const STARTING_WEIGHT_BW_RATIO = {
  // Compound pushes
  push: {
    beginner:     { male: 0.40, female: 0.20 },
    intermediate: { male: 0.60, female: 0.35 },
    advanced:     { male: 0.80, female: 0.50 },
  },
  // Compound pulls (rows, pull-ups)
  pull: {
    beginner:     { male: 0.35, female: 0.18 },
    intermediate: { male: 0.55, female: 0.30 },
    advanced:     { male: 0.75, female: 0.45 },
  },
  // Squats and leg presses
  squat: {
    beginner:     { male: 0.50, female: 0.30 },
    intermediate: { male: 0.75, female: 0.50 },
    advanced:     { male: 1.00, female: 0.70 },
  },
  // Deadlifts, RDLs, hip thrusts
  hinge: {
    beginner:     { male: 0.55, female: 0.35 },
    intermediate: { male: 0.80, female: 0.55 },
    advanced:     { male: 1.10, female: 0.75 },
  },
  // Isolation pushes (flyes, lateral raises, tricep extensions)
  isolation_push: {
    beginner:     { male: 0.10, female: 0.05 },
    intermediate: { male: 0.15, female: 0.08 },
    advanced:     { male: 0.20, female: 0.12 },
  },
  // Isolation pulls (curls, face pulls)
  isolation_pull: {
    beginner:     { male: 0.12, female: 0.06 },
    intermediate: { male: 0.18, female: 0.10 },
    advanced:     { male: 0.25, female: 0.15 },
  },
  // Core (planks, crunches — often bodyweight, but for weighted: cable crunches, etc.)
  core: {
    beginner:     { male: 0.08, female: 0.05 },
    intermediate: { male: 0.12, female: 0.08 },
    advanced:     { male: 0.18, female: 0.12 },
  },
  // Carries (farmer walks, etc.)
  carry: {
    beginner:     { male: 0.30, female: 0.18 },
    intermediate: { male: 0.50, female: 0.30 },
    advanced:     { male: 0.70, female: 0.45 },
  },
};

// Goal modifiers — strength goals start heavier, fat loss/endurance lighter
const GOAL_WEIGHT_MODIFIER = {
  strength:        1.10,
  muscle_gain:     1.00,
  general_fitness: 0.95,
  fat_loss:        0.85,
  endurance:       0.75,
};

// 1RM estimate — Epley for low reps, Brzycki for higher reps.
// Crossover is at 10 reps, NOT 12: the two formulas are numerically equal at
// ~10 reps, so switching there is continuous + monotonic. Switching at 12 (the
// old value) created a ~7% discontinuity — a set of 13 reps would spuriously
// out-rank a heavier set of 12 because Brzycki(13) jumps above Epley(12).
// For reps >= 30 Brzycki's denominator collapses, so fall back to Epley.
export const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
  if (reps >= 30) return weight * (1 + reps / 30);
  if (reps > 10) {
    const result = weight / (1.0278 - 0.0278 * reps);
    return isFinite(result) && result > 0 ? result : weight * (1 + reps / 30);
  }
  return weight * (1 + reps / 30);
};

// Round to nearest 2.5 lbs (standard plate increment)
const roundToPlate = (lbs) => Math.round(lbs / 2.5) * 2.5;

/**
 * Determine movement type from exercise metadata.
 * Returns true if compound (multi-joint), false if isolation.
 */
const isCompoundMovement = (movementPattern) => {
  if (!movementPattern) return false;
  return ['push', 'pull', 'squat', 'hinge', 'carry'].includes(movementPattern);
};

// (Removed the legacy rep-based isCompound() heuristic. When an exercise has no
//  movementPattern we now default to the ISOLATION increment — the smaller,
//  safer step. The old heuristic tagged any low-rep set as "compound" and
//  handed out the larger +5lb jump, which over-suggested weight for e.g. a
//  heavy-but-isolated curl in a strength block.)

/**
 * Estimate a starting weight for an exercise the user has never done before.
 * Uses body weight, fitness level, sex, goal, and movement pattern.
 *
 * @param {object} opts
 * @param {number} opts.bodyWeightLbs  — user's body weight in lbs
 * @param {string} opts.fitnessLevel   — beginner | intermediate | advanced
 * @param {string} opts.sex            — male | female | other
 * @param {string} opts.goal           — primary_goal from onboarding
 * @param {string} opts.movementPattern — from exercise library (push/pull/squat/hinge/isolation_push/isolation_pull/core/carry)
 * @returns {number|null} suggested starting weight in lbs, or null if insufficient data
 */
export const estimateStartingWeight = ({ bodyWeightLbs, fitnessLevel, sex, goal, movementPattern }) => {
  if (!bodyWeightLbs || bodyWeightLbs <= 0) return null;

  const level = fitnessLevel || 'beginner';
  const pattern = movementPattern || 'push'; // default to compound push if unknown
  const genderKey = sex === 'female' ? 'female' : 'male'; // default male for 'other'

  const ratioTable = STARTING_WEIGHT_BW_RATIO[pattern];
  if (!ratioTable) return null;

  const levelRatios = ratioTable[level] || ratioTable.beginner;
  const ratio = levelRatios[genderKey] ?? levelRatios.male;

  const goalMod = GOAL_WEIGHT_MODIFIER[goal] ?? 1.0;

  const raw = bodyWeightLbs * ratio * goalMod;

  // Floor: never suggest less than 5 lbs for any weighted exercise
  const suggested = roundToPlate(Math.max(5, raw));
  return suggested;
};

/**
 * Check if a deload week should be suggested based on consecutive session count.
 * If the user has done 4-6+ consecutive progressive sessions, suggest reducing
 * weight by ~40% to allow recovery.
 *
 * @param {number} consecutiveSessions — number of consecutive progressive sessions
 * @returns {boolean}
 */
export const shouldDeload = (consecutiveSessions) => {
  return consecutiveSessions >= 4;
};

/**
 * Compute a deload suggestion: reduce weight by ~40%, keep same reps.
 *
 * @param {number} currentWeight
 * @param {number} currentReps
 * @returns {{ suggestedWeight: number, suggestedReps: number, note: 'deload', label: string }}
 */
export const computeDeload = (currentWeight, currentReps) => {
  const deloadWeight = roundToPlate(currentWeight * 0.6);
  return {
    suggestedWeight: deloadWeight,
    suggestedReps: currentReps,
    note: 'deload',
    label: `Deload week — ${deloadWeight} lbs (60% of working weight) for recovery`,
  };
};

/**
 * Compute intra-session suggestion for the NEXT set based on completed sets
 * within the current workout. If the user hit the top of the rep range on the
 * last completed set, suggest bumping weight for the next set.
 *
 * @param {Array<{weight: number, reps: number}>} completedSetsThisSession
 *   Sets completed so far in the CURRENT session for this exercise.
 * @param {object} onboarding  { fitness_level, primary_goal }
 * @param {number} targetReps  from routine config
 * @param {string} [movementPattern] — exercise movement pattern for increment sizing
 * @returns {{ suggestedWeight: number, suggestedReps: number, note: string, label: string } | null}
 *   Returns null if no intra-session adjustment is needed (caller falls back to session-to-session suggestion).
 */
export const computeIntraSessionSuggestion = (completedSetsThisSession, onboarding, targetReps, movementPattern) => {
  if (!completedSetsThisSession || completedSetsThisSession.length === 0) return null;

  const goal  = onboarding?.primary_goal  ?? 'general_fitness';
  const level = onboarding?.fitness_level ?? 'intermediate';
  const config    = GOAL_CONFIG[goal] ?? GOAL_CONFIG.general_fitness;
  const increments = INCREMENTS[level] ?? INCREMENTS.intermediate;

  const lastSet = completedSetsThisSession[completedSetsThisSession.length - 1];
  if (!lastSet || !lastSet.weight || lastSet.weight <= 0 || !lastSet.reps || lastSet.reps <= 0) return null;

  // Compound only when the exercise library says so; unknown → isolation (safer).
  const compound = movementPattern ? isCompoundMovement(movementPattern) : false;
  const incr = compound ? increments.compound : increments.isolation;

  // If last set reps >= top of goal range at current weight → bump weight for next set
  if (lastSet.reps >= config.max) {
    const bumpedWeight = roundToPlate(lastSet.weight + incr);
    return {
      suggestedWeight: bumpedWeight,
      suggestedReps:   config.min,
      note: 'intra_session_bump',
      label: `+${incr} lbs — you maxed reps on last set`,
    };
  }

  // Otherwise, keep same weight and aim for same or +1 rep
  return null; // no override, use the base suggestion
};

/**
 * Compute a progression suggestion for one exercise.
 *
 * @param {Array<{weight: number, reps: number}>} history
 *   Completed sets from the user's LAST session for this exercise.
 * @param {Object} onboarding  { fitness_level, primary_goal, initial_weight_lbs, sex }
 * @param {number} targetReps  from routine config (nullable)
 * @param {number} [consecutiveSessions=0]  number of consecutive progressive sessions
 * @param {Object} [exerciseMeta]  { movementPattern } from exercise library
 * @param {Object} [personalRecord]  { weight, reps } — the user's PR for this
 *   exercise from personal_records. When the recorded PR has a higher
 *   estimated 1RM than the best set in `history` (e.g. the PR was set on a
 *   different day than the most recent session), we use the PR as the floor
 *   so the next suggestion progresses FROM the PR, not from a maintenance set.
 *
 * @returns {{
 *   suggestedWeight: number|null,
 *   suggestedReps:   number,
 *   note:  'first_time' | 'first_time_estimated' | 'increase_weight' | 'increase_reps' | 'maintain' | 'deload',
 *   label: string   // human-readable hint
 * }}
 */
export const computeSuggestion = (history, onboarding, targetReps, consecutiveSessions = 0, exerciseMeta = null, personalRecord = null) => {
  const goal  = onboarding?.primary_goal  ?? 'general_fitness';
  const level = onboarding?.fitness_level ?? 'intermediate';

  const config    = GOAL_CONFIG[goal] ?? GOAL_CONFIG.general_fitness;
  const increments = INCREMENTS[level] ?? INCREMENTS.intermediate;

  // ── Effective rep band (the double-progression window) ──────────────────────
  // Three cases:
  //  • no explicit routine target          → progress across the GOAL range
  //  • target inside the goal range         → goal-range double progression,
  //                                            displaying the routine's target
  //  • target OUTSIDE the goal range        → the routine/trainer deliberately
  //    prescribed a different scheme (e.g. a 5×5 strength block for a member
  //    whose goal is hypertrophy). Honour it as fixed linear progression on the
  //    prescribed reps instead of silently rewriting it into the goal range
  //    (the old code clamped it, hiding the prescription).
  const hasTarget = Number.isFinite(targetReps) && targetReps > 0;
  const targetInGoalRange = hasTarget && targetReps >= config.min && targetReps <= config.max;

  let bandMin, bandMax;
  if (!hasTarget || targetInGoalRange) {
    bandMin = config.min;
    bandMax = config.max;
  } else {
    bandMin = targetReps;   // fixed-target linear progression
    bandMax = targetReps;
  }

  // Rep number shown as "aim for X" on fresh/maintenance suggestions.
  const repTarget = hasTarget ? targetReps : Math.round((config.min + config.max) / 2);
  const repRangeLabel = bandMin === bandMax ? `${bandMin}` : `${bandMin}–${bandMax}`;

  // No usable history → try body-weight-based estimate, else generic first_time
  const completedSets = (history ?? []).filter(s => s.weight > 0 && s.reps > 0);
  if (completedSets.length === 0) {
    // Attempt to estimate starting weight from onboarding body metrics
    const bodyWeightLbs = onboarding?.initial_weight_lbs;
    const movementPattern = exerciseMeta?.movementPattern;

    if (bodyWeightLbs && bodyWeightLbs > 0) {
      const estimated = estimateStartingWeight({
        bodyWeightLbs,
        fitnessLevel: level,
        sex: onboarding?.sex ?? 'male',
        goal,
        movementPattern,
      });

      if (estimated && estimated > 0) {
        return {
          suggestedWeight: estimated,
          suggestedReps:   repTarget,
          note:  'first_time_estimated',
          label: `Suggested start: ${estimated} lbs × ${repRangeLabel} reps`,
        };
      }
    }

    return {
      suggestedWeight: null,
      suggestedReps:   repTarget,
      note:  'first_time',
      label: `Start light — aim for ${repRangeLabel} reps`,
    };
  }

  // Deload check: after 4+ consecutive progressive sessions, suggest recovery week
  if (shouldDeload(consecutiveSessions)) {
    const topSet = completedSets.reduce((top, s) =>
      epley1RM(s.weight, s.reps) > epley1RM(top.weight, top.reps) ? s : top
    );
    return computeDeload(topSet.weight, repTarget);
  }

  // Best working set = highest estimated 1RM from last session
  let best = completedSets.reduce((top, s) =>
    epley1RM(s.weight, s.reps) > epley1RM(top.weight, top.reps) ? s : top
  );

  // Reps that drive the weight-up vs reps-up decision. Normally this is the
  // average of the most recent session's sets. BUT if the PR floor kicks in
  // below, we must judge against the PR's OWN reps, not this session's — see
  // the PR-floor block.
  let decisionReps = Math.round(
    completedSets.reduce((sum, s) => sum + s.reps, 0) / completedSets.length
  );

  // ── PR floor ──────────────────────────────────────────────────────────────
  // If the recorded PR has a higher estimated 1RM than the best set from the
  // most-recent session, that session was a back-off / maintenance / deload day
  // and the PR is the real working level. Progress FROM the PR so the
  // suggestion doesn't drift backwards.
  //
  // Critically, when we adopt the PR as `best` we must ALSO judge weight-up vs
  // reps-up by the PR's own reps. The old code kept this session's avgReps,
  // which produced absurd jumps: PR 225×5 + a light 135×15 back-off day →
  // avgReps 15 ≥ max → "add weight to 227.5", ignoring that the PR was only 5
  // reps. Using the PR's reps (5 < range) correctly suggests +1 rep at 225.
  if (personalRecord && personalRecord.weight > 0 && personalRecord.reps > 0) {
    const prE1RM = epley1RM(personalRecord.weight, personalRecord.reps);
    const bestE1RM = epley1RM(best.weight, best.reps);
    if (prE1RM > bestE1RM) {
      best = { weight: personalRecord.weight, reps: personalRecord.reps };
      decisionReps = personalRecord.reps;
    }
  }

  // Compound only when the exercise library says so; unknown → isolation (safer).
  const compound = exerciseMeta?.movementPattern
    ? isCompoundMovement(exerciseMeta.movementPattern)
    : false;
  const incr = compound ? increments.compound : increments.isolation;

  // Hit top of the working band (or beginner who hit their target) → add weight,
  // reset reps to the bottom of the band (classic double progression).
  if (decisionReps >= bandMax || (level === 'beginner' && decisionReps >= repTarget)) {
    const suggestedWeight = roundToPlate(best.weight + incr);

    const MAX_REASONABLE_WEIGHT = 1500; // lbs - beyond any human capability
    if (suggestedWeight > MAX_REASONABLE_WEIGHT) {
      return { suggestedWeight: best.weight, suggestedReps: bandMin, note: 'maintain', label: 'Weight appears unusually high — verify your logs' };
    }

    return {
      suggestedWeight,
      suggestedReps:   bandMin,
      note:  'increase_weight',
      label: `+${incr} lbs — you crushed last session`,
    };
  }

  // Didn't quite hit the top → same weight, push for 1 more rep (capped at band top).
  const nextReps = Math.min(decisionReps + 1, bandMax);
  return {
    suggestedWeight: best.weight,
    suggestedReps:   nextReps,
    note:  'increase_reps',
    label: `Same weight — aim for ${nextReps} reps this time`,
  };
};;
