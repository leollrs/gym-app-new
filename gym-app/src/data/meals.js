import { MEALS_HIGH_PROTEIN } from './meals_high_protein';
import { MEALS_FAT_LOSS } from './meals_fat_loss';
import { MEALS_LEAN_BULK } from './meals_lean_bulk';
import { MEALS_MASS_GAIN } from './meals_mass_gain';
import { MEALS_QUICK_BUDGET } from './meals_quick_budget';
import { MEALS_BREAKFAST_POSTWORKOUT } from './meals_breakfast_postworkout';

export const MEALS = [
  ...MEALS_HIGH_PROTEIN,
  ...MEALS_FAT_LOSS,
  ...MEALS_LEAN_BULK,
  ...MEALS_MASS_GAIN,
  ...MEALS_QUICK_BUDGET,
  ...MEALS_BREAKFAST_POSTWORKOUT,
];
