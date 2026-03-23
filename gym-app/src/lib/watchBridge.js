import { CapgoWatch as Watch } from '@capgo/capacitor-watch';
import { Capacitor } from '@capacitor/core';

const isNative = () => Capacitor.getPlatform() === 'ios';

// ── State sync (iPhone → Watch) ──────────────────────────────────────────────

/**
 * Send the current workout state to the watch.
 * Called during ActiveSession whenever set data changes.
 */
export async function syncWorkoutToWatch({ exerciseName, setNumber, totalSets, suggestedWeight, suggestedReps, restSeconds, isResting, elapsedSeconds, exerciseCategory }) {
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
 * Each routine: { id, name, exerciseCount, lastUsed }
 */
export async function syncRoutinesToWatch(routines) {
  if (!isNative()) return;
  try {
    await Watch.updateApplicationContext({
      context: {
        type: 'routines_sync',
        routines: routines.map(r => ({
          id: r.id,
          name: r.name,
          exerciseCount: r.exercises?.length || 0,
          lastUsed: r.lastUsed || '',
        })),
        updatedAt: Date.now(),
      }
    });
  } catch {}
}

// ── Watch → iPhone messages ──────────────────────────────────────────────────

let messageHandler = null;

/**
 * Register a handler for messages coming FROM the watch.
 * Expected messages:
 * - { action: 'start_workout', routineId } — start a workout from the watch
 * - { action: 'complete_set', actualReps, actualWeight } — complete set with rep counter data
 * - { action: 'skip_rest' } — skip the rest timer
 * - { action: 'end_workout' } — end the current workout
 * - { action: 'request_routines' } — watch is asking for routine list
 */
export function onWatchMessage(handler) {
  messageHandler = handler;
}

/**
 * Initialize watch listeners. Call once on app startup.
 */
export async function initWatchListeners() {
  if (!isNative()) return;
  try {
    await Watch.addListener('messageReceived', (event) => {
      if (messageHandler && event?.message) {
        messageHandler(event.message);
      }
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
