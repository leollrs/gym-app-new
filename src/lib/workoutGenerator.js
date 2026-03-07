/**
 * Auto Workout Generator
 * Pure algorithm — takes onboarding data, returns A/B routine sets + cardio prescription.
 * Does NOT touch Supabase — caller is responsible for saving.
 */

import { exercises as ALL_EXERCISES } from '../data/exercises';

// ── Exercise metadata: tier + difficulty ────────────────────────────────────
const META = {
  // Chest
  ex_bp:    { tier: 'primary',   diff: 'intermediate' },
  ex_ibp:   { tier: 'secondary', diff: 'intermediate' },
  ex_dbp:   { tier: 'secondary', diff: 'beginner'     },
  ex_idbp:  { tier: 'secondary', diff: 'beginner'     },
  ex_cfly:  { tier: 'isolation', diff: 'beginner'     },
  ex_dfly:  { tier: 'isolation', diff: 'beginner'     },
  ex_dips:  { tier: 'primary',   diff: 'intermediate' },
  // Back
  ex_dl:    { tier: 'primary',   diff: 'advanced'     },
  ex_bbr:   { tier: 'primary',   diff: 'intermediate' },
  ex_pu:    { tier: 'primary',   diff: 'intermediate' },
  ex_lp:    { tier: 'secondary', diff: 'beginner'     },
  ex_cbr:   { tier: 'secondary', diff: 'beginner'     },
  ex_dbr:   { tier: 'secondary', diff: 'beginner'     },
  ex_rdl:   { tier: 'secondary', diff: 'intermediate' },
  // Shoulders
  ex_ohp:   { tier: 'primary',   diff: 'intermediate' },
  ex_dbop:  { tier: 'primary',   diff: 'beginner'     },
  ex_lr:    { tier: 'isolation', diff: 'beginner'     },
  ex_fr:    { tier: 'isolation', diff: 'beginner'     },
  ex_rfly:  { tier: 'isolation', diff: 'beginner'     },
  ex_fcu:   { tier: 'secondary', diff: 'beginner'     },
  // Biceps
  ex_bbc:   { tier: 'secondary', diff: 'intermediate' },
  ex_dbc:   { tier: 'secondary', diff: 'beginner'     },
  ex_hc:    { tier: 'isolation', diff: 'beginner'     },
  ex_cc:    { tier: 'isolation', diff: 'beginner'     },
  ex_pcc:   { tier: 'secondary', diff: 'beginner'     },
  // Triceps
  ex_tpd:   { tier: 'secondary', diff: 'beginner'     },
  ex_ske:   { tier: 'secondary', diff: 'intermediate' },
  ex_oe:    { tier: 'isolation', diff: 'beginner'     },
  ex_cgp:   { tier: 'primary',   diff: 'intermediate' },
  // Legs
  ex_sq:    { tier: 'primary',   diff: 'intermediate' },
  ex_fsq:   { tier: 'primary',   diff: 'advanced'     },
  ex_lp_l:  { tier: 'secondary', diff: 'beginner'     },
  ex_le:    { tier: 'isolation', diff: 'beginner'     },
  ex_lc:    { tier: 'isolation', diff: 'beginner'     },
  ex_lunge: { tier: 'secondary', diff: 'beginner'     },
  ex_bdl:   { tier: 'secondary', diff: 'intermediate' },
  // Glutes
  ex_hth:   { tier: 'primary',   diff: 'intermediate' },
  ex_kg:    { tier: 'secondary', diff: 'beginner'     },
  // Core
  ex_plank: { tier: 'isolation', diff: 'beginner'     },
  ex_cr:    { tier: 'secondary', diff: 'beginner'     },
  ex_llr:   { tier: 'primary',   diff: 'intermediate' },
  ex_abwh:  { tier: 'primary',   diff: 'intermediate' },
  // Calves
  ex_scr:   { tier: 'secondary', diff: 'beginner'     },
  ex_secr:  { tier: 'isolation', diff: 'beginner'     },
};

