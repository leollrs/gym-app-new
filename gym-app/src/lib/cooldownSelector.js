/**
 * Select cool-down stretches relevant to the muscles trained.
 * Returns 4-6 stretch objects.
 */

const STRETCHES = {
  Chest: [
    { id: 'cd_doorway', name: 'Doorway Chest Stretch', name_es: 'Estiramiento de pecho en puerta', durationSec: 30 },
  ],
  Back: [
    { id: 'cd_childs', name: "Child's Pose", name_es: 'Postura del niño', durationSec: 30 },
    { id: 'cd_catcow', name: 'Cat-Cow Stretch', name_es: 'Estiramiento gato-vaca', durationSec: 25 },
  ],
  Shoulders: [
    { id: 'cd_crossbody', name: 'Cross-Body Shoulder', name_es: 'Hombro cruzado', durationSec: 25 },
  ],
  Biceps: [
    { id: 'cd_wallbicep', name: 'Wall Bicep Stretch', name_es: 'Estiramiento de bíceps en pared', durationSec: 25 },
  ],
  Triceps: [
    { id: 'cd_overhead_tri', name: 'Overhead Tricep Stretch', name_es: 'Estiramiento de tríceps', durationSec: 25 },
  ],
  Legs: [
    { id: 'cd_quad', name: 'Standing Quad Stretch', name_es: 'Estiramiento de cuádriceps de pie', durationSec: 30 },
    { id: 'cd_hamstring', name: 'Standing Hamstring Stretch', name_es: 'Estiramiento de isquiotibiales', durationSec: 30 },
  ],
  Glutes: [
    { id: 'cd_figure4', name: 'Seated Figure-Four', name_es: 'Figura cuatro sentado', durationSec: 30 },
  ],
  Core: [
    { id: 'cd_cobra', name: 'Cobra Stretch', name_es: 'Estiramiento cobra', durationSec: 25 },
  ],
  Calves: [
    { id: 'cd_wallcalf', name: 'Wall Calf Stretch', name_es: 'Estiramiento de pantorrilla en pared', durationSec: 25 },
  ],
  general: [
    { id: 'cd_forward_fold', name: 'Standing Forward Fold', name_es: 'Flexión hacia adelante', durationSec: 30 },
    { id: 'cd_spinal_twist', name: 'Seated Spinal Twist', name_es: 'Torsión espinal sentado', durationSec: 25 },
    { id: 'cd_deep_breath', name: 'Deep Breathing', name_es: 'Respiración profunda', durationSec: 30 },
  ],
};

export function selectCoolDownStretches(muscleGroups = []) {
  const selected = new Map();

  // Add muscle-specific stretches
  for (const muscle of muscleGroups) {
    for (const stretch of (STRETCHES[muscle] || [])) {
      if (selected.size >= 6) break;
      if (!selected.has(stretch.id)) selected.set(stretch.id, stretch);
    }
  }

  // Fill with general stretches to at least 4
  for (const stretch of STRETCHES.general) {
    if (selected.size >= 4) break;
    if (!selected.has(stretch.id)) selected.set(stretch.id, stretch);
  }

  return [...selected.values()].slice(0, 6);
}
