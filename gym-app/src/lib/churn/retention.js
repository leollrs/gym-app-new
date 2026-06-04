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
import { selectInBatches, isMissingColumnError } from './batchedSelect.js';

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
  const sixtyDaysAgo = new Date(nowMs - 60 * MS_PER_DAY).toISOString();
  const thirtyDaysAgo = new Date(nowMs - 30 * MS_PER_DAY).toISOString();
  const fourteenDaysAgo = new Date(nowMs - 14 * MS_PER_DAY).toISOString();

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

  // ── 1. Member profiles ──
  // churn_pause_until (migration 0509) is a newer column. If the DB hasn't applied
  // it, selecting it 400s and the ENTIRE churn page silently drops to the legacy
  // estimator (everyone "95 / never logged a workout"). So fetch resiliently: try
  // with it, and on a missing-column error retry without (pause then = frozen-only).
  // Training frequency comes from preferred_training_days.length — there is NO
  // scalar profiles.training_frequency column (selecting it always 400s).
  // membership_status filter must match the edge fn EXACTLY (explicit allowlist).
  const MEMBER_COLS_SAFE = 'id, full_name, username, phone_number, created_at, membership_started_at, last_active_at, gym_id, preferred_training_days, membership_status';
  const runMembers = (cols) => supabase
    .from('profiles')
    .select(cols)
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .eq('imported_archived', false)
    .in('membership_status', ['active', 'frozen'])
    .order('full_name', { ascending: true });

  let { data: memberRows, error: membersError } = await runMembers(`${MEMBER_COLS_SAFE}, churn_pause_until`);
  if (membersError && isMissingColumnError(membersError)) {
    ({ data: memberRows, error: membersError } = await runMembers(MEMBER_COLS_SAFE));
  }

  if (membersError || !memberRows?.length) return [];
  const memberIds = memberRows.map((m) => m.id);

  // ── 2. Parallel data fetches (v3 set — attendance + trajectory windows) ──
  const [
    checkInsRes,        // 60d check-ins (attendance: recency, frequency, trend)
    sessions90Res,      // 90d completed sessions (logging trajectory + recency)
    allSessionsRes,     // all-time completed (totalSessions, first-workout, first90)
    feedRes,            // 90d activity feed (social + pr_hit)
    notifRes,           // 90d notifications (app-engagement trajectory)
    challengeRes,       // challenge joins (timestamped, for trajectory + bonus)
    referralsRes,       // referrals (protective bonus)
    bodyRes,            // 90d body logs (goal/progress trajectory)
    historyRes,         // prior churn scores (score-history velocity for display)
  ] = await Promise.all([
    selectInBatches((ids) => supabase.from('check_ins')
      .select('profile_id, checked_in_at')
      .eq('gym_id', gymId).gte('checked_in_at', sixtyDaysAgo).in('profile_id', ids)
      .order('checked_in_at', { ascending: false }), memberIds),

    selectInBatches((ids) => supabase.from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId).eq('status', 'completed').gte('started_at', ninetyDaysAgo).in('profile_id', ids)
      .order('started_at', { ascending: false }), memberIds),

    selectInBatches((ids) => supabase.from('workout_sessions')
      .select('profile_id, started_at')
      .eq('gym_id', gymId).eq('status', 'completed').in('profile_id', ids), memberIds),

    selectInBatches((ids) => supabase.from('activity_feed_items')
      .select('actor_id, created_at, type')
      .eq('gym_id', gymId).gte('created_at', ninetyDaysAgo).in('actor_id', ids)
      .order('created_at', { ascending: false }).limit(8000), memberIds),

    selectInBatches((ids) => supabase.from('notifications')
      .select('profile_id, read_at, created_at')
      .gte('created_at', ninetyDaysAgo).in('profile_id', ids).limit(12000), memberIds),

    selectInBatches((ids) => supabase.from('challenge_participants')
      .select('profile_id, joined_at').in('profile_id', ids).limit(8000), memberIds),

    selectInBatches((ids) => supabase.from('referrals')
      .select('referrer_id').in('referrer_id', ids).limit(5000), memberIds),

    selectInBatches((ids) => supabase.from('body_weight_logs')
      .select('profile_id, logged_at')
      .eq('gym_id', gymId).gte('logged_at', ninetyDaysAgo).in('profile_id', ids).limit(8000), memberIds),

    selectInBatches((ids) => supabase.from('churn_risk_scores')
      .select('profile_id, score, computed_at')
      .eq('gym_id', gymId).in('profile_id', ids)
      .order('computed_at', { ascending: false }), memberIds),
  ]);

  const checkInRows = checkInsRes.data || [];
  const session90Rows = sessions90Res.data || [];
  const allSessionRows = allSessionsRes.data || [];
  const feedRows = feedRes.data || [];
  const notifRows = notifRes.data || [];
  const challengeRows = challengeRes.data || [];
  const referralRows = referralsRes.data || [];
  const bodyRows = bodyRes.data || [];
  const historyRows = historyRes.data || [];

  // ── Helpers: per-member counters bucketed into recent (0–30d) vs baseline (30–90d) ──
  const blank = () => ({ recent: 0, base: 0 });
  const ensure = (map, id) => (map[id] || (map[id] = blank()));

  // Check-ins: recency, observed footprint, weekly rates
  const lastCheckIn = {};
  const ci30 = {}, ci14 = {}, ci14to60 = {}, ciTotal = {};
  checkInRows.forEach((r) => {
    const id = r.profile_id, t = r.checked_in_at;
    if (!lastCheckIn[id]) lastCheckIn[id] = t;
    ciTotal[id] = (ciTotal[id] || 0) + 1;
    if (t >= thirtyDaysAgo) ci30[id] = (ci30[id] || 0) + 1;
    if (t >= fourteenDaysAgo) ci14[id] = (ci14[id] || 0) + 1;
    if (t >= sixtyDaysAgo && t < fourteenDaysAgo) ci14to60[id] = (ci14to60[id] || 0) + 1;
  });

  // Completed sessions: logging trajectory + recency
  const lastSession = {};
  const logging = {};
  session90Rows.forEach((r) => {
    const id = r.profile_id, t = r.started_at;
    if (!lastSession[id]) lastSession[id] = t;
    const b = ensure(logging, id);
    if (t >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
  });

  // All-time completed: totals + first-90-day count
  const totalSessionsMap = {};
  allSessionRows.forEach((r) => { totalSessionsMap[r.profile_id] = (totalSessionsMap[r.profile_id] || 0) + 1; });
  const sessionsFirst90Map = {};
  memberRows.forEach((m) => {
    const cutoff = new Date(new Date(m.created_at).getTime() + 90 * MS_PER_DAY);
    sessionsFirst90Map[m.id] = allSessionRows.filter(
      (r) => r.profile_id === m.id && new Date(r.started_at) <= cutoff
    ).length;
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
  const body = {};
  bodyRows.forEach((r) => {
    const id = r.profile_id, t = r.logged_at;
    const b = ensure(body, id);
    if (t >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
  });

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

  // ── Cohort frequency percentile (self-tuning per gym) ──
  const allFreq = memberRows.map((m) => (ci30[m.id] || 0) / 4.33).sort((a, b) => a - b);
  const cohortPct = (f) => {
    if (!allFreq.length) return null;
    let lo = 0; for (const v of allFreq) { if (v < f) lo++; else break; }
    return lo / allFreq.length;
  };

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
    const recentWeeklyRate = (ci14[m.id] || 0) / 2;                 // last 2 weeks
    const baselineWeeklyRate = (ci14to60[m.id] || 0) / ((60 - 14) / 7); // ~6.57 wk window
    const totalSessions = totalSessionsMap[m.id] || 0;
    const observedCheckIns = ciTotal[m.id] || 0;

    const lg = logging[m.id] || blank();
    const sc = social[m.id] || blank();
    const pr = prs[m.id] || blank();
    const ap = appReads[m.id] || blank();
    const bd = body[m.id] || blank();
    const ch = challenge[m.id] || blank();

    const memberData = {
      isPaused: m.membership_status === 'frozen' || (m.churn_pause_until != null && new Date(m.churn_pause_until).getTime() > nowMs),
      tenureMonths,
      // observation window since we could first see them (signup), import-safe activation gate
      accountAgeDays: (nowMs - new Date(m.created_at).getTime()) / MS_PER_DAY,
      totalSessions,
      observedCheckIns,
      daysSinceLastActivity,
      // attendance
      avgWeeklyVisits,
      trainingFrequency: m.preferred_training_days?.length ?? 3, // mirror edge fn exactly
      cohortPercentile: cohortPct(avgWeeklyVisits),
      recentWeeklyRate,
      baselineWeeklyRate,
      // streak — deferred (neutral) in v1
      streakActive: false,
      brokenStreakLen: 0,
      // onboarding regime
      visitsSoFar: observedCheckIns,
      firstWorkoutLogged: totalSessions > 0,
      // engagement decline (baseline normalized to per-30d to match recent window)
      logging:   { baseline: lg.base / 2, recent: lg.recent },
      app:       { baseline: ap.base / 2, recent: ap.recent },
      appActivity: { baseline: ap.base / 2, recent: ap.recent },
      social:    { baseline: sc.base / 2, recent: sc.recent },
      goalsPRs:  { baseline: (pr.base + bd.base) / 2, recent: pr.recent + bd.recent },
      challenge: { baseline: ch.base / 2, recent: ch.recent },
      rewards:   { baseline: null, recent: 0 }, // deferred → neutral
      // protective bonuses
      activeReferrer: (referralCount[m.id] || 0) >= 1,
      activeChallenge: ch.recent > 0,
      recentPRs: pr.recent > 0,
      strongAppCard: (ap.recent >= 3) || (sc.recent >= 3),
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
