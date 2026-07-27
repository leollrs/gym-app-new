import { supabase } from '../supabase.js';
import logger from '../logger.js';
import { selectInBatches, selectAllInBatches, selectAllRows } from '../churn/batchedSelect.js';

/**
 * Run a member-segment filter spec against the DB and return the matched
 * profiles, enriched with computed fields (`_workoutCount`,
 * `_lastWorkoutAt`, `_currentStreak`).
 *
 * Two-phase fetch:
 *   1. Pull profiles matching the simple column filters (joined dates,
 *      fitness_level, role).
 *   2. Apply post-query filters that need joins — workout count + last
 *      workout (from `workout_sessions`), churn tier (from
 *      `churn_risk_scores`), and referral status (from `referrals`).
 *
 * The 500-row limit on the profiles query is intentional: segments are a
 * targeting tool, not a full members export. If an admin needs more, they
 * narrow the filter spec.
 *
 * Shared between the segments list (counts), the detail panel (preview),
 * and the editor modal (live count).
 */
export async function applySegmentFilters(gymId, filters) {
  // `fitness_level` lives on `member_onboarding`, not `profiles` — we used to
  // select it directly which 400'd the whole segment preview. The fitness-level
  // filter is now applied as a post-query join below (same pattern as workouts
  // / churn-tier filters).
  // Rebuild the base query per page (Supabase builders aren't safely
  // re-runnable), then page the FULL matching roster. A plain .limit(500)
  // truncated the whole segment — campaign SEND, recipient COUNT, CSV export,
  // and "Message All" DM — to the first 500 members alphabetically.
  const buildQuery = (from, to) => {
    let q = supabase
      .from('profiles')
      .select('id, full_name, username, created_at, last_active_at, avatar_type, avatar_value, streak_cache(current_streak_days)')
      .eq('gym_id', gymId)
      .eq('role', 'member');
    if (filters.joined_after) q = q.gte('created_at', filters.joined_after);
    if (filters.joined_before) q = q.lte('created_at', filters.joined_before);
    // streak/fitness/workout filters are applied post-fetch below
    return q.order('full_name').range(from, to);
  };

  const { data: members, error } = await selectAllRows(buildQuery);
  if (error) {
    logger.error('applySegmentFilters: profiles query', error);
    return [];
  }

  let filtered = members || [];

  // Fitness-level post-filter via member_onboarding join.
  if (filters.fitness_level?.length) {
    const ALLOWED_LEVELS = ['beginner', 'intermediate', 'advanced'];
    const safe = filters.fitness_level.filter(l => ALLOWED_LEVELS.includes(l));
    if (safe.length && filtered.length) {
      const memberIds = filtered.map(m => m.id);
      const { data: onboarding } = await selectInBatches(
        (ids) => supabase
          .from('member_onboarding')
          .select('profile_id, fitness_level')
          .in('profile_id', ids)
          .in('fitness_level', safe),
        memberIds);
      const levelSet = new Set((onboarding || []).map(r => r.profile_id));
      filtered = filtered.filter(m => levelSet.has(m.id));
    }
  }

  // Post-query filters that need join data
  if (
    filters.last_workout_days_ago_gt != null ||
    filters.last_workout_days_ago_lt != null ||
    filters.workout_count_lt != null ||
    filters.workout_count_gt != null
  ) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      // selectInBatches only chunks the `.in()` list for URL length — it does NOT
      // page each chunk, and PostgREST caps every response at 1000 rows. So a
      // 200-member chunk with more than 1000 all-time sessions between them
      // returned an arbitrary, unordered subset: `_workoutCount` came out low and
      // `_lastWorkoutAt` was whatever session happened to survive the cut. That
      // feeds the "hasn't trained in N days" win-back segment, i.e. a real
      // SMS/email blast was going to the wrong members. selectAllInBatches pages
      // each chunk to completion; the (started_at desc, id asc) order is a stable
      // total order so OFFSET paging can't skip or duplicate a session.
      const { data: sessions } = await selectAllInBatches(
        (ids, lo, hi) => supabase
          .from('workout_sessions')
          .select('profile_id, started_at')
          .eq('gym_id', gymId)
          .eq('status', 'completed')
          .in('profile_id', ids)
          .order('started_at', { ascending: false })
          .order('id', { ascending: true })
          .range(lo, hi),
        memberIds);

      const sessionMap = {};
      const lastSessionMap = {};
      (sessions || []).forEach(s => {
        sessionMap[s.profile_id] = (sessionMap[s.profile_id] || 0) + 1;
        if (!lastSessionMap[s.profile_id] || s.started_at > lastSessionMap[s.profile_id]) {
          lastSessionMap[s.profile_id] = s.started_at;
        }
      });

      const now = Date.now();
      const MS_PER_DAY = 86400000;

      filtered = filtered.filter(m => {
        const count = sessionMap[m.id] || 0;
        const lastSession = lastSessionMap[m.id];
        const daysSinceWorkout = lastSession
          ? Math.floor((now - new Date(lastSession).getTime()) / MS_PER_DAY)
          : 9999;

        if (filters.last_workout_days_ago_gt != null && daysSinceWorkout <= filters.last_workout_days_ago_gt) return false;
        if (filters.last_workout_days_ago_lt != null && daysSinceWorkout >= filters.last_workout_days_ago_lt) return false;
        if (filters.workout_count_lt != null && count >= filters.workout_count_lt) return false;
        if (filters.workout_count_gt != null && count <= filters.workout_count_gt) return false;
        return true;
      });

      // Attach computed data
      filtered = filtered.map(m => ({
        ...m,
        _workoutCount: sessionMap[m.id] || 0,
        _lastWorkoutAt: lastSessionMap[m.id] || null,
        _currentStreak: m.streak_cache?.current_streak_days ?? m.streak_cache?.[0]?.current_streak_days ?? 0,
      }));
    } else {
      filtered = filtered.map(m => ({
        ...m,
        _currentStreak: m.streak_cache?.current_streak_days ?? m.streak_cache?.[0]?.current_streak_days ?? 0,
      }));
    }
  } else {
    filtered = filtered.map(m => ({
      ...m,
      _currentStreak: m.streak_cache?.current_streak_days ?? m.streak_cache?.[0]?.current_streak_days ?? 0,
    }));
  }

  // Streak filter — operates on `_currentStreak` which the workout block
  // above attaches to every member (from `streak_cache.current_streak_days`).
  // The editor modal exposes streak_lt/streak_gt inputs and two prebuilt
  // templates (Power Users, Consistent Trainers) rely on streak_gt, so this
  // block must stay or those segments silently return the wrong members.
  if (filters.streak_gt != null || filters.streak_lt != null) {
    filtered = filtered.filter(m => {
      const s = m._currentStreak ?? 0;
      if (filters.streak_gt != null && s <= filters.streak_gt) return false;
      if (filters.streak_lt != null && s >= filters.streak_lt) return false;
      return true;
    });
  }

  // Churn tier filter — matches a member's CURRENT tier, not any historical one.
  //
  // This was changed deliberately (owner decision, 2026-07-26). `churn_risk_scores`
  // holds one row per member per DAY, and the previous version filtered on
  // `.in('risk_tier', …)` server-side across ALL history — so a member who was
  // `critical` once, months ago, and has trained every day since, matched the
  // "critical" segment forever. On a churn product that segment drives real SMS and
  // email sends, so it was messaging recovered members with win-back copy while the
  // truncation (each 200-id chunk stopped at PostgREST's 1000 rows) simultaneously
  // dropped genuinely at-risk ones.
  //
  // Now: window to the last 7 days, take the NEWEST row per member, then compare
  // its tier. That is the same rule `loadGymChurnScores` uses, so a segment and the
  // tier badge shown next to the member in the admin table can no longer disagree.
  //
  // Why 7 days rather than all history: the nightly cron writes one row per member
  // per day, so 7 days is ~7 rows per member — a bounded read that still tolerates
  // several consecutive cron failures. Members with no score in the window simply
  // don't match a tier filter, which is correct: an unscored member has no tier.
  // The tier compare moved client-side because we need "newest row per member"
  // BEFORE testing the tier — filtering server-side would let a stale `critical`
  // row satisfy the query even when today's row says `low`.
  if (filters.churn_tier?.length) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      const churnSince = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data: churnRows } = await selectAllInBatches(
        (ids, lo, hi) => supabase
          .from('churn_risk_scores')
          .select('profile_id, risk_tier, computed_at')
          .eq('gym_id', gymId)
          .in('profile_id', ids)
          .gte('computed_at', churnSince)
          .order('computed_at', { ascending: false })
          .order('profile_id', { ascending: true })
          .range(lo, hi),
        memberIds);

      // Rows arrive newest-first, so the first one seen per member is their current
      // score. Later (older) rows for the same member are ignored.
      const latestTier = new Map();
      (churnRows || []).forEach((r) => {
        if (!latestTier.has(r.profile_id)) latestTier.set(r.profile_id, r.risk_tier);
      });
      const wanted = new Set(filters.churn_tier);
      filtered = filtered.filter(m => wanted.has(latestTier.get(m.id)));
    }
  }

  // Referral filter
  if (filters.has_referral === true || filters.has_referral === false) {
    const memberIds = filtered.map(m => m.id);
    if (memberIds.length) {
      // Paged per chunk: selectInBatches alone truncates a chunk at PostgREST's
      // 1000-row cap, and a gym running an active referral program passes that
      // easily — members past the cut fell out of `referrerSet`, so has_referral
      // segments silently mis-targeted both ways (true → too few, false → too many).
      const { data: referrals } = await selectAllInBatches(
        (ids, lo, hi) => supabase
          .from('referrals')
          .select('referrer_id')
          .eq('gym_id', gymId)
          .in('referrer_id', ids)
          .order('id', { ascending: true })
          .range(lo, hi),
        memberIds);

      const referrerSet = new Set((referrals || []).map(r => r.referrer_id));
      filtered = filtered.filter(m =>
        filters.has_referral ? referrerSet.has(m.id) : !referrerSet.has(m.id)
      );
    }
  }

  return filtered;
}
