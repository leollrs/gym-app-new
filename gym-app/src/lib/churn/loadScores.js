/**
 * loadGymChurnScores — cheap, consistent per-member churn scores for a gym.
 *
 * Lee el precálculo nocturno (churn_risk_scores) que escribe la edge function
 * compute-churn-scores, que corre EL MISMO modelo v4. Aquí solo se mapea la fila.
 *
 * Cae al motor en vivo cuando el precálculo está viejo, falta, o lo escribió una
 * versión anterior del modelo (`model_version < MODEL_VERSION`, mig 0705). Ese
 * último caso es el que desacopla el despliegue: subir el cliente ya da números
 * v4 aunque la edge function siga en v3.
 *
 * Returns the same shape as fetchMembersWithChurnScores so Overview, Members,
 * and AdminChurn use it interchangeably and always agree.
 */

import { getRiskTier, buildExplanation, MODEL_VERSION } from './riskScoring.js';
import { fetchMembersWithChurnScores } from './retention.js';
import { selectAllRows, isMissingColumnError } from './batchedSelect.js';

const MS_PER_DAY = 86400000;
const FRESH_MS = 26 * MS_PER_DAY / 24;   // a little slack past 24h (cron is daily)
const MIN_COVERAGE = 0.5;                // menos de esta fracción con fila de la versión actual → recalcular en vivo

/**
 * newestPerMember — { profile_id → newest timestamp } for a gym-wide activity table.
 *
 * Feeds the "last visit N days ago" line rendered next to a precomputed score.
 *
 * What was here before: two gym-wide reads of RAW rows ordered newest-first with
 * `.limit(5000)`, folded client-side by keeping the first row seen per member. But
 * PostgREST caps EVERY response at 1000 rows on this project (max_rows=1000), so
 * `.limit(5000)` was a no-op — the reads returned 1000 rows, full stop. At ~2,700
 * check-ins/week the 1000 newest rows span roughly 2.6 DAYS. Every member who last
 * came in three days ago or more was simply not in the response, so the page showed
 * them a blank / "never" recency instead of "27 days" — on the NORMAL path, and
 * specifically for the lapsing members the churn page exists to surface.
 *
 * A server-side `max()` aggregate would be the ideal shape here — one row per
 * member instead of one row per visit. It is NOT used, deliberately:
 * **aggregate functions are disabled on this project.** Verified live against
 * prod, which answers any aggregate select with
 *   400  PGRST123  "Use of aggregate functions is not allowed"
 * So an aggregate-first-with-fallback arrangement would 400 on EVERY call, log a
 * red request in every admin's network tab, and pay a wasted round trip before
 * doing the paged read anyway. Page the raw rows directly instead.
 *
 * If `db-aggregates-enabled` is ever turned on for this project, switching to
 * `.select('profile_id, newest_at:<tsCol>.max()')` here turns ~24 pages into ~2.
 */
