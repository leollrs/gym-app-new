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
  other: 5.0,
};

/**
 * Estimate calories burned for a cardio session.
 * @param {string} cardioType - One of the supported cardio types
 * @param {number} durationSeconds - Duration in seconds
 * @param {number} weightLbs - Body weight in pounds
 * @returns {number} Estimated kilocalories (integer)
 */
export function estimateCardioCalories(cardioType, durationSeconds, weightLbs) {
  const met = MET_VALUES[cardioType] || MET_VALUES.other;
  const weightKg = weightLbs / 2.20462;
  const durationHours = durationSeconds / 3600;
  return Math.round(met * weightKg * durationHours);
}

export { MET_VALUES };
