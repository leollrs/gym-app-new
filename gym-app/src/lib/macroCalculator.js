/**
 * Mifflin-St Jeor TDEE calculator with goal-based macro split.
 *
 * BMR formula:
 *   Male:   10 × weight(kg) + 6.25 × height(cm) - 5 × age - 161 + 166
 *   Female: 10 × weight(kg) + 6.25 × height(cm) - 5 × age - 161
 *
 * Activity multipliers:
 *   1-2 days/week: 1.2 (sedentary)
 *   3-4 days/week: 1.55 (moderate)
 *   5-6 days/week: 1.725 (active)
 *   7   days/week: 1.9 (very active)
 */

const LBS_TO_KG = 0.453592;
const INCHES_TO_CM = 2.54;

function getActivityMultiplier(trainingDays) {
  if (trainingDays <= 2) return 1.2;
  if (trainingDays <= 4) return 1.55;
  if (trainingDays <= 6) return 1.725;
  return 1.9;
}

export function calculateMacros({
  weightLbs,
  heightInches,
  age,
  sex = 'male',
  trainingDays = 4,
  goal = 'muscle_gain',
}) {
  // Validate inputs
  if (!weightLbs || weightLbs <= 0 || !isFinite(weightLbs)) return null;
  if (!heightInches || heightInches <= 0 || !isFinite(heightInches)) return null;
  if (!age || age <= 0 || age > 120 || !isFinite(age)) return null;

  const weightKg = weightLbs * LBS_TO_KG;
  const heightCm = heightInches * INCHES_TO_CM;

  // BMR (Mifflin-St Jeor)
  let bmr;
  if (sex === 'female') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  } else {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  }

  // TDEE
  const multiplier = getActivityMultiplier(trainingDays);
  const tdee = Math.round(bmr * multiplier);

  // Goal adjustment
  let calories;
  let proteinPerLb;
  switch (goal) {
    case 'fat_loss':
      calories = tdee - 500;
      proteinPerLb = 1.0; // high protein to preserve muscle
      break;
    case 'muscle_gain':
      calories = tdee + 300;
      proteinPerLb = 0.9;
      break;
    case 'strength':
      calories = tdee + 200;
      proteinPerLb = 0.85;
      break;
    case 'endurance':
      calories = tdee;
      proteinPerLb = 0.7;
      break;
    case 'general_fitness':
    default:
      calories = tdee;
      proteinPerLb = 0.8;
      break;
  }

  calories = Math.max(calories, 1200); // safety floor

  // Macros
  let protein = Math.round(weightLbs * proteinPerLb);
  let fat = Math.round((calories * 0.25) / 9); // 25% of calories from fat
  let carbCalories = calories - protein * 4 - fat * 9;
  let carbs = Math.round(carbCalories / 4);

  // Guard the carb floor. For a light person on an aggressive deficit, protein +
  // fat can already consume nearly the whole calorie budget, leaving carbs near
  // zero. Flooring carbs to 50g would silently add up to ~200 cal ON TOP of the
  // target, quietly erasing the deficit. Instead, when carbs would fall below
  // the 50g floor, hold carbs at 50g and trim FAT to keep the calorie total on
  // target (protein is preserved — it's the priority macro). Only if fat hits
  // its own minimum do we let the total drift up.
  const CARB_FLOOR = 50;
  const FAT_FLOOR = Math.round((calories * 0.15) / 9); // never drop fat below 15% of cals
  if (carbs < CARB_FLOOR) {
    const deficitCals = (CARB_FLOOR - carbs) * 4; // extra calories the floor adds
    const fatReducible = Math.max(0, fat - FAT_FLOOR);
    const fatToCut = Math.min(fatReducible, Math.round(deficitCals / 9));
    fat -= fatToCut;
    carbs = CARB_FLOOR;
  }

  // Recompute the true calorie total from the final macros so the returned
  // `calories` matches protein/carbs/fat (rather than a target the macros no
  // longer sum to).
  const finalCalories = protein * 4 + carbs * 4 + fat * 9;

  return {
    calories: finalCalories,
    protein,
    carbs,
    fat,
    bmr: Math.round(bmr),
    tdee,
  };
}
