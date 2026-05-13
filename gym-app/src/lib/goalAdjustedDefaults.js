// goalAdjustedDefaults.js
//
// Translates a static exercise's defaults (defaultSets / defaultReps /
// restSeconds — encoded once in src/data/exercises.js) into goal-tailored
// targets so the Exercise Library + Workout Builder UI surface what's
// right for THIS user, not a generic recommendation.
//
// Mirrors the goal × volume tables used by the auto-workout generator
// (lib/workoutGenerator.js DURATION_CONFIGS[60].goals), with a coarser
// compound-vs-isolation split because most users only care about that
// distinction. Cardio / mobility / warm-up exercises are passed through
// unchanged — they have time-based "reps" that don't map to rep ranges.

const COMPOUND_PATTERNS = new Set([
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'push',
  'pull',
]);

const GOAL_PRESETS = {
  strength: {
    compound:  { sets: 5, reps: '3-5',  rest: 180 },
    isolation: { sets: 4, reps: '6-8',  rest: 120 },
  },
  muscle_gain: {
    compound:  { sets: 4, reps: '8-10', rest: 90 },
    isolation: { sets: 3, reps: '10-12', rest: 75 },
  },
  fat_loss: {
    compound:  { sets: 3, reps: '10-12', rest: 60 },
    isolation: { sets: 3, reps: '12-15', rest: 45 },
  },
  endurance: {
    compound:  { sets: 3, reps: '15-20', rest: 30 },
    isolation: { sets: 2, reps: '15-20', rest: 30 },
  },
  general_fitness: {
    compound:  { sets: 3, reps: '8-10',  rest: 75 },
    isolation: { sets: 3, reps: '10-12', rest: 60 },
  },
};

const PASS_THROUGH_MUSCLE_GROUPS = new Set(['Cardio', 'Warm-Up']);
const PASS_THROUGH_CATEGORIES = new Set(['Cardio', 'Mobility']);

const isCompound = (ex) => {
  const p = (ex?.movementPattern || ex?.movement_pattern || '').toLowerCase();
  if (!p) {
    // Heuristic fallback for exercises without movementPattern: 6 reps or
    // less in the default is almost always a strength compound.
    const r = String(ex?.defaultReps || '').trim();
    const lead = parseInt(r, 10);
    if (Number.isFinite(lead) && lead > 0 && lead <= 6) return true;
    return false;
  }
  return COMPOUND_PATTERNS.has(p);
};

/**
 * @param {object} exercise — full library row
 * @param {string} [goal='general_fitness']
 * @returns {{ sets:number, reps:string, rest:number, adjusted:boolean }}
 *   `adjusted` flips false for pass-through cases so callers can decide
 *   whether to badge the UI as "Goal-tailored".
 */
export function goalAdjustedDefaults(exercise, goal = 'general_fitness') {
  if (!exercise) {
    return { sets: 3, reps: '8-12', rest: 60, adjusted: false };
  }

  // Cardio / mobility / warm-up: keep the exercise's own defaults — rep
  // ranges don't apply.
  if (
    PASS_THROUGH_MUSCLE_GROUPS.has(exercise.muscle)
    || PASS_THROUGH_CATEGORIES.has(exercise.category)
  ) {
    return {
      sets: exercise.defaultSets ?? 3,
      reps: exercise.defaultReps ?? '—',
      rest: exercise.restSeconds ?? exercise.rest_seconds ?? 60,
      adjusted: false,
    };
  }

  const preset = GOAL_PRESETS[goal] || GOAL_PRESETS.general_fitness;
  const kind = isCompound(exercise) ? 'compound' : 'isolation';
  const out = preset[kind];
  return { ...out, adjusted: true };
}

/**
 * Format a rest-second number as "M:SS" (matches the modal's display).
 */
export function formatRest(restSeconds) {
  if (!Number.isFinite(restSeconds) || restSeconds < 0) return '—';
  const m = Math.floor(restSeconds / 60);
  const s = restSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
