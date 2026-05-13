// swapMatchScore.js
//
// Shared logic for the in-session swap modal (ActiveSession) and the
// workout-builder swap modal. Two responsibilities:
//
//   1. Score how well a candidate exercise replaces the target — region
//      overlap is the dominant signal, with small bonuses for matching
//      equipment + movement pattern. 100 = identical fit, ~60-80 = same
//      muscle but different angle/equipment, <40 = unrelated.
//
//   2. Filter candidates by the *reason* the user is swapping:
//        • equipment_busy — exclude same-equipment alternatives (the rack
//          is taken, so don't suggest another barbell move)
//        • injury — exclude alternatives that hit the SAME primary regions
//          (the muscle is aggravated; offer something different entirely)
//        • preference — no filter; user just wants variety
//
// Both functions are pure so the modal can pipeline them per render.

export function getSwapMatchScore(target, candidate) {
  if (!target || !candidate) return 0;

  const targetRegions = new Set(target.primaryRegions || target.primary_regions || []);
  const candRegions = candidate.primaryRegions || candidate.primary_regions || [];

  let regionScore = 0;
  if (targetRegions.size > 0) {
    const overlap = candRegions.filter((r) => targetRegions.has(r)).length;
    regionScore = (overlap / targetRegions.size) * 84;
  } else {
    // No region info on the target — fall back to muscle group equality
    // so we can still differentiate "Chest swap → Chest" from totally
    // different group picks.
    regionScore = (target.muscle && target.muscle === candidate.muscle) ? 70 : 30;
  }

  const equipBonus = target.equipment && candidate.equipment && target.equipment === candidate.equipment ? 8 : 0;

  const tp = (target.movementPattern || '').toLowerCase();
  const cp = (candidate.movementPattern || '').toLowerCase();
  const patternBonus = (tp && cp && tp === cp) ? 8 : 0;

  return Math.min(100, Math.round(regionScore + equipBonus + patternBonus));
}

export function filterByReason(exercises, reason, target) {
  if (!Array.isArray(exercises) || exercises.length === 0) return exercises || [];
  if (!reason || !target) return exercises;
  const targetEquip = target.equipment;
  const targetRegions = new Set(target.primaryRegions || target.primary_regions || []);

  if (reason === 'equipment_busy' && targetEquip) {
    return exercises.filter((ex) => ex.equipment !== targetEquip);
  }
  if (reason === 'injury' && targetRegions.size > 0) {
    return exercises.filter((ex) => {
      const regs = ex.primaryRegions || ex.primary_regions || [];
      return !regs.some((r) => targetRegions.has(r));
    });
  }
  // 'preference' — no filter; just variety
  return exercises;
}
