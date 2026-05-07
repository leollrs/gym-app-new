// ──────────────────────────────────────────────────────────────
// menuRanker.js
// Rank menu items (from analyze-menu-photo) by how well they fit
// the member's remaining macro budget for the day, weighted by
// their primary goal.
//
// Scoring:
//   - Calorie fit: hard penalty if we blow past remaining, softer
//     penalty if we under-fill by > 50% (wasted slot)
//   - Protein fit: closer to remaining_protein = better; for
//     muscle_gain / strength, over-delivering protein is rewarded
//   - Goal shaping:
//       fat_loss    → penalize high cal + high carbs
//       muscle_gain → reward high protein + reasonable carbs
//   - Final score multiplied by item.confidence (0..1)
// ──────────────────────────────────────────────────────────────

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function calorieFitScore(itemCal, remainingCal) {
  if (!remainingCal || remainingCal <= 0) {
    // Budget already blown — any item hurts; tiny items hurt less.
    return Math.max(0, 40 - itemCal / 20);
  }
  const ratio = itemCal / remainingCal;
  if (ratio > 1.1) {
    // Blew past remaining. Heavier penalty the further we overshoot.
    const over = ratio - 1;
    return Math.max(0, 55 - over * 120);
  }
  if (ratio > 0.95) return 95;          // just under — ideal
  if (ratio > 0.75) return 100;         // sweet spot
  if (ratio > 0.5) return 85;
  if (ratio > 0.25) return 60;
  return 35;                            // under-fills by > 75%
}

function proteinFitScore(itemPro, remainingPro, goal) {
  if (!remainingPro || remainingPro <= 0) {
    // Protein target hit — more is fine but not rewarded heavily.
    return 60 + Math.min(20, itemPro);
  }
  const ratio = itemPro / remainingPro;
  const isBulking = goal === 'muscle_gain' || goal === 'strength';

  if (ratio >= 1) {
    // Met or over-delivered. Bulkers love this, cutters are neutral.
    if (isBulking) return Math.min(100, 90 + (ratio - 1) * 15);
    return clamp(85 - (ratio - 1) * 25, 45, 85);
  }
  if (ratio >= 0.7) return 80 + ratio * 15;
  if (ratio >= 0.4) return 55 + ratio * 40;
  return 25 + ratio * 60;
}

function goalShapingBonus(item, goal) {
  const cal = item.calories || 0;
  const pro = item.protein_g || 0;
  const carbs = item.carbs_g || 0;
  const fat = item.fat_g || 0;
  const proteinRatio = (pro * 4) / Math.max(cal, 1);
  const carbRatio = (carbs * 4) / Math.max(cal, 1);
  const fatRatio = (fat * 9) / Math.max(cal, 1);

  switch (goal) {
    case 'fat_loss': {
      let bonus = 0;
      if (cal > 800) bonus -= 12;
      else if (cal > 600) bonus -= 6;
      if (carbRatio > 0.55) bonus -= 8;
      if (proteinRatio > 0.3) bonus += 8;
      if (fatRatio > 0.45) bonus -= 6;
      return bonus;
    }
    case 'muscle_gain': {
      let bonus = 0;
      if (pro >= 35) bonus += 10;
      else if (pro >= 25) bonus += 5;
      if (carbRatio >= 0.35 && carbRatio <= 0.55) bonus += 6;
      if (cal < 300) bonus -= 6; // too light for a bulking meal
      return bonus;
    }
    case 'strength': {
      let bonus = 0;
      if (pro >= 30) bonus += 8;
      if (cal >= 500) bonus += 4;
      return bonus;
    }
    case 'endurance': {
      let bonus = 0;
      if (carbRatio >= 0.45) bonus += 6;
      if (fatRatio > 0.45) bonus -= 6;
      return bonus;
    }
    default:
      return 0; // general
  }
}

function labelFromScore(score) {
  if (score >= 80) return 'Great fit';
  if (score >= 65) return 'Good fit';
  if (score >= 45) return 'Okay';
  return 'Heavy';
}

/**
 * @param {Array} items items from analyze-menu-photo
 * @param {{calories:number, protein_g:number, carbs_g:number, fat_g:number}} remainingMacros
 * @param {'muscle_gain'|'fat_loss'|'strength'|'endurance'|'general'} goal
 * @returns {Array} sorted copy, each annotated with matchScore, matchLabel, isTopPick
 */
export function rankMenuItems(items, remainingMacros, goal = 'general') {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safeGoal = goal || 'general';
  const rem = {
    calories: Math.max(0, Number(remainingMacros?.calories) || 0),
    protein_g: Math.max(0, Number(remainingMacros?.protein_g) || 0),
    carbs_g: Math.max(0, Number(remainingMacros?.carbs_g) || 0),
    fat_g: Math.max(0, Number(remainingMacros?.fat_g) || 0),
  };

  const scored = items.map((item) => {
    const cal = Number(item.calories) || 0;
    const pro = Number(item.protein_g) || 0;
    const confidence = clamp(Number(item.confidence) || 0.6, 0.3, 1);

    const calScore = calorieFitScore(cal, rem.calories);
    const proScore = proteinFitScore(pro, rem.protein_g, safeGoal);

    // Weighted blend — calories 45%, protein 45%, goal shaping 10%.
    let blended = calScore * 0.45 + proScore * 0.45;
    blended += goalShapingBonus(item, safeGoal); // additive, can be negative
    blended = clamp(blended, 0, 100);

    // Down-weight by AI confidence so a wildly uncertain "perfect match"
    // doesn't beat a confident good match.
    const final = clamp(blended * confidence, 0, 100);

    return {
      ...item,
      matchScore: Math.round(final),
      matchLabel: labelFromScore(final),
    };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);

  // Top 1–2 picks only if they actually clear the "Great fit" bar.
  const topCount = scored[0] && scored[0].matchScore > 75
    ? (scored[1] && scored[1].matchScore > 75 ? 2 : 1)
    : 0;
  for (let i = 0; i < scored.length; i++) {
    scored[i].isTopPick = i < topCount;
  }

  return scored;
}

export default rankMenuItems;
