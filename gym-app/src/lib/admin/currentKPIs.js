/**
 * Computes the six KPI metrics shown on the Admin → Analytics KPI cards
 * from raw tables. Used to (a) display "current vs target" on each card
 * and (b) feed the realistic-target advisor (`realisticTargets.js`) so
 * suggestions are anchored on actual gym performance, not aspiration.
 *
 * Definitions match the existing analytics charts to keep numbers
 * consistent across the page:
 *   - retention_rate: BEHAVIORAL retention — of "established" members
 *     (joined > 30 days ago), the % who logged a completed workout in
 *     the last 30 days. This replaced the old status-snapshot version
 *     ("% not currently cancelled/banned"), which systematically
 *     OVERSTATED retention: it applied today's membership_status to
 *     historical members and ignored that cancelled rows are often
 *     deleted rather than flagged. The behavioral measure asks the real
 *     question — "are members who've been here a while still showing
 *     up?" — and pairs with RetentionChart's pooled survival curve.
 *   - new_members: count of members joined this calendar month.
 *   - active_rate: % of ALL members with a completed workout in the last
 *     30 days (includes brand-new members — that's the difference from
 *     retention, which only counts established members).
 *   - avg_workouts: completed workouts in the last 30 days divided by
 *     total member count — a per-member training frequency proxy.
 *   - checkin_rate: avg daily check-ins / total members. Reads as "what
 *     fraction of the gym walks in on a typical day."
 *   - churn_rate: 100 - retention_rate. Same window as retention.
 */
import { startOfMonth, subDays } from 'date-fns';
import { supabase } from '../supabase';
import { withQueryTimeout } from '../queryWithTimeout';

export async function fetchCurrentKPIs(gymId) {
  if (!gymId) return null;

  const now = new Date();
  const monthStartIso = startOfMonth(now).toISOString();
  const thirtyDaysAgoIso = subDays(now, 30).toISOString();

  const [profilesRes, sessionsRes, checkInsRes] = await withQueryTimeout(Promise.all([
    supabase
      .from('profiles')
      .select('id, created_at, membership_status')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      // Imported-archived members are history-only — they feed the
      // retention diagnostic but must never appear in live KPIs, or
      // ex-members from years ago would show up as cancelled/churned
      // every month forever.
      .eq('imported_archived', false)
      .limit(5000),
    supabase
      .from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId)
      .eq('status', 'completed')
      .gte('started_at', thirtyDaysAgoIso)
      .limit(5000),
    supabase
      .from('check_ins')
      .select('checked_in_at')
      .eq('gym_id', gymId)
      .gte('checked_in_at', thirtyDaysAgoIso)
      .limit(5000),
  ]), 12_000, 'fetchCurrentKPIs');

  if (profilesRes.error) throw profilesRes.error;

  const members = profilesRes.data || [];
  const sessions = sessionsRes.data || [];
  const checkIns = checkInsRes.data || [];

  const totalMembers = members.length;
  // Defensive: a gym with zero members would produce divide-by-zero NaNs
  // that would then propagate into the realism check. Return null KPIs so
  // the card falls back to industry-default suggestions instead.
  if (totalMembers === 0) {
    return {
      retention_rate: null,
      new_members: 0,
      active_rate: null,
      avg_workouts: null,
      checkin_rate: null,
      churn_rate: null,
    };
  }

  // ── active_rate (all members) ──────────────────────────────────────
  const activeIds = new Set(sessions.map((s) => s.profile_id));
  const activeRate = Math.round((activeIds.size / totalMembers) * 100);

  // ── retention_rate (behavioral, established members) ───────────────
  // Of members who joined MORE than 30 days ago, what % logged a workout
  // in the last 30 days. Reuses `sessions` (already = completed, last 30d)
  // and `activeIds`. Behavioral, not status-based — see the file header.
  const establishedMembers = members.filter((m) => m.created_at < thirtyDaysAgoIso);
  const retainedEstablished = establishedMembers.filter((m) => activeIds.has(m.id)).length;
  const retentionRate = establishedMembers.length > 0
    ? Math.round((retainedEstablished / establishedMembers.length) * 100)
    : null;

  // ── new_members ────────────────────────────────────────────────────
  const newMembersThisMonth = members.filter((m) => m.created_at >= monthStartIso).length;

  // ── avg_workouts (per member, last 30d) ────────────────────────────
  const avgWorkouts = Math.round((sessions.length / totalMembers) * 10) / 10;

  // ── checkin_rate ───────────────────────────────────────────────────
  // Average daily check-ins as a fraction of total members. ~30 days of
  // data; if the gym only has a few days of history (brand-new), fall back
  // to the actual day count so the rate isn't artificially diluted.
  const daySet = new Set(checkIns.map((c) => c.checked_in_at.slice(0, 10)));
  const daySpan = Math.max(1, Math.min(30, daySet.size || 30));
  const avgDailyCheckins = checkIns.length / daySpan;
  const checkinRate = Math.round((avgDailyCheckins / totalMembers) * 100);

  // ── churn_rate ─────────────────────────────────────────────────────
  const churnRate = retentionRate != null ? 100 - retentionRate : null;

  return {
    retention_rate: retentionRate,
    new_members: newMembersThisMonth,
    active_rate: activeRate,
    avg_workouts: avgWorkouts,
    checkin_rate: checkinRate,
    churn_rate: churnRate,
  };
}
