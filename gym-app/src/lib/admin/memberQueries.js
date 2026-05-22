import { subDays } from 'date-fns';
import { supabase } from '../supabase';
import logger from '../logger';
import { loadGymChurnScores, estimateChurnScoreFallback } from '../churnScore';
import { withQueryTimeout } from '../queryWithTimeout';

export const MEMBERS_PAGE_SIZE = 200;

/**
 * Page-by-page member loader for the Admin → Members table. Pulls a 200-row
 * page of members from `profiles`, plus the supporting churn/follow-up/session
 * data, and stitches them into the row shape the table renders.
 *
 * Each returned row carries a churn score: server-computed when present in
 * `churn_risk_scores`, otherwise the client-side `estimateChurnScoreFallback`
 * so the UI never has empty bars for new gyms.
 */
export async function fetchMembers(gymId, page = 0) {
  const from = page * MEMBERS_PAGE_SIZE;
  const to = from + MEMBERS_PAGE_SIZE - 1;
  // Wrap the parallel batch in withQueryTimeout — if any one of these four
  // Supabase calls stalls (silent socket hang, not a real error), Promise.all
  // would wait forever and the admin page would freeze on TableSkeleton with
  // no recovery. 15s is generous for a paged read; under load the slowest
  // RPC here (fetchMembersWithChurnScores on cold cache) is ~5-8s.
  const [membersRes, followupRes, sessionsRes, scoredAll] = await withQueryTimeout(Promise.all([
    supabase.from('profiles').select('id, full_name, username, last_active_at, created_at, membership_started_at, admin_note, membership_status, membership_status_updated_at, qr_code_payload, qr_external_id, is_onboarded').eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false).order('last_active_at', { ascending: false, nullsFirst: false }).range(from, to),
    supabase.from('churn_risk_scores').select('profile_id, followup_sent_at, computed_at').eq('gym_id', gymId).order('computed_at', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', subDays(new Date(), 14).toISOString()).limit(5000),
    loadGymChurnScores(gymId, supabase).catch((err) => {
      logger.error('AdminMembers: loadGymChurnScores:', err);
      return [];
    }),
  ]), 15_000, `fetchMembers:page${page}`);

  if (membersRes.error) logger.error('AdminMembers: members:', membersRes.error);
  if (followupRes.error) logger.error('AdminMembers: churn followup:', followupRes.error);
  if (sessionsRes.error) logger.error('AdminMembers: sessions:', sessionsRes.error);

  const scoredMap = Object.fromEntries((scoredAll || []).map((s) => [s.id, s]));
  const followupMap = {};
  (followupRes.data || []).forEach((row) => {
    const prev = followupMap[row.profile_id];
    if (!prev || new Date(row.computed_at) > new Date(prev.computed_at)) followupMap[row.profile_id] = row;
  });

  const sessionsLast14 = {};
  const lastSessionAt = {};
  (sessionsRes.data || []).forEach(s => {
    sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1;
    if (!lastSessionAt[s.profile_id] || s.started_at > lastSessionAt[s.profile_id]) lastSessionAt[s.profile_id] = s.started_at;
  });

  const nowMs = Date.now();
  return (membersRes.data || []).map(m => {
    const scored = scoredMap[m.id];
    const effectiveLast = m.last_active_at ?? lastSessionAt[m.id] ?? m.created_at;
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const daysInactive = Math.floor((nowMs - new Date(effectiveLast)) / 86400000);
    const neverActive = !m.last_active_at && !lastSessionAt[m.id];

    const fallback = !scored ? estimateChurnScoreFallback(daysInactive, recentWorkouts, neverActive) : null;
    const follow = followupMap[m.id];

    return {
      ...m,
      recentWorkouts,
      lastSessionAt: lastSessionAt[m.id] ?? null,
      score: scored?.churnScore ?? fallback.score,
      risk_tier: scored?.riskTier?.tier ?? fallback.risk_tier,
      key_signals: scored?.keySignals ?? fallback.key_signals,
      followup_sent_at: follow?.followup_sent_at ?? null,
      membership_status: m.membership_status ?? 'active',
      daysInactive,
      neverActive,
    };
  });
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
