/**
 * Per-recipient stat fetcher for Outreach designer-template merge tokens.
 *
 * The Outreach broadcast pipeline already personalizes `{{first_name}}` and the
 * gym-level constants. The designer emails additionally carry per-member
 * tokens — streak_count, workout_count, days_inactive — that need real values
 * substituted at send time.
 *
 * We only fetch the stats a particular send actually references (detected via
 * `tokensNeeded`). Queries are batched through `selectInBatches` to stay under
 * the PostgREST querystring limit on large audiences.
 *
 *   const needed = tokensNeeded(subject + body + html);
 *   const stats  = await fetchMemberStats(gymId, recipientIds, needed);
 *   stats[memberId] === { streak_count, workout_count, days_inactive }
 */

import { supabase } from '../supabase';
import { selectInBatches } from '../churn/batchedSelect.js';
import logger from '../logger';

const STAT_TOKENS = ['streak_count', 'workout_count', 'days_inactive'];
const MS_PER_DAY = 86400000;

/** Which stat tokens appear anywhere in the supplied strings. */
export function tokensNeeded(...strings) {
  const blob = strings.filter(Boolean).join('\n');
  return STAT_TOKENS.filter((t) => blob.includes(`{{${t}}}`));
}

/**
 * Returns `{ [profileId]: { streak_count, workout_count, days_inactive } }` for
 * every recipient. Missing data falls back to '0' / '—' so substituted emails
 * never render with a raw token visible.
 */
export async function fetchMemberStats(gymId, recipientIds, needed = STAT_TOKENS) {
  const out = {};
  for (const id of recipientIds) out[id] = { streak_count: '0', workout_count: '0', days_inactive: '—' };
  if (!gymId || !recipientIds?.length || !needed?.length) return out;

  const wantStreak = needed.includes('streak_count');
  const wantDays = needed.includes('days_inactive');
  const wantWorkouts = needed.includes('workout_count');

  // streak_count ← streak_cache.current_streak_days (cheap, gym-scoped).
  if (wantStreak) {
    try {
      const { data } = await selectInBatches(
        (ids) => supabase
          .from('streak_cache')
          .select('profile_id, current_streak_days')
          .eq('gym_id', gymId)
          .in('profile_id', ids),
        recipientIds,
      );
      for (const r of (data || [])) {
        if (out[r.profile_id]) out[r.profile_id].streak_count = String(r.current_streak_days ?? 0);
      }
    } catch (err) { logger.warn('outreach stats: streak_cache failed', err); }
  }

  // days_inactive ← profiles.last_active_at (also cheap).
  if (wantDays) {
    try {
      const { data } = await selectInBatches(
        (ids) => supabase.from('profiles').select('id, last_active_at').in('id', ids),
        recipientIds,
      );
      const now = Date.now();
      for (const r of (data || [])) {
        if (!out[r.id]) continue;
        if (r.last_active_at) {
          const d = Math.max(0, Math.floor((now - new Date(r.last_active_at).getTime()) / MS_PER_DAY));
          out[r.id].days_inactive = String(d);
        }
      }
    } catch (err) { logger.warn('outreach stats: last_active_at failed', err); }
  }

  // workout_count ← count(workout_sessions WHERE status='completed') grouped per
  // profile. PostgREST has no GROUP BY, so we fetch profile_id rows in batches
  // and tally client-side. Heavier than the other two — fine for any reasonable
  // audience; the admin opted into rich personalization by picking these
  // designs, and Outreach is rate-limited by recipient cardinality anyway.
  if (wantWorkouts) {
    try {
      const { data } = await selectInBatches(
        (ids) => supabase
          .from('workout_sessions')
          .select('profile_id')
          .eq('status', 'completed')
          .in('profile_id', ids),
        recipientIds,
      );
      const tally = new Map();
      for (const r of (data || [])) tally.set(r.profile_id, (tally.get(r.profile_id) || 0) + 1);
      for (const id of recipientIds) {
        if (out[id]) out[id].workout_count = String(tally.get(id) || 0);
      }
    } catch (err) { logger.warn('outreach stats: workout count failed', err); }
  }

  return out;
}
