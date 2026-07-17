import { describe, it, expect } from 'vitest';
import { getExercises, getExerciseById, setExercises } from './exerciseStore';
import { generateProgram } from './workoutGenerator';

// Verifies the "DB-source now, keep safe seed" refactor: the store is seeded with
// the full static library, generation reads from it and still produces real
// programs, and the DB-refresh guard is defensive (bad payload can't clobber).
describe('exerciseStore + generation', () => {
  it('is seeded with the full library', () => {
    expect(getExercises().length).toBeGreaterThan(300);
    expect(getExerciseById('ex_bp')?.name).toBeTruthy();
    expect(getExerciseById('__nope__')).toBeNull();
  });

  it('setExercises rejects empty / malformed payloads (seed stays)', () => {
    const before = getExercises().length;
    expect(setExercises([])).toBe(false);
    expect(setExercises([{ id: 'x' }])).toBe(false); // missing muscle/equipment
    expect(getExercises().length).toBe(before);
  });

  it('generateProgram produces a real program reading from the store', () => {
    const onboarding = {
      fitness_level: 'intermediate',
      primary_goal: 'muscle_gain',
      training_days: 4,
      preferred_training_days: ['monday', 'tuesday', 'thursday', 'friday'],
      equipment: ['Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight'],
      injuries: [],
      sex: 'male', age: 28, weight_lbs: 180, height_inches: 70,
    };
    const program = generateProgram(onboarding, []);
    expect(program).toBeTruthy();
    // The program must reference real exercise ids pulled from the store.
    expect(JSON.stringify(program)).toMatch(/ex_[a-z0-9]+/);
  });
});
