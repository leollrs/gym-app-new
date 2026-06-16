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
export async function syncUserContextToWatch({ qrPayload, userName, streak, lastWorkoutDate, weeklyWorkoutCount, gymName, gymAccentHex, language }) {
  if (!isNative()) return;
  const payload = {
    type: 'user_context',
    qrPayload: qrPayload || '',
    userName: userName || '',
    currentStreak: streak || 0,
    lastWorkoutDate: lastWorkoutDate || '',
    weeklyWorkoutCount: weeklyWorkoutCount || 0,
    gymName: gymName || '',
    gymAccentHex: gymAccentHex || '',
    // 'en' / 'es' — the Watch uses this to localize its UI without bundling
    // a separate Localizable.strings setup.
    language: language || 'en',
  };
  // Prefer application context so the watch always has the latest values,
  // even if it was not reachable when the message was sent.
  try {
    await Watch.updateApplicationContext({ context: payload });
  } catch {}
  // Also try a direct message (for live updates while the watch is reachable)
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    try {
      await Watch.transferUserInfo({ userInfo: payload });
    } catch {}
  }
}

/**
 * Correct the streak the Watch shows WITHOUT touching the rest of the
 * user context. The full `user_context` payload pushed at auth time reads
 * `streak_cache.current_streak_days`, which can drift from reality. The
 * app's own UI shows a calendar-derived streak (Navigation.jsx) that
 * defends against that drift — this pushes that authoritative value so the
 * Watch + its complication match what the phone shows.
 *
 * Sent as its own message type so the Watch handler only overwrites the
 * streak (a partial `user_context` would wipe qrPayload / userName).
 */
export async function syncStreakToWatch(streak) {
  if (!isNative()) return;
  const payload = { type: 'streak_update', currentStreak: Number(streak) || 0 };
  // Application context = latest-wins + persisted, so a cold Watch launch
  // reads the corrected value even if it wasn't reachable at push time.
  try { await Watch.updateApplicationContext({ context: payload }); } catch {}
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    try { await Watch.transferUserInfo({ userInfo: payload }); } catch {}
  }
}

/**
 * Push the user's exercise library (or a slim subset) so the Watch's
 * Free Lift picker can show real exercise names without a round trip
 * per tap. Slim shape: `[{ id, name, category }]`.
 */
export async function syncExercisesToWatch(exercises) {
  if (!isNative()) return;
  const slim = (exercises || []).slice(0, 200).map((e) => ({
    id: String(e.id || e._id || ''),
    name: String(e.name || e.title || ''),
    category: String(e.category || e.muscle_group || ''),
  })).filter((e) => e.id && e.name);
  const payload = { type: 'exercises_sync', exercises: slim };
  try { await Watch.updateApplicationContext({ context: payload }); } catch {}
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    try { await Watch.transferUserInfo({ userInfo: payload }); } catch {}
  }
}

/**
 * Today's macro totals + targets for the Watch's Nutrition tab.
 * Shape mirrors the @Published vars on WatchSessionManager so the handler
 * is a 1:1 mapping.
 */
export async function syncNutritionToWatch(summary = {}) {
  if (!isNative()) return;
  const {
    caloriesEaten = 0, caloriesGoal = 0,
    proteinEaten = 0, proteinGoal = 0,
    carbsEaten = 0, carbsGoal = 0,
    fatEaten = 0, fatGoal = 0,
  } = summary;
  const payload = {
    type: 'nutrition_summary',
    caloriesEaten, caloriesGoal,
    proteinEaten, proteinGoal,
    carbsEaten, carbsGoal,
    fatEaten, fatGoal,
    updatedAt: Date.now(),
  };
  try { await Watch.updateApplicationContext({ context: payload }); } catch {}
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    try { await Watch.transferUserInfo({ userInfo: payload }); } catch {}
  }
}

/**
 * Push today's activity rings + points to the Watch's shared UserDefaults.
 * Powers DailySummaryView (Move / Exercise / Stand triple ring + STREAK + POINTS
 * tiles). Sent as application context so the latest snapshot always wins, with
 * sendMessage as a live-update fallback.
 *
 * Shape:
 *   { moveCalories, moveGoal, exerciseMinutes, exerciseGoal, standHours,
 *     standGoal, pointsToday, pointsTotal }
 */
export async function syncDailySummaryToWatch(summary = {}) {
  if (!isNative()) return;
  const {
    moveCalories = 0, moveGoal = 600,
    exerciseMinutes = 0, exerciseGoal = 30,
    standHours = 0, standGoal = 12,
    pointsToday = 0, pointsTotal = 0,
  } = summary;
  const moveProgress = Math.max(0, Math.min(1, moveGoal > 0 ? moveCalories / moveGoal : 0));
  const exerciseProgress = Math.max(0, Math.min(1, exerciseGoal > 0 ? exerciseMinutes / exerciseGoal : 0));
  const standProgress = Math.max(0, Math.min(1, standGoal > 0 ? standHours / standGoal : 0));
  const payload = {
    type: 'daily_summary',
    moveCalories, moveGoal, moveProgress,
    exerciseMinutes, exerciseGoal, exerciseProgress,
    standHours, standGoal, standProgress,
    pointsToday, pointsTotal,
    updatedAt: Date.now(),
  };
  try { await Watch.updateApplicationContext({ context: payload }); } catch {}
  try {
    await Watch.sendMessage({ data: payload });
  } catch {
    try { await Watch.transferUserInfo({ userInfo: payload }); } catch {}
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
 * Render a QR payload to a PNG (base64) using an offscreen canvas, then send
 * the image bytes to the Apple Watch so the Watch app can display the user's
 * actual check-in QR code without needing CoreImage.
 *
 * Uses dynamic import of `qrcode` if available; falls back to a manual pattern
 * renderer. Delivers via updateApplicationContext (latest-wins) so the Watch
 * always receives it even if not currently reachable.
 */
export async function syncQRToWatch(payload) {
  if (!isNative() || !payload) return;
  try {
    const base64 = await renderQRToBase64PNG(payload);
    if (!base64) return;
    const msg = { type: 'qr_png', payload, pngBase64: base64, updatedAt: Date.now() };
    try {
      await Watch.updateApplicationContext({ context: msg });
    } catch {}
    try {
      await Watch.sendMessage({ data: msg });
    } catch {
      try { await Watch.transferUserInfo({ userInfo: msg }); } catch {}
    }
  } catch {}
}

async function renderQRToBase64PNG(payload) {
  // Fallback: render via qrcode.react into a detached canvas
  try {
    const { renderToString } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { QRCodeCanvas } = await import('qrcode.react');
    // If React DOM is available, use a DOM canvas
    if (typeof document !== 'undefined') {
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '-9999px';
      document.body.appendChild(container);
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(container);
      root.render(createElement(QRCodeCanvas, { value: payload, size: 280, level: 'M', includeMargin: true }));
      // Wait a frame for canvas to mount
      await new Promise(r => requestAnimationFrame(() => r()));
      const canvas = container.querySelector('canvas');
      const dataUrl = canvas?.toDataURL('image/png');
      root.unmount();
      container.remove();
      if (dataUrl) return stripDataUrlPrefix(dataUrl);
    }
    // If only SVG is available, skip (server render not useful on client)
    void renderToString;
  } catch {}
  return null;
}

function stripDataUrlPrefix(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
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
