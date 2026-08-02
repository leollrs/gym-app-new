import { describe, it, expect } from 'vitest';
import {
  epley1RM,
  shouldDeload,
  computeDeload,
  estimateStartingWeight,
  parseRepTarget,
  computeSuggestion,
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

// routine_exercises.target_reps is TEXT, and '8-12' is what almost every row
// actually holds — so a scalar-only read of it discarded every prescription in
// the app. These lock the parse and the one behaviour that depends on it.
describe('parseRepTarget', () => {
  it('reads a plain number', () => {
    expect(parseRepTarget(10)).toEqual({ min: 10, max: 10 });
    expect(parseRepTarget('12')).toEqual({ min: 12, max: 12 });
  });

  it('reads a range however it was written', () => {
    expect(parseRepTarget('8-12')).toEqual({ min: 8, max: 12 });
    expect(parseRepTarget('8–12')).toEqual({ min: 8, max: 12 });   // en dash
    expect(parseRepTarget('8 to 12')).toEqual({ min: 8, max: 12 });
    expect(parseRepTarget(' 8 - 12 reps ')).toEqual({ min: 8, max: 12 });
  });

  it('normalises a backwards range', () => {
    expect(parseRepTarget('12-8')).toEqual({ min: 8, max: 12 });
  });

  it('refuses time and distance — cardio finishers share this column', () => {
    expect(parseRepTarget('10min')).toBeNull();
    expect(parseRepTarget('30s')).toBeNull();
    expect(parseRepTarget('5 km')).toBeNull();
  });

  it('refuses effort words and empties', () => {
    expect(parseRepTarget('AMRAP')).toBeNull();
    expect(parseRepTarget('Max')).toBeNull();
    expect(parseRepTarget('')).toBeNull();
    expect(parseRepTarget(null)).toBeNull();
    expect(parseRepTarget(undefined)).toBeNull();
    expect(parseRepTarget(0)).toBeNull();
  });
});

describe('computeSuggestion honours the routine prescription', () => {
  const hypertrophy = { primary_goal: 'muscle_gain', fitness_level: 'intermediate' }; // band 8-12
  const strength    = { primary_goal: 'strength',    fitness_level: 'intermediate' }; // band 3-6
  const at = (reps) => [{ weight: 100, reps }, { weight: 100, reps }];

  it("keeps a coach's 5x5 at 5 instead of rewriting it into the goal's 8-12", () => {
    // 5 reps done against a prescribed 5 = top of the band → add weight, back to 5.
    // Ignoring the prescription would read 5 as "below 12" and ask for 6 reps.
    const s = computeSuggestion(at(5), hypertrophy, '5');
    expect(s.note).toBe('increase_weight');
    expect(s.suggestedReps).toBe(5);
  });

  it('reads a written range that Number.isFinite could never see', () => {
    // Goal says 3-6, the routine says 8-12: 10 reps is mid-window, so keep the
    // weight and add a rep. Against the goal band, 10 ≥ 6 would have added
    // weight and dropped the member to 3 reps.
    const s = computeSuggestion(at(10), strength, '8-12');
    expect(s.note).toBe('increase_reps');
    expect(s.suggestedReps).toBe(11);
  });

  it('falls back to the goal range when the column holds a duration', () => {
    const s = computeSuggestion(at(12), hypertrophy, '10min');
    expect(s.note).toBe('increase_weight');
    expect(s.suggestedReps).toBe(8);
  });

  it('leaves a beginner the whole window instead of bumping at its bottom', () => {
    const beginner = { primary_goal: 'muscle_gain', fitness_level: 'beginner' };
    const s = computeSuggestion(at(8), beginner, '8-12');
    expect(s.note).toBe('increase_reps');
  });
});
