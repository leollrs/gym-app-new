import { CapgoWatch as Watch } from '@capgo/capacitor-watch';
import { Capacitor } from '@capacitor/core';

const isNative = () => Capacitor.getPlatform() === 'ios';

// ── State sync (iPhone → Watch) ──────────────────────────────────────────────

/**
 * Send the current workout state to the watch.
 * Uses updateApplicationContext — only the LATEST state matters during a workout.
 */
export async function syncWorkoutToWatch({ exerciseName, setNumber, totalSets, suggestedWeight, suggestedReps, restSeconds, isResting, elapsedSeconds, exerciseCategory, overloadSuggestion, currentSetIsPR, restRemainingSeconds }) {
  if (!isNative()) return;
  try {
    await Watch.updateApplicationContext({
      context: {
        type: 'workout_active',
        exerciseName,
        setNumber,
        totalSets,
        suggestedWeight,
        suggestedReps,
        restSeconds,
        isResting,
        elapsedSeconds,
        exerciseCategory: exerciseCategory || 'unknown',
        overloadSuggestion: overloadSuggestion || '',
        currentSetIsPR: currentSetIsPR || false,
        restRemainingSeconds: restRemainingSeconds || 0,
        updatedAt: Date.now(),
      }
    });
  } catch {}
}

/**
 * Tell the watch the workout ended.
 */
export async function syncWorkoutEnded({ duration, totalVolume, prsHit, setsCompleted }) {
  if (!isNative()) return;
  try {
    await Watch.updateApplicationContext({
      context: {
        type: 'workout_ended',
        duration,
        totalVolume,
        prsHit,
        setsCompleted: setsCompleted || 0,
        updatedAt: Date.now(),
      }
    });
  } catch {}
}

/**
 * Send the user's saved routines to the watch for Quick Start.
 * Uses sendMessage (data property) with transferUserInfo fallback.
 */
export async function syncRoutinesToWatch(routines) {
  if (!isNative()) return;
  const payload = {
    type: 'routines_sync',
    routines: routines.map(r => ({
      id: r.id,
      name: r.name,
      exerciseCount: r.exercises?.length || r.exerciseCount || 0,
      lastUsed: r.lastUsed || '',
      isProgram: r.isProgram || false,
      isTodayWorkout: r.isTodayWorkout || false,
    })),
  };
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    // sendMessage fails if watch not reachable — fall back to transferUserInfo (queued)
    try {
      await Watch.transferUserInfo({ userInfo: payload });
    } catch {}
  }
}

// ── Watch → iPhone messages ──────────────────────────────────────────────────

const messageHandlers = [];

/**
 * Register a handler for messages coming FROM the watch.
 * Multiple handlers are supported — all get called for every message.
 * Returns an unsubscribe function.
 */
export function onWatchMessage(handler) {
  messageHandlers.push(handler);
  return () => {
    const idx = messageHandlers.indexOf(handler);
    if (idx >= 0) messageHandlers.splice(idx, 1);
  };
}

function notifyHandlers(msg) {
  for (const handler of messageHandlers) {
    try { handler(msg); } catch {}
  }
}

/**
 * Initialize watch listeners. Call once on app startup.
 */
export async function initWatchListeners() {
  if (!isNative()) return;
  try {
    // Listen for direct messages
    await Watch.addListener('messageReceived', (event) => {
      if (event?.message) notifyHandlers(event.message);
    });
    // Listen for application context updates (from Watch)
    await Watch.addListener('applicationContextReceived', (event) => {
      if (event?.context) notifyHandlers(event.context);
    });
    // Listen for queued user info transfers
    await Watch.addListener('userInfoReceived', (event) => {
      if (event?.userInfo) {
        notifyHandlers(event.userInfo);
      }
    });
  } catch {}
}

// ── New sync helpers (iPhone → Watch) ────────────────────────────────────────

/**
 * Send user context to the watch (QR payload, streak, etc.).
 */
export async function syncUserContextToWatch({ qrPayload, userName, streak, lastWorkoutDate, weeklyWorkoutCount }) {
  if (!isNative()) return;
  const payload = {
    type: 'user_context',
    qrPayload: qrPayload || '',
    userName: userName || '',
    currentStreak: streak || 0,
    lastWorkoutDate: lastWorkoutDate || '',
    weeklyWorkoutCount: weeklyWorkoutCount || 0,
  };
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    try {
      await Watch.transferUserInfo({ userInfo: payload });
    } catch {}
  }
}

/**
 * Send friends activity data to the watch.
 */
export async function syncFriendsToWatch(friends) {
  if (!isNative()) return;
  try {
    await Watch.sendMessage({
      data: { type: 'friends_active', friends }
    });
  } catch {}
}

/**
 * Notify the watch that the user hit a new PR.
 */
export async function notifyWatchPR(exerciseName) {
  if (!isNative()) return;
  try {
    await Watch.sendMessage({
      data: {
        type: 'pr_hit',
        exerciseName: exerciseName || 'Exercise',
      }
    });
  } catch {}
}

/**
 * Request RPE input from the watch (post-set prompt).
 */
export async function requestWatchRPE() {
  if (!isNative()) return;
  try {
    await Watch.sendMessage({
      data: { type: 'request_rpe' }
    });
  } catch {}
}

/**
 * Check if watch is paired and reachable.
 */
export async function getWatchStatus() {
  if (!isNative()) return { isSupported: false, isPaired: false, isReachable: false };
  try {
    const info = await Watch.getInfo();
    return {
      isSupported: !!info?.isSupported,
      isPaired: !!info?.isPaired,
      isReachable: !!info?.isReachable,
    };
  } catch {
    return { isSupported: false, isPaired: false, isReachable: false };
  }
}
