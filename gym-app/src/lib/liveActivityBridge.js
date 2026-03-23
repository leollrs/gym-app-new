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
 */
export const startLiveActivity = async ({ routineName, totalSets, completedSets = 0, currentExerciseName = '', startTimestamp = 0 }) => {
  if (!isIOS()) return;
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.startLiveActivity({
      routineName,
      totalSets,
      completedSets,
      currentExerciseName,
      startTimestamp,
    });
  } catch (e) {
    console.warn('Live Activity start failed:', e);
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
}) => {
  if (!isIOS()) return;
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    await plugin.updateLiveActivity({
      elapsedSeconds,
      completedSets,
      currentExerciseName,
      isResting,
      restRemainingSeconds,
    });
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
