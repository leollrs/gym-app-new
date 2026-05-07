// readinessEngine.js
// -----------------------------------------------------------------------------
// Computes per-muscle readiness from completed workout sessions.
//
// Inputs:
//   sessions: array of completed sessions with nested workout_sets, shape:
//     [{
//       id, completed_at,
//       workout_sets: [{ exercise_id, weight_lbs, reps, completed }, ...]
//     }]
//
// Output: Map<regionId, {
//   recovery: 0-100,    // higher = more recovered / fresher
//   sets: number,       // weighted sets this week (uses muscleScores)
//   volume: number,     // weighted volume (lbs × reps × score)
//   lastTrained: ISO    // most recent timestamp this region was hit, or null
//   daysSince: number   // days since last trained, Infinity if never
//   state: 'fatigued' | 'moderate' | 'fresh' | 'rest'
// }>
//
// Recovery model (intentionally simple, calibratable later):
//   - Base recovery starts at 100 (fully recovered)
//   - Each weighted set this week subtracts (5 / regionRecoveryFactor) points
//   - Each day since last hit adds back (15 / regionRecoveryFactor) points
//   - Clamped 0–100
//   - Region recovery factor: small muscles recover ~2x faster than large
//
// State thresholds:
//   - rest:     sets === 0 (untrained this week)
//   - fatigued: recovery < 50
//   - moderate: 50–79
//   - fresh:    >= 80
// -----------------------------------------------------------------------------

import { exercises as ALL_EXERCISES } from '../data/exercises';
import { BODY_REGION_DEFINITIONS } from '../data/muscleRegions';

// Recovery rate per region. Larger compound muscles recover slower.
// 1.0 = baseline; 0.7 = recovers slower; 1.4 = recovers faster.
const RECOVERY_RATE = {
  // Large
  upper_chest: 0.85, mid_chest: 0.85, lower_chest: 0.85,
  upper_back: 0.85,  mid_back: 0.85,  lats: 0.85, lower_back: 0.75,
  quads: 0.75, hamstrings: 0.85, glutes: 0.85,
  // Medium
  front_delts: 1.0, side_delts: 1.0, rear_delts: 1.0,
  traps: 0.95, abductors: 1.0, adductors: 1.0,
  // Small / fast
  biceps: 1.2, triceps: 1.2, forearms: 1.4, brachialis: 1.2,
  upper_abs: 1.3, mid_abs: 1.3, lower_abs: 1.3, obliques: 1.3,
  abs: 1.3, serratus: 1.3,
  calves: 1.1, soleus: 1.2, tibialis: 1.4,
  glute_med: 1.1, hip_flexors: 1.2,
};

// Build exercise lookup: id → { primaryRegions, secondaryRegions, muscleScores }
const EXERCISE_LOOKUP = new Map(ALL_EXERCISES.map(ex => [ex.id, ex]));

// All known region IDs
const ALL_REGIONS = BODY_REGION_DEFINITIONS.map(r => r.id);

const MS_PER_DAY = 86_400_000;

/**
 * Compute readiness for every muscle region.
 * @param {Array} sessions - completed sessions with nested workout_sets
 * @param {object} [options]
 * @param {number} [options.windowDays=7] - days of history to consider
 * @param {Date}   [options.now=new Date()] - reference time
 * @returns {Map<string, object>} regionId → readiness object
 */
