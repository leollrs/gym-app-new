/**
 * Admin-facing churn data queries.
 *
 * These wrap the v2 churn pipeline (`fetchMembersWithChurnScores`) with the
 * fallback + post-processing the AdminChurn page needs:
 *
 *  - `fetchChurnFallback`: when the v2 pipeline returns nothing (pre-compute
 *    cron hasn't run, or the table is empty for this gym), we build a
 *    full member list with churn scores client-side using the same
 *    `estimateChurnScoreFallback` thresholds. Returns shape mirrors what
 *    the v2 pipeline produces so the AdminChurn UI doesn't care which
 *    source it came from.
 *
 *  - `autoDetectReturns`: scans `pending` and `no_response` win-back
 *    attempts and flips any whose member has logged a session or check-in
 *    after the attempt was created. Writes are best-effort with
 *    Promise.allSettled — partial failures are logged but don't bubble.
 *
 * Both take the supabase client as an arg (mirrors `fetchMembersWithChurnScores`)
 * so call sites stay explicit about which client is used.
 */

import { subDays } from 'date-fns';
import logger from '../logger.js';
import { estimateChurnScoreFallback } from './riskScoring.js';
import { withQueryTimeout } from '../queryWithTimeout.js';
import { selectAllRows, selectAllInBatches } from './batchedSelect.js';

const MS_PER_DAY = 86400000;

