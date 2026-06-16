import { describe, it, expect } from 'vitest';
import {
  epley1RM,
  shouldDeload,
  computeDeload,
  estimateStartingWeight,
} from '../overloadEngine';

// The progressive-overload engine is the core differentiator. These lock in the
// math so a future refactor can't silently change what weight a member is told
// to lift.

describe('epley1RM', () => {
  it('returns 0 for invalid input', () => {
    expect(epley1RM(0, 5)).toBe(0);
    expect(epley1RM(100, 0)).toBe(0);
    expect(epley1RM(100, -3)).toBe(0);
    expect(epley1RM(undefined, 5)).toBe(0);
  });

  it('matches the Epley formula at/below the 10-rep crossover', () => {
    expect(epley1RM(100, 1)).toBeCloseTo(103.333, 2); // 100 * (1 + 1/30)
    expect(epley1RM(100, 10)).toBeCloseTo(133.333, 2); // 100 * (1 + 10/30)
  });

  it('is monotonically increasing in reps across a realistic range (1-20)', () => {
    let prev = -Infinity;
    for (let reps = 1; reps <= 20; reps++) {
      const est = epley1RM(100, reps);
      expect(est).toBeGreaterThan(prev);
      prev = est;
    }
  });

  it('stays finite and positive at very high reps (>=30 fallback)', () => {
    const est = epley1RM(100, 30);
    expect(Number.isFinite(est)).toBe(true);
    expect(est).toBeGreaterThan(0);
  });
});

describe('shouldDeload', () => {
  it('triggers at 4+ consecutive progressive sessions', () => {
    expect(shouldDeload(4)).toBe(true);
    expect(shouldDeload(6)).toBe(true);
  });
  it('does not trigger below 4', () => {
    expect(shouldDeload(0)).toBe(false);
    expect(shouldDeload(3)).toBe(false);
  });
});

describe('computeDeload', () => {
  it('drops to ~60% of working weight, rounded to a 2.5lb plate, keeping reps', () => {
    const d = computeDeload(100, 8);
    expect(d.suggestedWeight).toBe(60); // round(100 * 0.6 / 2.5) * 2.5
    expect(d.suggestedReps).toBe(8);
    expect(d.note).toBe('deload');
    expect(typeof d.label).toBe('string');
  });

  it('rounds to the nearest plate increment', () => {
    const d = computeDeload(105, 5);
    expect(d.suggestedWeight).toBe(62.5); // 63 -> nearest 2.5
    expect(d.suggestedWeight % 2.5).toBe(0);
  });
});

describe('estimateStartingWeight', () => {
  it('returns null without a usable body weight', () => {
    expect(estimateStartingWeight({ bodyWeightLbs: 0 })).toBeNull();
    expect(estimateStartingWeight({ bodyWeightLbs: -10 })).toBeNull();
    expect(estimateStartingWeight({})).toBeNull();
  });

  it('returns a positive plate-rounded weight for valid input', () => {
    const w = estimateStartingWeight({
      bodyWeightLbs: 180,
      fitnessLevel: 'beginner',
      sex: 'male',
      goal: 'muscle_gain',
      movementPattern: 'push',
    });
    expect(typeof w).toBe('number');
    expect(w).toBeGreaterThanOrEqual(5);
    expect(w % 2.5).toBe(0);
  });

  it('never suggests below the 5lb floor', () => {
    const w = estimateStartingWeight({
      bodyWeightLbs: 1,
      fitnessLevel: 'beginner',
      sex: 'female',
      goal: 'fat_loss',
      movementPattern: 'isolation_push',
    });
    // tiny bodyweight still floors at 5 (or null if the pattern table is absent)
    if (w !== null) expect(w).toBeGreaterThanOrEqual(5);
  });
});