export function computeReadiness(sessions, options = {}) {
  const { windowDays = 7, now = new Date() } = options;
  const windowMs = windowDays * MS_PER_DAY;
  const nowMs = now.getTime();

  // Initialise output for every region
  const out = new Map();
  for (const id of ALL_REGIONS) {
    out.set(id, {
      recovery: 100,
      sets: 0,
      volume: 0,
      lastTrained: null,
      daysSince: Infinity,
      state: 'rest',
    });
  }

  if (!Array.isArray(sessions) || sessions.length === 0) return out;

  // Walk every set, accumulate per-region.
  for (const session of sessions) {
    const completedAt = session.completed_at ? new Date(session.completed_at).getTime() : null;
    if (!completedAt) continue;
    if (nowMs - completedAt > windowMs) continue; // outside window

    const sets = Array.isArray(session.workout_sets) ? session.workout_sets : [];
    for (const set of sets) {
      if (!set || set.completed === false) continue; // skip incomplete sets
      const ex = EXERCISE_LOOKUP.get(set.exercise_id);
      if (!ex) continue;

      const scores = ex.muscleScores || {};
      const primary = ex.primaryRegions || [];
      const secondary = ex.secondaryRegions || [];

      // Build region → contribution (0-1) for this exercise
      const contrib = {};
      // Use explicit muscleScores if present
      for (const [regionId, score] of Object.entries(scores)) {
        if (typeof score === 'number') {
          contrib[regionId] = Math.max(contrib[regionId] || 0, score / 100);
        }
      }
      // Fallback for regions in primary/secondary but missing from scores
      for (const regionId of primary) {
        if (contrib[regionId] === undefined) contrib[regionId] = 0.9;
      }
      for (const regionId of secondary) {
        if (contrib[regionId] === undefined) contrib[regionId] = 0.4;
      }

      const reps = Number(set.reps) || 0;
      const weight = Number(set.weight_lbs) || 0;
      const setVolume = weight * reps;

      for (const [regionId, factor] of Object.entries(contrib)) {
        const r = out.get(regionId);
        if (!r) continue;
        r.sets += factor;
        r.volume += setVolume * factor;
        if (!r.lastTrained || completedAt > new Date(r.lastTrained).getTime()) {
          r.lastTrained = new Date(completedAt).toISOString();
        }
      }
    }
  }

  // Compute recovery score from accumulated sets + days-since-last
  for (const [regionId, r] of out.entries()) {
    const rate = RECOVERY_RATE[regionId] || 1.0;

    if (r.sets === 0) {
      r.state = 'rest';
      r.recovery = 100;
      continue;
    }

    const daysSince = r.lastTrained
      ? Math.max(0, (nowMs - new Date(r.lastTrained).getTime()) / MS_PER_DAY)
      : 7;
    r.daysSince = daysSince;

    // Fatigue from recent training: ~5 points per weighted set, scaled by rate
    const fatigueLoad = (r.sets * 5) / rate;
    // Recovery from time since last hit: ~15 points per day, scaled by rate
    const recoveryGain = (daysSince * 15) * rate;

    const recovery = Math.max(0, Math.min(100, 100 - fatigueLoad + recoveryGain));
    r.recovery = Math.round(recovery);

    if (recovery >= 80) r.state = 'fresh';
    else if (recovery >= 50) r.state = 'moderate';
    else r.state = 'fatigued';
  }

  return out;
}

/**
 * Aggregate region-level readiness into a single overall score (weighted by sets).
 * @param {Map} readinessMap - output of computeReadiness
 * @returns {number} 0-100
 */
export function overallReadiness(readinessMap) {
  let total = 0;
  let weight = 0;
  for (const r of readinessMap.values()) {
    if (r.sets === 0) continue;
    total += r.recovery * r.sets;
    weight += r.sets;
  }
  if (weight === 0) return 100;
  return Math.round(total / weight);
}

/**
 * Aggregate readiness across multiple sub-regions into a single bucket
 * (e.g. for a marker that visually represents "Chest" but maps to
 * upper_chest + mid_chest + lower_chest).
 *
 * Returns a synthetic readiness object weighted by each sub-region's set count.
 */
