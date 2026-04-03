/**
 * Gym Workout of the Day Generator
 *
 * Generates a balanced gym-wide daily workout that:
 *   - Rotates through muscle group focuses across the week
 *   - Avoids repeating the same focus as the previous 7 days
 *   - Produces 5-6 exercises, 3-4 sets each
 *   - Assigns a fun theme name per day
 *   - Varies difficulty through the week
 */

import { exercises as ALL_EXERCISES } from '../data/exercises';

// ── Focus rotation: 7 day cycle ────────────────────────────────────────────────
const FOCUS_ROTATION = [
  { key: 'push',      muscles: ['Chest', 'Shoulders', 'Triceps'] },
  { key: 'legs',      muscles: ['Legs', 'Glutes', 'Calves'] },
  { key: 'pull',      muscles: ['Back', 'Biceps'] },
  { key: 'full_body', muscles: ['Chest', 'Back', 'Legs', 'Shoulders', 'Core'] },
  { key: 'upper',     muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
  { key: 'lower',     muscles: ['Legs', 'Glutes', 'Core', 'Calves'] },
  { key: 'core_mix',  muscles: ['Core', 'Shoulders', 'Back'] },
];

// ── Theme names per focus (EN) ─────────────────────────────────────────────────
// The i18n key is stored so the component can translate; fallback is the English string.
const THEMES = {
  push:      ['Upper Body Blast', 'Push Power Hour', 'Chest & Shoulders Crusher'],
  legs:      ['Leg Day Challenge', 'Lower Body Burner', 'Quads & Glutes Grind'],
  pull:      ['Back Attack', 'Pull Day Power', 'Back & Biceps Builder'],
  full_body: ['Full Body Burn', 'Total Body Torch', 'Head-to-Toe Hustle'],
  upper:     ['Upper Body Sculpt', 'Arms & Shoulders Shred', 'Upper Body Domination'],
  lower:     ['Lower Body Blast', 'Legs & Core Inferno', 'Glute & Quad Assault'],
  core_mix:  ['Core & Stability', 'Midsection Mayhem', 'Core Strength Circuit'],
};

// ── Difficulty rotation: cycles beginner → intermediate → advanced ──────────────
const DIFFICULTY_ROTATION = ['beginner', 'intermediate', 'advanced', 'intermediate', 'beginner', 'intermediate', 'advanced'];

// ── Exercise tier priorities for selection ──────────────────────────────────────
const TIER_PRIORITY = ['primary', 'secondary', 'isolation'];

// Movement pattern metadata for exercise IDs (mirrors workoutGenerator.js META)
const META = {
  ex_bp:    'primary',   ex_ibp:   'secondary', ex_dbp:   'secondary', ex_idbp:  'secondary',
  ex_cfly:  'isolation', ex_dfly:  'isolation', ex_dips:  'primary',
  ex_dl:    'primary',   ex_bbr:   'primary',   ex_pu:    'primary',   ex_lp:    'secondary',
  ex_cbr:   'secondary', ex_dbr:   'secondary', ex_rdl:   'secondary',
  ex_ohp:   'primary',   ex_dbop:  'primary',   ex_lr:    'isolation', ex_fr:    'isolation',
  ex_rfly:  'isolation', ex_fcu:   'secondary',
  ex_bbc:   'secondary', ex_dbc:   'secondary', ex_hc:    'isolation', ex_cc:    'isolation', ex_pcc: 'secondary',
  ex_tpd:   'secondary', ex_ske:   'secondary', ex_oe:    'isolation', ex_cgp:   'primary',
  ex_sq:    'primary',   ex_fsq:   'primary',   ex_lp_l:  'secondary', ex_le:    'isolation',
  ex_lc:    'isolation', ex_lunge: 'secondary', ex_bdl:   'secondary',
  ex_hth:   'primary',   ex_kg:    'secondary',
  ex_plank: 'isolation', ex_cr:    'secondary', ex_llr:   'primary',   ex_abwh:  'primary',
  ex_scr:   'secondary', ex_secr:  'isolation',
};

// ── Seeded random for deterministic daily generation ────────────────────────────
function createSeededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function seededShuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Duration estimator ─────────────────────────────────────────────────────────
const COMPOUND_IDS = new Set([
  'ex_sq', 'ex_dl', 'ex_bp', 'ex_ohp', 'ex_bbr',
  'ex_fsq', 'ex_rdl', 'ex_ibp', 'ex_cgp', 'ex_dips',
]);

function estimateDuration(exercises) {
  const WARMUP = 5;
  const COOLDOWN = 3;
  const SECS_PER_REP = 7;

  let totalSeconds = 0;
  for (const ex of exercises) {
    const repParts = String(ex.reps).split('-').map(Number).filter(n => !isNaN(n));
    const reps = repParts.length >= 2
      ? Math.round((repParts[0] + repParts[1]) / 2)
      : (repParts[0] || 10);
    const setup = COMPOUND_IDS.has(ex.exerciseId) ? 15 : 5;
    totalSeconds += ex.sets * (reps * SECS_PER_REP + setup + ex.restSeconds);
  }
  return Math.round(totalSeconds / 60) + WARMUP + COOLDOWN;
}

// ── Main generator ─────────────────────────────────────────────────────────────

/**
 * Generate today's Gym Workout of the Day.
 *
 * @param {Date} [date]               - The date to generate for (default: today)
 * @param {Array} [recentFocusKeys]   - Focus keys from previous 7 days to avoid repeating
 * @returns {{ theme, difficulty, focusKey, estimated_duration, exercises: Array }}
 */
export function generateGymWOD(date = new Date(), recentFocusKeys = []) {
  // Deterministic seed from date
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const rand = createSeededRandom(seed);

  // Pick focus: prefer one not used in recent 7 days
  const recentSet = new Set(recentFocusKeys);
  const available = FOCUS_ROTATION.filter(f => !recentSet.has(f.key));
  const focusPool = available.length > 0 ? available : FOCUS_ROTATION;
  const focus = focusPool[Math.floor(rand() * focusPool.length)];

  // Pick theme
  const themeOptions = THEMES[focus.key];
  const theme = themeOptions[Math.floor(rand() * themeOptions.length)];

  // Pick difficulty based on day of week + some variation
  const dayOfWeek = date.getDay(); // 0=Sun
  const difficulty = DIFFICULTY_ROTATION[dayOfWeek];

  // Volume config by difficulty
  const volumeConfig = {
    beginner:     { sets: 3, reps: '10-12', rest: 75, exerciseCount: 5 },
    intermediate: { sets: 3, reps: '8-12',  rest: 90, exerciseCount: 6 },
    advanced:     { sets: 4, reps: '6-10',  rest: 90, exerciseCount: 6 },
  }[difficulty];

  // Build exercise pool: only exercises matching focus muscles, use common equipment
  const commonEquipment = new Set(['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Kettlebell', 'Smith Machine']);
  const pool = ALL_EXERCISES.filter(ex =>
    focus.muscles.includes(ex.muscle) && commonEquipment.has(ex.equipment)
  );

  // Select exercises: 1 primary per muscle, then fill with secondaries/isolations
  const selected = [];
  const usedIds = new Set();

  // Pass 1: one primary per muscle (shuffled order for variety)
  const shuffledMuscles = seededShuffle(focus.muscles, rand);
  for (const muscle of shuffledMuscles) {
    if (selected.length >= volumeConfig.exerciseCount) break;
    const candidates = pool.filter(ex =>
      ex.muscle === muscle && (META[ex.id] || 'isolation') === 'primary' && !usedIds.has(ex.id)
    );
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(rand() * candidates.length)];
      usedIds.add(pick.id);
      selected.push(pick);
    }
  }

  // Pass 2: fill remaining slots with secondary then isolation exercises
  for (const tier of ['secondary', 'isolation']) {
    if (selected.length >= volumeConfig.exerciseCount) break;
    const shuffledPool = seededShuffle(
      pool.filter(ex => (META[ex.id] || 'isolation') === tier && !usedIds.has(ex.id)),
      rand
    );
    for (const ex of shuffledPool) {
      if (selected.length >= volumeConfig.exerciseCount) break;
      usedIds.add(ex.id);
      selected.push(ex);
    }
  }

  // Pass 3: if still short, add any remaining exercises from pool
  if (selected.length < volumeConfig.exerciseCount) {
    const remaining = seededShuffle(pool.filter(ex => !usedIds.has(ex.id)), rand);
    for (const ex of remaining) {
      if (selected.length >= volumeConfig.exerciseCount) break;
      usedIds.add(ex.id);
      selected.push(ex);
    }
  }

  // Build final exercise list
  const exercises = selected.map(ex => ({
    exerciseId:  ex.id,
    sets:        volumeConfig.sets,
    reps:        volumeConfig.reps,
    restSeconds: volumeConfig.rest,
  }));

  const estimated_duration = estimateDuration(exercises);

  return {
    theme,
    difficulty,
    focusKey: focus.key,
    estimated_duration,
    exercises,
  };
}
