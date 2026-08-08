/**
 * Churn Intelligence — Retention & Churn Prediction (v3 live engine)
 * ─────────────────────────────────────────────────────────────
 * Builds the v3 "Attendance-First Behavioral Retention Model" inputs for every
 * member in a gym and scores them. See src/lib/churn/MODEL_V3_SPEC.md.
 *
 * The v3 state machine (insufficient-data grace + dormant override) lives INSIDE
 * calculateChurnScore — this engine just assembles the metrics. No read-time
 * override anymore (the score is the truth).
 */

import { DEFAULT_WEIGHTS, calculateChurnScore } from './riskScoring.js';
import { calculateVelocity } from './metrics.js';
import { signalTenureRiskV2 } from './churnSignalsV2.js';
import { selectAllRows, selectAllInBatches, isMissingColumnError } from './batchedSelect.js';
import { buildRhythm, dayOf } from './rhythm.js';

/** @deprecated v2 tenure signal — kept only for legacy index.js re-export. */
export function signalTenureRisk(tenureMonths, totalSessionsFirst90Days) {
  const r = signalTenureRiskV2(tenureMonths, totalSessionsFirst90Days);
  return { ...r, value: tenureMonths };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Fetch all members for a gym, build v3 metrics, and score them.
 * Loads per-gym adaptive weights if available, otherwise uses defaults.
 * Returns array sorted by churnScore descending.
 */
export async function fetchMembersWithChurnScores(gymId, supabase) {
  const now = new Date();
  const nowMs = now.getTime();
  const ninetyDaysAgo = new Date(nowMs - 90 * MS_PER_DAY).toISOString();
  const thirtyDaysAgo = new Date(nowMs - 30 * MS_PER_DAY).toISOString();
  const todayDay = dayOf(now);

  // ── 0. Per-gym adaptive weights (blended with defaults via confidence) ──
  let gymWeights = DEFAULT_WEIGHTS;
  let gymWeightsMeta = null;
  try {
    const { data: wRow } = await supabase
      .from('gym_churn_weights')
      .select('*')
      .eq('gym_id', gymId)
      .maybeSingle();
    if (wRow && wRow.confidence > 0) {
      const c = wRow.confidence;
      gymWeights = {};
      for (const key of Object.keys(DEFAULT_WEIGHTS)) {
        const col = `w_${key}`;
        const learned = wRow[col] != null ? wRow[col] : DEFAULT_WEIGHTS[key];
        gymWeights[key] = learned * c + DEFAULT_WEIGHTS[key] * (1 - c);
      }
      gymWeightsMeta = {
        confidence: c,
        labeledOutcomes: wRow.labeled_outcomes,
        lastCalibratedAt: wRow.last_calibrated_at,
        calibrationAuc: wRow.calibration_auc,
      };
    }
  } catch {
    // Table may not have the v3 columns yet — defaults are fine.
  }

  // ── 1. Member profiles (gym-scoped, PAGED) ──
  // churn_pause_until (migration 0509) is a newer column. If the DB hasn't applied
  // it, selecting it 400s and the ENTIRE churn page silently drops to the legacy
  // estimator (everyone "95 / never logged a workout"). So fetch resiliently: try
  // with it, and on a missing-column error retry without (pause then = frozen-only).
  // Training frequency comes from preferred_training_days.length — there is NO
  // scalar profiles.training_frequency column (selecting it always 400s).
  // membership_status filter must match the edge fn EXACTLY (explicit allowlist).
  //
  // MUST be paged (selectAllRows), like loadScores.js does. PostgREST caps EVERY
  // response at 1000 rows on this project (max_rows=1000) — an unpaged read of a
  // 1,500-member gym returned only the first 1000 members BY NAME, so everyone from
  // roughly "R" onward was not scored "low risk", they were ABSENT from the churn
  // page entirely. A gym owner would never see the at-risk members in the back half
  // of the alphabet. The `id` tiebreaker keeps paging deterministic: full_name is
  // not unique, and two members sharing a name across a page boundary can otherwise
  // be duplicated or dropped.
  const MEMBER_COLS_SAFE = 'id, full_name, username, phone_number, created_at, membership_started_at, last_active_at, gym_id, preferred_training_days, membership_status';
  const runMembers = (cols) => selectAllRows((from, to) => supabase
    .from('profiles')
    .select(cols)
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false)
    .in('membership_status', ['active', 'frozen'])
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));

  let { data: memberRows, error: membersError } = await runMembers(`${MEMBER_COLS_SAFE}, churn_pause_until`);
  if (membersError && isMissingColumnError(membersError)) {
    ({ data: memberRows, error: membersError } = await runMembers(MEMBER_COLS_SAFE));
  }

  if (membersError || !memberRows?.length) return [];
  const memberIds = memberRows.map((m) => m.id);

  // ── 2. Parallel data fetches (v3 set — attendance + trajectory windows) ──
  // ALL of these use selectAllInBatches, never selectInBatches. selectInBatches only
  // chunks the `.in()` id list for URL length (~200 ids/request); it does NOT page a
  // chunk, so each chunk still slammed into PostgREST's 1000-row response cap. The
  // per-200-member numbers at a mid-size gym: 60d check-ins ~3,084 rows, 90d sessions
  // ~4,630, all-time sessions ~24,000 — every one of them truncated to 1000.
  //
  // Ordered newest-first, that meant only the most recent ~19 days of a chunk's
  // history survived, and THE TRUNCATION INVERTED THE MODEL: a member who last
  // attended 25 days ago returned ZERO rows, so lastCheckIn/lastSession were
  // undefined, daysSinceLastActivity came out null, and the v3 scorer filed a
  // long-tenured LAPSING member as never-activated / insufficient-data. The exact
  // population this product exists to catch was the population the cap erased.
  //
  // Every `.limit(N)` below is gone: N > 1000 is a no-op under max_rows, so those
  // numbers were false safeguards, and `.limit()` also fights `.range()` for the
  // same querystring parameter. Each query carries a stable `.order()` plus a unique
  // `id` tiebreaker — paging without a total order can duplicate or drop rows across
  // a page boundary (body_weight_logs.logged_at is a DATE, so same-day ties are the
  // norm, not the exception).
  const [
    checkInsRes,        // 60d check-ins (attendance: recency, frequency, trend)
    sessions90Res,      // 90d completed sessions (logging trajectory + recency)
    allSessionsRes,     // all-time completed (totalSessions, first-workout, first90)
    feedRes,            // 90d activity feed (social + pr_hit)
    notifRes,           // 90d notifications (app-engagement trajectory)
    challengeRes,       // challenge joins (timestamped, for trajectory + bonus)
    referralsRes,       // referrals (protective bonus)
    // Se fue la consulta de body_weight_logs: alimentaba el eje «metas/PRs» de la
    // Capa B de v3, que v4 no tiene. Una ida y vuelta menos por carga.
    historyRes,         // prior churn scores (score-history velocity for display)
  ] = await Promise.all([
    selectAllInBatches((ids, from, to) => supabase.from('check_ins')
      .select('profile_id, checked_in_at')
      // 90 días, no 60: buildRhythm necesita la serie entera de visitas para
      // sacar el p90 de intervalos de cada socio, que es la vara de v4.
      .eq('gym_id', gymId).gte('checked_in_at', ninetyDaysAgo).in('profile_id', ids)
      .order('checked_in_at', { ascending: false }).order('id', { ascending: true })
      .range(from, to), memberIds),

    selectAllInBatches((ids, from, to) => supabase.from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId).eq('status', 'completed').gte('started_at', ninetyDaysAgo).in('profile_id', ids)
      .order('started_at', { ascending: false }).order('id', { ascending: true })
      .range(from, to), memberIds),

    // All-time completed sessions — the heaviest read in the pipeline. It had NO
    // `.order()` at all, which made its 1000-row truncation arbitrary on top of being
    // wrong: totalSessions (and therefore `firstWorkoutLogged`) was capped for every
    // member in a chunk once the chunk crossed 1000 rows. Ordering is irrelevant to
    // the counts we derive, but `.range()` paging needs a total order to be stable.
    selectAllInBatches((ids, from, to) => supabase.from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId).eq('status', 'completed').in('profile_id', ids)
      .order('started_at', { ascending: false }).order('id', { ascending: true })
      .range(from, to), memberIds),

    selectAllInBatches((ids, from, to) => supabase.from('activity_feed_items')
      .select('actor_id, created_at, type')
      .eq('gym_id', gymId).gte('created_at', ninetyDaysAgo).in('actor_id', ids)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, to), memberIds),

    selectAllInBatches((ids, from, to) => supabase.from('notifications')
      .select('profile_id, read_at, created_at')
      .gte('created_at', ninetyDaysAgo).in('profile_id', ids)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, to), memberIds),

    selectAllInBatches((ids, from, to) => supabase.from('challenge_participants')
      .select('profile_id, joined_at').in('profile_id', ids)
      .order('joined_at', { ascending: false }).order('id', { ascending: true })
      .range(from, to), memberIds),

    selectAllInBatches((ids, from, to) => supabase.from('referrals')
      .select('referrer_id').in('referrer_id', ids)
      .order('id', { ascending: true })
      .range(from, to), memberIds),


    // WINDOWED — and the window is load-bearing, not a performance tweak.
    //
    // This feeds calculateVelocity (lib/churn/metrics.js), a linear regression
    // over whatever history it receives, which drives the rising/falling arrow on
    // the churn page. Unpaging this query without a window silently changed what
    // that arrow MEANS: it used to see roughly the newest ~1000 rows (~5 days,
    // an accident of the PostgREST cap) and would have started measuring a
    // 12-month average slope instead. A member who went 20 -> 85 in ten days
    // would render `stable`, velocity ~0 — the exact opposite of the signal, on
    // the number an owner reads to decide who to phone.
    //
    // 30 days is a deliberate choice, not a restoration of the old accident: long
    // enough for a regression to have signal, short enough that a genuine recent
    // deterioration dominates. It also caps this at ~30 rows/member instead of
    // ~365, which is what kept the fallback path inside its timeout budget.
    selectAllInBatches((ids, from, to) => supabase.from('churn_risk_scores')
      .select('profile_id, score, computed_at')
      .eq('gym_id', gymId).in('profile_id', ids)
      .gte('computed_at', new Date(Date.now() - 30 * 86400_000).toISOString())
      // profile_id (not id) as the tiebreaker — the nightly cron writes a whole gym
      // with one computed_at, so ties here are the rule; the table's own history has
      // gone through two shapes and `id` is not guaranteed on legacy deployments.
      .order('computed_at', { ascending: false }).order('profile_id', { ascending: true })
      .range(from, to), memberIds),
  ]);

  const checkInRows = checkInsRes.data || [];
  const session90Rows = sessions90Res.data || [];
  const allSessionRows = allSessionsRes.data || [];
  const feedRows = feedRes.data || [];
  const notifRows = notifRes.data || [];
  const challengeRows = challengeRes.data || [];
  const referralRows = referralsRes.data || [];
  const historyRows = historyRes.data || [];

  // ── Helpers: per-member counters bucketed into recent (0–30d) vs baseline (30–90d) ──
  const blank = () => ({ recent: 0, base: 0 });
  const ensure = (map, id) => (map[id] || (map[id] = blank()));

  // ── Días con visita, por socio ──
  // Check-in y entreno registrado el MISMO día son UNA visita. v3 los contaba
  // por separado, así que a quien registraba sus entrenos se le inflaba la
  // frecuencia y, con ella, todo lo que se derivaba de ella.
  const visitDays = {};
  const addVisitDay = (id, t) => {
    if (!t) return;
    (visitDays[id] || (visitDays[id] = new Set())).add(dayOf(t));
  };

  // Check-ins: recency, observed footprint, weekly rates
  const lastCheckIn = {};
  const ci30 = {}; // solo alimenta avgWeeklyVisits, que se pinta en la lista
  checkInRows.forEach((r) => {
    const id = r.profile_id, t = r.checked_in_at;
    if (!lastCheckIn[id]) lastCheckIn[id] = t;
    addVisitDay(id, t);
    if (t >= thirtyDaysAgo) ci30[id] = (ci30[id] || 0) + 1;
  });

  // Completed sessions: días de visita + recencia
  const lastSession = {};
  session90Rows.forEach((r) => {
    const id = r.profile_id, t = r.started_at;
    if (!lastSession[id]) lastSession[id] = t;
    addVisitDay(id, t);
  });

  // All-time completed: totals + first-90-day count.
  //
  // ONE grouping pass, then O(1) lookups. The previous shape ran
  // `allSessionRows.filter(r => r.profile_id === m.id && new Date(r.started_at) <= cutoff)`
  // INSIDE a forEach over memberRows — a full rescan of every session row for every
  // member, allocating a Date object per element. On truncated data that was already
  // ~12M iterations (~2.4s of blocked main thread). Paging the fetch above grows
  // allSessionRows ~22x, which would have turned it into ~270M iterations — a ~54
  // SECOND FROZEN TAB. Un-truncating the query without this rewrite would have made
  // the page dramatically worse than the bug it fixes.
  //
  // Now: O(rows) to bucket + O(rows) total to count (each row belongs to exactly one
  // member), and started_at is parsed once per ROW instead of once per member×row.
  const totalSessionsMap = {};
  const sessionMsByMember = new Map();   // profile_id → epoch-ms timestamps
  allSessionRows.forEach((r) => {
    const id = r.profile_id;
    totalSessionsMap[id] = (totalSessionsMap[id] || 0) + 1;
    let times = sessionMsByMember.get(id);
    if (!times) sessionMsByMember.set(id, (times = []));
    times.push(new Date(r.started_at).getTime());
  });
  // NOTE: sessionsFirst90Map is currently WRITE-ONLY — nothing in the v3 memberData
  // below reads it, and its only consumer signalTenureRiskV2(months, first90Sessions)
  // is reachable only through the @deprecated signalTenureRisk re-export at the top of
  // this file. Kept (cheaply) rather than deleted so wiring it into the v3 tenure
  // signal stays a one-liner — but it is dead today, not a behaviour change.
  const sessionsFirst90Map = {};
  memberRows.forEach((m) => {
    // Cutoff parsed ONCE per member, outside the counting loop.
    const cutoffMs = new Date(m.created_at).getTime() + 90 * MS_PER_DAY;
    const times = sessionMsByMember.get(m.id);
    if (!times) { sessionsFirst90Map[m.id] = 0; return; }
    let n = 0;
    for (let i = 0; i < times.length; i++) if (times[i] <= cutoffMs) n += 1;
    sessionsFirst90Map[m.id] = n;
  });

  // Activity feed → social trajectory + PR trajectory + last social
  const social = {}, prs = {}, lastSocialAt = {};
  feedRows.forEach((r) => {
    const id = r.actor_id, t = r.created_at;
    const isPR = r.type === 'pr_hit';
    if (!isPR && !lastSocialAt[id]) lastSocialAt[id] = t;
    const bucket = isPR ? ensure(prs, id) : ensure(social, id);
    if (t >= thirtyDaysAgo) bucket.recent += 1; else bucket.base += 1;
  });

  // Notifications read → app-engagement trajectory + open-rate
  const appReads = {}, notifTotalMap = {}, notifReadMap = {};
  notifRows.forEach((r) => {
    const id = r.profile_id, t = r.created_at;
    notifTotalMap[id] = (notifTotalMap[id] || 0) + 1;
    if (r.read_at) {
      notifReadMap[id] = (notifReadMap[id] || 0) + 1;
      const b = ensure(appReads, id);
      if (t >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
    }
  });

  // Body logs → folded into goal/progress trajectory
  // Challenge joins → trajectory + active bonus
  const challenge = {};
  challengeRows.forEach((r) => {
    const id = r.profile_id;
    const b = ensure(challenge, id);
    // joined_at may be absent on legacy rows → count as baseline (neutral)
    if (r.joined_at && r.joined_at >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
  });

  const referralCount = {};
  referralRows.forEach((r) => { referralCount[r.referrer_id] = (referralCount[r.referrer_id] || 0) + 1; });

  // Score-history velocity (display only)
  const historyMap = {};
  historyRows.forEach((r) => { (historyMap[r.profile_id] || (historyMap[r.profile_id] = [])).push(r); });

  // El percentil de cohorte de v3 vivía aquí: ordenaba la frecuencia de TODO el
  // gimnasio en cada carga para correr el ancla de 3×/semana ±2 según el cuartil.
  // v4 no tiene ancla — cada socio se mide contra su propio ritmo — así que la
  // cohorte no se consulta y el ordenamiento se fue con ella.

  // ── Build inputs + score ──
  const scored = memberRows.map((m) => {
    // Tenure: admin-entered membership_started_at wins (the real physical join date).
    const tenureAnchor = m.membership_started_at ? new Date(m.membership_started_at) : new Date(m.created_at);
    const tenureMonths = (nowMs - tenureAnchor.getTime()) / (MS_PER_DAY * 30.44);

    // Recency for CHURN = gym ATTENDANCE only (last check-in or logged workout).
    // NOT last_active_at (an app-open timestamp set at signup) or social activity —
    // a member who opens the app but stops attending IS churning; one who attends
    // but never opens the app is not. Using app-opens made everyone read "active".
    const candidates = [lastCheckIn[m.id], lastSession[m.id]]
      .filter(Boolean).map((t) => new Date(t).getTime());
    const lastSeenMs = candidates.length ? Math.max(...candidates) : 0;
    const daysSinceLastActivity = lastSeenMs > 0 ? (nowMs - lastSeenMs) / MS_PER_DAY : null;
    const daysSinceLastCheckIn = lastCheckIn[m.id] ? (nowMs - new Date(lastCheckIn[m.id]).getTime()) / MS_PER_DAY : null;
    const lastActivityAt = lastSeenMs > 0 ? new Date(lastSeenMs).toISOString() : null;

    const avgWeeklyVisits = (ci30[m.id] || 0) / 4.33;
    const totalSessions = totalSessionsMap[m.id] || 0;
    const accountStartDay = dayOf(m.created_at);
    const sc = social[m.id] || blank();
    const pr = prs[m.id] || blank();
    const ap = appReads[m.id] || blank();
    const ch = challenge[m.id] || blank();

    // El ritmo propio del socio: de aquí sale la vara con la que se le mide.
    const rhythm = buildRhythm([...(visitDays[m.id] || [])], todayDay);

    // Exactamente lo que v4 lee, y nada más. La versión v3 de este objeto tenía
    // dieciséis campos que el scorer ya no mira (ancla de frecuencia, percentil
    // de cohorte, racha, seis ejes de declive) — dejarlos ahí no rompe nada pero
    // hace creer que el modelo los usa, y uno de ellos costaba un ordenamiento
    // de todo el gimnasio en cada carga.
    const memberData = {
      rhythm,
      // Visitas de sus primeras 3 semanas de cuenta — la activación de v4 es
      // pisar el gimnasio, no registrar un entreno en la app.
      visitsIn21d: [...(visitDays[m.id] || [])].filter((d) => d <= accountStartDay + 21).length,
      isPaused: m.membership_status === 'frozen' || (m.churn_pause_until != null && new Date(m.churn_pause_until).getTime() > nowMs),
      // Ventana de OBSERVACIÓN (desde created_at), no antigüedad de membresía:
      // así un roster recién importado no marca a nadie el día uno.
      accountAgeDays: (nowMs - new Date(m.created_at).getTime()) / MS_PER_DAY,
      daysSinceLastActivity, // solo para el respaldo de la explicación
      // La lente de app: corrobora, nunca constituye. Base normalizada a 30 días
      // para que case con la ventana reciente.
      appActivity: { baseline: ap.base / 2, recent: ap.recent },
      // Protección (multiplicativa, tope 15%)
      activeReferrer: (referralCount[m.id] || 0) >= 1,
      activeChallenge: ch.recent > 0,
      recentPRs: pr.recent > 0,
      activeSocial: sc.recent > 0,
    };

    const result = calculateChurnScore(memberData, gymWeights);
    const velocityData = calculateVelocity(historyMap[m.id] || []);

    return {
      ...m,
      username: m.username || m.full_name,
      tenureMonths,
      daysSinceLastCheckIn,
      daysSinceLastActivity,
      lastActivityAt,
      lastCheckInAt: lastCheckIn[m.id] || null,
      avgWeeklyVisits,
      totalSessions,
      // v3 score
      churnScore: result.score,
      riskTier: result.riskTier,
      tier: result.tier,
      state: result.state,
      signals: result.signals,
      keySignals: result.keySignals,
      keySignal: result.keySignal,
      primaryDriver: result.primaryDriver,
      explanation: result.explanation,
      confidence: result.confidence,
      trend: result.trend,
      attRisk: result.attRisk,
      engRisk: result.engRisk,
      bonus: result.bonus,
      // score-history velocity (display only — distinct from attendance `trend`)
      velocity: velocityData.velocity,
      velocityTrend: velocityData.trend,
      velocityLabel: velocityData.label,
      gymWeightsMeta,
      metrics: memberData,
    };
  });

  return scored.sort((a, b) => b.churnScore - a.churnScore);
}