export function aggregateRegions(readinessMap, regionIds) {
  let totalSets = 0, totalVolume = 0;
  let weightedRecovery = 0, weightedDaysSince = 0;
  let lastTrained = null;
  const subs = [];

  for (const id of regionIds) {
    const r = readinessMap.get(id);
    if (!r) continue;
    subs.push({ id, ...r });
    totalSets += r.sets;
    totalVolume += r.volume;
    if (r.sets > 0) {
      weightedRecovery += r.recovery * r.sets;
      weightedDaysSince += r.daysSince * r.sets;
    }
    if (r.lastTrained && (!lastTrained || new Date(r.lastTrained) > new Date(lastTrained))) {
      lastTrained = r.lastTrained;
    }
  }

  let recovery = 100;
  let daysSince = Infinity;
  if (totalSets > 0) {
    recovery = Math.round(weightedRecovery / totalSets);
    daysSince = weightedDaysSince / totalSets;
  }

  let state = 'rest';
  if (totalSets > 0) {
    if (recovery >= 80) state = 'fresh';
    else if (recovery >= 50) state = 'moderate';
    else state = 'fatigued';
  }

  return {
    recovery,
    sets: Math.round(totalSets * 10) / 10, // 1dp
    volume: Math.round(totalVolume),
    lastTrained,
    daysSince,
    state,
    subs, // sub-region detail for the breakdown view
  };
}

// Counts of how many *bucket* regions sit in each state, given a list of buckets.
// Each bucket is { id, regionIds: [...] } — see READINESS_BUCKETS in the modal.
export function bucketCounts(readinessMap, buckets) {
  const out = { fatigued: 0, moderate: 0, fresh: 0, rest: 0 };
  for (const b of buckets) {
    const agg = aggregateRegions(readinessMap, b.regionIds);
    out[agg.state]++;
  }
  return out;
}

// ── Recovery score (sleep + HRV + RHR) ────────────────────────────────────────
//
// This layer is independent of training-load recovery above. It scores the
// user's *physiological* recovery state using last night's sleep, HRV vs
// rolling baseline, and (as a fallback) resting HR vs baseline. The composite
// `blendedReadiness()` below combines this with the training-load score.
// ----------------------------------------------------------------------------

const HRV_BASELINE_KEY = 'hrv_baseline_v1';
const RHR_BASELINE_KEY = 'rhr_baseline_v1';
const RECOVERY_CACHE_KEY = 'recovery_metrics_v1';
const BASELINE_WINDOW_DAYS = 14;
const BASELINE_MIN_SAMPLES = 7;

/**
 * Read a rolling baseline from localStorage. Shape:
 *   { avg: number, samples: [{ date: 'YYYY-MM-DD', value: number }] }
 * Returns a default empty baseline if missing or malformed.
 */
function _readBaseline(key) {
  try {
    if (typeof localStorage === 'undefined') return { avg: null, samples: [] };
    const raw = localStorage.getItem(key);
    if (!raw) return { avg: null, samples: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.samples)) return { avg: null, samples: [] };
    return { avg: typeof parsed.avg === 'number' ? parsed.avg : null, samples: parsed.samples };
  } catch {
    return { avg: null, samples: [] };
  }
}

function _writeBaseline(key, baseline) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(baseline));
  } catch {
    // Storage full / disabled — silently ignore.
  }
}

/**
 * Add today's reading to the rolling baseline (one sample per day, replaces
 * any prior sample for the same date). Trims to last 14 days and recomputes
 * the running average.
 */
export function updateBaseline(key, value, today = new Date()) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return _readBaseline(key);
  }
  const dateStr = today.toISOString().split('T')[0];
  const cur = _readBaseline(key);
  const filtered = cur.samples.filter((s) => s.date !== dateStr);
  filtered.push({ date: dateStr, value });

  // Trim to last BASELINE_WINDOW_DAYS days
  const cutoff = today.getTime() - BASELINE_WINDOW_DAYS * MS_PER_DAY;
  const recent = filtered.filter((s) => new Date(s.date).getTime() >= cutoff);
  recent.sort((a, b) => new Date(a.date) - new Date(b.date));

  const avg = recent.length > 0
    ? recent.reduce((a, s) => a + s.value, 0) / recent.length
    : null;

  const next = { avg, samples: recent };
  _writeBaseline(key, next);
  return next;
}

/**
 * Score sleep duration alone. 7.5h+ → 100, 6h → 60, <5h → 20. Linear between.
 * Adjusts ±10 for sleep quality (deep + REM percentage 0-100) when known.
 */
