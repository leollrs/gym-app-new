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
import { selectInBatches } from './batchedSelect.js';

const MS_PER_DAY = 86400000;

export async function fetchChurnFallback(gymId, supabase) {
  const now = new Date();
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [membersRes, checkInsRes, sessionsRes] = await withQueryTimeout(Promise.all([
    supabase.from('profiles').select('id, full_name, username, created_at').eq('gym_id', gymId).eq('role', 'member').eq('imported_archived', false),
    supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', thirtyDaysAgo).order('checked_in_at', { ascending: false }),
    supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', fourteenDaysAgo),
  ]), 15_000, 'fetchChurnFallback');

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

    const fb = estimateChurnScoreFallback(daysInactive, recentWorkouts, neverActive);
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

  const [sessionsRes, checkInsRes] = await Promise.all([
    selectInBatches(
      (ids) => supabase.from('workout_sessions')
        .select('profile_id, started_at')
        .eq('gym_id', gymId).eq('status', 'completed')
        .in('profile_id', ids)
        .order('started_at', { ascending: true }),
      memberIds),
    selectInBatches(
      (ids) => supabase.from('check_ins')
        .select('profile_id, checked_in_at')
        .eq('gym_id', gymId)
        .in('profile_id', ids)
        .order('checked_in_at', { ascending: true }),
      memberIds),
  ]);

  const sessions = sessionsRes.data || [];
  const checkIns = checkInsRes.data || [];
  const autoDetected = [];
  const toUpdate = [];

  const updated = winBackAttempts.map(a => {
    if (a.outcome !== 'pending' && a.outcome !== 'no_response') return a;

    const memberSessions = sessions.filter(s => s.profile_id === a.user_id && new Date(s.started_at) > new Date(a.created_at));
    const memberCheckIns = checkIns.filter(c => c.profile_id === a.user_id && new Date(c.checked_in_at) > new Date(a.created_at));

    if (memberSessions.length > 0 || memberCheckIns.length > 0) {
      const earliestReturn = [...memberSessions.map(s => s.started_at), ...memberCheckIns.map(c => c.checked_in_at)]
        .sort((x, y) => new Date(x) - new Date(y))[0];

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
