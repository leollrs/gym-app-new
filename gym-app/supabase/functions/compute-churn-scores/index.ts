/**
 * Compute Churn Scores — Supabase Edge Function
 * ───────────────────────────────────────────────
 * Runs daily (cron). Computes the v3 "Attendance-First Behavioral Retention
 * Model" for ALL active members across ALL gyms and persists to
 * churn_risk_scores. Mirrors the client engine in src/lib/churn/* —
 * see src/lib/churn/MODEL_V3_SPEC.md.
 *
 *   Layer A attendance core (≤70)  +  Layer B engagement decline (≤30)
 *   × tenure multiplier  →  attendance gate  →  + protective bonus (≥−20)  →  0–100
 *
 * State machine: insufficient-data grace (new/imported → never Critical),
 * dormant override (≥30d dark → Critical), both baked into the persisted score.
 *
 * Also drives the automated multi-channel follow-up drip and labels churn
 * outcomes for the calibration model.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

const corsHeaders = ALLOWED_ORIGIN
  ? {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }
  : null;

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const round1 = (n: number) => Math.round(n * 10) / 10;

// ── Model parameters (mirror riskScoring.js) ──
const ONBOARDING_DAYS = 75;
const GRACE_DAYS = 14;
const GRACE_MIN_EVENTS = 4;
const DORMANT_DAYS = 30;
const CHURNED_DAYS = 60;
const GATE_THRESHOLD = 18;
const MEDIUM_CAP = 54;
const ACTIVATION_DEADLINE_DAYS = 21;   // enrolled ≥ this (since created_at) with ZERO footprint → failed activation

const DEFAULT_WEIGHTS: Record<string, number> = {
  recency: 1.0, frequency: 1.0, trend: 1.0, streak: 1.0,
  habit_formation: 1.0, activation: 1.0,
  app_decline: 1.0, challenge_decline: 1.0, logging_decline: 1.0,
  rewards_decline: 1.0, social_decline: 1.0, goals_decline: 1.0,
};

type Sig = { score: number; maxPts: number; label: string; dir?: string };

// ── Layer A ──
function sigRecency(d: number | null, MAX = 25, tau = 18): Sig {
  if (d == null) return { score: MAX, maxPts: MAX, label: 'No recent activity' };
  const dd = Math.max(0, d);
  return { score: round1(MAX * (1 - Math.exp(-dd / tau))), maxPts: MAX, label: dd < 4 ? 'Active recently' : `${Math.round(dd)} days since last visit` };
}
function sigFrequency(avgWeekly: number, goal: number, cohortPct: number | null, MAX = 18): Sig {
  const anchor = Math.max(goal || 3, 3);
  const r = anchor > 0 ? avgWeekly / anchor : 0;
  let base: number;
  if (r >= 1.0) base = 0;
  else if (r >= 0.66) base = Math.round(MAX * 0.22);
  else if (r >= 0.5) base = Math.round(MAX * 0.39);
  else if (r >= 0.33) base = Math.round(MAX * 0.61);
  else if (r >= 0.16) base = Math.round(MAX * 0.78);
  else base = MAX;
  if (cohortPct != null) {
    if (cohortPct <= 0.25) base = Math.min(MAX, base + 2);
    else if (cohortPct >= 0.75) base = Math.max(0, base - 2);
  }
  return { score: base, maxPts: MAX, label: base === 0 ? 'Meeting visit goal' : `Visiting ${avgWeekly.toFixed(1)}×/week` };
}
function sigTrend(recentRate: number, baselineRate: number | null, MAX = 17): Sig {
  if (baselineRate == null || baselineRate < 0.25) return { score: 0, maxPts: MAX, label: 'Not enough history', dir: 'stable' };
  const v = baselineRate > 0 ? recentRate / baselineRate : 1;
  let score: number, dir: string;
  if (v >= 1.0) { score = 0; dir = recentRate > baselineRate * 1.1 ? 'up' : 'stable'; }
  else if (v >= 0.75) { score = Math.round(MAX * 0.24); dir = 'down'; }
  else if (v >= 0.5) { score = Math.round(MAX * 0.53); dir = 'down'; }
  else if (v >= 0.25) { score = Math.round(MAX * 0.76); dir = 'down'; }
  else { score = MAX; dir = 'down'; }
  const pct = Math.round((1 - v) * 100);
  return { score, maxPts: MAX, label: score === 0 ? (dir === 'up' ? 'Attendance trending up' : 'Attendance stable') : `Visits down ${pct}% vs usual`, dir };
}
function sigStreak(active: boolean, brokenLen: number, MAX = 10): Sig {
  if (active) return { score: 0, maxPts: MAX, label: 'Streak active' };
  if (!brokenLen || brokenLen < 7) return { score: 0, maxPts: MAX, label: 'No active streak' };
  return { score: round1(MAX * Math.min(brokenLen / 30, 1)), maxPts: MAX, label: `Broke a ${Math.round(brokenLen)}-day streak` };
}
function sigHabitFormation(visits: number, tenureDays: number, MAX = 30): Sig {
  const weeks = Math.max(tenureDays / 7, 0.5);
  const expected = Math.min(weeks * 3, 18);
  if (expected <= 0) return { score: 0, maxPts: MAX, label: 'Too early to tell' };
  const gap = Math.max(0, Math.min((expected - (visits || 0)) / expected, 1));
  return { score: round1(MAX * gap), maxPts: MAX, label: gap <= 0.15 ? 'Building a routine' : `Not building a routine (${visits || 0} visits in ${Math.round(weeks)}w)` };
}
function sigActivation(firstLogged: boolean, tenureDays: number, MAX = 12): Sig {
  if (firstLogged) return { score: 0, maxPts: MAX, label: 'Completed first workout' };
  if (tenureDays < 7) return { score: Math.round(MAX * 0.4), maxPts: MAX, label: 'No first workout yet' };
  return { score: MAX, maxPts: MAX, label: 'No workout in first week' };
}
// ── Layer B (signed decline) ──
function declineScore(baseline: number | null, recent: number, MAX: number, minBaseline: number): number {
  if (baseline == null || baseline < minBaseline) return 0;
  if ((recent || 0) >= baseline) return 0;
  return round1(MAX * Math.min((baseline - (recent || 0)) / baseline, 1));
}
const sigAppDecline = (b: number | null, r: number, MAX = 8): Sig => ({ score: declineScore(b, r, MAX, 4), maxPts: MAX, label: declineScore(b, r, MAX, 4) > 0 ? 'App activity dropped off' : 'Active in app' });
const sigChallengeDecline = (b: number | null, r: number, MAX = 6): Sig => ({ score: declineScore(b, r, MAX, 1), maxPts: MAX, label: declineScore(b, r, MAX, 1) > 0 ? 'Stopped joining challenges' : 'Challenge engagement ok' });
const sigLoggingDecline = (b: number | null, r: number, MAX = 6): Sig => ({ score: declineScore(b, r, MAX, 3), maxPts: MAX, label: declineScore(b, r, MAX, 3) > 0 ? 'Stopped logging workouts' : 'Logging workouts' });
const sigRewardsDecline = (b: number | null, r: number, MAX = 4): Sig => ({ score: declineScore(b, r, MAX, 2), maxPts: MAX, label: declineScore(b, r, MAX, 2) > 0 ? 'Stopped using rewards' : 'Rewards engaged' });
const sigSocialDecline = (b: number | null, r: number, MAX = 3): Sig => ({ score: declineScore(b, r, MAX, 2), maxPts: MAX, label: declineScore(b, r, MAX, 2) > 0 ? 'Pulled back socially' : 'Socially engaged' });
const sigGoalsDecline = (b: number | null, r: number, MAX = 3): Sig => ({ score: declineScore(b, r, MAX, 1), maxPts: MAX, label: declineScore(b, r, MAX, 1) > 0 ? 'Goal/PR activity stalled' : 'Hitting milestones' });

function bonusProtective(f: { activeReferrer: boolean; activeChallenge: boolean; recentPRs: boolean; strongAppCard: boolean; activeSocial: boolean }): number {
  let bonus = 0;
  if (f.activeReferrer) bonus -= 5;
  if (f.activeChallenge) bonus -= 5;
  if (f.recentPRs) bonus -= 4;
  if (f.strongAppCard) bonus -= 4;
  if (f.activeSocial) bonus -= 2;
  return Math.max(-20, bonus);
}

function tenureMultiplier(m: number): number {
  if (m < 2.5) return 1.0;
  if (m <= 3) return 1.15;
  if (m <= 6) return 1.05;
  if (m <= 12) return 0.95;
  return 0.85;
}
function getRiskTier(score: number): string {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}
function classifyDriver(attRisk: number, engRisk: number, score: number, isOnboarding: boolean): string {
  if (score < 30) return 'healthy';
  if (isOnboarding) return 'onboarding';
  if (attRisk >= 30 && engRisk >= 12) return 'both';
  if (attRisk >= 25) return 'attendance';
  if (engRisk >= 12) return 'engagement';
  return 'attendance';
}
function explainEN(driver: string, days: number | null, freq: number, accountAge: number | null = null): string {
  switch (driver) {
    case 'healthy': return 'Showing up consistently — looks healthy.';
    case 'engagement': return 'Attendance is stable, but engagement dropped sharply from previous behavior.';
    case 'both': return 'Attendance is falling and app engagement has dropped.';
    case 'onboarding': return 'New member — not yet building a routine.';
    case 'dormant': return days != null ? `No activity for ${days}+ days.` : 'No workouts or check-ins on record.';
    case 'new': return 'New member — not enough data yet to score.';
    case 'never_activated': return accountAge != null
      ? `Enrolled ${Math.round(accountAge)} days ago but never checked in or logged a workout.`
      : 'Never checked in or logged a workout.';
    case 'paused': return 'On a membership hold — churn alerts paused.';
    case 'churned': return days != null ? `Likely lost — no activity for ${days}+ days.` : 'Likely lost — no activity on record.';
    case 'attendance':
    default:
      if (days != null && freq > 0) return `Hasn't checked in for ${days} days (was ${freq.toFixed(1)}×/week).`;
      if (days != null) return `Hasn't checked in for ${days} days.`;
      return 'Attendance has dropped off.';
  }
}

type V3Input = {
  tenureMonths: number; accountAgeDays: number | null; totalSessions: number; observedCheckIns: number;
  daysSinceLastActivity: number | null; daysSinceLastCheckIn: number | null;
  avgWeeklyVisits: number; trainingFrequency: number; cohortPercentile: number | null;
  recentWeeklyRate: number; baselineWeeklyRate: number | null;
  streakActive: boolean; brokenStreakLen: number;
  visitsSoFar: number; firstWorkoutLogged: boolean;
  logging: { baseline: number | null; recent: number };
  app: { baseline: number | null; recent: number };
  social: { baseline: number | null; recent: number };
  goalsPRs: { baseline: number | null; recent: number };
  challenge: { baseline: number | null; recent: number };
  rewards: { baseline: number | null; recent: number };
  activeReferrer: boolean; activeChallenge: boolean; recentPRs: boolean; strongAppCard: boolean; activeSocial: boolean;
  isPaused: boolean;
};

function computeV3(m: V3Input, weights: Record<string, number>) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const tenureDays = (m.tenureMonths || 0) * 30.44;
  const isOnboarding = tenureDays < ONBOARDING_DAYS;
  const dsa = m.daysSinceLastActivity;
  const hasFootprint = m.totalSessions > 0 || m.observedCheckIns > 0; // real attendance, NOT last_active_at
  const accountAgeDays = m.accountAgeDays ?? tenureDays; // observation window (created_at), import-safe
  const freq = m.avgWeeklyVisits || 0;
  const days = m.daysSinceLastCheckIn != null ? Math.round(m.daysSinceLastCheckIn) : (dsa != null ? Math.round(dsa) : null);

  // State 0: paused (vacation / membership hold)
  if (m.isPaused) {
    return { score: 0, risk_tier: 'low', state: 'paused', primary_driver: 'paused', explanation: explainEN('paused', days, freq), trend: 'stable', key_signals: ['On hold'], signals: {} };
  }
  // State 1: insufficient data — gate on real attendance footprint, not dsa
  // (last_active_at is set at signup/import so never-attended accounts still have
  // a non-null dsa; they must NOT fall through to the dormant 95 override).
  // State 1a: failed activation — zero check-ins AND zero workouts EVER, past the
  // activation window (gated on accountAgeDays so freshly-imported rosters aren't
  // flagged on day one). A real churn risk, not "insufficient data". Flagged High,
  // scaling with how long they've been a no-show, kept below the dormant band.
  if (!hasFootprint && tenureDays >= GRACE_DAYS && accountAgeDays >= ACTIVATION_DEADLINE_DAYS) {
    const weeksOverdue = Math.max(0, Math.floor((accountAgeDays - ACTIVATION_DEADLINE_DAYS) / 7));
    const score = Math.min(78, 60 + weeksOverdue * 4);
    const sig = 'Never activated';
    return { score, risk_tier: getRiskTier(score), state: 'scored', primary_driver: 'never_activated', explanation: explainEN('never_activated', days, freq, accountAgeDays), trend: 'declining', key_signals: [sig], signals: {} };
  }
  if (tenureDays < GRACE_DAYS || !hasFootprint) {
    return { score: 0, risk_tier: 'low', state: 'insufficient_data', primary_driver: 'new', explanation: explainEN('new', days, freq), trend: 'stable', key_signals: ['New member — not enough data yet'], signals: {} };
  }
  // State 2: churned (mathematically gone — out of the primary action queue)
  if (dsa != null && dsa >= CHURNED_DAYS) {
    const sig = `No activity in ${Math.round(dsa)}+ days`;
    return { score: 100, risk_tier: 'critical', state: 'churned', primary_driver: 'churned', explanation: explainEN('churned', days, freq), trend: 'declining', key_signals: [sig], signals: {} };
  }
  // State 3: dormant (gone dark, still winnable)
  if (dsa == null || dsa >= DORMANT_DAYS) {
    const sig = dsa == null ? 'No recent activity' : `No activity in ${Math.round(dsa)}+ days`;
    return { score: 95, risk_tier: 'critical', state: 'dormant', primary_driver: 'dormant', explanation: explainEN('dormant', days, freq), trend: 'declining', key_signals: [sig], signals: {} };
  }

  const layerA: Record<string, Sig> = isOnboarding
    ? {
        habit_formation: sigHabitFormation(m.visitsSoFar, tenureDays),
        recency: sigRecency(dsa, 28, 10),
        activation: sigActivation(m.firstWorkoutLogged, tenureDays),
      }
    : {
        recency: sigRecency(dsa, 25, 18),
        frequency: sigFrequency(m.avgWeeklyVisits, m.trainingFrequency, m.cohortPercentile),
        trend: sigTrend(m.recentWeeklyRate, m.baselineWeeklyRate),
        streak: sigStreak(m.streakActive, m.brokenStreakLen),
      };
  // Low-frequency baseline guard (mirror riskScoring.js): dampen the absolute
  // frequency penalty for members stable at their own cadence.
  if (!isOnboarding && layerA.frequency && layerA.trend && layerA.trend.score === 0
      && layerA.trend.dir !== 'down' && (m.baselineWeeklyRate ?? 0) >= 0.25) {
    layerA.frequency = { ...layerA.frequency, score: round1(layerA.frequency.score * 0.55) };
  }
  const layerB: Record<string, Sig> = isOnboarding ? {} : {
    app_decline: sigAppDecline(m.app.baseline, m.app.recent),
    challenge_decline: sigChallengeDecline(m.challenge.baseline, m.challenge.recent),
    logging_decline: sigLoggingDecline(m.logging.baseline, m.logging.recent),
    rewards_decline: sigRewardsDecline(m.rewards.baseline, m.rewards.recent),
    social_decline: sigSocialDecline(m.social.baseline, m.social.recent),
    goals_decline: sigGoalsDecline(m.goalsPRs.baseline, m.goalsPRs.recent),
  };

  const sumLayer = (layer: Record<string, Sig>) =>
    Object.entries(layer).reduce((acc, [k, s]) => acc + s.score * (w[k] ?? 1), 0);
  const attRisk = Math.max(0, sumLayer(layerA));
  const engRisk = Math.max(0, sumLayer(layerB));
  const bonus = bonusProtective(m);

  let risk = (attRisk + engRisk) * tenureMultiplier(m.tenureMonths);
  if (attRisk <= GATE_THRESHOLD) risk = Math.min(risk, MEDIUM_CAP);
  risk = Math.max(0, Math.min(100, risk + bonus));
  const score = round1(risk);

  const signals = { ...layerA, ...layerB };
  const driver = classifyDriver(attRisk, engRisk, score, isOnboarding);
  const keySignals = Object.values(signals).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((s) => s.label);
  if (keySignals.length === 0) keySignals.push('Engagement looks healthy');
  const trend = layerA.trend?.dir === 'down' ? 'declining' : layerA.trend?.dir === 'up' ? 'improving' : 'stable';

  return { score, risk_tier: getRiskTier(score), state: 'scored', primary_driver: driver, explanation: explainEN(driver, days, freq), trend, key_signals: keySignals, signals };
}

// ── Main handler ─────────────────────────────────────────────
serve(async (req) => {
  if (!corsHeaders) return new Response('Server misconfiguration: ALLOWED_ORIGIN not set', { status: 500 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  try {
    function timingSafeEqual(a: string, b: string): boolean {
      if (a.length !== b.length) return false;
      const enc = new TextEncoder();
      const bufA = enc.encode(a), bufB = enc.encode(b);
      let result = 0;
      for (let i = 0; i < bufA.length; i++) result |= bufA[i] ^ bufB[i];
      return result === 0;
    }

    const cronSecret = Deno.env.get('CRON_SECRET');
    const authHeader = req.headers.get('Authorization') ?? '';
    const incomingSecret = req.headers.get('X-Cron-Secret') ?? '';
    const isCronAuth = cronSecret && incomingSecret && timingSafeEqual(cronSecret, incomingSecret);
    if (!isCronAuth) {
      const token = authHeader.replace('Bearer ', '');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!token || !serviceKey || !timingSafeEqual(token, serviceKey)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const nowMs = now.getTime();
    const ninetyDaysAgo = new Date(nowMs - 90 * MS_PER_DAY).toISOString();
    const sixtyDaysAgo = new Date(nowMs - 60 * MS_PER_DAY).toISOString();
    const thirtyDaysAgo = new Date(nowMs - 30 * MS_PER_DAY).toISOString();
    const fourteenDaysAgo = new Date(nowMs - 14 * MS_PER_DAY).toISOString();

    const { data: gyms } = await supabase.from('gyms').select('id');
    if (!gyms?.length) return new Response(JSON.stringify({ message: 'No gyms found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let totalScored = 0, totalFollowups = 0, highRiskCount = 0;

    for (const gym of gyms) {
      const gymId = gym.id;

      // Per-gym adaptive weights (blended with defaults via confidence)
      let gymWeights = { ...DEFAULT_WEIGHTS };
      try {
        const { data: wRow } = await supabase.from('gym_churn_weights').select('*').eq('gym_id', gymId).single();
        if (wRow && wRow.confidence > 0) {
          const c = wRow.confidence;
          for (const key of Object.keys(DEFAULT_WEIGHTS)) {
            const col = `w_${key}`;
            if (wRow[col] != null) gymWeights[key] = wRow[col] * c + DEFAULT_WEIGHTS[key] * (1 - c);
          }
        }
      } catch (_) { /* defaults */ }

      const { data: members } = await supabase
        .from('profiles')
        .select('id, created_at, membership_started_at, last_active_at, preferred_training_days, membership_status, phone_number, churn_pause_until')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .eq('imported_archived', false)
        .in('membership_status', ['active', 'frozen']);
      if (!members?.length) continue;

      const memberIds = members.map((m: any) => m.id);

      const [checkInsRes, sessions90Res, allSessionsRes, feedRes, notifRes, challengeRes, referralsRes, bodyRes] = await Promise.all([
        supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', sixtyDaysAgo).in('profile_id', memberIds).limit(20000),
        supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').gte('started_at', ninetyDaysAgo).in('profile_id', memberIds).limit(20000),
        supabase.from('workout_sessions').select('profile_id, started_at').eq('gym_id', gymId).eq('status', 'completed').in('profile_id', memberIds).limit(50000),
        supabase.from('activity_feed_items').select('actor_id, created_at, type').eq('gym_id', gymId).gte('created_at', ninetyDaysAgo).in('actor_id', memberIds).limit(20000),
        supabase.from('notifications').select('profile_id, read_at, created_at').gte('created_at', ninetyDaysAgo).in('profile_id', memberIds).limit(30000),
        supabase.from('challenge_participants').select('profile_id, joined_at').in('profile_id', memberIds).limit(20000),
        supabase.from('referrals').select('referrer_id').in('referrer_id', memberIds).limit(10000),
        supabase.from('body_weight_logs').select('profile_id, logged_at').eq('gym_id', gymId).gte('logged_at', ninetyDaysAgo).in('profile_id', memberIds).limit(20000),
      ]);

      const checkIns = checkInsRes.data || [];
      const sessions90 = sessions90Res.data || [];
      const allSessions = allSessionsRes.data || [];
      const feed = feedRes.data || [];
      const notifs = notifRes.data || [];
      const challenges = challengeRes.data || [];
      const referrals = referralsRes.data || [];
      const bodyLogs = bodyRes.data || [];

      const blank = () => ({ recent: 0, base: 0 });
      const ensure = (map: Record<string, any>, id: string) => (map[id] || (map[id] = blank()));

      const lastCheckIn: Record<string, string> = {};
      const ci30: Record<string, number> = {}, ci14: Record<string, number> = {}, ci14to60: Record<string, number> = {}, ciTotal: Record<string, number> = {};
      checkIns.forEach((r: any) => {
        const id = r.profile_id, t = r.checked_in_at;
        if (!lastCheckIn[id]) lastCheckIn[id] = t;
        ciTotal[id] = (ciTotal[id] || 0) + 1;
        if (t >= thirtyDaysAgo) ci30[id] = (ci30[id] || 0) + 1;
        if (t >= fourteenDaysAgo) ci14[id] = (ci14[id] || 0) + 1;
        if (t >= sixtyDaysAgo && t < fourteenDaysAgo) ci14to60[id] = (ci14to60[id] || 0) + 1;
      });

      const lastSession: Record<string, string> = {};
      const logging: Record<string, any> = {};
      sessions90.forEach((r: any) => {
        const id = r.profile_id, t = r.started_at;
        if (!lastSession[id]) lastSession[id] = t;
        const b = ensure(logging, id);
        if (t >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
      });

      const totalSessionsMap: Record<string, number> = {};
      allSessions.forEach((r: any) => { totalSessionsMap[r.profile_id] = (totalSessionsMap[r.profile_id] || 0) + 1; });

      const social: Record<string, any> = {}, prs: Record<string, any> = {}, lastSocialAt: Record<string, string> = {};
      feed.forEach((r: any) => {
        const id = r.actor_id, t = r.created_at, isPR = r.type === 'pr_hit';
        if (!isPR && !lastSocialAt[id]) lastSocialAt[id] = t;
        const b = isPR ? ensure(prs, id) : ensure(social, id);
        if (t >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
      });

      const appReads: Record<string, any> = {};
      notifs.forEach((r: any) => {
        if (!r.read_at) return;
        const b = ensure(appReads, r.profile_id);
        if (r.created_at >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
      });

      const body: Record<string, any> = {};
      bodyLogs.forEach((r: any) => {
        const b = ensure(body, r.profile_id);
        if (r.logged_at >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
      });

      const challenge: Record<string, any> = {};
      challenges.forEach((r: any) => {
        const b = ensure(challenge, r.profile_id);
        if (r.joined_at && r.joined_at >= thirtyDaysAgo) b.recent += 1; else b.base += 1;
      });

      const referralCount: Record<string, number> = {};
      referrals.forEach((r: any) => { referralCount[r.referrer_id] = (referralCount[r.referrer_id] || 0) + 1; });

      // Cohort frequency percentile
      const allFreq = members.map((m: any) => (ci30[m.id] || 0) / 4.33).sort((a: number, b: number) => a - b);
      const cohortPct = (f: number): number | null => {
        if (!allFreq.length) return null;
        let lo = 0; for (const v of allFreq) { if (v < f) lo++; else break; }
        return lo / allFreq.length;
      };

      const rows: any[] = [];
      const memberSignals: Record<string, any> = {};

      for (const m of members) {
        const tenureAnchor = m.membership_started_at ? new Date(m.membership_started_at) : new Date(m.created_at);
        const tenureMonths = (nowMs - tenureAnchor.getTime()) / (MS_PER_DAY * 30.44);

        // Recency = gym ATTENDANCE only (check-in / logged workout), NOT last_active_at (app-open).
        const cands = [lastCheckIn[m.id], lastSession[m.id]].filter(Boolean).map((t: string) => new Date(t).getTime());
        const lastSeenMs = cands.length ? Math.max(...cands) : 0;
        const daysSinceLastActivity = lastSeenMs > 0 ? (nowMs - lastSeenMs) / MS_PER_DAY : null;
        const daysSinceLastCheckIn = lastCheckIn[m.id] ? (nowMs - new Date(lastCheckIn[m.id]).getTime()) / MS_PER_DAY : null;

        const lg = logging[m.id] || blank(), sc = social[m.id] || blank(), pr = prs[m.id] || blank();
        const ap = appReads[m.id] || blank(), bd = body[m.id] || blank(), ch = challenge[m.id] || blank();
        const avgWeeklyVisits = (ci30[m.id] || 0) / 4.33;
        const totalSessions = totalSessionsMap[m.id] || 0;
        const observedCheckIns = ciTotal[m.id] || 0;

        const input: V3Input = {
          tenureMonths,
          accountAgeDays: (nowMs - new Date(m.created_at).getTime()) / MS_PER_DAY,
          totalSessions, observedCheckIns, daysSinceLastActivity, daysSinceLastCheckIn,
          avgWeeklyVisits,
          trainingFrequency: m.preferred_training_days?.length ?? 3,
          cohortPercentile: cohortPct(avgWeeklyVisits),
          recentWeeklyRate: (ci14[m.id] || 0) / 2,
          baselineWeeklyRate: (ci14to60[m.id] || 0) / ((60 - 14) / 7),
          streakActive: false, brokenStreakLen: 0,
          visitsSoFar: observedCheckIns, firstWorkoutLogged: totalSessions > 0,
          logging: { baseline: lg.base / 2, recent: lg.recent },
          app: { baseline: ap.base / 2, recent: ap.recent },
          social: { baseline: sc.base / 2, recent: sc.recent },
          goalsPRs: { baseline: (pr.base + bd.base) / 2, recent: pr.recent + bd.recent },
          challenge: { baseline: ch.base / 2, recent: ch.recent },
          rewards: { baseline: null, recent: 0 },
          activeReferrer: (referralCount[m.id] || 0) >= 1,
          activeChallenge: ch.recent > 0,
          recentPRs: pr.recent > 0,
          strongAppCard: (ap.recent >= 3) || (sc.recent >= 3),
          activeSocial: sc.recent > 0,
          isPaused: m.membership_status === 'frozen' || (m.churn_pause_until != null && new Date(m.churn_pause_until).getTime() > nowMs),
        };

        const result = computeV3(input, gymWeights);
        memberSignals[m.id] = result.signals;
        if (result.risk_tier === 'high' || result.risk_tier === 'critical') highRiskCount++;

        rows.push({
          profile_id: m.id,
          gym_id: gymId,
          score: result.score,
          risk_tier: result.risk_tier,
          state: result.state,
          primary_driver: result.primary_driver,
          explanation: result.explanation,
          trend: result.trend,
          signal_count: Object.keys(result.signals).length,
          key_signals: result.key_signals,
          velocity: 0,
          metrics: { avgWeeklyVisits, tenureMonths, daysSinceLastActivity, attendance: true },
          computed_at: now.toISOString(),
        });
      }

      if (rows.length > 0) {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
        await supabase.from('churn_risk_scores').delete().eq('gym_id', gymId).gte('computed_at', todayStart).lt('computed_at', tomorrowStart);
        const { error: insertError } = await supabase.from('churn_risk_scores').insert(rows);
        if (insertError) console.error(`Insert error for gym ${gymId}:`, insertError);
        totalScored += rows.length;
      }

      // ── Automated follow-ups (multi-channel drip) — unchanged ──
      const { data: settings } = await supabase.from('churn_followup_settings').select('*').eq('gym_id', gymId).single();
      if (settings?.enabled) {
        const threshold = settings.threshold || 61;
        const cooldownDays = settings.cooldown_days || 7;
        const cooldownDate = new Date(nowMs - cooldownDays * MS_PER_DAY).toISOString();
        const { data: dripSteps } = await supabase.from('drip_campaign_steps')
          .select('step_number, delay_days, message_template, message_b, channel').eq('gym_id', gymId).order('step_number', { ascending: true });
        const stepsToUse = dripSteps?.length ? dripSteps : [{ step_number: 1, delay_days: 0, message_template: settings.message_template, message_b: null, channel: 'notification' }];

        // Active A/B win-back experiments for this gym. When one applies to a
        // member we send its variant's message and tag the attempt with the
        // campaign id, so the automated drip feeds the A/B Testing page (not just
        // the manual Win-Back modal). Prefer a campaign whose target tier matches
        // the member; otherwise fall back to the most recent active campaign.
        const { data: activeCampaigns } = await supabase
          .from('winback_campaigns')
          .select('id, target_tier, variant_a, variant_b')
          .eq('gym_id', gymId)
          .eq('is_active', true)
          .is('ended_at', null)
          .order('created_at', { ascending: false });

        const atRisk = rows.filter((r) => r.score >= threshold);
        const atRiskIds = atRisk.map((r) => r.profile_id);
        let existingAttempts: any[] = [];
        if (atRiskIds.length) {
          const { data: attempts } = await supabase.from('win_back_attempts').select('user_id, step_number, created_at').eq('gym_id', gymId).in('user_id', atRiskIds).order('step_number', { ascending: false });
          existingAttempts = attempts || [];
        }
        const memberStepMap: Record<string, { step: number; created_at: string }> = {};
        existingAttempts.forEach((a: any) => {
          if (!memberStepMap[a.user_id] || a.step_number > memberStepMap[a.user_id].step) memberStepMap[a.user_id] = { step: a.step_number, created_at: a.created_at };
        });
        const phoneMap: Record<string, string> = {};
        members!.forEach((m: any) => { if (m.phone_number) phoneMap[m.id] = m.phone_number; });

        for (const member of atRisk) {
          const lastAttempt = memberStepMap[member.profile_id];
          let nextStepNum: number;
          if (!lastAttempt) nextStepNum = 1;
          else {
            const nextStep = stepsToUse.find((s) => s.step_number === lastAttempt.step + 1);
            if (!nextStep) continue;
            const daysSinceLastStep = (nowMs - new Date(lastAttempt.created_at).getTime()) / MS_PER_DAY;
            if (daysSinceLastStep < nextStep.delay_days) continue;
            nextStepNum = nextStep.step_number;
          }
          const step = stepsToUse.find((s) => s.step_number === nextStepNum);
          if (!step) continue;
          const { data: recent } = await supabase.from('notifications').select('id').eq('profile_id', member.profile_id).eq('type', 'churn_followup').gte('created_at', cooldownDate).limit(1);
          if (recent && recent.length > 0) continue;
          // Sticky variant assignment per member (id parity) so a member always
          // sees the same arm across drip steps — clean A/B measurement.
          const parityB = parseInt(member.profile_id.slice(-1), 16) % 2 === 1;
          const memberTier = String(member.risk_tier || '').toLowerCase();
          const campaign = (activeCampaigns || []).find((c: any) => String(c.target_tier || '').toLowerCase() === memberTier)
            || (activeCampaigns || [])[0] || null;
          let variant: 'A' | 'B';
          let template: string;
          let campaignId: string | null = null;
          if (campaign) {
            // Drive content from the experiment's variant; tag the attempt so it
            // counts toward this campaign's results on the A/B Testing page.
            variant = parityB ? 'B' : 'A';
            const cv = variant === 'B' ? campaign.variant_b : campaign.variant_a;
            template = (cv && cv.message) ? cv.message : (step.message_b && parityB ? step.message_b! : step.message_template);
            campaignId = campaign.id;
          } else {
            // No active experiment — fall back to the drip step's own A/B.
            variant = (step.message_b && parityB) ? 'B' : 'A';
            template = (step.message_b && parityB) ? step.message_b! : step.message_template;
          }
          const channel = step.channel || 'notification';
          if (channel === 'notification') {
            await supabase.from('notifications').insert({ profile_id: member.profile_id, gym_id: gymId, type: 'churn_followup', title: 'We miss you!', body: template, data: { source: 'churn_auto', score: member.score, tier: member.risk_tier, step: nextStepNum } });
          } else if (channel === 'email') {
            try { await fetch(`${SUPABASE_URL}/functions/v1/send-admin-email`, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: member.profile_id, subject: 'We miss you!', body: template, lang: 'en' }) }); } catch (e) { console.error('Drip email failed:', e); }
          } else if (channel === 'sms') {
            if (phoneMap[member.profile_id]) {
              try { await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: member.profile_id, body: template.slice(0, 320), source: 'automated', gymId }) }); } catch (e) { console.error('Drip SMS failed:', e); }
            }
          }
          try {
            await supabase.from('win_back_attempts').insert({ user_id: member.profile_id, gym_id: gymId, admin_id: '00000000-0000-0000-0000-000000000000', message: template, outcome: 'no_response', step_number: nextStepNum, variant, ...(campaignId ? { message_template: campaignId } : {}), created_at: now.toISOString() });
          } catch (_) {}
          totalFollowups++;
        }
        await supabase.from('churn_followup_settings').update({ last_run_at: now.toISOString(), last_run_count: atRisk.length }).eq('gym_id', gymId);
      }

      // ── Auto-label churn outcomes (feeds calibration) ──
      const outcomeInserts: any[] = [];
      for (const m of members) {
        const memberScore = rows.find((r) => r.profile_id === m.id);
        if (!memberScore) continue;
        const tenure = (nowMs - new Date(m.membership_started_at || m.created_at).getTime()) / (MS_PER_DAY * 30.44);
        const lastCI = lastCheckIn[m.id];
        const lastSess = lastSession[m.id];
        const lastActivity = [m.last_active_at, lastCI, lastSess].filter(Boolean).map((t: string) => new Date(t).getTime());
        const daysSinceActivity = lastActivity.length ? (nowMs - Math.max(...lastActivity)) / MS_PER_DAY : 999;
        const snap = memberSignals[m.id] || {};
        if (daysSinceActivity >= 60) outcomeInserts.push({ profile_id: m.id, gym_id: gymId, churned: true, reason: 'inactive_60d', signal_snapshot: snap, score_at_label: memberScore.score });
        else if (daysSinceActivity >= 30) outcomeInserts.push({ profile_id: m.id, gym_id: gymId, churned: true, reason: 'inactive_30d', signal_snapshot: snap, score_at_label: memberScore.score });
        if (m.membership_status === 'cancelled') outcomeInserts.push({ profile_id: m.id, gym_id: gymId, churned: true, reason: 'cancelled', signal_snapshot: snap, score_at_label: memberScore.score });
        else if (m.membership_status === 'frozen') outcomeInserts.push({ profile_id: m.id, gym_id: gymId, churned: true, reason: 'frozen', signal_snapshot: snap, score_at_label: memberScore.score });
        if (tenure >= 6 && daysSinceActivity < 14 && m.membership_status === 'active') outcomeInserts.push({ profile_id: m.id, gym_id: gymId, churned: false, reason: 'retained_6m', signal_snapshot: snap, score_at_label: memberScore.score });
      }
      if (outcomeInserts.length > 0) {
        for (const outcome of outcomeInserts) {
          await supabase.from('churn_outcomes').insert(outcome).then(() => {});
        }
      }
    }

    return new Response(JSON.stringify({ success: true, scored: totalScored, highRiskCount, followups_sent: totalFollowups, computed_at: now.toISOString() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('compute-churn-scores error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
