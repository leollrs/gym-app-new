/**
 * Adaptive Workout Generator
 * Creates a unique, personalized workout for today based on:
 *   - User's onboarding data (goal, level, equipment, injuries)
 *   - Last 14 days of workout history (exercises, muscles, timing)
 *   - Muscle recovery analysis with priority scoring
 *
 * Exports: generateAdaptiveWorkout(userId) — async, fetches from Supabase
 */

import { supabase } from './supabase';
import { exercises as ALL_EXERCISES } from '../data/exercises';
import { INJURY_EXCLUSIONS } from './exerciseConstants';

// ── Muscle group classification ─────────────────────────────────────────────
const MUSCLE_SIZE = {
  Chest:     'large',
  Back:      'large',
  Legs:      'large',
  Shoulders: 'medium',
  Glutes:    'medium',
  Biceps:    'small',
  Triceps:   'small',
  Core:      'small',
  Calves:    'small',
};

// Recovery windows in hours
const RECOVERY_HOURS = {
  large:  { min: 48, full: 72 },
  medium: { min: 48, full: 48 },
  small:  { min: 24, full: 48 },
};

// ── Exercise metadata (tier) — mirrors workoutGenerator.js ──────────────────
const META = {
  ex_bp:    { tier: 'primary'   },
  ex_ibp:   { tier: 'secondary' },
  ex_dbp:   { tier: 'secondary' },
  ex_idbp:  { tier: 'secondary' },
  ex_cfly:  { tier: 'isolation' },
  ex_dfly:  { tier: 'isolation' },
  ex_dips:  { tier: 'primary'   },
  ex_dl:    { tier: 'primary'   },
  ex_bbr:   { tier: 'primary'   },
  ex_pu:    { tier: 'primary'   },
  ex_lp:    { tier: 'secondary' },
  ex_cbr:   { tier: 'secondary' },
  ex_dbr:   { tier: 'secondary' },
  ex_rdl:   { tier: 'secondary' },
  ex_ohp:   { tier: 'primary'   },
  ex_dbop:  { tier: 'primary'   },
  ex_lr:    { tier: 'isolation' },
  ex_fr:    { tier: 'isolation' },
  ex_rfly:  { tier: 'isolation' },
  ex_fcu:   { tier: 'secondary' },
  ex_bbc:   { tier: 'secondary' },
  ex_dbc:   { tier: 'secondary' },
  ex_hc:    { tier: 'isolation' },
  ex_cc:    { tier: 'isolation' },
  ex_pcc:   { tier: 'secondary' },
  ex_tpd:   { tier: 'secondary' },
  ex_ske:   { tier: 'secondary' },
  ex_oe:    { tier: 'isolation' },
  ex_cgp:   { tier: 'primary'   },
  ex_sq:    { tier: 'primary'   },
  ex_fsq:   { tier: 'primary'   },
  ex_lp_l:  { tier: 'secondary' },
  ex_le:    { tier: 'isolation' },
  ex_lc:    { tier: 'isolation' },
  ex_lunge: { tier: 'secondary' },
  ex_bdl:   { tier: 'secondary' },
  ex_hth:   { tier: 'primary'   },
  ex_kg:    { tier: 'secondary' },
  ex_plank: { tier: 'isolation' },
  ex_cr:    { tier: 'secondary' },
  ex_llr:   { tier: 'primary'   },
  ex_abwh:  { tier: 'primary'   },
  ex_scr:   { tier: 'secondary' },
  ex_secr:  { tier: 'isolation' },
};

// ── Volume config by goal — same as workoutGenerator.js ─────────────────────
const GOAL_CONFIG = {
  muscle_gain:     { sets: [3, 4], reps: '8-12',  rest: 90  },
  fat_loss:        { sets: [3, 4], reps: '12-15', rest: 60  },
  strength:        { sets: [4, 5], reps: '3-6',   rest: 180 },
  endurance:       { sets: [2, 3], reps: '15-20', rest: 45  },
  general_fitness: { sets: [3, 3], reps: '10-12', rest: 75  },
};

