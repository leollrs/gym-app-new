/**
 * iOS Live Activity bridge — shows workout progress on lock screen + Dynamic Island.
 * Falls back silently on Android/web or iOS < 16.1.
 */

const isIOS = () => {
  try {
    return window.Capacitor?.getPlatform?.() === 'ios';
  } catch { return false; }
};

const getPlugin = () => {
  try {
    return window.Capacitor?.Plugins?.LiveActivity;
  } catch { return null; }
};

/**
 * Start a Live Activity when a workout begins.
 *
 * `routineName`, `restLabel`, and `workoutLabel` should be localized by the
 * caller (we read i18n.language from React-side state and pass localized
 * strings here). The iOS LiveActivityPlugin.swift will fall back to its own
 * hardcoded English labels if these are absent — that fallback is the only
 * remaining English-on-iOS surface, see `LiveActivityPlugin.swift` (out of
 * JS scope).
 */
export const startLiveActivity = async ({
  routineName,
  totalSets,
  completedSets = 0,
  currentExerciseName = '',
  startTimestamp = 0,
  workoutLabel,
  restLabel,
}) => {
  if (!isIOS()) return;
  const plugin = getPlugin();
  if (!plugin) { console.warn('[LiveActivity] Plugin not found — check MainViewController registration'); return; }
  try {
    const payload = {
      routineName,
      totalSets,
      completedSets,
      currentExerciseName,
      startTimestamp,
    };
    if (typeof workoutLabel === 'string' && workoutLabel) payload.workoutLabel = workoutLabel;
    if (typeof restLabel === 'string' && restLabel) payload.restLabel = restLabel;
    await plugin.startLiveActivity(payload);
  } catch (e) {
    console.warn('[LiveActivity] Start failed:', e?.message || e);
  }
};

/**
 * Update the Live Activity with current workout state.
 */
export const updateLiveActivity = async ({
  elapsedSeconds,
  completedSets,
  totalSets,
  currentExerciseName,
  isResting = false,
  restRemainingSeconds = 0,
  isPaused = false,
  distanceKm = null,
  workoutLabel,
  restLabel,
}) => {
  if (!isIOS()) return;
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    const payload = {
      elapsedSeconds,
      completedSets,
      totalSets,
      currentExerciseName,
      isResting,
      restRemainingSeconds,
      isPaused,
    };
    // Only include distanceKm when meaningful (cardio mode with a fix). Avoids
    // sending null through the Capacitor bridge where Swift's getDouble will
    // treat it as 0 and show "0.00 km" on the widget.
    if (typeof distanceKm === 'number' && Number.isFinite(distanceKm) && distanceKm > 0) {
      payload.distanceKm = distanceKm;
    }
    if (typeof workoutLabel === 'string' && workoutLabel) payload.workoutLabel = workoutLabel;
    if (typeof restLabel === 'string' && restLabel) payload.restLabel = restLabel;
    await plugin.updateLiveActivity(payload);
  } catch (e) {
    console.warn('Live Activity update failed:', e);
  }
};

/**
 * End the Live Activity when workout finishes.
 */
export const endLiveActivity = async ({ elapsedSeconds = 0, completedSets = 0, totalSets = 0 } = {}) => {
  if (!isIOS()) return;
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.endLiveActivity({ elapsedSeconds, completedSets, totalSets });
  } catch (e) {
    console.warn('Live Activity end failed:', e);
  }
};
