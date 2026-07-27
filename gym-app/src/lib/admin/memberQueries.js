import { subDays } from 'date-fns';
import { supabase } from '../supabase';
import logger from '../logger';
import { loadGymChurnScores, estimateChurnScoreFallback } from '../churnScore';
import { withQueryTimeout } from '../queryWithTimeout';
import { signCheckinPhotos } from '../checkinPhoto';
import { selectAllRows } from '../churn/batchedSelect';

export const MEMBERS_PAGE_SIZE = 200;

// churn_risk_scores is append-one-row-per-member-per-day (unique index on
// (profile_id, computed_at::date) — migration 0030). Reading "all history" for a
// gym is unbounded and PostgREST caps the response at 1000 rows regardless of
// any .limit() we pass, so we window to the last 7 days and keep the newest row
// per member — the exact rule loadGymChurnScores uses, so the follow-up flag on
// this table agrees with the score shown next to it.
const SCORE_WINDOW_DAYS = 7;

/**
 * Page-by-page member loader for the Admin → Members table. Pulls a 200-row
 * page of members from `profiles`, plus the supporting churn/follow-up/session
 * data, and stitches them into the row shape the table renders.
 *
 * Each returned row carries a churn score: server-computed when present in
 * `churn_risk_scores`, otherwise the client-side `estimateChurnScoreFallback`
 * so the UI never has empty bars for new gyms.
 */
/**
 * Real total member count for this gym — a header-only query, no rows returned.
 *
 * The Members page was showing `members.length`, i.e. however many rows had been
 * loaded so far. On a gym past one page that rendered "Members (200)", "200 total
 * members" and a "Total Members: 200" stat card, all wrong, and all of them
 * changed as the admin clicked Load more. Filters here MUST stay in sync with
 * the profiles query in fetchMembers below or the count won't match the list.
 */
export async function fetchMemberCount(gymId) {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false);
  if (error) { logger.error('AdminMembers: member count:', error); return null; }
  return count ?? null;
}

