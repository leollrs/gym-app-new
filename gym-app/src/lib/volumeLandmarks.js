// volumeLandmarks.js
// -----------------------------------------------------------------------------
// RP-style weekly VOLUME landmarks (MEV / MAV / MRV) per muscle group, plus the
// logic to count a member's actual weekly sets per group from session history
// and grade each group against its landmarks.
//
// This is the "layer above the bar" the per-set overload engine doesn't touch:
// the per-exercise engine decides load/reps; this decides whether the WEEKLY
// SET VOLUME for each muscle is too little (below MEV → won't grow), in the
// productive sweet spot (MEV–MAV), high but recoverable (MAV–MRV), or junk
// volume / overreaching (> MRV).
//
//   MEV — minimum effective volume (floor to make progress)
//   MAV — maximum adaptive volume (top of the productive sweet spot)
//   MRV — maximum recoverable volume (ceiling; beyond ≈ junk / overreach)
//
// Set counting (RP convention): a completed set counts as 1 set toward the
// exercise's PRIMARY muscle group and 0.5 toward each meaningful SECONDARY
// group. We attribute per-SET (not per weighted sub-region) so a compound press
// counts as one chest set, not ~2 from hitting upper+mid+lower chest.
// -----------------------------------------------------------------------------

import { getExercises } from './exerciseStore';
const ALL_EXERCISES = getExercises();
import { GROUP_TO_REGIONS } from './muscleBuckets';

// Weekly working-set landmarks for an INTERMEDIATE lifter. Group taxonomy
// matches GROUP_TO_REGIONS so the UI stays consistent with the rest of the app.
// Legs is quads+hamstrings+adductors combined (glutes/calves are their own
// groups), hence its higher band.
export const VOLUME_LANDMARKS = [
  { key: 'Chest',     mev: 10, mav: 18, mrv: 22 },
  { key: 'Back',      mev: 10, mav: 20, mrv: 25 },
  { key: 'Shoulders', mev: 8,  mav: 20, mrv: 26 },
  { key: 'Biceps',    mev: 8,  mav: 16, mrv: 24 },
  { key: 'Triceps',   mev: 8,  mav: 16, mrv: 22 },
  { key: 'Legs',      mev: 12, mav: 24, mrv: 30 },
  { key: 'Glutes',    mev: 6,  mav: 14, mrv: 20 },
  { key: 'Calves',    mev: 8,  mav: 16, mrv: 22 },
  { key: 'Core',      mev: 6,  mav: 16, mrv: 25 },
];

const LANDMARK_KEYS = VOLUME_LANDMARKS.map(l => l.key);

// Advanced lifters tolerate / need more volume; beginners grow on less and
// shouldn't chase the ceiling. Scales all three landmarks.
const LEVEL_SCALE = { beginner: 0.7, intermediate: 1.0, advanced: 1.15 };

// region → group (first owner wins; GROUP_TO_REGIONS has no real overlaps).
const REGION_TO_GROUP = {};
for (const [group, regions] of Object.entries(GROUP_TO_REGIONS)) {
  if (!LANDMARK_KEYS.includes(group)) continue; // only the groups we grade
  for (const r of regions) if (!(r in REGION_TO_GROUP)) REGION_TO_GROUP[r] = group;
}

const EX_LOOKUP = new Map(ALL_EXERCISES.map(e => [e.id, e]));

/**
 * Resolve an exercise to { primaryGroup, secondaryGroups[] } among the graded
 * muscle groups. Uses muscleScores when present (most granular), else falls
 * back to primary/secondary region tags. Returns null when the exercise hits
 * no graded group (e.g. a pure forearm/neck movement, or a custom exercise).
 */
function exerciseGroups(ex) {
  if (!ex) return null;
  const groupScore = {};
  const bump = (region, score) => {
    const g = REGION_TO_GROUP[region];
    if (!g) return;
    groupScore[g] = Math.max(groupScore[g] || 0, score);
  };

  const scores = ex.muscleScores || {};
  for (const [region, s] of Object.entries(scores)) {
    if (typeof s === 'number') bump(region, s);
  }
  if (Object.keys(groupScore).length === 0) {
    for (const r of (ex.primaryRegions || [])) bump(r, 90);
    for (const r of (ex.secondaryRegions || [])) bump(r, 40);
  }

  const entries = Object.entries(groupScore).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return {
    primaryGroup: entries[0][0],
    secondaryGroups: entries.slice(1).filter(([, s]) => s >= 50).map(([g]) => g),
  };
}

/**
 * Count weekly sets per muscle group from session history.
 *
 * @param {Array} sessions - [{ completed_at, workout_sets:[{exercise_id, completed}] }]
 *   (same shape readinessEngine consumes — flattenSessionSets output works).
 * @param {object} [opts]
 * @param {number} [opts.windowDays=7]
 * @param {number} [opts.now=Date.now()]
 * @returns {Object<string, number>} group key → weekly set count (1 per primary,
 *   0.5 per secondary).
 */
export function computeWeeklySetsByGroup(sessions, { windowDays = 7, now = Date.now() } = {}) {
  const out = {};
  for (const key of LANDMARK_KEYS) out[key] = 0;

  const cutoff = now - windowDays * 86400000;
  for (const s of (sessions || [])) {
    const t = s?.completed_at ? new Date(s.completed_at).getTime() : null;
    if (!t || t < cutoff) continue;
    for (const set of (s.workout_sets || [])) {
      if (!set || set.completed === false) continue;
      const grp = exerciseGroups(EX_LOOKUP.get(set.exercise_id));
      if (!grp) continue;
      if (grp.primaryGroup in out) out[grp.primaryGroup] += 1;
      for (const sg of grp.secondaryGroups) if (sg in out) out[sg] += 0.5;
    }
  }
  return out;
}

/**
 * Grade each muscle group's weekly volume against its (level-scaled) landmarks.
 *
 * @param {Array} sessions - session history (see computeWeeklySetsByGroup)
 * @param {string} [level='intermediate'] - beginner | intermediate | advanced
 * @param {object} [opts] - forwarded to computeWeeklySetsByGroup (windowDays/now)
 * @returns {Array<{
 *   key:string, sets:number, mev:number, mav:number, mrv:number,
 *   status:'under'|'optimal'|'high'|'over', delta:number
 * }>} delta = recommended set change toward the productive band (+add / −cut).
 */
export function assessWeeklyVolume(sessions, level = 'intermediate', opts = {}) {
  const byGroup = computeWeeklySetsByGroup(sessions, opts);
  const scale = LEVEL_SCALE[level] ?? 1.0;

  return VOLUME_LANDMARKS.map(g => {
    const sets = Math.round((byGroup[g.key] || 0) * 10) / 10;
    const mev = Math.max(1, Math.round(g.mev * scale));
    const mav = Math.max(mev + 1, Math.round(g.mav * scale));
    const mrv = Math.max(mav + 1, Math.round(g.mrv * scale));

    let status;
    if (sets < mev) status = 'under';
    else if (sets <= mav) status = 'optimal';
    else if (sets <= mrv) status = 'high';
    else status = 'over';

    let delta = 0;
    if (status === 'under') delta = Math.max(1, Math.round(mev - sets));
    else if (status === 'over') delta = -Math.max(1, Math.round(sets - mrv));

    return { key: g.key, sets, mev, mav, mrv, status, delta };
  });
}