// ── Push / Pull / Legs synergy groups for workout naming ────────────────────
const SYNERGY_GROUPS = {
  Push: ['Chest', 'Shoulders', 'Triceps'],
  Pull: ['Back', 'Biceps'],
  Legs: ['Legs', 'Glutes', 'Calves'],
  Core: ['Core'],
};

// ── Goal-based compound preference multiplier ───────────────────────────────
const COMPOUND_BOOST = {
  muscle_gain:     1.3,
  strength:        1.5,
  fat_loss:        1.2,
  endurance:       1.0,
  general_fitness: 1.1,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a lookup: exercise_id → muscle group */
const EXERCISE_MUSCLE_MAP = new Map(ALL_EXERCISES.map(ex => [ex.id, ex.muscle]));

/** Deterministic daily seed so regenerate gives variety but same day = stable */
function dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Simple seeded shuffle (Fisher-Yates with seeded random) */
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  const rand = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Step 1: Muscle Recovery Analysis ────────────────────────────────────────

/**
 * For each muscle group, compute:
 *  - hoursSinceLast: hours since last trained (Infinity if never)
 *  - recoveryScore: 0 (just trained) → 100 (fully recovered)
 */
function analyzeRecovery(recentSets) {
  const now = Date.now();
  const muscleGroups = Object.keys(MUSCLE_SIZE);

  // Find the most recent timestamp each muscle was trained
  const lastTrained = {};
  for (const s of recentSets) {
    const muscle = EXERCISE_MUSCLE_MAP.get(s.exercise_id);
    if (!muscle) continue;
    const ts = new Date(s.completed_at).getTime();
    if (!lastTrained[muscle] || ts > lastTrained[muscle]) {
      lastTrained[muscle] = ts;
    }
  }

  const recovery = {};
  for (const muscle of muscleGroups) {
    const size = MUSCLE_SIZE[muscle];
    const window = RECOVERY_HOURS[size];
    const lastTs = lastTrained[muscle];

    if (!lastTs) {
      // Never trained in the window — fully recovered
      recovery[muscle] = { hoursSinceLast: Infinity, recoveryScore: 100, daysSinceLast: null };
      continue;
    }

    const hoursSince = (now - lastTs) / (1000 * 60 * 60);
    const daysSince = Math.floor(hoursSince / 24);

    // Linear scale: 0 at 0 hours, 100 at full recovery hours
    const score = Math.min(100, Math.round((hoursSince / window.full) * 100));

    recovery[muscle] = {
      hoursSinceLast: hoursSince,
      recoveryScore: score,
      daysSinceLast: daysSince,
    };
  }

  return recovery;
}

// ── Step 2: Priority Scoring ────────────────────────────────────────────────

function scoreMuscles(recovery, goal) {
  const scores = [];
  const compoundBoost = COMPOUND_BOOST[goal] || 1.0;

  for (const [muscle, data] of Object.entries(recovery)) {
    let score = data.recoveryScore;

    // Frequency debt: if not trained in 5+ days, boost priority
    if (data.daysSinceLast === null || data.daysSinceLast >= 5) {
      score += 25;
    } else if (data.daysSinceLast >= 4) {
      score += 15;
    }

    // Goal alignment: compound-heavy muscles get boosted for strength/muscle_gain
    const size = MUSCLE_SIZE[muscle];
    if (size === 'large') {
      score *= compoundBoost;
    }

    // Penalize muscles that are still recovering (below minimum)
    const window = RECOVERY_HOURS[size];
    if (data.hoursSinceLast !== Infinity && data.hoursSinceLast < window.min) {
      score *= 0.2; // Heavily penalize under-recovered muscles
    }

    scores.push({ muscle, score: Math.round(score), ...data });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

// ── Step 3: Workout Composition ─────────────────────────────────────────────

function buildExerciseList(topMuscles, pool, goal, seed) {
  const goalConfig = GOAL_CONFIG[goal] || GOAL_CONFIG.general_fitness;
  const targetExercises = topMuscles.length <= 2 ? 6 : 7;
  const maxExercises = 8;

  // Distribute exercise slots across chosen muscles
  // Primary muscles get more slots
  const slotDistribution = [];
  topMuscles.forEach((muscle, idx) => {
    const count = idx === 0 ? 3 : idx === 1 ? 2 : 2;
    for (let i = 0; i < count; i++) {
      slotDistribution.push(muscle);
    }
  });

  // Trim to target
  const slots = slotDistribution.slice(0, maxExercises);

  // For each slot, pick exercises prioritizing compounds first
  const chosen = [];
  const usedIds = new Set();

  // Sort pool: primary > secondary > isolation
  const tierOrder = { primary: 0, secondary: 1, isolation: 2 };

  for (const muscle of slots) {
    if (chosen.length >= targetExercises) break;

    const candidates = seededShuffle(
      pool.filter(ex => ex.muscle === muscle && !usedIds.has(ex.id)),
      seed + chosen.length
    );

    // Sort by tier preference (compounds first)
    candidates.sort((a, b) => {
      const ta = tierOrder[META[a.id]?.tier || 'isolation'] ?? 2;
      const tb = tierOrder[META[b.id]?.tier || 'isolation'] ?? 2;
      return ta - tb;
    });

    const pick = candidates[0];
    if (pick) {
      usedIds.add(pick.id);

      const tier = META[pick.id]?.tier || 'isolation';
      const isCompound = tier === 'primary';

      // Sets: compounds get upper range, isolation gets lower
      const sets = isCompound ? goalConfig.sets[1] : goalConfig.sets[0];
      const rest = isCompound
        ? goalConfig.rest
        : Math.max(30, goalConfig.rest - 15);

      chosen.push({
        exerciseId: pick.id,
        sets,
        reps: goalConfig.reps,
        restSeconds: rest,
        _muscle: muscle,
        _tier: tier,
        _name: pick.name,
      });
    }
  }

  // If we have fewer than 5, pad with remaining high-priority muscles
  if (chosen.length < 5) {
    const remaining = pool.filter(ex =>
      topMuscles.includes(ex.muscle) && !usedIds.has(ex.id)
    );
    const shuffled = seededShuffle(remaining, seed + 99);
    for (const ex of shuffled) {
      if (chosen.length >= 5) break;
      usedIds.add(ex.id);
      chosen.push({
        exerciseId: ex.id,
        sets: goalConfig.sets[0],
        reps: goalConfig.reps,
        restSeconds: goalConfig.rest,
        _muscle: ex.muscle,
        _tier: META[ex.id]?.tier || 'isolation',
        _name: ex.name,
      });
    }
  }

  // Sort final list: compounds first, then secondaries, then isolations
  chosen.sort((a, b) => {
    const ta = tierOrder[a._tier] ?? 2;
    const tb = tierOrder[b._tier] ?? 2;
    return ta - tb;
  });

  return { exercises: chosen, goalConfig };
}

// ── Step 4: Generate reasoning ──────────────────────────────────────────────

function generateReasons(exercises, recovery, goalExIds = new Set()) {
  return exercises.map(ex => {
    const data = recovery[ex._muscle];
    let reason;

    if (goalExIds.has(ex.exerciseId)) {
      reason = `Active goal — prioritized for progressive overload`;
    } else if (!data || data.daysSinceLast === null) {
      reason = `${ex._muscle} hasn't been hit recently — time to work it`;
    } else if (data.daysSinceLast >= 5) {
      reason = `${ex._muscle} is overdue (${data.daysSinceLast} days) — priority`;
    } else if (data.recoveryScore >= 80) {
      reason = `${ex._muscle} is fully recovered (${data.daysSinceLast}d ago)`;
    } else {
      reason = `${ex._muscle} recovered ${data.recoveryScore}% — light volume`;
    }

    return {
      exerciseId: ex.exerciseId,
      sets: ex.sets,
      reps: ex.reps,
      restSeconds: ex.restSeconds,
      reason,
    };
  });
}

// ── Workout naming ──────────────────────────────────────────────────────────

function nameWorkout(musclesFocused) {
  // Try to match a synergy group
  for (const [label, muscles] of Object.entries(SYNERGY_GROUPS)) {
    const overlap = musclesFocused.filter(m => muscles.includes(m));
    if (overlap.length >= 2 && overlap.length >= musclesFocused.length * 0.6) {
      return `Today's Workout: ${label} Focus`;
    }
  }

  // If mixed, just list top 2
  const top = musclesFocused.slice(0, 2).join(' & ');
  return `Today's Workout: ${top}`;
}

function generateSummaryReasoning(musclesFocused, recovery) {
  const parts = [];
  for (const muscle of musclesFocused.slice(0, 2)) {
    const data = recovery[muscle];
    if (!data) continue;
    if (data.daysSinceLast === null) {
      parts.push(`${muscle} hasn't been trained recently`);
    } else if (data.daysSinceLast >= 4) {
      parts.push(`${muscle} is overdue (${data.daysSinceLast} days)`);
    } else {
      parts.push(`${muscle} is recovered (${data.daysSinceLast}d ago)`);
    }
  }

  if (parts.length === 0) return 'Balanced session targeting your most recovered muscles.';
  return parts.join(', ') + ' — time to push.';
}

// ── Estimate duration ───────────────────────────────────────────────────────

// Compound IDs that take longer per set (including setup, unracking, etc.)
const COMPOUND_IDS = new Set([
  'ex_sq', 'ex_dl', 'ex_bp', 'ex_ohp', 'ex_bbr',
  'ex_fsq', 'ex_rdl', 'ex_ibp', 'ex_cgp', 'ex_dips',
]);

function estimateDuration(exercises) {
  const WARMUP_MINUTES = 5;
  const COOLDOWN_MINUTES = 3;
  const SECS_PER_REP = 7; // midpoint of 5-10s per rep
  const DEFAULT_REPS = 10;

  let totalSeconds = 0;
  for (const ex of exercises) {
    // Parse reps from string like "8-12" → average, or fall back to default
    let reps = DEFAULT_REPS;
    if (ex.reps) {
      const parts = String(ex.reps).split('-').map(Number).filter(n => !isNaN(n));
      if (parts.length >= 2) reps = Math.round((parts[0] + parts[1]) / 2);
      else if (parts.length === 1 && parts[0] > 0) reps = parts[0];
    }
    const isCompound = COMPOUND_IDS.has(ex.exerciseId);
    const setupTime = isCompound ? 15 : 5; // extra setup/unracking time
    const repTime = reps * SECS_PER_REP;
    const restDuration = ex.restSeconds || 90;
    totalSeconds += ex.sets * (repTime + setupTime + restDuration);
  }
  return Math.round((totalSeconds / 60) + WARMUP_MINUTES + COOLDOWN_MINUTES);
}

// ── Main Export ─────────────────────────────────────────────────────────────

/**
 * Generate an adaptive workout for the given user.
 *
 * @param {string} userId — Supabase auth user ID
 * @param {number} [variant=0] — bump this to regenerate a different workout
 * @returns {Promise<{
 *   name: string,
 *   exercises: Array<{ exerciseId: string, sets: number, reps: string, restSeconds: number, reason: string }>,
 *   musclesFocused: string[],
 *   estimatedMinutes: number,
 *   reasoning: string
 * }>}
 */
export async function generateAdaptiveWorkout(userId, variant = 0) {
  // ── Fetch onboarding data + active goals ──────────────────────────────
  const [{ data: onboarding }, { data: activeGoals }] = await Promise.all([
    supabase
      .from('member_onboarding')
      .select('fitness_level, primary_goal, training_days_per_week, available_equipment, injuries_notes')
      .eq('profile_id', userId)
      .maybeSingle(),
    supabase
      .from('member_goals')
      .select('goal_type, exercise_id, target_value, current_value, target_date')
      .eq('profile_id', userId)
      .is('achieved_at', null),
  ]);

  const {
    fitness_level = 'beginner',
    primary_goal = 'general_fitness',
    available_equipment = ['Bodyweight'],
    injuries_notes = '',
  } = onboarding || {};

  // ── Identify goal-targeted exercises and their muscles ────────────────
  const liftGoals = (activeGoals ?? []).filter(g => g.goal_type === 'lift_1rm' && g.exercise_id);
  const goalExerciseIds = new Set(liftGoals.map(g => g.exercise_id));
  const goalMuscleLookup = new Map();
  for (const ex of ALL_EXERCISES) {
    if (goalExerciseIds.has(ex.id)) goalMuscleLookup.set(ex.id, ex.muscle);
  }
  const goalMuscles = new Set(goalMuscleLookup.values());

  // ── Fetch last 14 days of workout history ───────────────────────────────
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const { data: recentSessions } = await supabase
    .from('workout_sessions')
    .select('id, completed_at')
    .eq('profile_id', userId)
    .eq('status', 'completed')
    .gte('completed_at', fourteenDaysAgo.toISOString())
    .order('completed_at', { ascending: false });

  let recentSets = [];
  if (recentSessions?.length > 0) {
    const sessionIds = recentSessions.map(s => s.id);
    const { data: sets } = await supabase
      .from('sets')
      .select('exercise_id, session_id')
      .in('session_id', sessionIds);

    // Attach completed_at from session to each set for recovery analysis
    const sessionMap = {};
    for (const s of recentSessions) {
      sessionMap[s.id] = s.completed_at;
    }
    recentSets = (sets || []).map(s => ({
      ...s,
      completed_at: sessionMap[s.session_id],
    }));
  }

  // ── Build filtered exercise pool ────────────────────────────────────────
  const injuryAreas = (injuries_notes || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const excluded = new Set(injuryAreas.flatMap(area => [...(INJURY_EXCLUSIONS[area] || [])]));

  const allowedEquipment = new Set([...available_equipment, 'Bodyweight']);
  const allowedDiff = new Set(
    fitness_level === 'beginner'     ? ['beginner'] :
    fitness_level === 'intermediate' ? ['beginner', 'intermediate'] :
                                       ['beginner', 'intermediate', 'advanced']
  );

  // Difficulty map for filtering
  const DIFF_MAP = {
    ex_bp: 'intermediate', ex_ibp: 'intermediate', ex_dbp: 'beginner', ex_idbp: 'beginner',
    ex_cfly: 'beginner', ex_dfly: 'beginner', ex_dips: 'intermediate',
    ex_dl: 'advanced', ex_bbr: 'intermediate', ex_pu: 'intermediate',
    ex_lp: 'beginner', ex_cbr: 'beginner', ex_dbr: 'beginner', ex_rdl: 'intermediate',
    ex_ohp: 'intermediate', ex_dbop: 'beginner', ex_lr: 'beginner', ex_fr: 'beginner',
    ex_rfly: 'beginner', ex_fcu: 'beginner',
    ex_bbc: 'intermediate', ex_dbc: 'beginner', ex_hc: 'beginner', ex_cc: 'beginner', ex_pcc: 'beginner',
    ex_tpd: 'beginner', ex_ske: 'intermediate', ex_oe: 'beginner', ex_cgp: 'intermediate',
    ex_sq: 'intermediate', ex_fsq: 'advanced', ex_lp_l: 'beginner', ex_le: 'beginner',
    ex_lc: 'beginner', ex_lunge: 'beginner', ex_bdl: 'intermediate',
    ex_hth: 'intermediate', ex_kg: 'beginner',
    ex_plank: 'beginner', ex_cr: 'beginner', ex_llr: 'intermediate', ex_abwh: 'intermediate',
    ex_scr: 'beginner', ex_secr: 'beginner',
  };

  const pool = ALL_EXERCISES.filter(ex => {
    if (!allowedEquipment.has(ex.equipment)) return false;
    if (excluded.has(ex.id)) return false;
    const diff = DIFF_MAP[ex.id] || 'beginner';
    return allowedDiff.has(diff);
  });

  // ── Analyze recovery + score muscles ────────────────────────────────────
  const recovery = analyzeRecovery(recentSets);
  const rankedMuscles = scoreMuscles(recovery, primary_goal);

  // Boost muscles that have active lift goals (ensure they appear in top picks)
  if (goalMuscles.size > 0) {
    for (const rm of rankedMuscles) {
      if (goalMuscles.has(rm.muscle)) {
        rm.score += 40; // significant boost to prioritize goal muscles
      }
    }
    rankedMuscles.sort((a, b) => b.score - a.score);
  }

  // Pick top 2-3 muscle groups that have available exercises in the pool
  const availableMuscles = new Set(pool.map(ex => ex.muscle));
  const topMuscles = rankedMuscles
    .filter(m => availableMuscles.has(m.muscle))
    .slice(0, 3)
    .map(m => m.muscle);

  // Ensure we have at least 2 muscles
  if (topMuscles.length < 2) {
    for (const m of rankedMuscles) {
      if (!topMuscles.includes(m.muscle) && availableMuscles.has(m.muscle)) {
        topMuscles.push(m.muscle);
        if (topMuscles.length >= 2) break;
      }
    }
  }

  // ── Build the workout ───────────────────────────────────────────────────
  const seed = dailySeed() + variant * 7919; // different seed per variant
  const { exercises: rawExercises, goalConfig } = buildExerciseList(topMuscles, pool, primary_goal, seed);

  // ── Inject goal-targeted exercises if not already included ─────────────
  const includedIds = new Set(rawExercises.map(e => e.exerciseId));
  for (const gExId of goalExerciseIds) {
    if (includedIds.has(gExId)) continue;
    const gMuscle = goalMuscleLookup.get(gExId);
    // Only inject if the goal exercise's muscle is in our chosen muscles
    if (!gMuscle || !topMuscles.includes(gMuscle)) continue;
    const ex = pool.find(e => e.id === gExId);
    if (!ex) continue;
    const tier = META[ex.id]?.tier || 'isolation';
    const gc = goalConfig || GOAL_CONFIG[primary_goal] || GOAL_CONFIG.general_fitness;
    // Replace the last exercise of the same muscle group, or append
    const replaceIdx = [...rawExercises].reverse().findIndex(e => e._muscle === gMuscle);
    const entry = {
      exerciseId: ex.id,
      sets: tier === 'primary' ? gc.sets[1] : gc.sets[0],
      reps: gc.reps,
      restSeconds: tier === 'primary' ? gc.rest : Math.max(30, gc.rest - 15),
      _muscle: gMuscle,
      _tier: tier,
      _name: ex.name,
    };
    if (replaceIdx !== -1) {
      rawExercises[rawExercises.length - 1 - replaceIdx] = entry;
    } else if (rawExercises.length < 8) {
      rawExercises.push(entry);
    }
    includedIds.add(gExId);
  }

  const exercises = generateReasons(rawExercises, recovery, goalExerciseIds);

  // Deduce actual muscles focused from selected exercises
  const musclesFocused = [...new Set(rawExercises.map(ex => ex._muscle))];
  const name = nameWorkout(musclesFocused);
  const reasoning = generateSummaryReasoning(musclesFocused, recovery);
  const estimatedMinutes = estimateDuration(exercises);

  return {
    name,
    exercises,
    musclesFocused,
    estimatedMinutes,
    reasoning,
  };
}