export async function fetchMembers(gymId, page = 0) {
  const from = page * MEMBERS_PAGE_SIZE;
  const to = from + MEMBERS_PAGE_SIZE - 1;
  // Cutoffs computed ONCE, outside the paging closures below. Re-evaluating
  // `new Date()` per page would inch the lower bound forward between requests,
  // shrinking the result set mid-scan and letting OFFSET paging skip a row at
  // the boundary.
  const scoresSince = subDays(new Date(), SCORE_WINDOW_DAYS).toISOString();
  const sessionsSince = subDays(new Date(), 14).toISOString();
  // Wrap the parallel batch in withQueryTimeout — if any one of these four
  // Supabase calls stalls (silent socket hang, not a real error), Promise.all
  // would wait forever and the admin page would freeze on TableSkeleton with
  // no recovery. Under load the slowest RPC here (fetchMembersWithChurnScores
  // on cold cache) is ~5-8s; the two paged reads below add a round trip per
  // 1000 rows, hence 25s rather than the old 15s.
  const [membersRes, followupRes, sessionsRes, scoredAll] = await withQueryTimeout(Promise.all([
    supabase.from('profiles').select('id, full_name, username, last_active_at, created_at, membership_started_at, admin_note, membership_status, membership_status_updated_at, qr_code_payload, qr_external_id, is_onboarded, checkin_photo_path').eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false).order('last_active_at', { ascending: false, nullsFirst: false }).range(from, to),
    // Follow-up flags. Was an unbounded all-history read: PostgREST returned the
    // newest 1000 rows only, which for a 1000+ member gym is less than a single
    // day of scores — every member past the cut lost their "followed up" badge.
    // Now: 7-day window, newest-first with a (computed_at, profile_id) stable
    // tiebreaker so OFFSET paging can't skip/duplicate, first row per member wins.
    selectAllRows((lo, hi) => supabase.from('churn_risk_scores').select('profile_id, followup_sent_at, computed_at').eq('gym_id', gymId).gte('computed_at', scoresSince).order('computed_at', { ascending: false }).order('profile_id', { ascending: true }).range(lo, hi)),
    // 14-day gym-wide sessions → `recentWorkouts` + `lastSessionAt` per member.
    // `.limit(5000)` was a false safeguard (PostgREST caps at 1000) AND the query
    // had no .order(), so the 1000 rows kept were an arbitrary slice: a 300-member
    // gym logging ~3,600 sessions a fortnight showed roughly a quarter of each
    // member's real count, and "last workout" could be any session, not the last.
    selectAllRows((lo, hi) => supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', sessionsSince).order('started_at', { ascending: false }).order('id', { ascending: true }).range(lo, hi)),
    loadGymChurnScores(gymId, supabase).catch((err) => {
      logger.error('AdminMembers: loadGymChurnScores:', err);
      return [];
    }),
  ]), 25_000, `fetchMembers:page${page}`);

  if (membersRes.error) logger.error('AdminMembers: members:', membersRes.error);
  if (followupRes.error) logger.error('AdminMembers: churn followup:', followupRes.error);
  if (sessionsRes.error) logger.error('AdminMembers: sessions:', sessionsRes.error);

  const scoredMap = Object.fromEntries((scoredAll || []).map((s) => [s.id, s]));
  // Rows arrive newest-first (ordered above), so the first row we see for a
  // member IS their latest score — no per-row Date parsing/comparison needed.
  const followupMap = {};
  (followupRes.data || []).forEach((row) => {
    if (!followupMap[row.profile_id]) followupMap[row.profile_id] = row;
  });

  const sessionsLast14 = {};
  const lastSessionAt = {};
  (sessionsRes.data || []).forEach(s => {
    sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
    if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) lastSessionAt[s.profile_id] = s.started_at;
  });

  const nowMs = Date.now();
  const rows = (membersRes.data || []).map(m => {
    const scored = scoredMap[m.id];
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const lastSessAt = lastSessionAt[m.id] ?? null;

    // Recency reflects REAL gym activity (last check-in / workout) from the churn
    // engine — NEVER last_active_at, an app-open timestamp set at signup/import that
    // made never-attended members read "active 28d ago / Low Risk". When the member
    // was never scored (cold start) fall back to the 14-day session window only.
    const lastActivityAt = scored?.lastActivityAt ?? lastSessAt;
    const daysInactive = scored && scored.daysSinceLastActivity != null
      ? Math.floor(scored.daysSinceLastActivity)
      : (lastActivityAt ? Math.floor((nowMs - new Date(lastActivityAt)) / 86400000) : null);
    // "Never active" = no attendance footprint at all (no check-in, no workout) —
    // whether that reads as insufficient_data or the flagged never_activated risk.
    const neverActive = scored
      ? (scored.state === 'insufficient_data' || scored.primaryDriver === 'never_activated')
      : !lastSessAt;

    const fallback = !scored ? estimateChurnScoreFallback(daysInactive ?? 0, recentWorkouts, neverActive) : null;
    const follow = followupMap[m.id];

    return {
      ...m,
      recentWorkouts,
      lastSessionAt: lastSessAt,
      lastActivityAt,
      score: scored?.churnScore ?? fallback.score,
      risk_tier: scored?.riskTier?.tier ?? fallback.risk_tier,
      // state drives the honest badge (insufficient_data / paused / churned vs scored).
      // Dropping it here is what made the modal render score-0 as "Low Risk".
      state: scored?.state ?? fallback?.state ?? 'scored',
      key_signals: scored?.keySignals ?? fallback.key_signals,
      explanation: scored?.explanation ?? null,
      primaryDriver: scored?.primaryDriver ?? null,
      trend: scored?.trend ?? 'stable',
      daysSinceLastActivity: scored?.daysSinceLastActivity ?? null,
      daysSinceLastCheckIn: scored?.daysSinceLastCheckIn ?? null,
      followup_sent_at: follow?.followup_sent_at ?? null,
      membership_status: m.membership_status ?? 'active',
      daysInactive,
      neverActive,
    };
  });

  // Sign staff check-in reference photos for this page in one batched call so
  // the roster can show faces. Members without one fall back to initials.
  try {
    const photoMap = await signCheckinPhotos(rows.map(r => r.checkin_photo_path));
    rows.forEach(r => { r.checkin_photo_url = r.checkin_photo_path ? (photoMap.get(r.checkin_photo_path) || null) : null; });
  } catch (err) {
    logger.warn('AdminMembers: sign checkin photos:', err?.message);
  }

  return rows;
}

export async function fetchAllInvites(gymId) {
  const { data, error } = await withQueryTimeout(
    supabase
      .from('gym_invites')
      .select('id, member_name, phone, email, invite_code, created_at, expires_at, used_by, used_at')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false }),
    10_000,
    'fetchAllInvites',
  );

  if (error) logger.error('AdminMembers: invites:', error);
  return data || [];
}

export function getInviteStatus(invite) {
  if (invite.used_by) return 'claimed';
  const now = new Date();
  const expiresAt = invite.expires_at ? new Date(invite.expires_at) : null;
  if (expiresAt && expiresAt < now) return 'expired';
  return 'pending';
}
