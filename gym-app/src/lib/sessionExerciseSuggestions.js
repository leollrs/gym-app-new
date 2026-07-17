// sessionExerciseSuggestions.js
//
// Pure helper that surfaces "what to add next" picks for the in-session Add
// Exercise modal. Given the exercises currently in the active session, find
// muscle groups that pair naturally with what's already in the workout but
// aren't being trained yet, then rank library exercises that hit them.
//
// Logic, in order of priority:
//   1. Push/Pull balance — if the session is push-heavy, suggest pull, etc.
//   2. Antagonist pairing — chest↔back, biceps↔triceps, quads↔hams.
//   3. Hygiene — once the workout has 3+ exercises, add Core/Legs if
//      they're missing entirely.
//
// Sorts candidates by muscle-score peak so the suggestions are quality
// picks, not the alphabetical first thing in the library.

import { getExercises } from './exerciseStore';
const DEFAULT_LIBRARY = getExercises();

const ANTAGONISTS = {
  Chest:      'Back',
  Back:       'Chest',
  Biceps:     'Triceps',
  Triceps:    'Biceps',
  Quads:      'Hamstrings',
  Hamstrings: 'Quads',
};

function muscleScorePeak(ex) {
  const scores = ex.muscleScores || {};
  let best = 0;
  for (const v of Object.values(scores)) {
    if (typeof v === 'number' && v > best) best = v;
  }
  return best;
}

function classifyPattern(ex) {
  const p = (ex.movementPattern || '').toLowerCase();
  if (p.startsWith('push') || p === 'isolation_push') return 'push';
  if (p.startsWith('pull') || p === 'isolation_pull') return 'pull';
  return null;
}

export function getSessionSuggestions(currentExercises, options = {}) {
  const { topN = 6, library = DEFAULT_LIBRARY } = options;
  if (!Array.isArray(currentExercises) || currentExercises.length === 0) return [];

  const sessionIds = new Set(currentExercises.map((e) => e?.id).filter(Boolean));
  const sessionGroups = new Set(currentExercises.map((e) => e?.muscle).filter(Boolean));

  // Movement-pattern counts to detect push vs pull imbalance.
  let pushCount = 0;
  let pullCount = 0;
  for (const ex of currentExercises) {
    const cls = classifyPattern(ex)
      || (library.find((lex) => lex.id === ex?.id)
        ? classifyPattern(library.find((lex) => lex.id === ex?.id))
        : null);
    if (cls === 'push') pushCount++;
    else if (cls === 'pull') pullCount++;
  }

  // Build target muscle groups based on what's missing / imbalanced.
  const targets = new Set();
  for (const g of sessionGroups) {
    const a = ANTAGONISTS[g];
    if (a && !sessionGroups.has(a)) targets.add(a);
  }
  if (pushCount >= 2 && pullCount === 0) {
    targets.add('Back');
    targets.add('Biceps');
  }
  if (pullCount >= 2 && pushCount === 0) {
    targets.add('Chest');
    targets.add('Triceps');
  }
  if (currentExercises.length >= 3) {
    if (!sessionGroups.has('Core')) targets.add('Core');
    const hasLegs = ['Legs', 'Quads', 'Hamstrings', 'Glutes', 'Calves']
      .some((g) => sessionGroups.has(g));
    if (!hasLegs) targets.add('Legs');
  }
  if (targets.size === 0) return [];

  const candidates = library
    .filter((ex) => !sessionIds.has(ex.id))
    .filter((ex) => targets.has(ex.muscle))
    .map((ex) => {
      const score = muscleScorePeak(ex);
      // Bonus when the exercise hits multiple target groups (compound that
      // covers two missing areas is worth more than an isolation).
      const regionHits = (ex.primaryRegions || []).filter((_, idx, arr) => arr).length;
      const compoundBonus = Math.min(8, Math.max(0, ((ex.primaryRegions?.length || 0) - 1) * 4));
      return { ex, score, match: Math.min(100, score + compoundBonus) };
    })
    .sort((a, b) => {
      if (b.match !== a.match) return b.match - a.match;
      const ra = a.ex.primaryRegions?.length || 0;
      const rb = b.ex.primaryRegions?.length || 0;
      return rb - ra;
    })
    .slice(0, topN)
    // Decorate each exercise with the computed match score so the UI can
    // render a "% match" badge without re-running the ranking pass.
    .map(({ ex, match }) => ({ ...ex, _suggestionMatch: match }));

  return candidates;
}
