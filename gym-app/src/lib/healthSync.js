import { Health } from '@capgo/capacitor-health';
import { Capacitor } from '@capacitor/core';

// ── Helpers ────────────────────────────────────────────────────────────────────

const isNative = () => Capacitor.isNativePlatform();

const toISODate = (d) => d.toISOString().split('T')[0];

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
 * Returns false on web — never throws.
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
 * Request read/write permissions for steps, weight, and activity (workouts).
 * Returns { granted: boolean }.
 */
export async function requestPermissions() {
  try {
    if (!isNative()) return { granted: false };
    await Health.requestAuthorization({
      read: ['steps', 'weight', 'activity'],
      write: ['weight', 'activity'],
    });
    // If requestAuthorization resolves without error, treat as granted.
    // Some platforms don't return an explicit granted flag.
    return { granted: true };
  } catch {
    return { granted: false };
  }
}

/**
 * Read today's total step count.
 * Returns a number (0 on failure or web).
 */
export async function readTodaySteps() {
  try {
    if (!isNative()) return 0;
    const result = await Health.queryAggregated({
      startDate: startOfDay().toISOString(),
      endDate: endOfDay().toISOString(),
      dataType: 'steps',
      bucket: 'day',
    });
    // queryAggregated typically returns an array of buckets or a single value
    if (Array.isArray(result?.data) && result.data.length > 0) {
      return Math.round(Number(result.data[0].value) || 0);
    }
    if (result?.value !== undefined) {
      return Math.round(Number(result.value) || 0);
    }
    return 0;
  } catch {
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
    const result = await Health.query({
      startDate: daysAgo(days).toISOString(),
      endDate: endOfDay().toISOString(),
      dataType: 'weight',
    });
    const samples = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
    return samples.map((s) => ({
      date: toISODate(new Date(s.startDate || s.date || s.timestamp)),
      // Health stores typically use kg — convert to lbs
      value: Math.round((Number(s.value) || 0) * 2.20462 * 10) / 10,
    }));
  } catch {
    return [];
  }
}

/**
 * Write a weight sample (in lbs) to the health store.
 * Converts to kg before writing.
 */
export async function writeWeight(lbs) {
  try {
    if (!isNative()) return false;
    const now = new Date().toISOString();
    await Health.store({
      dataType: 'weight',
      value: lbs / 2.20462, // store as kg
      startDate: now,
      endDate: now,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a completed workout to the health store.
 * @param {{ name: string, startDate: Date|string, endDate: Date|string, calories?: number, distance?: number }}
 */
export async function writeWorkout({ name, startDate, endDate, calories, distance }) {
  try {
    if (!isNative()) return false;
    await Health.store({
      dataType: 'activity',
      value: name || 'Workout',
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      ...(calories !== undefined && { calories: Number(calories) }),
      ...(distance !== undefined && { distance: Number(distance) }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read steps and active calories for the last 7 days.
 * Returns { steps: number, calories: number }.
 */
export async function readWeeklyActivitySummary() {
  try {
    if (!isNative()) return { steps: 0, calories: 0 };
    const start = daysAgo(7).toISOString();
    const end = endOfDay().toISOString();

    const [stepsResult, caloriesResult] = await Promise.all([
      Health.queryAggregated({
        startDate: start,
        endDate: end,
        dataType: 'steps',
        bucket: 'week',
      }).catch(() => null),
      Health.queryAggregated({
        startDate: start,
        endDate: end,
        dataType: 'activity',
        bucket: 'week',
      }).catch(() => null),
    ]);

    const extractValue = (res) => {
      if (Array.isArray(res?.data) && res.data.length > 0) {
        return res.data.reduce((sum, b) => sum + (Number(b.value) || 0), 0);
      }
      return Number(res?.value) || 0;
    };

    return {
      steps: Math.round(extractValue(stepsResult)),
      calories: Math.round(extractValue(caloriesResult)),
    };
  } catch {
    return { steps: 0, calories: 0 };
  }
}
