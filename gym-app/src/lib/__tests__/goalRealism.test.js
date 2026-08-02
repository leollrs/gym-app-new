import { describe, it, expect } from 'vitest';
import {
  honestWeeks,
  realisticBand,
  isSupportedDirection,
  milestone,
} from '../goalRealism';

// These timelines are shown to a member as a promise about their own body, so
// the direction of the gap has to mean something. The original math took
// Math.abs(gap) everywhere, which made "squat 110 → 220" and "squat 220 → 110"
// the same question and answered both with a confident date.

const lvl = 'intermediate'; // compound 2.5 lb/wk, isolation 1.25

describe('direction is part of the goal', () => {
  it('refuses to schedule getting weaker', () => {
    expect(honestWeeks({ goalType: 'lift_1rm', gap: -110, fitnessLevel: lvl })).toBeNull();
    expect(realisticBand({ goalType: 'lift_1rm', gap: -110, fitnessLevel: lvl })).toBeNull();
    expect(isSupportedDirection({ goalType: 'lift_1rm', gap: -110, fitnessLevel: lvl })).toBe(false);
  });

  it('still schedules getting stronger', () => {
    // 110 lb at 2.5/wk × 0.75 (moderate) = 58.7 → 59 weeks
    expect(honestWeeks({ goalType: 'lift_1rm', gap: 110, fitnessLevel: lvl })).toBe(59);
    expect(isSupportedDirection({ goalType: 'lift_1rm', gap: 110, fitnessLevel: lvl })).toBe(true);
  });

  it('refuses to schedule GAINING body fat', () => {
    expect(honestWeeks({ goalType: 'body_fat', gap: 5 })).toBeNull();
    expect(isSupportedDirection({ goalType: 'body_fat', gap: 5 })).toBe(false);
  });

  it('schedules losing body fat', () => {
    expect(honestWeeks({ goalType: 'body_fat', gap: -5 })).toBe(14); // 5 / (0.5×0.75)
  });

  it('says nothing about a goal with no gap yet', () => {
    expect(isSupportedDirection({ goalType: 'lift_1rm', gap: 0, fitnessLevel: lvl })).toBe(true);
    expect(isSupportedDirection({ goalType: 'lift_1rm', gap: NaN, fitnessLevel: lvl })).toBe(true);
  });
});

describe('body weight is not symmetric', () => {
  // Losing 1.5 lb/wk is a normal deficit. Gaining 1.5 lb/wk is not lean gain,
  // so the same 20 lb takes far longer in the other direction.
  it('loses faster than it gains', () => {
    const down = honestWeeks({ goalType: 'body_weight', gap: -20 });
    const up   = honestWeeks({ goalType: 'body_weight', gap: 20 });
    expect(down).toBe(18);  // 20 / (1.5 × 0.75)
    expect(up).toBe(54);    // 20 / (0.5 × 0.75)
    expect(up).toBeGreaterThan(down);
  });

  it('offers dates in both directions — losing and gaining are both real goals', () => {
    expect(realisticBand({ goalType: 'body_weight', gap: -20 })).not.toBeNull();
    expect(realisticBand({ goalType: 'body_weight', gap: 20 })).not.toBeNull();
  });
});

describe('bands stay ordered', () => {
  it('aggressive is soonest, steady is latest', () => {
    const b = realisticBand({ goalType: 'lift_1rm', gap: 100, fitnessLevel: lvl });
    expect(b.aggressive.weeks).toBeLessThan(b.moderate.weeks);
    expect(b.moderate.weeks).toBeLessThan(b.steady.weeks);
  });
});

describe('milestone', () => {
  it('carves a 12-week partial out of a long goal, never past the target', () => {
    const m = milestone({ goalType: 'lift_1rm', startValue: 125, targetValue: 225, fitnessLevel: lvl });
    expect(m.weeks).toBe(12);
    expect(m.direction).toBe('up');
    expect(m.value).toBeGreaterThan(125);
    expect(m.value).toBeLessThanOrEqual(225);
  });

  it('has nothing to offer for a backwards lift', () => {
    expect(milestone({ goalType: 'lift_1rm', startValue: 220, targetValue: 110, fitnessLevel: lvl })).toBeNull();
  });
});