function _scoreSleep(sleepHours, sleepQuality) {
  if (typeof sleepHours !== 'number' || !Number.isFinite(sleepHours) || sleepHours < 0) {
    return null;
  }

  let base;
  if (sleepHours >= 7.5) base = 100;
  else if (sleepHours >= 6) {
    // 6.0 → 60, 7.5 → 100, linear
    base = 60 + ((sleepHours - 6) / 1.5) * 40;
  } else if (sleepHours >= 5) {
    // 5.0 → 20, 6.0 → 60, linear
    base = 20 + ((sleepHours - 5) / 1) * 40;
  } else {
    // <5h asymptotically toward 0; cap floor at 5
    base = Math.max(5, 20 * (sleepHours / 5));
  }

  // Quality bonus/penalty: ±10 around the 50 midpoint.
  if (typeof sleepQuality === 'number') {
    const adj = ((sleepQuality - 50) / 50) * 10;
    base += adj;
  }

  return Math.max(0, Math.min(100, Math.round(base)));
}

/**
 * Score HRV vs baseline. ≥baseline = 100, -10% = 80, -20% = 60, -30% = 40,
 * <-30% = 20. Returns null if baseline has fewer than BASELINE_MIN_SAMPLES.
 */
function _scoreHRV(hrv, baseline) {
  if (typeof hrv !== 'number' || !Number.isFinite(hrv) || hrv <= 0) return null;
  if (!baseline || !Array.isArray(baseline.samples) || baseline.samples.length < BASELINE_MIN_SAMPLES) {
    return null;
  }
  if (typeof baseline.avg !== 'number' || baseline.avg <= 0) return null;

  const ratio = hrv / baseline.avg; // 1.0 = at baseline, <1 = depressed
  if (ratio >= 1) return 100;
  if (ratio >= 0.9) return Math.round(80 + (ratio - 0.9) * 200); // 0.9 → 80, 1.0 → 100
  if (ratio >= 0.8) return Math.round(60 + (ratio - 0.8) * 200); // 0.8 → 60, 0.9 → 80
  if (ratio >= 0.7) return Math.round(40 + (ratio - 0.7) * 200); // 0.7 → 40, 0.8 → 60
  if (ratio >= 0.6) return Math.round(20 + (ratio - 0.6) * 200); // 0.6 → 20, 0.7 → 40
  return 20;
}

/**
 * Score resting HR vs baseline. LOWER is better, so the math inverts: if
 * today's RHR is at or below baseline → 100. Each +5% above baseline drops
 * roughly 20 points.
 */
function _scoreRHR(rhr, baseline) {
  if (typeof rhr !== 'number' || !Number.isFinite(rhr) || rhr <= 0) return null;
  if (!baseline || !Array.isArray(baseline.samples) || baseline.samples.length < BASELINE_MIN_SAMPLES) {
    return null;
  }
  if (typeof baseline.avg !== 'number' || baseline.avg <= 0) return null;

  // LOWER RHR = better recovery. Compute deviation above baseline (positive
  // = elevated = bad).
  const ratio = rhr / baseline.avg;
  if (ratio <= 1.0) return 100;
  if (ratio <= 1.05) return Math.round(80 + (1.05 - ratio) * 400); // 1.05 → 80, 1.0 → 100
  if (ratio <= 1.10) return Math.round(60 + (1.10 - ratio) * 400); // 1.10 → 60
  if (ratio <= 1.15) return Math.round(40 + (1.15 - ratio) * 400); // 1.15 → 40
  if (ratio <= 1.20) return Math.round(20 + (1.20 - ratio) * 400); // 1.20 → 20
  return 20;
}

/**
 * Compute a single recovery score (0-100) from sleep + HRV + RHR metrics.
 *
 * Side effects: updates the HRV / RHR rolling baselines in localStorage.
 *
 * @param {object} metrics  output of getRecoveryMetrics()
 * @param {object} [opts]
 * @param {boolean} [opts.persistBaseline=true]  set false in pure-test paths
 * @param {Date}   [opts.now=new Date()]
 *
 * @returns {{
 *   score: number|null,
 *   factors: { sleep: number|null, hrv: number|null, rhr: number|null },
 *   baseline: { hrv: object, rhr: object }
 * } | null}  null when no metrics at all
 */
