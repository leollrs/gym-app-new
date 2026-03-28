import { Health } from '@capgo/capacitor-health';
import { Capacitor } from '@capacitor/core';

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
      read: ['steps', 'weight', 'heartRate', 'calories'],
      write: ['weight'],
    });
    return { granted: true };
  } catch (e) {
    console.warn('Health requestPermissions failed:', e);
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
    console.warn('readLatestWeight failed:', e);
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
    console.warn('readTodaySteps failed:', e);
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
    console.warn('readWeightHistory failed:', e);
    return [];
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
    console.warn('writeWeight failed:', e);
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
    console.warn('writeWorkout failed:', e);
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
