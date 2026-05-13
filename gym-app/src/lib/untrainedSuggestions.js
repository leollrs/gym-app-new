// untrainedSuggestions.js
//
// Pure helper that surfaces exercise suggestions for muscle groups the user
// hasn't worked yet this week, given a readiness map (from `readinessEngine`)
// and the local exercise catalogue. The Recovery modal renders the result as
// "Bring these up" cards with an "Add to routine" CTA.
//
// A group is "untrained" when its aggregated 7-day set count is 0. We rank
// exercises by their `muscleScores` entry for any of the group's region ids
// and keep the top N — same scoring the Exercise Library uses for filter
// chips, so suggestions match what the user sees when they tap a muscle.

import { aggregateRegions } from './readinessEngine';
import { GROUP_TO_REGIONS } from './muscleBuckets';
import { exercises as DEFAULT_LIBRARY } from '../data/exercises';

// Rank exercises by their best `muscleScores` match across the given region
// ids. Used by the Recovery modal's per-muscle dropdown — the user taps a
// muscle and sees the top picks that hit those exact regions.
export function rankExercisesForRegions(regionIds, options = {}) {
  const { topN = 5, minScore = 50, library = DEFAULT_LIBRARY } = options;
  if (!Array.isArray(regionIds) || regionIds.length === 0) return [];
  return library
    .map((ex) => {
      const scores = ex.muscleScores || {};
      let best = 0;
      for (const region of regionIds) {
        const s = scores[region] || 0;
        if (s > best) best = s;
      }
      return { ex, score: best };
    })
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((r) => r.ex);
}

export function getUntrainedGroupSuggestions(readiness, options = {}) {
  const {
    perGroup = 3,
    minScore = 60,
    maxGroups = 5,
    library = DEFAULT_LIBRARY,
  } = options;

  const out = [];
  for (const [group, regionIds] of Object.entries(GROUP_TO_REGIONS)) {
    const agg = aggregateRegions(readiness, regionIds);
    if (agg.sets > 0) continue; // already worked this week

    const ranked = library
      .map((ex) => {
        const scores = ex.muscleScores || {};
        let best = 0;
        for (const region of regionIds) {
          const s = scores[region] || 0;
          if (s > best) best = s;
        }
        return { ex, score: best };
      })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, perGroup);

    if (ranked.length >= 2) {
      out.push({
        group,
        regionIds,
        exercises: ranked.map((r) => r.ex),
        lastTrained: agg.lastTrained,
      });
    }
    if (out.length >= maxGroups) break;
  }
  return out;
}
