import { describe, it, expect } from 'vitest';
import { prospectFollowUpTier, PROSPECT_STATUSES, PROSPECT_SOURCES } from '../admin/memberQueries';

// Fixed clock so the boundaries are exact and the suite can't go flaky at
// midnight. All fixtures below are offsets from this instant.
const NOW = new Date('2026-08-03T12:00:00Z').getTime();
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

const at = (visited_at, status = 'new') => ({ visited_at, status });

describe('prospectFollowUpTier', () => {
  it('walks fresh → warm → cold as the visit ages', () => {
    expect(prospectFollowUpTier(at(daysAgo(0)), NOW)).toBe('fresh');
    expect(prospectFollowUpTier(at(daysAgo(1)), NOW)).toBe('fresh');
    expect(prospectFollowUpTier(at(daysAgo(3)), NOW)).toBe('warm');
    expect(prospectFollowUpTier(at(daysAgo(10)), NOW)).toBe('cold');
  });

  it('puts the boundaries exactly on the day, not a hair either side', () => {
    expect(prospectFollowUpTier(at(daysAgo(2)), NOW)).toBe('warm');
    expect(prospectFollowUpTier(at(daysAgo(7)), NOW)).toBe('cold');
    // A minute short of each boundary must still be the lower tier.
    expect(prospectFollowUpTier(at(new Date(NOW - 2 * 86_400_000 + 60_000).toISOString()), NOW)).toBe('fresh');
    expect(prospectFollowUpTier(at(new Date(NOW - 7 * 86_400_000 + 60_000).toISOString()), NOW)).toBe('warm');
  });

  // A resolved prospect must never show up as needing a call. Chasing someone
  // who already signed up is the fastest way to get the panel ignored.
  it('goes silent once the prospect is resolved', () => {
    expect(prospectFollowUpTier(at(daysAgo(30), 'converted'), NOW)).toBeNull();
    expect(prospectFollowUpTier(at(daysAgo(30), 'lost'), NOW)).toBeNull();
    expect(prospectFollowUpTier(at(daysAgo(30), 'contacted'), NOW)).toBe('cold');
  });

  // Clock skew, or an admin back-dating a visit. A negative age must not read
  // as maximally stale.
  it('treats a future visit as fresh, never cold', () => {
    expect(prospectFollowUpTier(at(new Date(NOW + 86_400_000).toISOString()), NOW)).toBe('fresh');
  });

  it('degrades to fresh on junk input rather than inventing urgency', () => {
    expect(prospectFollowUpTier(at(null), NOW)).toBe('fresh');
    expect(prospectFollowUpTier(at('not-a-date'), NOW)).toBe('fresh');
    expect(prospectFollowUpTier(null, NOW)).toBeNull();
    expect(prospectFollowUpTier(undefined, NOW)).toBeNull();
  });
});

// These two lists are mirrored by CHECK constraints in migration 0681. If the
// SQL and the client ever drift, the insert fails at the front desk with an
// opaque 400 — so pin them.
describe('prospect vocabularies match migration 0681', () => {
  it('pins the status list', () => {
    expect(PROSPECT_STATUSES).toEqual(['new', 'contacted', 'converted', 'lost']);
  });

  it('pins the source list', () => {
    expect(PROSPECT_SOURCES).toEqual([
      'first_free_class', 'guest_of_member', 'walk_in', 'event', 'other',
    ]);
  });
});
