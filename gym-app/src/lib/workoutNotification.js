/**
 * Persistent workout notification — shows elapsed time + sets on lock screen.
 * Uses the same @capacitor/local-notifications pattern as restNotification.js
 * (which is confirmed working on iOS).
 */

import logger from './logger';

const WORKOUT_NOTIF_ID = 2001;
let updateInterval = null;
let workoutStartTime = null;
let lastSetsInfo = { completed: 0, total: 0 };

const isNative = () => {
  try { return window.Capacitor?.isNativePlatform?.() === true; }
  catch { return false; }
};

const formatDuration = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const fireNotification = async (title, body) => {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    // Cancel old one first
    await LocalNotifications.cancel({ notifications: [{ id: WORKOUT_NOTIF_ID }] });
    // Schedule — mirrors the pattern from restNotification.js which works
    await LocalNotifications.schedule({
      notifications: [{
        id: WORKOUT_NOTIF_ID,
        title,
        body,
        schedule: { at: new Date(Date.now() + 1500) },
        sound: 'default',
      }],
    });
  } catch (e) {
    logger.warn('Workout notification error:', e);
  }
};

/**
 * Start the persistent workout notification.
 */
export const startWorkoutNotification = async (startTimestamp, completedSets, totalSets) => {
  workoutStartTime = startTimestamp;
  lastSetsInfo = { completed: completedSets, total: totalSets };

  // Fire initial notification
  const elapsed = Math.floor((Date.now() - workoutStartTime) / 1000);
  fireNotification(
    `Workout in progress — ${formatDuration(elapsed)}`,
    `${completedSets} / ${totalSets} sets completed`
  );

  // Update every 60s
  stopInterval();
  updateInterval = setInterval(() => {
    if (!workoutStartTime) return;
    const el = Math.floor((Date.now() - workoutStartTime) / 1000);
    fireNotification(
      `Workout in progress — ${formatDuration(el)}`,
      `${lastSetsInfo.completed} / ${lastSetsInfo.total} sets completed`
    );
  }, 60_000);
};

/**
 * Update the notification when sets change.
 */
export const updateWorkoutNotification = (completedSets, totalSets) => {
  if (!workoutStartTime) return;
  lastSetsInfo = { completed: completedSets, total: totalSets };
  const elapsed = Math.floor((Date.now() - workoutStartTime) / 1000);
  fireNotification(
    `Workout in progress — ${formatDuration(elapsed)}`,
    `${completedSets} / ${totalSets} sets completed`
  );
};

const stopInterval = () => {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
};

/**
 * Cancel the persistent notification when workout ends.
 */
export const cancelWorkoutNotification = async () => {
  stopInterval();
  workoutStartTime = null;
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: WORKOUT_NOTIF_ID }] });
  } catch { }
};
