import { describe, it, expect } from 'vitest';
import { classEndsAt, classHasEnded } from '../classTime';

// Local-time constructor so these read the same way the app does.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe('classEndsAt', () => {
  it('resolves an ordinary same-day class', () => {
    expect(classEndsAt('2026-08-05', '09:00', '10:00')?.getTime())
      .toBe(at(2026, 8, 5, 10, 0));
  });

  it('parses the date locally, not as UTC midnight', () => {
    // `new Date('2026-08-05')` is UTC midnight — 8pm on Aug 4 in Puerto Rico.
    const d = classEndsAt('2026-08-05', '09:00', '10:00');
    expect(d.getDate()).toBe(5);
    expect(d.getMonth()).toBe(7); // August
  });

  // THE regression: a class running 23:00 → 00:30 stores end_time "00:30",
  // which applied to its own date lands BEFORE the class starts.
  it('carries a midnight-crossing class into the next day', () => {
    expect(classEndsAt('2026-08-05', '23:00', '00:30')?.getTime())
      .toBe(at(2026, 8, 6, 0, 30));
  });

  it('treats an end equal to the start as a full-day crossing', () => {
    expect(classEndsAt('2026-08-05', '12:00', '12:00')?.getTime())
      .toBe(at(2026, 8, 6, 12, 0));
  });

  it('accepts seconds on the time, as Postgres TIME returns them', () => {
    expect(classEndsAt('2026-08-05', '09:00:00', '10:30:00')?.getTime())
      .toBe(at(2026, 8, 5, 10, 30));
  });

  it('returns null when it cannot tell', () => {
    expect(classEndsAt('', '09:00', '10:00')).toBeNull();
    expect(classEndsAt('2026-08-05', '09:00', null)).toBeNull();
    expect(classEndsAt('not-a-date', '09:00', '10:00')).toBeNull();
  });
});

describe('classHasEnded', () => {
  it('is false before the end and true after', () => {
    expect(classHasEnded('2026-08-05', '09:00', '10:00', at(2026, 8, 5, 9, 30))).toBe(false);
    expect(classHasEnded('2026-08-05', '09:00', '10:00', at(2026, 8, 5, 10, 1))).toBe(true);
  });

  // The user-visible symptom: a 23:00 class reading as finished at 22:00, hiding
  // Cancel on a booking that was still cancellable.
  it('does not call a late class finished before it starts', () => {
    expect(classHasEnded('2026-08-05', '23:00', '00:30', at(2026, 8, 5, 22, 0))).toBe(false);
    expect(classHasEnded('2026-08-05', '23:00', '00:30', at(2026, 8, 6, 0, 45))).toBe(true);
  });

  it('never claims a class ended on missing data', () => {
    expect(classHasEnded('2026-08-05', '09:00', undefined)).toBe(false);
    expect(classHasEnded(null, null, null)).toBe(false);
  });
});
