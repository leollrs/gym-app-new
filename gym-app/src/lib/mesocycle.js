// mesocycle.js
// -----------------------------------------------------------------------------
// Planned periodization (#4). Replaces the purely reactive "4 progressive
// sessions → deload" heuristic with a scheduled accumulation → deload wave.
//
// We DERIVE the mesocycle position from training history instead of storing
// state: count the consecutive training weeks ending just before this week.
// The deload lands on the last week of each cycle, then it restarts. A missed
// week breaks the streak — which is itself a real-life deload — so the next
// trained week starts a fresh accumulation block. Fully deterministic, no DB
// column required.
//
//   accumulation weeks  → progress as normal, nudge volume up toward your max
//   deload week         → pull load/volume back so the body supercompensates
// -----------------------------------------------------------------------------

const WEEK_MS = 7 * 86400000;
// 1970-01-05 was a Monday; offset so week boundaries fall on Mondays (UTC).
const REF_MONDAY_MS = 4 * 86400000;

const weekIndexOf = (ms) => Math.floor((ms - REF_MONDAY_MS) / WEEK_MS);

// Cycle length by experience. Last week of each is the deload, so accumulation
// weeks = length - 1. Beginners run shorter cycles, advanced lifters longer.
const MESO_LENGTH = { beginner: 4, intermediate: 5, advanced: 6 };

/**
 * Compute the member's current mesocycle position from session history.
 *
 * @param {Array} sessions - [{ completed_at }] (anything with a completed_at;
 *   sets not needed). Should cover at least ~length weeks of history.
 * @param {object} [opts]
 * @param {string} [opts.level='intermediate']
 * @param {number} [opts.now=Date.now()]
 * @returns {{
 *   week:number,            // 1-based week within the current cycle
 *   length:number,          // total weeks in the cycle
 *   accumulationWeeks:number,
 *   phase:'accumulation'|'deload',
 *   isDeloadWeek:boolean,
 *   volumeScale:number,     // 0.5 on deload; ramps ~0.85→1.10 across accumulation
 *   weeksTrained:number     // consecutive trained weeks incl. this one
 * }}
 */
export function getMesocyclePosition(sessions, { level = 'intermediate', now = Date.now() } = {}) {
  const length = MESO_LENGTH[level] ?? 5;
  const accumulationWeeks = length - 1;

  const trainingWeeks = new Set();
  for (const s of (sessions || [])) {
    const t = s?.completed_at ? new Date(s.completed_at).getTime() : null;
    if (t) trainingWeeks.add(weekIndexOf(t));
  }

  const curWeek = weekIndexOf(now);
  // Consecutive trained weeks ending at the week BEFORE this one (this week is
  // the one they're training now, so it counts as +1 on top of the streak).
  let streakBefore = 0;
  let w = curWeek - 1;
  while (trainingWeeks.has(w)) { streakBefore++; w--; }

  const position = streakBefore % length;      // 0-based slot this week occupies
  const isDeloadWeek = position === length - 1;
  const week = position + 1;

  let volumeScale;
  if (isDeloadWeek) volumeScale = 0.5;
  else volumeScale = accumulationWeeks > 1
    ? 0.85 + (position / (accumulationWeeks - 1)) * 0.25
    : 1.0;

  return {
    week,
    length,
    accumulationWeeks,
    phase: isDeloadWeek ? 'deload' : 'accumulation',
    isDeloadWeek,
    volumeScale: Math.round(volumeScale * 100) / 100,
    weeksTrained: streakBefore + 1,
  };
}

// Load multiplier to apply to suggested working weights during a deload week.
export const MESO_DELOAD_FACTOR = 0.6;
