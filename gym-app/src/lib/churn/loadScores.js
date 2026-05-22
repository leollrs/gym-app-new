/**
 * loadGymChurnScores — the cheap, consistent way to get per-member churn
 * scores for a gym.
 *
 * Background: the live engine (fetchMembersWithChurnScores) runs ~18 queries
 * and scores every member in the browser on each page load. The
 * compute-churn-scores edge fn already computes the SAME v2 model nightly and
 * persists it to churn_risk_scores. So on a normal day we should just READ
 * that table instead of recomputing.
 *
 * The catch: the edge fn writes the raw weighted score, but the live engine
 * applies an inactivity override (never-active or 30+ days inactive → forced
 * to 95 / Critical) that the home, members, and churn pages rely on to agree.
 * So we re-apply that same override on top of the precomputed rows here.
 *
 * Freshness gate: if the precompute is missing or stale (cron hasn't run, or a
 * brand-new gym), fall back to the live (now batched) engine so nothing breaks
 * and a new gym still sees real numbers.
 *
 * Returns the same shape as fetchMembersWithChurnScores, so Overview and
 * AdminChurn can use it interchangeably and always agree with each other.
 */

import { getRiskTier } from './riskScoring.js';
import { fetchMembersWithChurnScores } from './retention.js';
import { selectAllRows } from './batchedSelect.js';

const MS_PER_DAY = 86400000;
// Cron runs daily; allow a little slack past 24h before considering it stale.
const FRESH_MS = 26 * MS_PER_DAY / 24;
// If fewer than this fraction of members have a precomputed row, treat the
// precompute as not trustworthy and recompute live.
const MIN_COVERAGE = 0.5;

export async function loadGymChurnScores(gymId, supabase) {
  // ── 1. Members (gym-scoped, no IN-list) ─────────────────────
  // Paginated: a gym past ~1000 members would otherwise be silently truncated
  // by PostgREST's default response cap, hiding the rest from churn entirely.
  const { data: memberRows, error: membersError } = await selectAllRows((from, to) =>
    supabase
      .from('profiles')
      .select('id, full_name, username, phone_number, created_at, membership_started_at, gym_id, last_active_at, membership_status')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .eq('imported_archived', false)
      .not('membership_status', 'in', '(cancelled,banned,deactivated)')
      .order('full_name', { ascending: true })
      .range(from, to));

  if (membersError || !memberRows?.length) return [];

  // ── 2. Precomputed scores (gym-scoped); keep the latest per member ──
  // Bounded to the last 7 days (cron runs daily, so the latest row is <1–2d
  // old) AND paginated — at 1 row/member this is >1000 rows past 1000 members.
  const scoresSince = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
  const { data: scoreRows } = await selectAllRows((from, to) =>
    supabase
      .from('churn_risk_scores')
      .select('profile_id, score, risk_tier, key_signals, velocity, computed_at')
      .eq('gym_id', gymId)
      .gte('computed_at', scoresSince)
      .order('computed_at', { ascending: false })
      .range(from, to));

  const latest = {};
  let newest = 0;
  (scoreRows || []).forEach((r) => {
    if (!latest[r.profile_id]) latest[r.profile_id] = r;
    const t = new Date(r.computed_at).getTime();
    if (t > newest) newest = t;
  });

  const covered = memberRows.filter((m) => latest[m.id]).length;
  const fresh = newest > 0
    && (Date.now() - newest) < FRESH_MS
    && covered / memberRows.length >= MIN_COVERAGE;

  // ── 3. Stale / missing precompute → live (batched) engine ───
  if (!fresh) return fetchMembersWithChurnScores(gymId, supabase);

  // ── 4. Fresh precompute → cheap activity fetch for the override ──
  // (gym-scoped, no IN-list — same reason the engine broke at ~390 members)
  const sixtyDaysAgo = new Date(Date.now() - 60 * MS_PER_DAY).toISOString();
  // These only refine recency on top of profiles.last_active_at (the primary,
  // always-maintained signal), so an explicit cap is fine — we take the most
  // recent N rows rather than risk PostgREST silently truncating at ~1000.
  const RECENCY_CAP = 5000;
  const [{ data: checkInRows }, { data: sessionRows }] = await Promise.all([
    supabase
      .from('check_ins')
      .select('profile_id, checked_in_at')
      .eq('gym_id', gymId)
      .gte('checked_in_at', sixtyDaysAgo)
      .order('checked_in_at', { ascending: false })
      .limit(RECENCY_CAP),
    supabase
      .from('workout_sessions')
      .select('profile_id, started_at, status')
      .eq('gym_id', gymId)
      .gte('started_at', sixtyDaysAgo)
      .order('started_at', { ascending: false })
      .limit(RECENCY_CAP),
  ]);

  const lastCheckIn = {};
  (checkInRows || []).forEach((r) => {
    if (!lastCheckIn[r.profile_id]) lastCheckIn[r.profile_id] = r.checked_in_at;
  });
  const lastSession = {};
  const hasCompletedSession = new Set();
  (sessionRows || []).forEach((r) => {
    if (r.status === 'completed') hasCompletedSession.add(r.profile_id);
    if (!lastSession[r.profile_id]) lastSession[r.profile_id] = r.started_at;
  });

  const now = Date.now();
  const scored = memberRows.map((m) => {
    const row = latest[m.id];
    const lastCheckInAt = lastCheckIn[m.id] ?? null;
    // ISO strings sort lexically == chronologically; pop() = most recent.
    const lastSeen = [m.last_active_at, lastCheckInAt, lastSession[m.id]]
      .filter(Boolean).sort().pop() || null;
    const daysSinceLastActivity = lastSeen
      ? Math.floor((now - new Date(lastSeen).getTime()) / MS_PER_DAY)
      : null;
    const daysSinceLastCheckIn = lastCheckInAt
      ? (now - new Date(lastCheckInAt).getTime()) / MS_PER_DAY
      : null;

    // ── Inactivity override — mirrors retention.js so tiers match ──
    const neverActive = !lastSeen && !hasCompletedSession.has(m.id);
    const longInactive = daysSinceLastActivity != null && daysSinceLastActivity >= 30;

    let churnScore = Number(row.score) || 0;
    let keySignals = Array.isArray(row.key_signals) ? row.key_signals : [];
    if (neverActive || longInactive) {
      churnScore = 95;
      keySignals = neverActive
        ? ['Never logged a workout']
        : [`No activity in ${daysSinceLastActivity}+ days`];
    }

    return {
      ...m,
      username: m.username || m.full_name,
      churnScore,
      riskTier: getRiskTier(churnScore),
      keySignals,
      keySignal: keySignals[0] || 'Engagement looks healthy',
      daysSinceLastActivity,
      daysSinceLastCheckIn,
      lastCheckInAt,
      velocity: row.velocity ?? 0,
      velocityTrend: 'stable',
      velocityLabel: '',
      _source: 'precompute',
    };
  });

  return scored.sort((a, b) => b.churnScore - a.churnScore);
}
