/**
 * Select warm-up exercises relevant to the muscles being trained.
 * Returns 3-5 warm-up exercise objects ready for ActiveSession.
 */

// Warm-up exercises from the exercise library, mapped by target area
const WARM_UPS = {
  // Upper body
  upper: [
    { id: 'ex_wu_ac', name: 'Arm Circles', name_es: 'Círculos de brazos', durationSec: 30 },
    { id: 'ex_wu_iw', name: 'Inchworm', name_es: 'Gusano', durationSec: 45 },
    { id: 'ex_wu_trot', name: 'Torso Rotations', name_es: 'Rotaciones de torso', durationSec: 30 },
  ],
  // Lower body
  lower: [
    { id: 'ex_wu_ls', name: 'Leg Swings', name_es: 'Balanceo de piernas', durationSec: 30 },
    { id: 'ex_wu_hc', name: 'Hip Circles', name_es: 'Círculos de cadera', durationSec: 30 },
    { id: 'ex_wu_wls', name: 'Walking Lunges', name_es: 'Zancadas caminando', durationSec: 45 },
    { id: 'ex_wu_bk', name: 'Butt Kicks', name_es: 'Patadas al glúteo', durationSec: 30 },
  ],
  // General / cardio
  general: [
    { id: 'ex_wu_jj', name: 'Jumping Jacks', name_es: 'Saltos de tijera', durationSec: 45 },
    { id: 'ex_wu_hw', name: 'High Knees', name_es: 'Rodillas altas', durationSec: 30 },
    { id: 'ex_wu_lc', name: 'Light Cardio (Jump Rope)', name_es: 'Cardio ligero (Cuerda)', durationSec: 60 },
  ],
};

// Map muscle groups to warm-up categories
const MUSCLE_TO_CATEGORY = {
  'Chest': 'upper', 'Back': 'upper', 'Shoulders': 'upper',
  'Biceps': 'upper', 'Triceps': 'upper', 'Forearms': 'upper', 'Traps': 'upper',
  'Legs': 'lower', 'Glutes': 'lower', 'Calves': 'lower',
  'Core': 'general', 'Full Body': 'general', 'Warm-Up': 'general',
};

/**
 * Given an array of muscle groups being trained, return 3-5 relevant warm-ups.
 * Always starts with a general warm-up, then adds targeted ones.
 */
export function selectWarmUps(muscleGroups = []) {
  const categories = new Set(muscleGroups.map(m => MUSCLE_TO_CATEGORY[m] || 'general'));
  const selected = new Map(); // id -> warm-up, preserves insertion order

  // Always start with a general cardio warm-up
  const generalPick = WARM_UPS.general[0]; // Jumping Jacks
  selected.set(generalPick.id, generalPick);

  // Add targeted warm-ups based on muscle categories
  for (const cat of categories) {
    for (const wu of (WARM_UPS[cat] || [])) {
      if (selected.size >= 5) break;
      if (!selected.has(wu.id)) selected.set(wu.id, wu);
    }
  }

  // Fill to at least 3 with general warm-ups
  for (const wu of [...WARM_UPS.general, ...WARM_UPS.upper, ...WARM_UPS.lower]) {
    if (selected.size >= 3) break;
    if (!selected.has(wu.id)) selected.set(wu.id, wu);
  }

  return [...selected.values()].slice(0, 5);
}
