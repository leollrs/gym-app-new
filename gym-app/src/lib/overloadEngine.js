// ── Progressive Overload Engine ────────────────────────────────────────────
// Computes per-exercise weight/rep suggestions using double progression.
//
// Double progression:
//   1. Stay at current weight, increase reps toward top of range.
//   2. Once top of range is hit → increase weight, drop back to lower end.
//
// Adjustments per goal (rep range + 1RM %) and fitness level (increment size).
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

// 1RM estimate — Epley for reps <= 12, Brzycki for reps > 12 (Fix #26)
export const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
  // For reps >= 30, always use Epley formula (Brzycki breaks down)
  if (reps >= 30) return weight * (1 + reps / 30);
  if (reps > 12) {
    const result = weight / (1.0278 - 0.0278 * reps);
    return isFinite(result) && result > 0 ? result : weight * (1 + reps / 30);
  }
  return weight * (1 + reps / 30);
};

// Round to nearest 2.5 lbs (standard plate increment)
const roundToPlate = (lbs) => Math.round(lbs / 2.5) * 2.5;

/**
 * Decide if an exercise is "compound" (multi-joint) based on its target rep range.
 * Lower rep targets → compound movement → larger weight jumps.
 */
const isCompound = (targetReps) => targetReps <= 8;

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
 * Compute a progression suggestion for one exercise.
 *
 * @param {Array<{weight: number, reps: number}>} history
 *   Completed sets from the user's LAST session for this exercise.
 * @param {Object} onboarding  { fitness_level, primary_goal }
 * @param {number} targetReps  from routine config (nullable)
 * @param {number} [consecutiveSessions=0]  number of consecutive progressive sessions
 *
 * @returns {{
 *   suggestedWeight: number|null,
 *   suggestedReps:   number,
 *   note:  'first_time' | 'increase_weight' | 'increase_reps' | 'maintain' | 'deload',
 *   label: string   // human-readable hint
 * }}
 */
export const computeSuggestion = (history, onboarding, targetReps, consecutiveSessions = 0) => {
  const goal  = onboarding?.primary_goal  ?? 'general_fitness';
  const level = onboarding?.fitness_level ?? 'intermediate';

  const config    = GOAL_CONFIG[goal] ?? GOAL_CONFIG.general_fitness;
  const increments = INCREMENTS[level] ?? INCREMENTS.intermediate;

  // Rep target: honour routine config if it falls in goal range; else use range midpoint
  const repTarget = targetReps
    ? Math.max(config.min, Math.min(config.max, targetReps))
    : Math.round((config.min + config.max) / 2);

  // No usable history → first time doing this exercise
  const completedSets = (history ?? []).filter(s => s.weight > 0 && s.reps > 0);
  if (completedSets.length === 0) {
    return {
      suggestedWeight: null,
      suggestedReps:   repTarget,
      note:  'first_time',
      label: `Start light — aim for ${config.min}–${config.max} reps`,
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
  const best = completedSets.reduce((top, s) =>
    epley1RM(s.weight, s.reps) > epley1RM(top.weight, top.reps) ? s : top
  );

  // Average completed reps across last session's sets
  const avgReps = Math.round(
    completedSets.reduce((sum, s) => sum + s.reps, 0) / completedSets.length
  );

  const incr = isCompound(repTarget) ? increments.compound : increments.isolation;

  // Hit top of range (or beginner who hit target) → increase weight
  if (avgReps >= config.max || (level === 'beginner' && avgReps >= repTarget)) {
    const suggestedWeight = roundToPlate(best.weight + incr);

    const MAX_REASONABLE_WEIGHT = 1500; // lbs - beyond any human capability
    if (suggestedWeight > MAX_REASONABLE_WEIGHT) {
      return { suggestedWeight: best.weight, note: 'maintain', label: 'Weight appears unusually high — verify your logs' };
    }

    return {
      suggestedWeight,
      suggestedReps:   config.min,
      note:  'increase_weight',
      label: `+${incr} lbs — you crushed last session`,
    };
  }

  // Didn't quite hit top → same weight, push for 1 more rep
  const nextReps = Math.min(avgReps + 1, config.max);
  return {
    suggestedWeight: best.weight,
    suggestedReps:   nextReps,
    note:  'increase_reps',
    label: `Same weight — aim for ${nextReps} reps this time`,
  };
};