async function newestPerMember(supabase, table, tsCol, gymId, sinceIso) {
  const map = {};

  // Raw rows, newest-first, fully paged — first row seen per member wins.
  const raw = await selectAllRows((from, to) => supabase
    .from(table)
    .select(`profile_id, ${tsCol}`)
    .eq('gym_id', gymId)
    .gte(tsCol, sinceIso)
    // `id` tiebreaker so a page boundary inside a same-instant cluster can't drop rows.
    .order(tsCol, { ascending: false })
    .order('id', { ascending: true })
    .range(from, to));

  (raw.data || []).forEach((r) => { if (!map[r.profile_id]) map[r.profile_id] = r[tsCol]; });
  return map;
}

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
      // `id` tiebreaker: full_name is not unique, and paging on a non-total order can
      // duplicate or drop a member whose namesake straddles a page boundary.
      .order('full_name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to));

  let { data: memberRows, error: membersError } = await runMembers(`${MEMBER_COLS_SAFE}, churn_pause_until`);
  if (membersError && isMissingColumnError(membersError)) {
    ({ data: memberRows, error: membersError } = await runMembers(MEMBER_COLS_SAFE));
  }

  if (membersError || !memberRows?.length) return [];

  // ── 2. Precálculo (lo más reciente por socio, últimos 7 días) ──
  const scoresSince = new Date(Date.now() - 7 * MS_PER_DAY).toISOString();
  const { data: scoreRows } = await selectAllRows((from, to) =>
    supabase
      .from('churn_risk_scores')
      .select('profile_id, score, risk_tier, key_signals, velocity, primary_driver, explanation, state, trend, metrics, model_version, computed_at')
      .eq('gym_id', gymId)
      .gte('computed_at', scoresSince)
      // profile_id tiebreaker: the nightly cron stamps an entire gym with one
      // computed_at, so this order is almost entirely ties. Paging a non-total order
      // can drop a row — and a dropped row here is not a rounding error, it sends a
      // scored member down the `!row` branch and renders them as "New member — not
      // enough data yet" with a 0 score.
      .order('computed_at', { ascending: false })
      .order('profile_id', { ascending: true })
      .range(from, to));

  const latest = {};
  let newest = 0;
  (scoreRows || []).forEach((r) => {
    if (!latest[r.profile_id]) latest[r.profile_id] = r;
    const t = new Date(r.computed_at).getTime();
    if (t > newest) newest = t;
  });

  // Una fila solo cuenta si la escribió ESTA versión del modelo.
  //
  // Antes se deducía de si `primary_driver` venía relleno — un proxy. Ahora hay
  // columna (mig 0705), y eso es lo que desacopla el despliegue: mientras la
  // edge function siga escribiendo v3, el cliente ve `model_version < 4` y
  // recalcula en vivo con v4. Números correctos desde que se sube esto; el
  // despliegue solo lo hace rápido.
  //
  // `?? 3` porque las filas anteriores a la migración no traen la columna, y en
  // una base sin migrar PostgREST la devuelve como undefined en vez de fallar.
  const covered = memberRows.filter(
    (m) => latest[m.id] && (latest[m.id].model_version ?? 3) >= MODEL_VERSION,
  ).length;
  const fresh = newest > 0
    && (Date.now() - newest) < FRESH_MS
    && covered / memberRows.length >= MIN_COVERAGE;

  // ── 3. Precálculo viejo, ausente o de otra versión → motor en vivo ──
  if (!fresh) return fetchMembersWithChurnScores(gymId, supabase);

  // ── 4. Precálculo fresco → lectura ligera solo para la recencia que se PINTA ──
  // This is the NORMAL path — it runs on every Overview / Members / Churn load when
  // the nightly precompute is fresh, which is most of the time.
  const sixtyDaysAgo = new Date(Date.now() - 60 * MS_PER_DAY).toISOString();
  const [lastCheckIn, lastSession] = await Promise.all([
    newestPerMember(supabase, 'check_ins', 'checked_in_at', gymId, sixtyDaysAgo),
    newestPerMember(supabase, 'workout_sessions', 'started_at', gymId, sixtyDaysAgo),
  ]);

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
      confidence: row?.metrics?.confidence || 'low',
      // Localize from the driver (the edge fn's stored text is English-only). Pass the
      // persisted avgWeeklyVisits (metrics JSONB) so the attendance reason keeps its
      // "(was X×/wk)" clause — matching the live engine's wording exactly, no freshness drift.
      explanation: driver
        ? buildExplanation(driver, {
            daysSinceLastCheckIn, daysSinceLastActivity,
            avgWeeklyVisits: row?.metrics?.avgWeeklyVisits,
            // v4: la frase nombra el ritmo propio del socio («no suele pasar de
            // 5 días»), así que estos tienen que venir del snapshot persistido.
            daysSinceLastVisit: row?.metrics?.daysSinceLastVisit,
            g90: row?.metrics?.g90,
            drop: row?.metrics?.drop,
            weeklyRate: row?.metrics?.weeklyRate,
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