// ── Injury → excluded exercise IDs ─────────────────────────────────────────
const INJURY_EXCLUSIONS = {
  lower_back: new Set(['ex_dl', 'ex_rdl', 'ex_bbr']),
  knees:      new Set(['ex_sq', 'ex_fsq', 'ex_lp_l', 'ex_lunge', 'ex_bdl']),
  shoulders:  new Set(['ex_ohp', 'ex_lr', 'ex_fr', 'ex_dips']),
  wrists:     new Set(['ex_bbc', 'ex_fr']),
  elbows:     new Set(['ex_ske', 'ex_oe', 'ex_cgp', 'ex_tpd']),
  hips:       new Set(['ex_hth', 'ex_sq', 'ex_fsq']),
  ankles:     new Set(['ex_scr', 'ex_secr']),
};

// ── Volume config by goal ───────────────────────────────────────────────────
const GOAL_CONFIG = {
  muscle_gain:    { sets: [3, 4], reps: '8-12',  rest: 90  },
  fat_loss:       { sets: [3, 4], reps: '12-15', rest: 60  },
  strength:       { sets: [4, 5], reps: '3-6',   rest: 180 },
  endurance:      { sets: [2, 3], reps: '15-20', rest: 45  },
  general_fitness:{ sets: [3, 3], reps: '10-12', rest: 75  },
};

const RECOVERY_MOD = {
  aggressive:   { setsBonus: 1,  restMod: -15 },
  standard:     { setsBonus: 0,  restMod: 0   },
  moderate:     { setsBonus: -1, restMod: 30  },
  conservative: { setsBonus: -1, restMod: 45  },
};

// ── Day slot blueprints ─────────────────────────────────────────────────────
// Each entry: { muscle, tier } = one exercise slot
// Ordered slots determine which exercises get picked (A: offset 0, B: offset 1)

function buildPushSlots(level, gender, priority) {
  const slots = [
    { muscle: 'Chest',     tier: 'primary'   },
    { muscle: 'Chest',     tier: 'secondary'  },
    { muscle: 'Shoulders', tier: 'primary'   },
    { muscle: 'Shoulders', tier: 'isolation'  },
    { muscle: 'Triceps',   tier: 'secondary'  },
  ];
  if (level !== 'beginner') {
    slots.push({ muscle: 'Chest',   tier: 'isolation' });
    slots.push({ muscle: 'Triceps', tier: 'isolation' });
  }
  if (level === 'advanced') {
    slots.push({ muscle: 'Shoulders', tier: 'isolation' });
  }
  return slots;
}

function buildPullSlots(level, gender, priority) {
  const slots = [
    { muscle: 'Back',   tier: 'primary'   },
    { muscle: 'Back',   tier: 'secondary'  },
    { muscle: 'Biceps', tier: 'secondary'  },
    { muscle: 'Biceps', tier: 'isolation'  },
  ];
  if (level !== 'beginner') {
    slots.push({ muscle: 'Back',   tier: 'secondary' });
  }
  return slots;
}

function buildLegsSlots(level, gender, priority) {
  const slots = [
    { muscle: 'Legs',   tier: 'primary'   },
    { muscle: 'Legs',   tier: 'secondary'  },
    { muscle: 'Glutes', tier: 'primary'   },
    { muscle: 'Core',   tier: 'secondary'  },
  ];
  if (level !== 'beginner') {
    slots.push({ muscle: 'Legs',   tier: 'isolation' });
    slots.push({ muscle: 'Core',   tier: 'primary'   });
  }
  if (gender === 'female' || (priority || []).some(p => p.toLowerCase().includes('glute'))) {
    slots.push({ muscle: 'Glutes', tier: 'secondary' });
  }
  if (level !== 'beginner') {
    slots.push({ muscle: 'Calves', tier: 'secondary' });
  }
  return slots;
}

