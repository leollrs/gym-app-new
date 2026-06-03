/**
 * loadGymChurnScores — cheap, consistent per-member churn scores for a gym.
 *
 * Reads the nightly precompute (churn_risk_scores) written by the
 * compute-churn-scores edge function, which runs the SAME v3 model. We just map
 * the persisted row — the v3 score already bakes in the dormant override and the
 * insufficient-data grace, so there is NO read-time override anymore.
 *
 * Falls back to the live (v3) engine when the precompute is stale, missing, or
 * still v2 (i.e. written before the v3 edge function was deployed — detected by
 * the absence of the v3 `primary_driver`/`state` columns).
 *
 * Returns the same shape as fetchMembersWithChurnScores so Overview, Members,
 * and AdminChurn use it interchangeably and always agree.
 */

import { getRiskTier, buildExplanation } from './riskScoring.js';
import { fetchMembersWithChurnScores } from './retention.js';
import { selectAllRows, isMissingColumnError } from './batchedSelect.js';

const MS_PER_DAY = 86400000;
const FRESH_MS = 26 * MS_PER_DAY / 24;   // a little slack past 24h (cron is daily)
const MIN_COVERAGE = 0.5;                // < this fraction with a v3 row → recompute live

export async function loadGymChurnScores(gymId, supabase) {
  // ── 1. Members (gym-scoped, paginated) ──
  // churn_pause_until (migration 0509) may not be applied yet — selecting a
  // missing column 400s and would drop the whole page to the legacy fallback.
  // Try with it, retry without on a missing-column error (pause = frozen-only).
  const MEMBER_COLS_SAFE = 'id, full_name, username, phone_number, created_at, membership_started_at, gym_id, last_active_at, membership_status';
  const runMembers = (cols) => selectAllRows((from, to) =>
    supabase
      .from('profiles')
      .select(cols)
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .eq('imported_archived', false)
      // Keep IDENTICAL to compute-churn-scores edge fn + retention.js (allowlist) so every
      // member listed here also has a precompute row — the §4 fresh path assumes it.
      .in('membership_status', ['active', 'frozen'])
      .order('full_name', { ascending: true })
      .range(from, to));

  let { data: memberRows, error: membersError } = await runMembers(`${MEMBER_COLS_SAFE}, churn_pause_until`);
  if (membersError && isMissingColumnError(membersError)) {
    ({ data: memberRows, error: membersError } = await runMembers(MEMBER_COLS_SAFE));
  }

  if (membersError || !memberRows?.length) return [];

  // ── 2. Precomputed v3 scores (latest per member, last 7 days) ──
  const scoresSince = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
  const { data: scoreRows } = await selectAllRows((from, to) =>
    supabase
      .from('churn_risk_scores')
      .select('profile_id, score, risk_tier, key_signals, velocity, primary_driver, explanation, state, trend, metrics, computed_at')
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

  // A row counts as v3 only if it carries the v3 columns (primary_driver set).
  const v3Covered = memberRows.filter((m) => latest[m.id] && latest[m.id].primary_driver != null).length;
  const fresh = newest > 0
    && (Date.now() - newest) < FRESH_MS
    && v3Covered / memberRows.length >= MIN_COVERAGE;

  // ── 3. Stale / missing / pre-v3 precompute → live (v3) engine ──
  if (!fresh) return fetchMembersWithChurnScores(gymId, supabase);

  // ── 4. Fresh v3 precompute → light activity fetch for DISPLAY recency only ──
  const sixtyDaysAgo = new Date(Date.now() - 60 * MS_PER_DAY).toISOString();
  const RECENCY_CAP = 5000;
  const [{ data: checkInRows }, { data: sessionRows }] = await Promise.all([
    supabase.from('check_ins').select('profile_id, checked_in_at')
      .eq('gym_id', gymId).gte('checked_in_at', sixtyDaysAgo)
      .order('checked_in_at', { ascending: false }).limit(RECENCY_CAP),
    supabase.from('workout_sessions').select('profile_id, started_at')
      .eq('gym_id', gymId).gte('started_at', sixtyDaysAgo)
      .order('started_at', { ascending: false }).limit(RECENCY_CAP),
  ]);

  const lastCheckIn = {};
  (checkInRows || []).forEach((r) => { if (!lastCheckIn[r.profile_id]) lastCheckIn[r.profile_id] = r.checked_in_at; });
  const lastSession = {};
  (sessionRows || []).forEach((r) => { if (!lastSession[r.profile_id]) lastSession[r.profile_id] = r.started_at; });

  const now = Date.now();
  const scored = memberRows.map((m) => {
    const row = latest[m.id];
    const lastCheckInAt = lastCheckIn[m.id] ?? null;
    // Attendance-only recency (check-in / workout), NOT last_active_at — matches the scorer.
    const lastSeen = [lastCheckInAt, lastSession[m.id]].filter(Boolean).sort().pop() || null;
    const daysSinceLastActivity = lastSeen ? Math.floor((now - new Date(lastSeen).getTime()) / MS_PER_DAY) : null;
    const daysSinceLastCheckIn = lastCheckInAt ? (now - new Date(lastCheckInAt).getTime()) / MS_PER_DAY : null;

    // Pause is CURRENT state — apply at read time so a vacation hold set after the
    // last nightly run still suppresses the alert immediately.
    const isPaused = m.membership_status === 'frozen'
      || (m.churn_pause_until != null && new Date(m.churn_pause_until).getTime() > now);

    // Defensive: a scoreable (non-paused) member with no precompute row — e.g. created after
    // the last nightly run, or membership filters drifting out of sync with the edge fn —
    // must NOT crash the whole gym's churn view (reading row.score off undefined). Surface
    // them as not-yet-scored rather than a misleading "healthy 0".
    if (!row && !isPaused) {
      return {
        ...m,
        username: m.username || m.full_name,
        churnScore: 0,
        state: 'insufficient_data',
        riskTier: getRiskTier(0, 'insufficient_data'),
        tier: 'insufficient_data',
        keySignals: ['New member — not enough data yet'],
        keySignal: 'New member — not enough data yet',
        primaryDriver: 'new',
        explanation: buildExplanation('new', { daysSinceLastCheckIn, daysSinceLastActivity }),
        trend: 'stable',
        daysSinceLastActivity,
        daysSinceLastCheckIn,
        lastCheckInAt,
        lastActivityAt: lastSeen,
        velocity: 0,
        velocityTrend: 'stable',
        velocityLabel: '',
        _source: 'precompute',
      };
    }

    const churnScore = isPaused ? 0 : (Number(row.score) || 0);
    const state = isPaused ? 'paused' : (row.state || 'scored');
    const driver = isPaused ? 'paused' : (row.primary_driver || null);
    const keySignals = isPaused ? [] : (Array.isArray(row.key_signals) ? row.key_signals : []);

    return {
      ...m,
      username: m.username || m.full_name,
      churnScore,
      state,
      riskTier: getRiskTier(churnScore, state),
      tier: getRiskTier(churnScore, state).tier,
      keySignals,
      keySignal: keySignals[0] || 'Engagement looks healthy',
      primaryDriver: driver,
      // Localize from the driver (the edge fn's stored text is English-only). Pass the
      // persisted avgWeeklyVisits (metrics JSONB) so the attendance reason keeps its
      // "(was X×/wk)" clause — matching the live engine's wording exactly, no freshness drift.
      explanation: driver
        ? buildExplanation(driver, {
            daysSinceLastCheckIn, daysSinceLastActivity,
            avgWeeklyVisits: row?.metrics?.avgWeeklyVisits,
            accountAgeDays: m.created_at ? (now - new Date(m.created_at).getTime()) / MS_PER_DAY : null,
          })
        : (row?.explanation || ''),
      trend: isPaused ? 'stable' : (row?.trend || 'stable'),
      daysSinceLastActivity,
      daysSinceLastCheckIn,
      lastCheckInAt,
      lastActivityAt: lastSeen,
      velocity: row?.velocity ?? 0,
      velocityTrend: 'stable',
      velocityLabel: '',
      _source: 'precompute',
    };
  });

  return scored.sort((a, b) => b.churnScore - a.churnScore);
}
