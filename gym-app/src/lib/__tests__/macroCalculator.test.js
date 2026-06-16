import { describe, it, expect } from 'vitest';
import { calculateMacros } from '../macroCalculator';

const baseMale = {
  weightLbs: 180,
  heightInches: 70,
  age: 30,
  sex: 'male',
  trainingDays: 4,
  goal: 'muscle_gain',
};

describe('calculateMacros', () => {
  it('returns null for invalid input', () => {
    expect(calculateMacros({ ...baseMale, weightLbs: 0 })).toBeNull();
    expect(calculateMacros({ ...baseMale, heightInches: 0 })).toBeNull();
    expect(calculateMacros({ ...baseMale, age: 0 })).toBeNull();
    expect(calculateMacros({ ...baseMale, age: 130 })).toBeNull();
  });

  it('returns macros whose calories equal protein*4 + carbs*4 + fat*9', () => {
    // The function recomputes `calories` from the final macros — this invariant
    // must hold for every goal, or the rings/targets in the UI lie.
    for (const goal of ['muscle_gain', 'fat_loss', 'strength', 'endurance', 'general_fitness']) {
      const m = calculateMacros({ ...baseMale, goal });
      expect(m).not.toBeNull();
      expect(m.calories).toBe(m.protein * 4 + m.carbs * 4 + m.fat * 9);
    }
  });

  it('sets protein from the goal-specific per-lb multiplier', () => {
    expect(calculateMacros({ ...baseMale, goal: 'muscle_gain' }).protein).toBe(162); // round(180 * 0.9)
    expect(calculateMacros({ ...baseMale, goal: 'fat_loss' }).protein).toBe(180);    // round(180 * 1.0)
  });

  it('respects the calorie floor and carb floor', () => {
    const aggressive = calculateMacros({
      weightLbs: 110, heightInches: 62, age: 45, sex: 'female', trainingDays: 1, goal: 'fat_loss',
    });
    expect(aggressive).not.toBeNull();
    expect(aggressive.calories).toBeGreaterThanOrEqual(1200);
    expect(aggressive.carbs).toBeGreaterThanOrEqual(50);
  });

  it('gives a lower TDEE for female than male, all else equal', () => {
    const male = calculateMacros({ ...baseMale, sex: 'male' });
    const female = calculateMacros({ ...baseMale, sex: 'female' });
    expect(female.tdee).toBeLessThan(male.tdee);
    expect(male.bmr).toBeGreaterThan(0);
  });
});