function buildUpperSlots(level, gender, priority) {
  const slots = [
    { muscle: 'Chest',     tier: 'primary'   },
    { muscle: 'Back',      tier: 'primary'   },
    { muscle: 'Shoulders', tier: 'primary'   },
    { muscle: 'Biceps',    tier: 'secondary'  },
    { muscle: 'Triceps',   tier: 'secondary'  },
  ];
  if (level !== 'beginner') {
    slots.push({ muscle: 'Chest',     tier: 'secondary' });
    slots.push({ muscle: 'Back',      tier: 'secondary' });
    slots.push({ muscle: 'Shoulders', tier: 'isolation' });
  }
  if (level === 'advanced') {
    slots.push({ muscle: 'Biceps',  tier: 'isolation' });
    slots.push({ muscle: 'Triceps', tier: 'isolation' });
  }
  return slots;
}

function buildLowerSlots(level, gender, priority) {
  const slots = [
    { muscle: 'Legs',   tier: 'primary'   },
    { muscle: 'Legs',   tier: 'secondary'  },
    { muscle: 'Glutes', tier: 'primary'   },
    { muscle: 'Core',   tier: 'secondary'  },
  ];
  if (level !== 'beginner') {
    slots.push({ muscle: 'Legs',   tier: 'isolation' });
    slots.push({ muscle: 'Calves', tier: 'secondary' });
    slots.push({ muscle: 'Core',   tier: 'primary'   });
  }
  if (gender === 'female' || (priority || []).some(p => p.toLowerCase().includes('glute'))) {
    slots.push({ muscle: 'Glutes', tier: 'secondary' });
  }
  return slots;
}

function buildFullBodySlots(level, gender, priority) {
  const slots = [
    { muscle: 'Legs',      tier: 'primary'   },
    { muscle: 'Chest',     tier: 'primary'   },
    { muscle: 'Back',      tier: 'primary'   },
    { muscle: 'Shoulders', tier: 'primary'   },
    { muscle: 'Biceps',    tier: 'secondary'  },
    { muscle: 'Triceps',   tier: 'secondary'  },
    { muscle: 'Core',      tier: 'isolation'  },
  ];
  if (level !== 'beginner') {
    slots.push({ muscle: 'Legs',   tier: 'secondary' });
    slots.push({ muscle: 'Glutes', tier: 'primary'   });
  }
  return slots;
}

