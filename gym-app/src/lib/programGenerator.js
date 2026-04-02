// ── Program Generation Algorithm ─────────────────────────────────────────────
// Pure client-side algorithm that generates workout programs by optimising
// muscle-coverage scores.  No API calls, no external imports.
// Runs in <100 ms for any configuration.

import { exercises as ALL_EXERCISES } from '../data/exercises';
import { INJURY_EXCLUSIONS } from './exerciseConstants';

// ── Constants ────────────────────────────────────────────────────────────────

const SPLIT_MAP = {
  3: 'full_body',
  4: 'upper_lower',
  5: 'ppl_upper_lower',
  6: 'ppl_ppl',
};

const SPLIT_DAYS = {
  full_body:       [{ type: 'full_body', label: 'Full Body A' }, { type: 'full_body', label: 'Full Body B' }, { type: 'full_body', label: 'Full Body C' }],
  upper_lower:     [{ type: 'upper', label: 'Upper A' }, { type: 'lower', label: 'Lower A' }, { type: 'upper', label: 'Upper B' }, { type: 'lower', label: 'Lower B' }],
  ppl_upper_lower: [{ type: 'push', label: 'Push' }, { type: 'pull', label: 'Pull' }, { type: 'legs', label: 'Legs' }, { type: 'upper', label: 'Upper' }, { type: 'lower', label: 'Lower' }],
  ppl_ppl:         [{ type: 'push', label: 'Push A' }, { type: 'pull', label: 'Pull A' }, { type: 'legs', label: 'Legs A' }, { type: 'push', label: 'Push B' }, { type: 'pull', label: 'Pull B' }, { type: 'legs', label: 'Legs B' }],
};

const DAY_TARGETS = {
  push:      { mid_chest: 80, upper_chest: 60, front_delts: 70, side_delts: 50, triceps: 70 },
  pull:      { lats: 80, upper_back: 70, mid_back: 50, rear_delts: 50, biceps: 70, forearms: 30 },
  legs:      { quads: 80, hamstrings: 70, glutes: 75, calves: 50, adductors: 30 },
  upper:     { mid_chest: 70, upper_back: 70, front_delts: 60, lats: 60, biceps: 50, triceps: 50 },
  lower:     { quads: 80, hamstrings: 70, glutes: 75, calves: 50, lower_back: 40 },
  full_body: { quads: 60, hamstrings: 50, glutes: 50, mid_chest: 50, lats: 50, front_delts: 40, biceps: 30, triceps: 30 },
};

const LEVEL_CONFIG = {
  beginner:     { maxExercises: 5, defaultSets: 3, weeklyCapMultiplier: 0.7, restRange: [90, 120], deloadEvery: 3 },
  intermediate: { maxExercises: 7, defaultSets: 4, weeklyCapMultiplier: 1.0, restRange: [60, 90],  deloadEvery: 4 },
  advanced:     { maxExercises: 9, defaultSets: 4, weeklyCapMultiplier: 1.3, restRange: [45, 75],  deloadEvery: 5 },
};

const GOAL_ADJUSTMENTS = {
  muscle_gain:     { setsMultiplier: 1.2, restBias: 15,  preferCompound: 0.6 },
  strength:        { setsMultiplier: 0.8, restBias: 30,  preferCompound: 0.9 },
  fat_loss:        { setsMultiplier: 1.0, restBias: -15, preferCompound: 0.5 },
  endurance:       { setsMultiplier: 1.3, restBias: -20, preferCompound: 0.4 },
  general_fitness: { setsMultiplier: 1.0, restBias: 0,   preferCompound: 0.6 },
};

const BASE_WEEKLY_CAPS = {
  quads: 300, hamstrings: 250, glutes: 280, calves: 200,
  mid_chest: 280, upper_chest: 200, lats: 280, upper_back: 250,
  front_delts: 250, side_delts: 200, rear_delts: 200,
  biceps: 220, triceps: 240, forearms: 150,
  lower_back: 200, core: 200, traps: 180,
  abs: 200, obliques: 150, adductors: 150, mid_back: 200,
};

// Primary regions score 70, secondary regions score 30.
const PRIMARY_SCORE   = 70;
const SECONDARY_SCORE = 30;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a { region: score } map from an exercise's primaryRegions / secondaryRegions. */
function getMuscleScores(exercise) {
  const scores = {};
  for (const r of exercise.primaryRegions)   scores[r] = PRIMARY_SCORE;
  for (const r of exercise.secondaryRegions) scores[r] = (scores[r] || 0) + SECONDARY_SCORE;
  return scores;
}

