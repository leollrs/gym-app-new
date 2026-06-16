import { describe, it, expect } from 'vitest';
import { slotTypesFor, mealFitsSlot, suggestMeals } from '../mealPlanner';

describe('slotTypesFor', () => {
  it('maps slot counts to time-of-day labels', () => {
    expect(slotTypesFor(1)).toEqual(['lunch']);
    expect(slotTypesFor(2)).toEqual(['lunch', 'dinner']);
    expect(slotTypesFor(3)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(slotTypesFor(4)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
  });

  it('inserts extra snacks between lunch and dinner for 5+', () => {
    const five = slotTypesFor(5);
    expect(five).toHaveLength(5);
    expect(five[0]).toBe('breakfast');
    expect(five[five.length - 1]).toBe('dinner');
    expect(five.filter((s) => s === 'snack')).toHaveLength(2);
  });
});

describe('mealFitsSlot', () => {
  it('breakfast slot only accepts breakfast-category dishes', () => {
    expect(mealFitsSlot({ category: 'breakfast' }, 'breakfast')).toBe(true);
    expect(mealFitsSlot({ category: 'high_protein' }, 'breakfast')).toBe(false);
  });

  it('lunch/dinner accept anything except breakfast dishes', () => {
    expect(mealFitsSlot({ category: 'high_protein' }, 'lunch')).toBe(true);
    expect(mealFitsSlot({ category: 'breakfast' }, 'dinner')).toBe(false);
  });

  it('snack requires light + fast (<=400 kcal, <=15 min)', () => {
    expect(mealFitsSlot({ calories: 300, prepTime: 10 }, 'snack')).toBe(true);
    expect(mealFitsSlot({ calories: 500, prepTime: 10 }, 'snack')).toBe(false);
    expect(mealFitsSlot({ calories: 300, prepTime: 20 }, 'snack')).toBe(false);
  });

  it('a null slot fits anything', () => {
    expect(mealFitsSlot({ category: 'fat_loss' }, null)).toBe(true);
  });
});

describe('suggestMeals', () => {
  const targets = { calories: 2200, protein: 160, carbs: 220, fat: 70 };
  const none = { calories: 0, protein: 0, carbs: 0, fat: 0 };

  it('returns [] once the day is already at target', () => {
    expect(suggestMeals({ targets, consumed: targets })).toEqual([]);
  });

  it('returns a ranked, capped, well-shaped list for a lunch slot', () => {
    const out = suggestMeals({ targets, consumed: none, mealType: 'lunch' });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);          // guards the old "lunch returns nothing" bug
    expect(out.length).toBeLessThanOrEqual(20);
    for (const item of out) {
      expect(item.meal).toBeTruthy();
      expect(typeof item.score).toBe('number');
      expect(typeof item.fits).toBe('boolean');
      // lunch must never surface a breakfast dish
      expect(item.meal.category).not.toBe('breakfast');
    }
  });

  it('is sorted by descending score', () => {
    const out = suggestMeals({ targets, consumed: none, mealType: 'lunch' });
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
    }
  });
});
