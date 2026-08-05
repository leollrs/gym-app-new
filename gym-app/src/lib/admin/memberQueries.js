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

/**
 * Single-member loader for the `?member=<id>` deep link (Overview's morning
 * queue, activity feed and needs-attention card all navigate here).
 *
 * fetchMembers only returns `role='member'`, un-archived rows, one 200-row page
 * at a time. None of the surfaces that deep-link here apply those filters, so a
 * linked member can be legitimately absent from the loaded roster — without
 * this the link silently does nothing at all.
 *
 * Enriched with the same cold-start fallback fetchMembers uses so MemberDetail
 * gets the row shape it expects. Returns null when the member isn't in this gym.
 */
export async function fetchMemberById(gymId, memberId) {
  const sessionsSince = subDays(new Date(), 14).toISOString();
  const [profileRes, sessionsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, username, last_active_at, created_at, membership_started_at, admin_note, membership_status, membership_status_updated_at, qr_code_payload, qr_external_id, is_onboarded, checkin_photo_path')
      .eq('id', memberId).eq('gym_id', gymId).maybeSingle(),
    supabase
      .from('workout_sessions')
      .select('started_at')
      .eq('gym_id', gymId).eq('profile_id', memberId).eq('status', 'completed')
      .gte('started_at', sessionsSince)
      .order('started_at', { ascending: false }),
  ]);

  if (profileRes.error) { logger.error('AdminMembers: fetchMemberById:', profileRes.error); return null; }
  const m = profileRes.data;
  if (!m) return null;

  const sessions = sessionsRes.data || [];
  const recentWorkouts = sessions.length;
  const lastSessAt = sessions[0]?.started_at ?? null;
  const neverActive = !lastSessAt;
  const daysInactive = lastSessAt ? Math.floor((Date.now() - new Date(lastSessAt)) / 86400000) : null;
  const fallback = estimateChurnScoreFallback(daysInactive ?? 0, recentWorkouts, neverActive);

  const row = {
    ...m,
    recentWorkouts,
    lastSessionAt: lastSessAt,
    lastActivityAt: lastSessAt,
    score: fallback.score,
    risk_tier: fallback.risk_tier,
    state: fallback.state,
    key_signals: fallback.key_signals,
    explanation: null,
    primaryDriver: null,
    trend: 'stable',
    daysSinceLastActivity: daysInactive,
    daysSinceLastCheckIn: null,
    followup_sent_at: null,
    membership_status: m.membership_status ?? 'active',
    daysInactive,
    neverActive,
    checkin_photo_url: null,
  };

  try {
    const photoMap = await signCheckinPhotos([m.checkin_photo_path]);
    row.checkin_photo_url = m.checkin_photo_path ? (photoMap.get(m.checkin_photo_path) || null) : null;
  } catch (err) {
    logger.warn('AdminMembers: sign checkin photo:', err?.message);
  }

  return row;
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

// ── Prospects (mig 0681) ────────────────────────────────────────────────────
// Walk-ins, free-first-class guests and members' guests: the step of the funnel
// before an invite exists. Kept here beside the invite queries because the
// admin Members page renders all three from one place.

export const PROSPECT_STATUSES = ['new', 'contacted', 'converted', 'lost'];

export const PROSPECT_SOURCES = ['first_free_class', 'guest_of_member', 'walk_in', 'event', 'other'];

/**
 * Prospects for a gym, newest visit first, with the referring member's name
 * joined in — "who brought them" is the whole point of the row, so it must
 * never require a second round trip to render.
 */
export async function fetchProspects(gymId) {
  // Paginado con selectAllRows, igual que fetchMembers unas líneas más arriba y
  // por la misma razón que se documenta ahí: PostgREST tapa la respuesta en
  // 1000 filas independientemente de cualquier .limit(). Todo lo que cuelga de
  // esto agrega en cliente — los contadores por estado de ProspectsTab, la
  // insignia de la pestaña, el paginador — así que pasadas las 1000 fichas los
  // números salían mal y las más antiguas eran inalcanzables.
  const { data, error } = await withQueryTimeout(
    selectAllRows((lo, hi) => supabase
      .from('gym_prospects')
      .select(`
        id, full_name, phone, email, source, status, note, lost_reason,
        visited_at, created_at, converted_at, converted_profile_id,
        consent_contact_at, referred_by_profile_id,
        access_code, visit_count, last_visit_at, unreachable_at,
        referrer:referred_by_profile_id(id, full_name, avatar_url)
      `)
      .eq('gym_id', gymId)
      .order('visited_at', { ascending: false })
      .order('id', { ascending: true })
      .range(lo, hi)),
    10_000,
    'fetchProspects',
  );

  // Lanza en vez de devolver []. Tragarse el error hacía que una lectura rota
  // se dibujara como "Todavía no hay prospectos" — y "no hay ninguno" y "no se
  // pudo cargar" significan lo contrario. Con el throw, React Query expone
  // isError y la pestaña puede decir la verdad.
  if (error) {
    logger.error('AdminMembers: prospects:', error);
    throw error;
  }
  return data || [];
}

// A prospect goes cold fast. These are the windows the follow-up pill uses.
const PROSPECT_WARM_DAYS = 2;
const PROSPECT_COLD_DAYS = 7;

/**
 * How urgently an open prospect needs a follow-up, from the time since their
 * visit. Returns one of 'fresh' | 'warm' | 'cold', or null when the prospect
 * is already resolved (converted or lost) and no longer needs chasing.
 *
 * `now` is injectable so this stays a pure function under test.
 */
export function prospectFollowUpTier(prospect, now = Date.now()) {
  if (!prospect) return null;
  if (prospect.status === 'converted' || prospect.status === 'lost') return null;

  const visited = prospect.visited_at ? new Date(prospect.visited_at).getTime() : NaN;
  if (!Number.isFinite(visited)) return 'fresh';

  // Math.max guards a visit timestamp in the future (clock skew, or an admin
  // back-dating a row) from reading as maximally stale via a negative delta.
  const days = Math.max(0, (now - visited) / 86_400_000);
  if (days >= PROSPECT_COLD_DAYS) return 'cold';
  if (days >= PROSPECT_WARM_DAYS) return 'warm';
  return 'fresh';
}