/** Infer a coarse movement-pattern tag from the exercise's muscle group. */
function getMovementPattern(exercise) {
  const map = {
    Chest: 'push', Back: 'pull', Shoulders: 'push',
    Biceps: 'pull', Triceps: 'push', Legs: 'legs',
    Glutes: 'legs', Core: 'core', Calves: 'legs',
    Forearms: 'pull', Traps: 'pull', 'Full Body': 'compound',
  };
  return map[exercise.muscle] || 'other';
}

/** Count how many distinct regions an exercise hits (primary + secondary). */
function regionCount(exercise) {
  return new Set([...exercise.primaryRegions, ...exercise.secondaryRegions]).size;
}

/** Build the set of exercise IDs to exclude based on reported injuries. */
function buildInjuryExclusions(injuries) {
  const excluded = new Set();
  if (!injuries || injuries.length === 0) return excluded;
  for (const area of injuries) {
    const set = INJURY_EXCLUSIONS[area];
    if (set) set.forEach(id => excluded.add(id));
  }
  return excluded;
}

/** Clamp a value between min and max. */
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

/** Simple seeded pseudo-random (mulberry32). Deterministic for same seed. */
function mulberry32(seed) {
  let t = seed | 0;
  return function () {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Core Selection ───────────────────────────────────────────────────────────

/**
 * Greedy exercise selection for a single day.
 *
 * @param {object[]} pool          – exercises already filtered by equipment / injury
 * @param {object}   dayTarget     – { region: score } targets for this day type
 * @param {number}   maxExercises  – cap from level config
 * @param {number}   sets          – computed sets per exercise
 * @param {number}   restSeconds   – computed rest between sets
 * @param {object}   weeklyTotals  – mutable; accumulated region×sets across the week
 * @param {object}   weeklyCaps    – max region load per week
 * @param {number}   preferCompound – 0-1, from goal
 * @param {Set}      usedOnVariantA – exercise IDs already used on the "A" variant day
 * @param {Function} rng           – seeded random [0,1)
 * @returns {{ exercises: object[], weeklyTotals: object }}
 */
function selectExercisesForDay(
  pool, dayTarget, maxExercises, sets, restSeconds,
  weeklyTotals, weeklyCaps, preferCompound, usedOnVariantA, rng,
) {
  const remainingGap = { ...dayTarget };
  const dayExercises = [];
  const usedIds      = new Set();
  let lastPattern    = null;
  const recentEquip  = [];

  const hasGap = () => Object.values(remainingGap).some(v => v > 0);

  while (hasGap() && dayExercises.length < maxExercises) {
    let bestScore = -Infinity;
    let bestEx    = null;

    for (const ex of pool) {
      if (usedIds.has(ex.id)) continue;

      const scores  = getMuscleScores(ex);
      const pattern = getMovementPattern(ex);

      // Gap-fill score: how well does this exercise close the remaining gap?
      let gapFill = 0;
      for (const region of Object.keys(remainingGap)) {
        if (remainingGap[region] > 0 && scores[region]) {
          gapFill += Math.min(remainingGap[region], scores[region]);
        }
      }

      // Overwork penalty
      let overworkPenalty = 0;
      for (const [region, score] of Object.entries(scores)) {
        const projected = (weeklyTotals[region] || 0) + score * sets;
        if (projected > (weeklyCaps[region] || Infinity)) {
          overworkPenalty += 50;
        }
      }

      // Diversity penalty
      let diversityPenalty = 0;
      if (pattern === lastPattern) diversityPenalty += 30;
      if (recentEquip.length >= 2 &&
          recentEquip[recentEquip.length - 1] === ex.equipment &&
          recentEquip[recentEquip.length - 2] === ex.equipment) {
        diversityPenalty += 20;
      }

      // Compound bonus
      let compoundBonus = 0;
      if (regionCount(ex) >= 3 && preferCompound > 0.5) {
        compoundBonus = 20;
      }

      // Anti-repetition: penalise exercises already used on variant A
      let variantPenalty = 0;
      if (usedOnVariantA.has(ex.id)) variantPenalty = 40;

      const finalScore =
        gapFill + compoundBonus
        - overworkPenalty - diversityPenalty - variantPenalty
        + rng() * 10; // slight randomness for variety on regeneration

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestEx    = ex;
      }
    }

    if (!bestEx) break; // no viable exercise left

    usedIds.add(bestEx.id);
    const scores = getMuscleScores(bestEx);

    dayExercises.push({
      id:           bestEx.id,
      sets,
      rest_seconds: restSeconds,
    });

    // Update remaining gap
    for (const [region, score] of Object.entries(scores)) {
      if (region in remainingGap) {
        remainingGap[region] = Math.max(0, remainingGap[region] - score);
      }
    }

    // Update weekly totals
    for (const [region, score] of Object.entries(scores)) {
      weeklyTotals[region] = (weeklyTotals[region] || 0) + score * sets;
    }

    lastPattern = getMovementPattern(bestEx);
    recentEquip.push(bestEx.equipment);
  }

  return { exercises: dayExercises, weeklyTotals };
}

// ── Week Construction ────────────────────────────────────────────────────────

/**
 * Build a single week's training days.
 *
 * @returns {object[]} – array of { name, exercises: [{ id, sets, rest_seconds }] }
 */
function buildWeek(pool, splitDays, levelCfg, goalAdj, weeklyCaps, rng) {
  const weeklyTotals = {};
  const rawSets      = Math.round(levelCfg.defaultSets * goalAdj.setsMultiplier);
  const sets         = clamp(rawSets, 2, 6);
  const baseRest     = Math.round((levelCfg.restRange[0] + levelCfg.restRange[1]) / 2 + goalAdj.restBias);
  const restSeconds  = clamp(baseRest, 30, 180);

  // Track exercises used per day-type so B variants prefer different ones.
  const usedByType = {}; // e.g. { push: Set([...ids]) }

  const days = [];

  for (const { type, label } of splitDays) {
    const target    = DAY_TARGETS[type];
    const variantA  = usedByType[type] || new Set();

    const result = selectExercisesForDay(
      pool, target, levelCfg.maxExercises, sets, restSeconds,
      weeklyTotals, weeklyCaps, goalAdj.preferCompound, variantA, rng,
    );

    days.push({ name: label, exercises: result.exercises });

    // Record used IDs for this day-type so subsequent same-type days vary
    if (!usedByType[type]) usedByType[type] = new Set();
    for (const ex of result.exercises) usedByType[type].add(ex.id);
  }

  return days;
}

// ── Periodisation ────────────────────────────────────────────────────────────

/**
 * Deep-clone a week and optionally swap some exercises for variation.
 * swapRate: fraction of exercises to attempt to swap (0-1).
 */
function varyWeek(baseWeek, pool, swapRate, rng) {
  const varied = JSON.parse(JSON.stringify(baseWeek));
  if (swapRate <= 0) return varied;

  for (const day of varied) {
    for (let i = 0; i < day.exercises.length; i++) {
      if (rng() > swapRate) continue;

      const currentId = day.exercises[i].id;
      const currentEx = pool.find(e => e.id === currentId);
      if (!currentEx) continue;

      const currentPattern = getMovementPattern(currentEx);
      const dayIds = new Set(day.exercises.map(e => e.id));

      // Find alternative with same movement pattern
      const alternatives = pool.filter(
        e => e.id !== currentId && !dayIds.has(e.id) && getMovementPattern(e) === currentPattern,
      );
      if (alternatives.length === 0) continue;

      const pick = alternatives[Math.floor(rng() * alternatives.length)];
      day.exercises[i] = { ...day.exercises[i], id: pick.id };
    }
  }
  return varied;
}

/** Apply deload: reduce sets by 40%, min 2. */
function deloadWeek(week) {
  const d = JSON.parse(JSON.stringify(week));
  for (const day of d) {
    for (const ex of day.exercises) {
      ex.sets = Math.max(2, Math.floor(ex.sets * 0.6));
    }
  }
  return d;
}

/** Progressive overload: add 1 set to first compound per day. */
function progressWeek(week, pool) {
  const p = JSON.parse(JSON.stringify(week));
  for (const day of p) {
    for (const ex of day.exercises) {
      const fullEx = pool.find(e => e.id === ex.id);
      if (fullEx && regionCount(fullEx) >= 3) {
        ex.sets += 1;
        break; // only first compound
      }
    }
  }
  return p;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a full workout program.
 *
 * @param {object}   opts
 * @param {object[]} opts.exercises     – exercise objects with primaryRegions / secondaryRegions
 * @param {string}   opts.goal          – 'muscle_gain' | 'strength' | 'fat_loss' | 'endurance' | 'general_fitness'
 * @param {string}   opts.level         – 'beginner' | 'intermediate' | 'advanced'
 * @param {number}   opts.daysPerWeek   – 3-6
 * @param {string[]} opts.equipment     – available equipment names
 * @param {number}   [opts.durationWeeks=8] – 4-16
 * @param {string[]} [opts.injuries]    – regions to avoid
 * @returns {{ weeks: object, metadata: object }}
 */
export function generateProgram({
  exercises = ALL_EXERCISES,
  goal          = 'general_fitness',
  level         = 'intermediate',
  daysPerWeek   = 4,
  equipment     = [],
  durationWeeks = 8,
  injuries      = [],
}) {
  // ── Validate / normalise inputs ──
  const days   = clamp(daysPerWeek, 3, 6);
  const weeks  = clamp(durationWeeks, 4, 16);

  const levelCfg = LEVEL_CONFIG[level]  || LEVEL_CONFIG.intermediate;
  const goalAdj  = GOAL_ADJUSTMENTS[goal] || GOAL_ADJUSTMENTS.general_fitness;

  const splitKey  = SPLIT_MAP[days];
  const splitDays = SPLIT_DAYS[splitKey];

  // ── Step 1: Filter exercise pool ──
  const equipSet      = new Set(equipment.map(e => e.trim()));
  const injuryExclude = buildInjuryExclusions(injuries);

  const pool = exercises.filter(ex => {
    // Equipment filter: if caller provided equipment, exercise must match
    if (equipSet.size > 0 && !equipSet.has(ex.equipment)) return false;
    // Injury filter
    if (injuryExclude.has(ex.id)) return false;
    return true;
  });

  // ── Step 2: Weekly caps ──
  const weeklyCaps = {};
  for (const [region, cap] of Object.entries(BASE_WEEKLY_CAPS)) {
    weeklyCaps[region] = Math.round(cap * levelCfg.weeklyCapMultiplier);
  }

  // ── Step 3: Build a deterministic (seeded) RNG ──
  // Seed from the string representation of all inputs so same config → same result
  // (except the random(0,10) tiebreaker gives slight variety on regeneration).
  const seedStr   = `${goal}|${level}|${days}|${equipment.sort().join(',')}|${injuries.sort().join(',')}`;
  let   seedVal   = 0;
  for (let i = 0; i < seedStr.length; i++) seedVal = ((seedVal << 5) - seedVal + seedStr.charCodeAt(i)) | 0;
  // XOR with Date.now low bits so "regenerate" gives different results
  seedVal ^= Date.now() & 0xFFFF;
  const rng = mulberry32(seedVal);

  // ── Step 4: Build base week template ──
  const baseWeek = buildWeek(pool, splitDays, levelCfg, goalAdj, weeklyCaps, rng);

  // ── Step 5: Periodise across all weeks ──
  const weekMap      = {};
  let progressCount  = 0;

  for (let w = 1; w <= weeks; w++) {
    const isDeload = w > 1 && w % levelCfg.deloadEvery === 0;

    if (isDeload) {
      // Deload week: reduce volume
      weekMap[String(w)] = deloadWeek(baseWeek);
    } else if (w <= 2) {
      // Weeks 1-2: base template (identical structure)
      weekMap[String(w)] = JSON.parse(JSON.stringify(baseWeek));
    } else {
      // Every 2-3 weeks swap 1-2 exercises per day for variation
      const swapRate = (w % 2 === 0) ? 0.15 : 0.25;
      let varied = varyWeek(baseWeek, pool, swapRate, rng);

      // Progressive overload: every 2 non-deload weeks add 1 set to first compound
      progressCount++;
      if (progressCount % 2 === 0) {
        varied = progressWeek(varied, pool);
      }

      weekMap[String(w)] = varied;
    }
  }

  // ── Step 6: Build metadata ──
  const allExIds   = new Set();
  const muscleHits = {};

  for (const weekDays of Object.values(weekMap)) {
    for (const day of weekDays) {
      for (const ex of day.exercises) {
        allExIds.add(ex.id);
        const fullEx = pool.find(e => e.id === ex.id);
        if (fullEx) {
          for (const r of fullEx.primaryRegions)   muscleHits[r] = (muscleHits[r] || 0) + ex.sets;
          for (const r of fullEx.secondaryRegions) muscleHits[r] = (muscleHits[r] || 0) + Math.round(ex.sets * 0.5);
        }
      }
    }
  }

  return {
    weeks: weekMap,
    metadata: {
      split: splitKey,
      splitDays: splitDays.map(d => d.label),
      totalExercises: allExIds.size,
      muscleBreakdown: muscleHits,
      durationWeeks: weeks,
      level,
      goal,
    },
  };
}

// ── UI helper ────────────────────────────────────────────────────────────────

/**
 * Get a human-readable description of the split for a given days-per-week.
 *
 * @param {number} daysPerWeek – 3-6
 * @returns {{ name: string, days: string[] }}
 */
export function getSplitDescription(daysPerWeek) {
  const descriptions = {
    3: { name: 'Full Body',              days: ['Full Body A', 'Full Body B', 'Full Body C'] },
    4: { name: 'Upper / Lower',          days: ['Upper A', 'Lower A', 'Upper B', 'Lower B'] },
    5: { name: 'Push / Pull / Legs + Upper / Lower', days: ['Push', 'Pull', 'Legs', 'Upper', 'Lower'] },
    6: { name: 'Push / Pull / Legs',     days: ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'] },
  };
  return descriptions[clamp(daysPerWeek, 3, 6)];
}
