/**
 * Realistic-target advisor for the Admin → Analytics KPI cards.
 *
 * Each metric has a `monthlyDelta` — the most a typical gym can shift the
 * needle in a single month, grounded in IHRSA / Two-Brain Business data.
 * `industryDefault` is the cold-start anchor for brand-new gyms with no
 * historical baseline. `invert` flips the direction for metrics where
 * lower is better (churn).
 *
 * Used in two places on the KPI card:
 *   - `suggestTarget` powers the "Suggested: X" chip (one realistic
 *     monthly step from the current baseline).
 *   - `checkRealism` powers the soft warning when the owner types a value
 *     more than 3 monthly steps away from baseline — the goal is honesty
 *     ("from 20% retention, 90% in a month isn't realistic") without
 *     blocking the save.
 */

export const REALISTIC_TARGETS = {
  // Percentage points per month, anchored at industry median.
  retention_rate: { monthlyDelta: 3,   industryDefault: 72,  invert: false, unit: '%' },
  // Absolute new-member count. Small absolute delta because gym sizes vary;
  // the warning band is more relevant than the suggestion for this metric.
  new_members:    { monthlyDelta: 3,   industryDefault: 10,  invert: false, unit: ''  },
  active_rate:    { monthlyDelta: 5,   industryDefault: 60,  invert: false, unit: '%' },
  avg_workouts:   { monthlyDelta: 0.4, industryDefault: 2.1, invert: false, unit: ''  },
  checkin_rate:   { monthlyDelta: 5,   industryDefault: 50,  invert: false, unit: '%' },
  churn_rate:     { monthlyDelta: 1.5, industryDefault: 8,   invert: true,  unit: '%' },
};

// How many monthly steps away from baseline before the soft warning fires.
// 3x leaves room for ambitious but plausible goals while still catching
// "I want 90% from a 20% baseline" type targets.
const AGGRESSIVE_MULTIPLIER = 3;

function roundForUnit(value, unit) {
  // Counts (new_members, avg_workouts) get one decimal at most; percentages
  // are clean integers so the chip reads naturally.
  if (unit === '%') return Math.max(0, Math.min(100, Math.round(value)));
  return Math.max(0, Math.round(value * 10) / 10);
}

/**
 * Suggest a next-month target. If `baseline` is missing (new gym, no data
 * yet), returns the industry default — that way day-one owners still see a
 * grounded anchor instead of a blank input.
 */
export function suggestTarget(metric, baseline) {
  const cfg = REALISTIC_TARGETS[metric];
  if (!cfg) return null;
  const base = baseline == null || Number.isNaN(Number(baseline))
    ? cfg.industryDefault
    : Number(baseline);
  const next = cfg.invert ? base - cfg.monthlyDelta : base + cfg.monthlyDelta;
  return roundForUnit(next, cfg.unit);
}

/**
 * Returns `null` if the target sits within a realistic band, or a struct
 * describing why the value is aggressive so the caller can render a
 * warning. Doesn't block — the owner can still save.
 *
 * "Aggressive" = more than AGGRESSIVE_MULTIPLIER monthly steps in the
 * improving direction from baseline. Targets equal to or below baseline
 * (i.e., maintenance / easy targets) never trigger the warning.
 */
export function checkRealism(metric, baseline, target) {
  const cfg = REALISTIC_TARGETS[metric];
  if (!cfg) return null;
  const n = Number(target);
  if (!Number.isFinite(n)) return null;

  const base = baseline == null || Number.isNaN(Number(baseline))
    ? cfg.industryDefault
    : Number(baseline);

  const aggressiveLimit = cfg.invert
    ? base - cfg.monthlyDelta * AGGRESSIVE_MULTIPLIER
    : base + cfg.monthlyDelta * AGGRESSIVE_MULTIPLIER;

  const tooAggressive = cfg.invert ? n < aggressiveLimit : n > aggressiveLimit;
  if (!tooAggressive) return null;

  return {
    baseline: roundForUnit(base, cfg.unit),
    suggested: suggestTarget(metric, base),
    monthlyDelta: cfg.monthlyDelta,
    unit: cfg.unit,
    invert: cfg.invert,
  };
}
