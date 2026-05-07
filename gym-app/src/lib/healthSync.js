import { Health } from '@capgo/capacitor-health';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import logger from './logger';

// One-time cleanup of `healthPermissionStatus` cached from the buggy
// pre-fix flow that passed an invalid 'hrv' identifier and silently
// failed before ever calling HKHealthStore.requestAuthorization.
// Without this wipe, MemberSettings.ensurePermission would see the stale
// 'denied' value and open iOS Settings instead of re-prompting.
try {
  if (typeof localStorage !== 'undefined'
      && !localStorage.getItem('healthPermissionStatus_resetv1')) {
    localStorage.removeItem('healthPermissionStatus');
    localStorage.setItem('healthPermissionStatus_resetv1', '1');
  }
} catch {}

// ── Helpers ────────────────────────────────────────────────────────────────────

const isNative = () => Capacitor.isNativePlatform();

const startOfDay = (d = new Date()) => {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
};

const endOfDay = (d = new Date()) => {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check if health data is available on this device.
 */
export async function isAvailable() {
  try {
    if (!isNative()) return false;
    const result = await Health.isAvailable();
    return !!result?.available;
  } catch {
    return false;
  }
}

/**
 * Request read/write permissions for health data types.
 * Returns { granted: boolean }.
 */
export async function requestPermissions() {
  try {
    if (!isNative()) return { granted: false };
    // Identifiers must match the plugin's HealthDataType enum exactly. An
    // unknown name throws inside the iOS plugin BEFORE HKHealthStore is
    // called, which silently breaks the entire auth request — and the app
    // never registers in iOS Settings → Health.
    await Health.requestAuthorization({
      read: [
        'steps', 'weight', 'height', 'heartRate', 'calories',
        'sleep', 'heartRateVariability', 'restingHeartRate',
      ],
      write: ['weight'],
    });
    return { granted: true };
  } catch (e) {
    logger.warn('Health requestPermissions failed:', e);
    return { granted: false };
  }
}

/**
 * Check if we can actually read a data type by attempting a small query.
 * iOS doesn't tell us if read was denied, so we try reading and see if we get data or an error.
 */
export async function checkReadAccess(dataType) {
  try {
    if (!isNative()) return false;
    await Health.queryAggregated({
      dataType,
      startDate: startOfDay().toISOString(),
      endDate: endOfDay().toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    });
    // If it doesn't throw, we have at least some access
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the latest weight from Apple Health (last 30 days).
 * Returns { value: number (lbs), date: string } or null.
 */
export async function readLatestWeight() {
  try {
    if (!isNative()) return null;
    const result = await Health.readSamples({
      dataType: 'weight',
      startDate: daysAgo(30).toISOString(),
      endDate: endOfDay().toISOString(),
      limit: 1,
      ascending: false,
    });
    const sample = result?.samples?.[0];
    if (!sample || !sample.value) return null;
    const raw = sample.value;
    const unit = (sample.unit || '').toLowerCase();
    // Smart unit detection:
    // - If unit says 'lb' or 'pound', it's already lbs
    // - If value > 300, likely grams → convert to lbs
    // - If value > 0 and <= 300, likely kg → convert to lbs
    let lbs;
    if (unit.includes('lb') || unit.includes('pound')) {
      lbs = raw;
    } else if (raw > 300) {
      // Grams (e.g., 80000g = 80kg)
      lbs = (raw / 1000) * 2.20462;
    } else {
      // Kg (standard HealthKit unit)
      lbs = raw * 2.20462;
    }
    return {
      value: Math.round(lbs * 10) / 10,
      date: new Date(sample.startDate).toISOString().split('T')[0],
    };
  } catch (e) {
    logger.warn('readLatestWeight failed:', e);
    return null;
  }
}

/**
 * Read today's total step count.
 */
export async function readTodaySteps() {
  try {
    if (!isNative()) return 0;
    const result = await Health.queryAggregated({
      dataType: 'steps',
      startDate: startOfDay().toISOString(),
      endDate: endOfDay().toISOString(),
      bucket: 'day',
      aggregation: 'sum',
    });
    if (result?.samples?.length > 0) {
      return Math.round(result.samples[0].value || 0);
    }
    return 0;
  } catch (e) {
    logger.warn('readTodaySteps failed:', e);
    return 0;
  }
}

/**
 * Read weight samples for the last N days.
 * Returns array of { date: 'YYYY-MM-DD', value: number (lbs) }.
 */
export async function readWeightHistory(days = 30) {
  try {
    if (!isNative()) return [];
    const result = await Health.readSamples({
      dataType: 'weight',
      startDate: daysAgo(days).toISOString(),
      endDate: endOfDay().toISOString(),
      limit: 100,
      ascending: false,
    });
    const samples = result?.samples || [];
    return samples.map((s) => {
      const raw = s.value || 0;
      const unit = (s.unit || '').toLowerCase();
      let lbs;
      if (unit.includes('lb') || unit.includes('pound')) lbs = raw;
      else if (raw > 300) lbs = (raw / 1000) * 2.20462;
      else lbs = raw * 2.20462;
      return {
        date: new Date(s.startDate).toISOString().split('T')[0],
        value: Math.round(lbs * 10) / 10,
      };
    });
  } catch (e) {
    logger.warn('readWeightHistory failed:', e);
    return [];
  }
}

/**
 * Read the latest height from the health store (last 365 days).
 * Returns { value: number (inches), date: string } or null.
 */
export async function readHeight() {
  try {
    if (!isNative()) return null;
    const result = await Health.readSamples({
      dataType: 'height',
      startDate: daysAgo(365).toISOString(),
      endDate: endOfDay().toISOString(),
      limit: 1,
      ascending: false,
    });
    const sample = result?.samples?.[0];
    if (!sample || !sample.value) return null;
    const raw = sample.value;
    const unit = (sample.unit || '').toLowerCase();
    // Smart unit detection:
    // - If unit says 'in' or 'inch', it's already inches
    // - If value > 3 and <= 100, likely cm → convert to inches (divide by 2.54)
    // - If value > 100, likely cm (e.g. 178cm)
    // - If value <= 3, likely meters → convert to inches (* 39.3701)
    let inches;
    if (unit.includes('in')) {
      inches = raw;
    } else if (raw > 3) {
      // Centimeters (most common from HealthKit via this plugin)
      inches = raw / 2.54;
    } else {
      // Meters (e.g. 1.78)
      inches = raw * 39.3701;
    }
    // Sanity check: height should be 36-96 inches (3ft-8ft)
    if (inches < 36 || inches > 96) return null;
    return {
      value: Math.round(inches * 10) / 10,
      date: new Date(sample.startDate).toISOString().split('T')[0],
    };
  } catch (e) {
    logger.warn('readHeight failed:', e);
    return null;
  }
}

/**
 * Read biological sex from the health store.
 * NOTE: The @capgo/capacitor-health plugin does NOT support getCharacteristics().
 * Biological sex must be entered manually by the user.
 * Returns null (kept for API compatibility).
 */
export async function readBiologicalSex() {
  return null;
}

/**
 * Read date of birth from the health store.
 * NOTE: The @capgo/capacitor-health plugin does NOT support getCharacteristics().
 * Age must be entered manually by the user.
 * Returns null (kept for API compatibility).
 */
export async function readDateOfBirth() {
  return null;
}

/**
 * Write a weight sample (in lbs) to the health store.
 */
export async function writeWeight(lbs) {
  try {
    if (!isNative()) return false;
    const now = new Date().toISOString();
    await Health.saveSample({
      dataType: 'weight',
      value: lbs / 2.20462, // store as kg
      unit: 'kilogram',
      startDate: now,
      endDate: now,
    });
    return true;
  } catch (e) {
    logger.warn('writeWeight failed:', e);
    return false;
  }
}

/**
 * Write a completed workout to the health store.
 * Note: On iOS, the Watch app already saves the workout via HKWorkoutSession.
 * This is a fallback for when the Watch isn't being used.
 */
export async function writeWorkout({ name, startDate, endDate, calories, distance }) {
  try {
    if (!isNative()) return false;
    // The @capgo/capacitor-health plugin doesn't have a direct writeWorkout method.
    // Workouts are saved natively by the Watch's HKWorkoutSession.
    // For phone-only workouts, we save an exercise time sample as a proxy.
    await Health.saveSample({
      dataType: 'calories',
      value: calories || 0,
      unit: 'kilocalorie',
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      metadata: { HKExternalUUID: `tugympr-${Date.now()}` },
    });
    return true;
  } catch (e) {
    logger.warn('writeWorkout failed:', e);
    return false;
  }
}

/**
 * Read steps and active calories for the last 7 days.
 */
/**
 * Read today's Apple-style activity rings from HealthKit.
 * Returns { moveCalories, exerciseMinutes, standHours, moveGoal, exerciseGoal, standGoal }.
 * Goals fall back to Apple's defaults (600 cal / 30 min / 12 hrs) since the
 * health plugin doesn't expose user-configured ring goals on iOS.
 *
 * Used by the Apple Watch DailySummaryView so the rings reflect real movement
 * even before the user opens any workout flow on the watch.
 */
export async function readTodayActivityRings() {
  const fallback = {
    moveCalories: 0, exerciseMinutes: 0, standHours: 0,
    moveGoal: 600, exerciseGoal: 30, standGoal: 12,
  };
  try {
    if (!isNative()) return fallback;
    const start = startOfDay().toISOString();
    const end = endOfDay().toISOString();
    // The @capgo/capacitor-health plugin exposes a fixed enum of dataTypes;
    // 'calories' maps to active energy burned, 'exerciseTime' to Apple's
    // Exercise minutes. Apple Stand isn't exposed by the plugin, so we
    // approximate it from the count of distinct hours that have any active
    // calorie samples (≥1 kcal in an hour ≈ a "stood" hour).
    const [calRes, minRes, hourlyCalRes] = await Promise.all([
      Health.queryAggregated({ dataType: 'calories', startDate: start, endDate: end, bucket: 'day', aggregation: 'sum' }).catch(() => null),
      Health.queryAggregated({ dataType: 'exerciseTime', startDate: start, endDate: end, bucket: 'day', aggregation: 'sum' }).catch(() => null),
      Health.queryAggregated({ dataType: 'calories', startDate: start, endDate: end, bucket: 'hour', aggregation: 'sum' }).catch(() => null),
    ]);
    const pickValue = (res) => {
      const sample = res?.samples?.[0];
      if (!sample) return 0;
      const raw = Number(sample.value) || 0;
      const unit = (sample.unit || '').toLowerCase();
      if (unit.includes('sec')) return raw / 60; // seconds → minutes
      return raw;
    };
    const moveCalories = Math.round(pickValue(calRes));
    const exerciseMinutes = Math.round(pickValue(minRes));
    const standHours = Math.min(
      24,
      (hourlyCalRes?.samples || []).filter((s) => Number(s.value) >= 1).length,
    );
    return {
      moveCalories,
      exerciseMinutes,
      standHours,
      moveGoal: fallback.moveGoal,
      exerciseGoal: fallback.exerciseGoal,
      standGoal: fallback.standGoal,
    };
  } catch (e) {
    logger.warn?.('readTodayActivityRings failed:', e);
    return fallback;
  }
}

export async function readWeeklyActivitySummary() {
  try {
    if (!isNative()) return { steps: 0, calories: 0 };
    const start = daysAgo(7).toISOString();
    const end = endOfDay().toISOString();

    const [stepsResult, caloriesResult] = await Promise.all([
      Health.queryAggregated({
        dataType: 'steps',
        startDate: start,
        endDate: end,
        bucket: 'week',
        aggregation: 'sum',
      }).catch(() => null),
      Health.queryAggregated({
        dataType: 'calories',
        startDate: start,
        endDate: end,
        bucket: 'week',
        aggregation: 'sum',
      }).catch(() => null),
    ]);

    const extractValue = (res) => {
      if (res?.samples?.length > 0) {
        return res.samples.reduce((sum, b) => sum + (b.value || 0), 0);
      }
      return 0;
    };

    return {
      steps: Math.round(extractValue(stepsResult)),
      calories: Math.round(extractValue(caloriesResult)),
    };
  } catch {
    return { steps: 0, calories: 0 };
  }
}

// ── Cardio Health Import ──────────────────────────────────────────────────────

/**
 * Map Apple Health workout type identifiers to our cardio_type values.
 */
const HEALTH_WORKOUT_TYPE_MAP = {
  running: 'running',
  cycling: 'cycling',
  walking: 'walking',
  swimming: 'swimming',
  rowing: 'rowing',
  elliptical: 'elliptical',
  // HealthKit HKWorkoutActivityType names
  HKWorkoutActivityTypeRunning: 'running',
  HKWorkoutActivityTypeCycling: 'cycling',
  HKWorkoutActivityTypeWalking: 'walking',
  HKWorkoutActivityTypeSwimming: 'swimming',
  HKWorkoutActivityTypeRowing: 'rowing',
  HKWorkoutActivityTypeElliptical: 'elliptical',
};

/**
 * Read cardio workouts from Apple Health for the last 7 days.
 * Returns an array of normalized cardio workout objects.
 *
 * @returns {Promise<Array<{
 *   type: string,
 *   startDate: string,
 *   endDate: string,
 *   durationSeconds: number,
 *   distanceKm: number|null,
 *   calories: number|null,
 *   avgHeartRate: number|null,
 *   source: 'health_kit'
 * }>>}
 */
export async function readCardioWorkouts() {
  try {
    if (!isNative()) return [];

    const start = daysAgo(7).toISOString();
    const end = endOfDay().toISOString();

    const result = await Health.readSamples({
      dataType: 'workout',
      startDate: start,
      endDate: end,
      limit: 100,
      ascending: false,
    });

    const samples = result?.samples || [];
    const workouts = [];

    for (const sample of samples) {
      const rawType = sample.workoutActivityType || sample.activityType || '';
      const cardioType = HEALTH_WORKOUT_TYPE_MAP[rawType] || null;

      // Skip non-cardio workout types
      if (!cardioType) continue;

      const startDate = new Date(sample.startDate);
      const endDate = new Date(sample.endDate);
      const durationSeconds = Math.round((endDate - startDate) / 1000);

      if (durationSeconds <= 0) continue;

      workouts.push({
        type: cardioType,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        durationSeconds,
        distanceKm: sample.distance != null
          ? Math.round((sample.distance / 1000) * 1000) / 1000 // meters to km, 3 decimals
          : null,
        calories: sample.calories != null
          ? Math.round(sample.calories)
          : null,
        avgHeartRate: sample.averageHeartRate != null
          ? Math.round(sample.averageHeartRate)
          : null,
        source: 'health_kit',
      });
    }

    return workouts;
  } catch (e) {
    logger.warn('readCardioWorkouts failed:', e);
    return [];
  }
}

/**
 * Sync cardio workouts from Apple Health into the cardio_sessions table.
 * Deduplicates by matching started_at (±60 seconds) and cardio_type.
 *
 * @param {string} profileId - The user's profile UUID
 * @param {string} gymId - The user's gym UUID
 * @returns {Promise<number>} Count of newly synced sessions
 */
export async function syncCardioFromHealth(profileId, gymId) {
  try {
    const workouts = await readCardioWorkouts();
    if (workouts.length === 0) return 0;

    // Fetch existing cardio sessions for the last 7 days to deduplicate
    const { data: existing } = await supabase
      .from('cardio_sessions')
      .select('started_at, cardio_type')
      .eq('profile_id', profileId)
      .gte('started_at', daysAgo(7).toISOString())
      .order('started_at', { ascending: false });

    const existingSet = (existing || []).map((s) => ({
      type: s.cardio_type,
      time: new Date(s.started_at).getTime(),
    }));

    const isDuplicate = (workout) => {
      const wTime = new Date(workout.startDate).getTime();
      return existingSet.some(
        (e) => e.type === workout.type && Math.abs(e.time - wTime) <= 60_000
      );
    };

    let synced = 0;

    for (const w of workouts) {
      if (isDuplicate(w)) continue;

      const { error } = await supabase.from('cardio_sessions').insert({
        profile_id: profileId,
        gym_id: gymId,
        cardio_type: w.type,
        duration_seconds: w.durationSeconds,
        distance_km: w.distanceKm,
        calories_burned: w.calories,
        avg_heart_rate: w.avgHeartRate,
        source: w.source,
        started_at: w.startDate,
        completed_at: w.endDate,
      });

      if (!error) synced++;
      else logger.warn('syncCardioFromHealth insert error:', error);
    }

    return synced;
  } catch (e) {
    logger.warn('syncCardioFromHealth failed:', e);
    return 0;
  }
}

// ── Recovery Metrics (Sleep / HRV / RHR) ──────────────────────────────────────

/**
 * Best-effort wrapper around Health.queryAggregated / readSamples that swallows
 * unsupported-data-type errors and returns null. The capacitor-health plugin
 * surface is slightly different on iOS vs Android (Health Connect), and not
 * every dataType key is supported on every platform — we degrade gracefully
 * rather than failing the whole recovery read.
 */
async function _readSamplesSafe(dataType, opts = {}) {
  try {
    if (!isNative()) return null;
    const { days = 1, limit = 100, ascending = false } = opts;
    const result = await Health.readSamples({
      dataType,
      startDate: daysAgo(days).toISOString(),
      endDate: endOfDay().toISOString(),
      limit,
      ascending,
    });
    return result?.samples || [];
  } catch (e) {
    // Quiet — many devices/plugins simply don't expose these types.
    logger.warn(`_readSamplesSafe(${dataType}) failed:`, e?.message || e);
    return null;
  }
}

async function _queryAggregatedSafe(dataType, opts = {}) {
  try {
    if (!isNative()) return null;
    const { days = 1, bucket = 'day', aggregation = 'sum' } = opts;
    const result = await Health.queryAggregated({
      dataType,
      startDate: daysAgo(days).toISOString(),
      endDate: endOfDay().toISOString(),
      bucket,
      aggregation,
    });
    return result?.samples || [];
  } catch (e) {
    logger.warn(`_queryAggregatedSafe(${dataType}) failed:`, e?.message || e);
    return null;
  }
}

/**
 * Read last night's sleep duration + quality.
 * Returns { totalMinutes, deepMinutes, remMinutes, source } or null.
 *
 * Strategy: ask for samples in the last 36h, sum durations, classify by stage
 * if the plugin returns stage labels. Falls back to single total-duration if
 * stage data isn't available.
 */
export async function readSleepLastNight() {
  // The capacitor-health iOS enum only accepts 'sleep' for HKCategoryTypeIdentifierSleepAnalysis.
  // The other historical names throw invalidDataType inside the plugin.
  const candidates = ['sleep'];
  let samples = null;
  for (const dt of candidates) {
    samples = await _readSamplesSafe(dt, { days: 2, limit: 200 });
    if (samples && samples.length > 0) break;
  }
  if (!samples || samples.length === 0) return null;

  // Filter to "last night" — anything overlapping the last 16h window. Apple
  // Health typically returns one main asleep block with optional stage subs.
  const cutoff = Date.now() - 16 * 60 * 60 * 1000;
  let totalMs = 0;
  let deepMs = 0;
  let remMs = 0;

  for (const s of samples) {
    const start = new Date(s.startDate || s.start || 0).getTime();
    const end = new Date(s.endDate || s.end || 0).getTime();
    if (!start || !end || end <= start) continue;
    if (end < cutoff) continue;

    const dur = end - start;
    const stage = String(s.stage || s.value || s.type || '').toLowerCase();

    // Apple stage labels: 'asleep', 'asleepCore', 'asleepDeep', 'asleepREM',
    // 'awake', 'inBed'. Health Connect stages: 'deep', 'rem', 'light'.
    if (stage.includes('awake') || stage === 'inbed' || stage === 'in_bed') continue;

    if (stage.includes('deep')) deepMs += dur;
    if (stage.includes('rem')) remMs += dur;

    // Only count "asleep" stages toward total. If no stage info is present,
    // count the whole sample.
    if (!stage || stage.includes('asleep') || stage === 'sleeping' || stage === 'sleep'
        || stage.includes('deep') || stage.includes('rem') || stage.includes('light')
        || stage.includes('core')) {
      totalMs += dur;
    }
  }

  if (totalMs <= 0) return null;

  return {
    totalMinutes: Math.round(totalMs / 60000),
    deepMinutes: deepMs > 0 ? Math.round(deepMs / 60000) : null,
    remMinutes: remMs > 0 ? Math.round(remMs / 60000) : null,
    source: Capacitor.getPlatform() === 'ios' ? 'apple_health' : 'health_connect',
  };
}

/**
 * Read latest HRV (resting, in ms). Returns { value, date } or null.
 * Prefers today's average; falls back to last 7-day most-recent reading.
 */
export async function readLatestHRV() {
  // Plugin enum exposes HRV as 'heartRateVariability' (HKQuantityTypeIdentifier.heartRateVariabilitySDNN).
  const candidates = ['heartRateVariability'];
  for (const dt of candidates) {
    const samples = await _readSamplesSafe(dt, { days: 7, limit: 50 });
    if (!samples || samples.length === 0) continue;

    // Average all samples within the last 24h, fall back to most recent.
    const dayCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = samples.filter((s) => {
      const t = new Date(s.startDate || s.start || 0).getTime();
      return t >= dayCutoff && Number(s.value) > 0;
    });

    const pickFrom = recent.length > 0 ? recent : samples.filter((s) => Number(s.value) > 0);
    if (pickFrom.length === 0) continue;

    if (recent.length > 0) {
      const avg = pickFrom.reduce((a, s) => a + Number(s.value), 0) / pickFrom.length;
      return {
        value: Math.round(avg * 10) / 10,
        date: new Date().toISOString().split('T')[0],
      };
    }

    // No today reading — return most recent
    const sorted = [...pickFrom].sort((a, b) =>
      new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime()
    );
    return {
      value: Math.round(Number(sorted[0].value) * 10) / 10,
      date: new Date(sorted[0].startDate || Date.now()).toISOString().split('T')[0],
    };
  }
  return null;
}

/**
 * Read latest resting heart rate (bpm). Returns { value, date } or null.
 */
export async function readRestingHR() {
  const candidates = ['restingHeartRate'];
  for (const dt of candidates) {
    const samples = await _readSamplesSafe(dt, { days: 7, limit: 20 });
    if (!samples || samples.length === 0) continue;
    const valid = samples.filter((s) => Number(s.value) > 0);
    if (valid.length === 0) continue;
    const sorted = [...valid].sort((a, b) =>
      new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime()
    );
    const top = sorted[0];
    return {
      value: Math.round(Number(top.value)),
      date: new Date(top.startDate || Date.now()).toISOString().split('T')[0],
    };
  }

  // Some plugins only expose RHR via aggregation
  const agg = await _queryAggregatedSafe('heartRate', { days: 1, bucket: 'day', aggregation: 'min' });
  if (agg && agg.length > 0 && Number(agg[0].value) > 0) {
    return {
      value: Math.round(Number(agg[0].value)),
      date: new Date().toISOString().split('T')[0],
    };
  }
  return null;
}

/**
 * Aggregate recovery read — single call returns sleep + HRV + RHR + source.
 * Each field is null when unavailable. Safe to call on web (returns all-null
 * with source: null).
 *
 * @returns {Promise<{
 *   sleepHours: number|null,
 *   sleepQuality: number|null,    // 0-100, null when stage data missing
 *   hrv: number|null,             // ms
 *   restingHR: number|null,       // bpm
 *   source: 'apple_health'|'health_connect'|null
 * }>}
 */
export async function getRecoveryMetrics() {
  if (!isNative()) {
    return { sleepHours: null, sleepQuality: null, hrv: null, restingHR: null, source: null };
  }

  const [sleep, hrv, rhr] = await Promise.all([
    readSleepLastNight().catch(() => null),
    readLatestHRV().catch(() => null),
    readRestingHR().catch(() => null),
  ]);

  // Sleep quality: % of total that is deep + REM. Null if stage data missing.
  let sleepQuality = null;
  if (sleep && (sleep.deepMinutes != null || sleep.remMinutes != null) && sleep.totalMinutes > 0) {
    const restorative = (sleep.deepMinutes || 0) + (sleep.remMinutes || 0);
    // Healthy adult: ~20-25% of sleep is deep+REM combined ≈ baseline 100.
    // Map: 25%+ → 100, 10% → 50, <5% → 20.
    const pct = (restorative / sleep.totalMinutes) * 100;
    if (pct >= 25) sleepQuality = 100;
    else if (pct >= 20) sleepQuality = 90;
    else if (pct >= 15) sleepQuality = 75;
    else if (pct >= 10) sleepQuality = 55;
    else if (pct >= 5) sleepQuality = 35;
    else sleepQuality = 20;
  }

  const platform = Capacitor.getPlatform();
  const source = sleep?.source || (platform === 'ios' ? 'apple_health' : platform === 'android' ? 'health_connect' : null);

  return {
    sleepHours: sleep ? Math.round((sleep.totalMinutes / 60) * 10) / 10 : null,
    sleepQuality,
    hrv: hrv?.value ?? null,
    restingHR: rhr?.value ?? null,
    source: (sleep || hrv || rhr) ? source : null,
  };
}
