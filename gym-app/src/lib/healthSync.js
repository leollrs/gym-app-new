import { Health } from '@capgo/capacitor-health';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import logger from './logger';

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
    await Health.requestAuthorization({
      read: ['steps', 'weight', 'height', 'heartRate', 'calories'],
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
 * Read the latest weight from Apple Health (last 7 days).
 * Returns { value: number (lbs), date: string } or null.
 */
export async function readLatestWeight() {
  try {
    if (!isNative()) return null;
    const result = await Health.readSamples({
      dataType: 'weight',
      startDate: daysAgo(7).toISOString(),
      endDate: endOfDay().toISOString(),
      limit: 1,
      ascending: false,
    });
    const sample = result?.samples?.[0];
    if (!sample) return null;
    return {
      value: Math.round((sample.value || 0) * 2.20462 * 10) / 10,
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
    return samples.map((s) => ({
      date: new Date(s.startDate).toISOString().split('T')[0],
      // Health stores weight in kg — convert to lbs
      value: Math.round((s.value || 0) * 2.20462 * 10) / 10,
    }));
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
    if (!sample) return null;
    // Health stores height in meters — convert to inches
    const inches = Math.round((sample.value || 0) * 39.3701 * 10) / 10;
    return {
      value: inches,
      date: new Date(sample.startDate).toISOString().split('T')[0],
    };
  } catch (e) {
    logger.warn('readHeight failed:', e);
    return null;
  }
}

/**
 * Read biological sex from the health store.
 * Returns 'male' | 'female' | null.
 */
export async function readBiologicalSex() {
  try {
    if (!isNative()) return null;
    const result = await Health.getCharacteristics();
    const sex = result?.biologicalSex;
    if (sex === 'male' || sex === 'female') return sex;
    // Some platforms return capitalized or numeric values
    if (typeof sex === 'string') {
      const lower = sex.toLowerCase();
      if (lower.includes('male') && !lower.includes('female')) return 'male';
      if (lower.includes('female')) return 'female';
    }
    return null;
  } catch (e) {
    logger.warn('readBiologicalSex failed:', e);
    return null;
  }
}

/**
 * Read date of birth from the health store.
 * Returns { dateOfBirth: string (ISO), age: number } or null.
 */
export async function readDateOfBirth() {
  try {
    if (!isNative()) return null;
    const result = await Health.getCharacteristics();
    const dob = result?.dateOfBirth;
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    if (age < 5 || age > 120) return null;
    return {
      dateOfBirth: birthDate.toISOString().split('T')[0],
      age,
    };
  } catch (e) {
    logger.warn('readDateOfBirth failed:', e);
    return null;
  }
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
