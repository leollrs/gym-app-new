/**
 * Churn Intelligence — Metric Computation Helpers
 * ─────────────────────────────────────────────────────────────
 * Velocity calculation (score trend over time) and other
 * metric utility functions.
 */


// ═══════════════════════════════════════════════════════════════
//  VELOCITY — SCORE TREND OVER TIME
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate score velocity from historical scores.
 * Uses linear regression over recent score history.
 * Positive = risk increasing, negative = risk decreasing.
 *
 * @param {Array<{ score: number, computed_at: string }>} history
 *   Sorted newest-first. Needs at least 2 entries.
 * @returns {{ velocity: number, trend: 'rising'|'falling'|'stable', label: string }}
 */
export function calculateVelocity(history) {
  if (!history || history.length < 2) {
    return { velocity: 0, trend: 'stable', label: 'Not enough history' };
  }

  const newest = new Date(history[0].computed_at);
  const points = history.map(h => ({
    x: (newest - new Date(h.computed_at)) / (1000 * 60 * 60 * 24),
    y: h.score,
  }));

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;

  if (denom === 0) return { velocity: 0, trend: 'stable', label: 'Flat' };

  // Negate because x = "days ago" (positive = past)
  const slope = -(n * sumXY - sumX * sumY) / denom;
  const velocity = Math.round(slope * 10) / 10;

  let trend = 'stable';
  let label = 'Risk stable';
  if (velocity >= 2)        { trend = 'rising';  label = `Risk rising fast (+${velocity}/day)`; }
  else if (velocity >= 0.5) { trend = 'rising';  label = `Risk trending up (+${velocity}/day)`; }
  else if (velocity <= -2)  { trend = 'falling'; label = `Risk dropping fast (${velocity}/day)`; }
  else if (velocity <= -0.5){ trend = 'falling'; label = `Risk improving (${velocity}/day)`; }

  return { velocity, trend, label };
}