export function computeRecoveryScore(metrics, opts = {}) {
  if (!metrics) return null;
  const { persistBaseline = true, now = new Date() } = opts;

  const { sleepHours, sleepQuality, hrv, restingHR } = metrics;

  // Update baselines first so their averages reflect today's reading.
  let hrvBaseline = _readBaseline(HRV_BASELINE_KEY);
  let rhrBaseline = _readBaseline(RHR_BASELINE_KEY);
  if (persistBaseline) {
    if (typeof hrv === 'number' && hrv > 0) hrvBaseline = updateBaseline(HRV_BASELINE_KEY, hrv, now);
    if (typeof restingHR === 'number' && restingHR > 0) rhrBaseline = updateBaseline(RHR_BASELINE_KEY, restingHR, now);
  }

  const sleepScore = _scoreSleep(sleepHours, sleepQuality);
  const hrvScore = _scoreHRV(hrv, hrvBaseline);
  // Only fall back to RHR when HRV is unavailable (per spec).
  const rhrScore = hrvScore === null ? _scoreRHR(restingHR, rhrBaseline) : null;

  if (sleepScore === null && hrvScore === null && rhrScore === null) {
    return {
      score: null,
      factors: { sleep: null, hrv: hrvScore, rhr: rhrScore },
      baseline: { hrv: hrvBaseline, rhr: rhrBaseline },
    };
  }

  // Composite: 40% sleep + 60% (hrv || rhr || neutral 70 default).
  // If only sleep is available (no autonomic signal yet), use sleep alone.
  let composite;
  const autonomic = hrvScore !== null ? hrvScore : rhrScore;
  if (sleepScore !== null && autonomic !== null) {
    composite = sleepScore * 0.4 + autonomic * 0.6;
  } else if (sleepScore !== null) {
    composite = sleepScore;
  } else if (autonomic !== null) {
    // Sleep missing but autonomic present — use autonomic with a neutral 70
    // weighted against it so a great HRV night doesn't read as 100 when we
    // know nothing about sleep.
    composite = 70 * 0.4 + autonomic * 0.6;
  } else {
    composite = null;
  }

  return {
    score: composite === null ? null : Math.round(Math.max(0, Math.min(100, composite))),
    factors: { sleep: sleepScore, hrv: hrvScore, rhr: rhrScore },
    baseline: { hrv: hrvBaseline, rhr: rhrBaseline },
  };
}

/**
 * Blend the existing training-load readiness with the new recovery score.
 *   final = trainingLoad * 0.6 + recovery * 0.4
 * If `recovery` is null/missing, returns trainingLoad unchanged.
 */
export function blendedReadiness(trainingLoadScore, recovery) {
  const tl = Number(trainingLoadScore);
  if (!Number.isFinite(tl)) return 100;
  if (!recovery || typeof recovery.score !== 'number' || !Number.isFinite(recovery.score)) {
    return Math.round(Math.max(0, Math.min(100, tl)));
  }
  const blended = tl * 0.6 + recovery.score * 0.4;
  return Math.round(Math.max(0, Math.min(100, blended)));
}

// ── Recovery metrics localStorage cache ──────────────────────────────────────
const RECOVERY_TTL_MS = 4 * 60 * 60 * 1000; // 4h

/** Read the cached recovery metrics object, or null if stale/missing. */
export function loadCachedRecoveryMetrics(now = Date.now()) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(RECOVERY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
    if (now - parsed.fetchedAt > RECOVERY_TTL_MS) return null;
    return parsed.metrics || null;
  } catch {
    return null;
  }
}

/** Write the freshly-fetched recovery metrics + timestamp. */
export function saveCachedRecoveryMetrics(metrics) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      RECOVERY_CACHE_KEY,
      JSON.stringify({ fetchedAt: Date.now(), metrics })
    );
  } catch {
    // Ignore storage errors.
  }
}

export const RECOVERY_BASELINE_MIN_SAMPLES = BASELINE_MIN_SAMPLES;
