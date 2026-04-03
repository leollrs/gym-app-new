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
  const protein = Math.round(weightLbs * proteinPerLb);
  const fat = Math.round((calories * 0.25) / 9); // 25% of calories from fat
  const carbCalories = calories - protein * 4 - fat * 9;
  const carbs = Math.max(Math.round(carbCalories / 4), 50); // floor at 50g

  return {
    calories: Math.round(calories),
    protein,
    carbs,
    fat,
    bmr: Math.round(bmr),
    tdee,
  };
}
