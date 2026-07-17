import { describe, it, expect } from 'vitest';
import { getMeals, setMeals } from './mealStore';
import { generateDayPlan } from './mealPlanner';

// Verifies the recipe side of "DB-source now, keep safe seed": the store is
// seeded with the full recipe library, the meal planner builds plans reading
// from it, and the DB-refresh guard is defensive.
describe('mealStore + planning', () => {
  it('is seeded with the full recipe library', () => {
    expect(getMeals().length).toBeGreaterThan(400);
  });

  it('setMeals rejects empty / malformed payloads (seed stays)', () => {
    const before = getMeals().length;
    expect(setMeals([])).toBe(false);
    expect(setMeals([{ id: 'x' }])).toBe(false);
    expect(getMeals().length).toBe(before);
  });

  it('generateDayPlan builds a plan from the store', () => {
    const plan = generateDayPlan({
      targets: { calories: 2200, protein: 160, carbs: 220, fat: 70 },
      slots: 3,
    });
    expect(JSON.stringify(plan)).toMatch(/"id":"r\d+"/);
  });
});
