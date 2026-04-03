/**
 * MET-based calorie estimation for cardio activities.
 * Formula: calories = MET x weightKg x durationHours
 *
 * MET values sourced from the Compendium of Physical Activities.
 */

const MET_VALUES = {
  running: 9.8,
  cycling: 7.5,
  rowing: 7.0,
  elliptical: 5.0,
  stair_climber: 9.0,
  jump_rope: 12.3,
  swimming: 8.0,
  walking: 3.8,
  hiit: 8.0,
  basketball: 6.5,
  soccer: 7.0,
  tennis: 7.3,
  boxing: 7.8,
  dance: 5.5,
  yoga: 3.0,
  pilates: 3.5,
  martial_arts: 10.3,
  skiing: 7.0,
  hiking: 6.0,
  other: 5.0,
};

// Calories per km by activity (for distance-based estimation)
const CAL_PER_KM_PER_KG = {
  running: 1.036,    // ~1 kcal/kg/km
  cycling: 0.45,
  rowing: 0.8,
  swimming: 1.2,
  walking: 0.72,
  hiking: 0.9,
};

/**
 * Estimate calories burned for a cardio session.
 * If distance is provided for supported types, uses distance-based formula
 * (more accurate). Otherwise falls back to MET × time.
 */
export function estimateCardioCalories(cardioType, durationSeconds, weightLbs, distanceKm = null) {
  const weightKg = weightLbs / 2.20462;
  const durationHours = durationSeconds / 3600;

  // Distance-based: more accurate for running/cycling/swimming/walking
  if (distanceKm && distanceKm > 0 && CAL_PER_KM_PER_KG[cardioType]) {
    const baseCal = CAL_PER_KM_PER_KG[cardioType] * weightKg * distanceKm;
    // Speed factor: faster pace = higher intensity = more calories
    const speedKmh = distanceKm / durationHours;
    const expectedSpeed = { running: 9, cycling: 20, rowing: 8, swimming: 2.5, walking: 5.5, hiking: 4 };
    const speedRatio = speedKmh / (expectedSpeed[cardioType] || 10);
    const intensityMult = 0.7 + 0.6 * Math.min(speedRatio, 2); // 0.7x slow to 1.9x fast
    return Math.round(baseCal * intensityMult);
  }

  // Time-based fallback: MET × weight × time
  const met = MET_VALUES[cardioType] || MET_VALUES.other;
  return Math.round(met * weightKg * durationHours);
}

export { MET_VALUES };
