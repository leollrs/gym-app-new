import { describe, it, expect } from 'vitest';
import { DOW_NAMES } from '../trainerPlanAdoption';
import { buildStreakCalendar } from '../streakCalendar';

/**
 * profiles.preferred_training_days is TEXT[] of English day names, but the
 * day_of_week columns next to it are ints. Because the column is TEXT[],
 * Postgres accepts ints without error — the mismatch is invisible until a
 * member's streak quietly dies. These tests are the type check the column
 * doesn't give us.
 */

// The literal map every SQL reader uses (0242, 0297) and the JS readers
// duplicate (streakCalendar.js, personalProgramService.js). Written out by hand
// on purpose: if DOW_NAMES is ever edited, this must disagree, not follow.
const SQL_CASE = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

describe('preferred_training_days day-name contract', () => {
  it('DOW_NAMES is the exact inverse of the map every reader applies', () => {
    DOW_NAMES.forEach((name, dow) => {
      expect(SQL_CASE[name]).toBe(dow);
    });
    expect(DOW_NAMES).toHaveLength(7);
  });

  it('maps the packed week a coach plan produces to real day names', () => {
    // PACKED_WEEK is [1,2,3,4,5,6,0]; a 3-day plan takes the first three.
    expect([1, 2, 3].map(d => DOW_NAMES[d])).toEqual(['Monday', 'Tuesday', 'Wednesday']);
    // A 7-day plan wraps onto Sunday, which must be 'Sunday' and not undefined.
    expect([1, 2, 3, 4, 5, 6, 0].map(d => DOW_NAMES[d])).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
  });

  it('never emits a value the readers would resolve to NULL', () => {
    // This is the actual bug: ints stringify to '1','2','3', no CASE branch
    // matches, the array becomes {NULL,NULL,NULL}, and because a NULL branch
    // condition is false in plpgsql every rest day is charged as a missed one.
    const written = [1, 2, 3].map(d => DOW_NAMES[d]);
    written.forEach((v) => {
      expect(SQL_CASE[v]).toBeTypeOf('number');
    });
    // The shape the bug produced, for contrast.
    ['1', '2', '3'].forEach((v) => {
      expect(SQL_CASE[v]).toBeUndefined();
    });
  });
});

describe('streakCalendar agrees with what adoption writes', () => {
  const NOW = new Date(2026, 2, 15, 12, 0, 0); // 15 Mar 2026, local — matches toKey()
  const build = (days) => buildStreakCalendar({
    profile: { preferred_training_days: days, created_at: '2026-01-01T00:00:00.000Z' },
    sessions: [], cardio: [], gymHours: [], closures: [], holidays: [], freezes: [],
    now: NOW,
  });
  // Only days the rest/missed decision actually ran on. The calendar also emits
  // 'future', 'before-account' and 'today', which are decided before
  // preferred_training_days is ever consulted.
  const scoredDays = (cal) => cal.months
    .flatMap(m => m.days)
    .filter(d => d.status === 'rest' || d.status === 'missed');

  it('days outside the plan are rest, days inside it are misses', () => {
    const days = scoredDays(build([1, 2, 3].map(d => DOW_NAMES[d]))); // Mon/Tue/Wed
    // Thursday is not in the plan, so skipping it must never count against you.
    expect(days.filter(d => d.dow === 4).every(d => d.status === 'rest')).toBe(true);
    // Monday is, and there are no sessions, so it is a real miss.
    expect(days.filter(d => d.dow === 1).every(d => d.status === 'missed')).toBe(true);
    // Both classes must actually be present, or the assertions above are vacuous.
    expect(days.some(d => d.status === 'missed')).toBe(true);
    expect(days.some(d => d.status === 'rest')).toBe(true);
  });

  it('the numeric array silently inverted this — and disagreed with the server', () => {
    // Regression guard for the actual bug. `DAY_MAP['1']` is undefined, so the
    // rest-day filter matched NOTHING and marked all seven days rest: the
    // calendar showed a clean sheet with zero misses.
    //
    // The server did the opposite with the same row. Its CASE yields NULL per
    // element, `dow = ANY('{NULL,NULL,NULL}')` is NULL not FALSE, and plpgsql
    // treats a NULL branch as false — so the rest-day skip never fired and
    // EVERY day was charged as missed. The member saw a perfect calendar while
    // their freezes burned and the streak broke. That divergence is why this
    // went unnoticed; it is what makes it worth a test rather than a comment.
    const days = scoredDays(build(['1', '2', '3']));
    expect(days.length).toBeGreaterThan(0);
    expect(days.every(d => d.status === 'rest')).toBe(true);
    expect(days.some(d => d.status === 'missed')).toBe(false);
  });
});