export async function fetchChurnFallback(gymId, supabase) {
  const now = new Date();
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  // All three reads MUST be paged. This is the cold-start path — the first churn
  // screen a brand-new gym ever sees, before the nightly precompute has run — and all
  // three were unbounded single requests. PostgREST caps EVERY response at 1000 rows
  // on this project (max_rows=1000), so:
  //   • profiles  → only the first 1000 members existed at all; the rest never
  //                 appeared in the list, at any risk level.
  //   • check_ins → 30 days ordered newest-first truncates to ~2.6 days at a busy
  //                 gym, so lastCheckInMap was empty for anyone quieter than that and
  //                 they scored as `neverActive` — the fallback estimator's most
  //                 severe bucket — regardless of a long, healthy history.
  //   • sessions  → recentWorkouts undercounted, pushing scores further up.
  // Net effect on a cold-start gym: a truncated member list where the members who DID
  // appear were scored against fabricated inactivity.
  //
  // Each query carries a total order (timestamp + unique `id`) — paging a
  // non-deterministic order can duplicate or drop rows across a page boundary.
  //
  // Timeout raised 15s → 45s: paging turns each of these from one request into up to a
  // dozen sequential round trips, and the old ceiling would now fire on a slow
  // connection and blank the page instead of merely being slower.
  const [membersRes, checkInsRes, sessionsRes] = await withQueryTimeout(Promise.all([
    selectAllRows((from, to) => supabase.from('profiles').select('id, full_name, username, created_at').eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false).order('id', { ascending: true }).range(from, to)),
    selectAllRows((from, to) => supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', thirtyDaysAgo).order('checked_in_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
    selectAllRows((from, to) => supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', fourteenDaysAgo).order('started_at', { ascending: false }).order('id', { ascending: true }).range(from, to)),
  ]), 45_000, 'fetchChurnFallback');

  const memberRows = membersRes.data || [];
  logger.debug('[ChurnFallback] gymId:', gymId, 'membersRes.error:', membersRes.error, 'memberRows:', memberRows.length);
  if (!memberRows.length) return [];

  const lastCheckInMap = {};
  (checkInsRes.data || []).forEach(r => { if (!lastCheckInMap[r.profile_id]) lastCheckInMap[r.profile_id] = r.checked_in_at; });
  const sessionsLast14 = {};
  (sessionsRes.data || []).forEach(s => { sessionsLast14[s.profile_id] = (sessionsLast14[s.profile_id] || 0) + 1; });

  const nowMs = Date.now();
  return memberRows.map(m => {
    const lastCheckIn = lastCheckInMap[m.id] ?? null;
    const lastActive = lastCheckIn ?? m.created_at;
    const daysInactive = Math.floor((nowMs - new Date(lastActive)) / MS_PER_DAY);
    const recentWorkouts = sessionsLast14[m.id] ?? 0;
    const neverActive = !lastCheckIn && recentWorkouts === 0;
    const tenureMonths = (nowMs - new Date(m.created_at)) / (MS_PER_DAY * 30.44);
    const daysSinceLastCheckIn = lastCheckIn ? (nowMs - new Date(lastCheckIn)) / MS_PER_DAY : null;

    const fb = estimateChurnScoreFallback(daysInactive, recentWorkouts, neverActive, tenureMonths * 30.44);
    // AdminChurn surfaces a per-member status string in the list view, so we
    // backfill a "healthy" signal when the engine produces no key signals.
    const keySignals = fb.key_signals.length ? fb.key_signals : ['Engagement looks healthy'];

    return {
      ...m,
      username: m.username || m.full_name,
      churnScore: fb.score,
      riskTier: fb.risk_tier,
      keySignals,
      keySignal: keySignals[0],
      daysSinceLastCheckIn,
      lastCheckInAt: lastCheckIn,
      tenureMonths,
      velocityTrend: 'stable',
      velocityLabel: 'Not enough history',
    };
  }).sort((a, b) => b.churnScore - a.churnScore);
}

export async function autoDetectReturns(winBackAttempts, gymId, supabase) {
  const pending = winBackAttempts.filter(a => a.outcome === 'pending' || a.outcome === 'no_response');
  if (!pending.length) return { attempts: winBackAttempts, autoDetected: [] };

  const memberIds = [...new Set(pending.map(a => a.user_id))];

  // Only rows AFTER the oldest still-open attempt can ever satisfy the
  // `activity > attempt.created_at` test below, so ask the DB for exactly that window
  // instead of every session/check-in a member has ever had. Identical result set for
  // the comparison, typically weeks of rows instead of years.
  const oldestAttemptMs = pending.reduce((min, a) => {
    const t = new Date(a.created_at).getTime();
    return Number.isFinite(t) && t < min ? t : min;
  }, Infinity);
  const since = Number.isFinite(oldestAttemptMs) ? new Date(oldestAttemptMs).toISOString() : null;
  const sinceFilter = (q, col) => (since ? q.gt(col, since) : q);

  // selectAllInBatches, not selectInBatches: the latter chunks the id list for URL
  // length but does NOT page a chunk, so each 200-member chunk truncated at
  // PostgREST's 1000-row cap. Ordered ASCENDING, that kept the OLDEST 1000 rows —
  // precisely the wrong end for "did this member come back AFTER we contacted them?".
  // Win-back attempts at a busy gym therefore stayed stuck on `pending` even when the
  // member had already returned, so the outreach report under-counted its own wins.
  const [sessionsRes, checkInsRes] = await Promise.all([
    selectAllInBatches(
      (ids, from, to) => sinceFilter(supabase.from('workout_sessions')
        .select('profile_id, started_at')
        .eq('gym_id', gymId).eq('status', 'completed')
        .in('profile_id', ids), 'started_at')
        .order('started_at', { ascending: true }).order('id', { ascending: true })
        .range(from, to),
      memberIds),
    selectAllInBatches(
      (ids, from, to) => sinceFilter(supabase.from('check_ins')
        .select('profile_id, checked_in_at')
        .eq('gym_id', gymId)
        .in('profile_id', ids), 'checked_in_at')
        .order('checked_in_at', { ascending: true }).order('id', { ascending: true })
        .range(from, to),
      memberIds),
  ]);

  const sessions = sessionsRes.data || [];
  const checkIns = checkInsRes.data || [];
  const autoDetected = [];
  const toUpdate = [];

  // Group ONCE per member, ascending. The previous shape re-filtered the ENTIRE
  // sessions array and the ENTIRE check-ins array inside the per-attempt map —
  // O(attempts × rows), with two Date allocations per element inspected. That was
  // survivable only because the reads above were silently truncated to 1000 rows;
  // now that they are fully paged it would scale with the gym's whole activity log.
  const activityByMember = new Map();   // profile_id → [{ t: epochMs, iso }] ascending
  const push = (id, iso) => {
    if (!iso) return;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return;
    let arr = activityByMember.get(id);
    if (!arr) activityByMember.set(id, (arr = []));
    arr.push({ t, iso });
  };
  sessions.forEach(s => push(s.profile_id, s.started_at));
  checkIns.forEach(c => push(c.profile_id, c.checked_in_at));
  // Each list is two already-sorted runs concatenated; sort merges them cheaply.
  activityByMember.forEach(arr => arr.sort((x, y) => x.t - y.t));

  const updated = winBackAttempts.map(a => {
    if (a.outcome !== 'pending' && a.outcome !== 'no_response') return a;

    const times = activityByMember.get(a.user_id);
    if (!times) return a;

    // Ascending, so the first entry past the attempt IS the earliest return. Scans
    // only this member's own rows, and stops at the first hit.
    const attemptMs = new Date(a.created_at).getTime();
    let earliestReturn = null;
    for (let i = 0; i < times.length; i++) {
      if (times[i].t > attemptMs) { earliestReturn = times[i].iso; break; }
    }

    if (earliestReturn) {
      toUpdate.push(a.id);
      autoDetected.push({ attemptId: a.id, memberId: a.user_id, returnedAt: earliestReturn });
      return { ...a, outcome: 'returned', _autoDetected: true, _returnedAt: earliestReturn };
    }
    return a;
  });

  if (toUpdate.length > 0) {
    try {
      const results = await Promise.allSettled(toUpdate.map(id =>
        supabase.from('win_back_attempts').update({ outcome: 'returned' }).eq('id', id).eq('gym_id', gymId).then(res => {
          if (res.error) throw res.error;
          return res;
        })
      ));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        logger.error(`Auto-detect returns: ${failed} of ${toUpdate.length} updates failed`);
      }
    } catch (err) {
      logger.error('Auto-detect returns: batch update failed', err);
    }
  }

  return { attempts: updated, autoDetected };
}
