/**
 * exerciseChips.js — the muscle/category filter chips used by AllExercisesModal.
 *
 * Extracted from ExerciseLibrary because the Library's picker is now the ONE
 * exercise picker in the app. Every surface that lets you add an exercise
 * (program builder, routine builder, active session, admin/trainer builders)
 * should render <AllExercisesModal> with these, instead of hand-rolling a
 * search sheet — which is how we ended up with several that had no filters, no
 * video, no favorites, and a silent `.slice(0, 80)` cap that hid most of the
 * catalog past the first 80 matches.
 *
 * Kept as plain functions rather than a hook so callers stay free to memoize
 * with whatever deps they actually have. `filterByChip` MUST be passed to the
 * modal memoized — the modal keys its filter+sort useMemo on the prop
 * identity, so a fresh arrow every render re-filters the whole catalog.
 */

/** Base chips — the ones with a body-figure representation. */
export const baseChipDefs = (t) => [
  { id: 'all',   label: t('exerciseLibrary.filterAll', 'All') },
  { id: 'push',  label: `↑ ${t('exerciseLibrary.filterPush', 'Push')}` },
  { id: 'pull',  label: `↓ ${t('exerciseLibrary.filterPull', 'Pull')}` },
  { id: 'chest', label: t('muscleGroups.Chest', 'Chest') },
  { id: 'back',  label: t('muscleGroups.Back', 'Back') },
  { id: 'arms',  label: t('exerciseLibrary.filterArms', 'Arms') },
  { id: 'legs',  label: t('muscleGroups.Legs', 'Legs') },
  { id: 'core',  label: t('muscleGroups.Core', 'Core') },
];

/**
 * Full set for the search modal — adds the list-only filters that have no
 * place on the body figure.
 */
export const modalChipDefs = (t) => [
  ...baseChipDefs(t),
  { id: 'recent',   label: t('exerciseLibrary.filterRecent', 'Recent') },
  { id: 'mobility', label: t('exerciseLibrary.filterMobility', 'Mobility') },
  { id: 'hiit',     label: t('exerciseLibrary.filterHIIT', 'HIIT') },
];

/**
 * Chip predicate. `recentIds` / `favoriteIds` are optional — a surface with no
 * notion of "recent" (the program builder, say) just gets a Recent chip that
 * matches nothing rather than a crash, so callers can share one chip list.
 *
 * @param {object} ex          exercise row
 * @param {string} chipId
 * @param {{recentIds?: Set, favoriteIds?: Set}} [ctx]
 */
export function matchesChip(ex, chipId, ctx = {}) {
  const m = (ex.muscle || '').toLowerCase();
  const cat = (ex.category || '').toLowerCase();
  if (chipId === 'recent') {
    const recent = ctx.recentIds;
    if (recent && recent.size > 0) return recent.has(ex.id);
    return ctx.favoriteIds ? ctx.favoriteIds.has(ex.id) : false;
  }
  if (chipId === 'legs')     return m === 'legs' || m === 'quads' || m === 'hamstrings' || m === 'glutes' || m === 'calves';
  if (chipId === 'core')     return m === 'core' || m === 'abs';
  if (chipId === 'push')     return m === 'chest' || m === 'shoulders' || m === 'triceps';
  if (chipId === 'pull')     return m === 'back' || m === 'lats' || m === 'biceps' || m === 'traps';
  if (chipId === 'chest')    return m === 'chest';
  if (chipId === 'back')     return m === 'back' || m === 'lats' || m === 'traps';
  if (chipId === 'arms')     return m === 'biceps' || m === 'triceps' || m === 'forearms';
  if (chipId === 'mobility') return cat.includes('mobility') || cat.includes('stretch');
  if (chipId === 'hiit')     return cat.includes('hiit') || cat.includes('cardio');
  return true;
}