// ── Split → day templates ───────────────────────────────────────────────────
const SPLIT_TEMPLATES = {
  full_body:    (days) => {
    const count = Math.min(days, 2);
    return Array.from({ length: count }, () => ({
      label:    'Full Body',
      slotsKey: 'full_body',
      muscles:  ['Chest', 'Back', 'Legs', 'Glutes', 'Shoulders', 'Biceps', 'Triceps', 'Core'],
    }));
  },
  ppl:          () => [
    { label: 'Push',  slotsKey: 'push',  muscles: ['Chest', 'Shoulders', 'Triceps'] },
    { label: 'Pull',  slotsKey: 'pull',  muscles: ['Back', 'Biceps'] },
    { label: 'Legs',  slotsKey: 'legs',  muscles: ['Legs', 'Glutes', 'Core', 'Calves'] },
  ],
  upper_lower:  () => [
    { label: 'Upper', slotsKey: 'upper', muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
    { label: 'Lower', slotsKey: 'lower', muscles: ['Legs', 'Glutes', 'Core', 'Calves'] },
  ],
  ppl_extended: () => [
    { label: 'Push',  slotsKey: 'push',  muscles: ['Chest', 'Shoulders', 'Triceps'] },
    { label: 'Pull',  slotsKey: 'pull',  muscles: ['Back', 'Biceps'] },
    { label: 'Legs',  slotsKey: 'legs',  muscles: ['Legs', 'Glutes', 'Core', 'Calves'] },
    { label: 'Upper', slotsKey: 'upper', muscles: ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps'] },
    { label: 'Lower', slotsKey: 'lower', muscles: ['Legs', 'Glutes', 'Core'] },
  ],
  ppl_double:   () => [
    { label: 'Push',  slotsKey: 'push',  muscles: ['Chest', 'Shoulders', 'Triceps'] },
    { label: 'Pull',  slotsKey: 'pull',  muscles: ['Back', 'Biceps'] },
    { label: 'Legs',  slotsKey: 'legs',  muscles: ['Legs', 'Glutes', 'Core', 'Calves'] },
  ],
};

const SLOTS_BUILDERS = {
  push:      buildPushSlots,
  pull:      buildPullSlots,
  legs:      buildLegsSlots,
  upper:     buildUpperSlots,
  lower:     buildLowerSlots,
  full_body: buildFullBodySlots,
};

// ── Cardio prescription ─────────────────────────────────────────────────────
function getCardio(goal, somatotype) {
  if (goal === 'fat_loss' && somatotype === 'fuller')
    return { daysPerWeek: 3, description: '30min LISS or 20min HIIT' };
  if (goal === 'fat_loss')
    return { daysPerWeek: 2, description: '20min LISS' };
  if (goal === 'endurance')
    return { daysPerWeek: 3, description: '40min Zone 2 cardio' };
  if (goal === 'muscle_gain' || goal === 'strength')
    return { daysPerWeek: 1, description: '20min LISS (active recovery)' };
  return { daysPerWeek: 2, description: '25min LISS' };
}

// ── Split selection ─────────────────────────────────────────────────────────
function getSplitType(days) {
  if (days <= 2) return 'full_body';
  if (days === 3) return 'ppl';
  if (days === 4) return 'upper_lower';
  if (days === 5) return 'ppl_extended';
  return 'ppl_double';
}

// ── Pick one exercise from pool ─────────────────────────────────────────────
// usageMap tracks how many times we've drawn from each muscle:tier bucket.
// variantOffset shifts which exercise is selected (0 = A, 1 = B).
function pickExercise(pool, muscle, tier, variantOffset, usageMap) {
  const key = `${muscle}:${tier}`;
  const candidates = pool.filter(ex => ex.muscle === muscle && (META[ex.id]?.tier || 'isolation') === tier);

  if (candidates.length === 0) {
    // Fall back to any tier for this muscle
    const fallback = pool.filter(ex => ex.muscle === muscle);
    if (fallback.length === 0) return null;
    const fbKey = `${muscle}:any`;
    const used = usageMap.get(fbKey) || 0;
    usageMap.set(fbKey, used + 1);
    return fallback[(used + variantOffset) % fallback.length] ?? fallback[0];
  }

  const used = usageMap.get(key) || 0;
  usageMap.set(key, used + 1);
  return candidates[(used + variantOffset) % candidates.length] ?? candidates[0];
}

// ── Build a single routine from slots ──────────────────────────────────────
function buildRoutine(template, pool, variantOffset, variant, level, gender, priority, goalConfig, recoveryMod) {
  const buildSlots = SLOTS_BUILDERS[template.slotsKey];
  const slots = buildSlots(level, gender, priority);

  const usageMap = new Map();
  const exercises = [];

  for (const slot of slots) {
    const ex = pickExercise(pool, slot.muscle, slot.tier, variantOffset, usageMap);
    if (!ex) continue;

    // Determine sets
    const baseSets = goalConfig.sets[0];
    const maxSets  = goalConfig.sets[1];
    const bonus    = recoveryMod.setsBonus;
    const sets     = Math.min(maxSets, Math.max(1, baseSets + bonus));

    // Priority muscles get +1 set
    const isPriority = (priority || []).some(p => p.toLowerCase() === ex.muscle.toLowerCase());
    const finalSets  = isPriority ? Math.min(maxSets + 1, sets + 1) : sets;

    // Rest with recovery modifier
    const rest = Math.max(30, goalConfig.rest + recoveryMod.restMod);

    exercises.push({
      exerciseId:   ex.id,
      sets:         finalSets,
      reps:         goalConfig.reps,
      restSeconds:  rest,
    });
  }

  return {
    name:      `Auto: ${template.label} ${variant}`,
    label:     template.label,
    muscles:   template.muscles,
    exercises,
  };
}

// ── Estimated session duration (minutes) ───────────────────────────────────
export function estimateDuration(routine, restSeconds) {
  const sets   = routine.exercises.reduce((sum, ex) => sum + ex.sets, 0);
  const setTime = 45; // seconds per set (average)
  const totalSeconds = sets * (setTime + restSeconds);
  return Math.round(totalSeconds / 60);
}

// ── Main export ────────────────────────────────────────────────────────────
/**
 * @param {object} onboarding — combined onboarding + new body data
 * @returns {{ split, splitLabel, routinesA, routinesB, cardio, dayTemplates }}
 */
export function generateProgram(onboarding) {
  const {
    fitness_level        = 'beginner',
    primary_goal         = 'general_fitness',
    training_days_per_week = 3,
    available_equipment  = ['Bodyweight'],
    injuries_notes       = '',
    height_cm,
    weight_kg,
    age                  = 30,
    gender               = 'other',
    priority_muscles     = [],
  } = onboarding;

  // 1. Body profile
  const heightM   = (height_cm || 170) / 100;
  const weightKg  = weight_kg || 70;
  const bmi       = weightKg / (heightM * heightM);
  const somatotype = bmi < 22 ? 'lean' : bmi < 27 ? 'athletic' : 'fuller';

  const recoveryTier =
    age < 25  ? 'aggressive'   :
    age < 35  ? 'standard'     :
    age < 45  ? 'moderate'     :
                'conservative';

  // 2. Build injury exclusion set
  const injuryAreas = (injuries_notes || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const excluded = new Set(injuryAreas.flatMap(area => [...(INJURY_EXCLUSIONS[area] || [])]));

  // 3. Allowed difficulty levels
  const allowedDiff = new Set(
    fitness_level === 'beginner'     ? ['beginner'] :
    fitness_level === 'intermediate' ? ['beginner', 'intermediate'] :
                                       ['beginner', 'intermediate', 'advanced']
  );

  // 4. Filter exercise pool
  const allowedEquipment = new Set([...available_equipment, 'Bodyweight']);
  const pool = ALL_EXERCISES.filter(ex => {
    if (!allowedEquipment.has(ex.equipment))    return false;
    if (excluded.has(ex.id))                    return false;
    const diff = META[ex.id]?.diff || 'beginner';
    return allowedDiff.has(diff);
  });

  // 5. Volume config
  const goalConfig   = GOAL_CONFIG[primary_goal]  || GOAL_CONFIG.general_fitness;
  const recoveryMod  = RECOVERY_MOD[recoveryTier] || RECOVERY_MOD.standard;

  // 6. Determine split & day templates
  const splitType = getSplitType(training_days_per_week);
  const templateFn = SPLIT_TEMPLATES[splitType];
  const dayTemplates = templateFn(training_days_per_week, fitness_level, gender, priority_muscles);

  // 7. Generate A and B routine sets
  const routinesA = dayTemplates.map(t =>
    buildRoutine(t, pool, 0, 'A', fitness_level, gender, priority_muscles, goalConfig, recoveryMod)
  );
  const routinesB = dayTemplates.map(t =>
    buildRoutine(t, pool, 1, 'B', fitness_level, gender, priority_muscles, goalConfig, recoveryMod)
  );

  // 8. Cardio
  const cardio = getCardio(primary_goal, somatotype);

  const SPLIT_LABELS = {
    full_body:    'Full Body',
    ppl:          'Push / Pull / Legs',
    upper_lower:  'Upper / Lower',
    ppl_extended: 'PPL + Upper/Lower',
    ppl_double:   'PPL × 2',
  };

  return {
    split:        splitType,
    splitLabel:   SPLIT_LABELS[splitType],
    somatotype,
    recoveryTier,
    routinesA,
    routinesB,
    cardio,
    dayTemplates,
    goalConfig,
  };
}
