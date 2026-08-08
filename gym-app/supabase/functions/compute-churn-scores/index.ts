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

// ── Parámetros del modelo (refleja src/lib/churn/riskScoring.js + rhythm.js) ──
//
// v4: cada socio contra sí mismo. Fuera el ancla de 3×/semana con su
// amortiguador y su cuartil, fuera el multiplicador por antigüedad (que le
// ponía techo 69 al veterano, o sea inmunidad matemática) y fuera los overrides
// de 30/60 días como PUNTUACIÓN — siguen como estado, para ordenar la cola.
const ONBOARDING_DAYS = 75;
const GRACE_DAYS = 21;
const ACTIVATION_DEADLINE_DAYS = 21;
const LOST_DAYS = 60;
const DORMANT_DAYS = 30;
const BAND_CRITICAL = 70, BAND_HIGH = 45, BAND_MEDIUM = 25;

const CLASS_A_MIN_VISITS = 8, CLASS_A_MIN_SPAN = 42;
const G90_MIN = 3, G90_MAX = 21;

// Techos: cada señal aporta como mucho esta fracción, y se combinan con un
// OR-ruidoso `1 − Π(1 − señal)`. Suma normalizada NO: con ella, el socio de
// asistencia perfecta que desaparece tenía una sola señal encendida y su techo
// quedaba en 44 — no podía ser Crítico. Mismo error que el multiplicador de v3.
const CEIL_GAP = 0.85, CEIL_DROP = 0.45, CEIL_FLOOR = 0.30, CEIL_APP = 0.10;
const CEIL_HABIT = 0.60, CEIL_ONB_RECENCY = 0.55, CEIL_ACTIVATION = 0.40;

const DEFAULT_WEIGHTS: Record<string, number> = {
  gap: 1.0, drop: 1.0, floor: 1.0,
  habit: 1.0, onboarding_recency: 1.0, activation: 1.0, app_withdrawal: 1.0,
};

// `maxPts` además de `frac`: las barras de AdminChurn / MemberDetailPanel
// calculan `score / maxPts`. Sin él pintaban 0% y el panel enseñaba
// «42.5/undefined» — un build verde no ve eso.
type Sig = { frac: number; ceil: number; score: number; maxPts: number; label: string };
const sig = (frac: number, ceil: number, label: string): Sig =>
  ({ frac, ceil, score: pct1(frac), maxPts: pct1(ceil), label });
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct1 = (n: number) => Math.round(n * 1000) / 10;
const dayOf = (t: string | number | Date) => Math.floor(new Date(t).getTime() / MS_PER_DAY);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

type Rhythm = {
  klass: 'A' | 'B' | 'C' | 'none'; visits: number; spanDays: number;
  g90: number | null; daysSinceLastVisit: number | null;
  weeklyRate: number; drop: number | null;
};

function buildRhythm(visitDays: number[], todayDay: number): Rhythm {
  const days = [...new Set(visitDays)].sort((a, b) => a - b);
  if (days.length === 0) {
    return { klass: 'none', visits: 0, spanDays: 0, g90: null, daysSinceLastVisit: null, weeklyRate: 0, drop: null };
  }
  const first = days[0], last = days[days.length - 1];
  const spanDays = last - first;
  const daysSinceLastVisit = todayDay - last;
  const observedDays = Math.max(14, Math.min(90, todayDay - first + 1));
  const weeklyRate = (days.length / observedDays) * 7;

  // Caída medida HASTA LA ÚLTIMA VISITA, no hasta hoy: si no, el hueco actual se
  // come la ventana reciente y la caída dispara por la misma razón que la
  // brecha. Dos términos leyendo el mismo hecho es el pecado de v3.
  const cut = last;
  const recentN = days.filter((d) => d > cut - 21 && d <= cut).length;
  const baseN = days.filter((d) => d <= cut - 21).length;
  const baseSpan = Math.max(0, Math.min(69, cut - 21 - first + 1));
  const baseWeekly = baseSpan >= 21 ? (baseN / baseSpan) * 7 : 0;
  // Con menos de 1 visita/semana de base, 21 días esperan <3 visitas y el ratio
  // es ruido: al de 1×/mes le salía caída del 100% por saltarse UNA visita.
  // Sin recortar a 0: en negativo = venía más que antes, que es lo que hace
  // alcanzable `trend: 'improving'`. `sigDrop` manda los negativos a cero.
  const drop = baseWeekly >= 1 ? 1 - ((recentN / 21) * 7) / baseWeekly : null;

  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  gaps.sort((a, b) => a - b);

  if (days.length >= CLASS_A_MIN_VISITS && spanDays >= CLASS_A_MIN_SPAN) {
    return { klass: 'A', visits: days.length, spanDays, daysSinceLastVisit, weeklyRate, drop,
      g90: Math.max(G90_MIN, Math.min(G90_MAX, percentile(gaps, 0.9))) };
  }
  // Clase B: con 3+ intervalos ya se sabe cuánto es mucho PARA ESTA PERSONA. Se
  // usa el más largo visto (conservador). Sin esto, el de 1×/3 semanas caía a la
  // curva genérica y salía Crítico a los 30 días sin haber faltado a nada.
  if (gaps.length >= 3) {
    return { klass: 'B', visits: days.length, spanDays, daysSinceLastVisit, weeklyRate, drop,
      g90: Math.max(G90_MIN, Math.min(G90_MAX, gaps[gaps.length - 1])) };
  }
  return { klass: 'C', visits: days.length, spanDays, daysSinceLastVisit, weeklyRate, drop: null, g90: null };
}

const confidenceOf = (r: Rhythm) => (r.klass === 'A' ? 'high' : r.klass === 'B' ? 'medium' : 'low');

// ── Señales ──
function sigGap(d: number | null, g90: number | null): Sig {
  if (d == null || !g90) return sig(CEIL_GAP, CEIL_GAP, 'No recent activity');
  // Satura a 4× su ritmo: con 3× el socio regular de 1×/semana llegaba al máximo
  // a los 21 días (dos visitas perdidas) y salía Crítico.
  const frac = CEIL_GAP * clamp01((d / g90 - 1) / 3);
  return sig(frac, CEIL_GAP, frac === 0 ? 'On their usual rhythm' : `${Math.round(d)} days out — usually never past ${Math.round(g90)}`);
}
function sigDrop(drop: number | null): Sig | null {
  if (drop == null) return null;
  const frac = CEIL_DROP * clamp01((drop - 0.15) / 0.55);
  return sig(frac, CEIL_DROP, frac === 0 ? 'Holding their rate' : `Was coming ${Math.round(drop * 100)}% less`);
}
function sigFloor(weeklyRate: number): Sig {
  const frac = CEIL_FLOOR * clamp01((2 - (weeklyRate || 0)) / 2);
  return sig(frac, CEIL_FLOOR, frac === 0 ? 'Good visit volume' : `${(weeklyRate || 0).toFixed(1)} visits/week`);
}
function sigGapGeneric(d: number | null): Sig {
  if (d == null) return sig(CEIL_GAP, CEIL_GAP, 'No recent activity');
  const frac = CEIL_GAP * clamp01((d - 10) / 25);
  return sig(frac, CEIL_GAP, frac === 0 ? 'Came recently' : `${Math.round(d)} days since last visit`);
}
function sigHabit(visits: number, accountAgeDays: number): Sig {
  const weeks = Math.max(accountAgeDays / 7, 0.5);
  const expected = Math.min(weeks * 3, 18);
  const gap = clamp01((expected - (visits || 0)) / expected);
  const frac = CEIL_HABIT * gap;
  return sig(frac, CEIL_HABIT, gap <= 0.15 ? 'Building a routine' : `Not building a routine (${visits || 0} visits in ${Math.round(weeks)}w)`);
}
function sigOnboardingRecency(d: number | null): Sig {
  const dd = d == null ? 14 : d;
  const frac = CEIL_ONB_RECENCY * clamp01(dd / 14);
  return sig(frac, CEIL_ONB_RECENCY, frac === 0 ? 'Came recently' : `${Math.round(dd)} days since last visit`);
}
// Activación = TRES VISITAS AL GIMNASIO, no «registró un entreno en la app».
// v3 le quitaba 12 puntos a quien entrenaba a diario y no tocaba el móvil.
function sigActivation(visitsIn21d: number, accountAgeDays: number): Sig | null {
  if (accountAgeDays < 21) return null;
  const frac = CEIL_ACTIVATION * clamp01((3 - (visitsIn21d || 0)) / 3);
  return sig(frac, CEIL_ACTIVATION, frac === 0 ? 'Started well' : `Only ${visitsIn21d || 0} visits in their first weeks`);
}
// La app corrobora, nunca constituye. Sin base propia el término NO EXISTE.
function sigAppWithdrawal(baseline: number | null, recent: number): Sig | null {
  if (baseline == null || baseline < 6) return null;
  const drop = clamp01(1 - (recent || 0) / baseline);
  const frac = CEIL_APP * clamp01((drop - 0.4) / 0.6);
  return sig(frac, CEIL_APP, frac === 0 ? 'Still active in the app' : 'Stopped using the app');
}
// Proporcional, no restando puntos planos: −20 sobre un 25 lo dejaba en 5.
function protectionFactor(f: { activeChallenge: boolean; activeReferrer: boolean; recentPRs: boolean; activeSocial: boolean }): number {
  let p = 0;
  if (f.activeChallenge) p += 0.05;
  if (f.activeReferrer) p += 0.05;
  if (f.recentPRs) p += 0.03;
  if (f.activeSocial) p += 0.02;
  return Math.min(p, 0.15);
}

function getRiskTier(score: number): string {
  if (score >= BAND_CRITICAL) return 'critical';
  if (score >= BAND_HIGH) return 'high';
  if (score >= BAND_MEDIUM) return 'medium';
  return 'low';
}

function classifyDriver(terms: Record<string, Sig>, score: number, isOnboarding: boolean): string {
  if (score < BAND_MEDIUM) return 'healthy';
  if (isOnboarding) return 'onboarding';
  const gap = terms.gap?.frac ?? 0, drop = terms.drop?.frac ?? 0, floor = terms.floor?.frac ?? 0;
  if (gap >= 0.15 && drop >= 0.15) return 'both';
  if (gap >= drop && gap > 0) return 'gap';
  if (drop > 0) return 'drop';
  if (floor > 0) return 'volume';
  return 'gap';
}

// El cliente re-localiza desde `primary_driver`; esto es solo el respaldo.
function explainEN(driver: string, d: number | null, g90: number | null, drop: number | null, rate: number, accountAge: number | null = null): string {
  switch (driver) {
    case 'healthy': return 'Showing up consistently — looks healthy.';
    case 'gap': return d != null && g90 != null ? `${d} days out; usually never past ${g90}.` : `${d ?? 0} days since their last visit.`;
    case 'drop': return `Still coming, but a lot less than before: ${Math.round((drop ?? 0) * 100)}% less.`;
    case 'both': return 'Coming less often and now overdue for a visit.';
    case 'volume': return `Coming ${rate.toFixed(1)}× a week — thin for a habit to hold.`;
    case 'onboarding': return 'New member, not building a routine yet.';
    case 'dormant': return `No activity for ${d ?? 0}+ days.`;
    case 'new': return 'New member — not enough data to score yet.';
    case 'never_activated': return accountAge != null ? `Enrolled ${Math.round(accountAge)} days ago and has never come in.` : 'Has never come in.';
    case 'paused': return 'Membership on hold — alerts paused.';
    case 'churned': return `Likely lost — no activity for ${d ?? 0}+ days.`;
    default: return 'Attendance has dropped off.';
  }
}

type V4Input = {
  isPaused: boolean;
  accountAgeDays: number;
  rhythm: Rhythm;
  visitsIn21d: number;
  app: { baseline: number | null; recent: number };
  activeReferrer: boolean; activeChallenge: boolean; recentPRs: boolean; activeSocial: boolean;
};

function computeV4(m: V4Input, weights: Record<string, number>) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const r = m.rhythm;
  const dsv = r.daysSinceLastVisit;
  const hasFootprint = r.visits > 0;
  const conf = confidenceOf(r);
  const expl = (driver: string) => explainEN(driver, dsv, r.g90, r.drop, r.weeklyRate, m.accountAgeDays);
  const base = { signals: {} as Record<string, Sig>, confidence: conf };

  if (m.isPaused) {
    return { ...base, score: 0, risk_tier: 'low', state: 'paused', primary_driver: 'paused', explanation: expl('paused'), trend: 'stable', key_signals: ['On hold'] };
  }
  // Perdido ANTES que «nunca activó»: si no, el que se apuntó hace tres años y
  // no pisó el gimnasio se quedaba en 78 Alto para siempre, ordenando por encima
  // de gente recuperable. La cola se llenaba de fantasmas.
  const neverCameAndOld = !hasFootprint && m.accountAgeDays >= LOST_DAYS;
  if ((dsv != null && dsv >= LOST_DAYS) || neverCameAndOld) {
    return { ...base, score: 100, risk_tier: 'critical', state: 'churned',
      primary_driver: neverCameAndOld ? 'never_activated' : 'churned',
      explanation: expl(neverCameAndOld ? 'never_activated' : 'churned'), trend: 'declining', key_signals: ['No activity'] };
  }
  if (!hasFootprint && m.accountAgeDays >= ACTIVATION_DEADLINE_DAYS) {
    const weeksOverdue = Math.max(0, Math.floor((m.accountAgeDays - ACTIVATION_DEADLINE_DAYS) / 7));
    const score = Math.min(75, 55 + weeksOverdue * 3);
    return { ...base, score, risk_tier: getRiskTier(score), state: 'scored', primary_driver: 'never_activated', explanation: expl('never_activated'), trend: 'declining', key_signals: ['Never activated'] };
  }
  if (!hasFootprint || m.accountAgeDays < GRACE_DAYS) {
    return { ...base, score: 0, risk_tier: 'low', state: 'insufficient_data', primary_driver: 'new', explanation: expl('new'), trend: 'stable', key_signals: ['New member — not enough data yet'] };
  }

  const isOnboarding = m.accountAgeDays < ONBOARDING_DAYS;
  const terms: Record<string, Sig> = {};
  if (isOnboarding) {
    terms.habit = sigHabit(r.visits, m.accountAgeDays);
    terms.onboarding_recency = sigOnboardingRecency(dsv);
    const act = sigActivation(m.visitsIn21d, m.accountAgeDays);
    if (act) terms.activation = act;
  } else if (r.g90 != null) {
    terms.gap = sigGap(dsv, r.g90);
    const drop = sigDrop(r.drop);
    if (drop) terms.drop = drop;
    terms.floor = sigFloor(r.weeklyRate);
  } else {
    terms.gap = sigGapGeneric(dsv);
    terms.floor = sigFloor(r.weeklyRate);
  }
  const app = sigAppWithdrawal(m.app.baseline, m.app.recent);
  if (app) terms.app_withdrawal = app;

  let survive = 1;
  for (const [k, t] of Object.entries(terms)) survive *= (1 - Math.min(1, t.frac * (w[k] ?? 1)));
  const pct = (1 - survive) * 100;
  const score = round1(Math.max(0, Math.min(100, pct * (1 - protectionFactor(m)))));

  const driver = classifyDriver(terms, score, isOnboarding);
  const keySignals = Object.values(terms).filter((t) => t.frac > 0).sort((a, b) => b.frac - a.frac).slice(0, 3).map((t) => t.label);
  if (keySignals.length === 0) keySignals.push('Everything looks fine');

  return {
    score, risk_tier: getRiskTier(score),
    // «Dormido» es una ETIQUETA para ordenar la cola, ya no una puntuación.
    state: dsv != null && dsv >= DORMANT_DAYS ? 'dormant' : 'scored',
    primary_driver: driver, explanation: expl(driver),
    trend: r.drop != null && r.drop > 0.15 ? 'declining' : 'stable',
    key_signals: keySignals, signals: terms, confidence: conf,
  };
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
        supabase.from('check_ins').select('profile_id, checked_in_at').eq('gym_id', gymId).gte('checked_in_at', ninetyDaysAgo).in('profile_id', memberIds).limit(20000),
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
      // Check-in y entreno el MISMO día son UNA visita. v3 los contaba aparte,
      // así que a quien registraba sus entrenos se le inflaba la frecuencia.
      const visitDays: Record<string, Set<number>> = {};
      const addVisitDay = (id: string, t: string) => {
        if (!t) return;
        (visitDays[id] || (visitDays[id] = new Set<number>())).add(dayOf(t));
      };
      const ci30: Record<string, number> = {}, ci14: Record<string, number> = {}, ci14to60: Record<string, number> = {}, ciTotal: Record<string, number> = {};
      checkIns.forEach((r: any) => {
        const id = r.profile_id, t = r.checked_in_at;
        addVisitDay(id, r.checked_in_at);
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
        addVisitDay(id, r.started_at);
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

      const todayDay = dayOf(now);
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

        const accountAgeDays = (nowMs - new Date(m.created_at).getTime()) / MS_PER_DAY;
        const accountStartDay = dayOf(m.created_at);
        const memberDays = [...(visitDays[m.id] || [])];

        const input: V4Input = {
          isPaused: m.membership_status === 'frozen' || (m.churn_pause_until != null && new Date(m.churn_pause_until).getTime() > nowMs),
          accountAgeDays,
          rhythm: buildRhythm(memberDays, todayDay),
          // Activación = pisar el gimnasio 3 veces en sus primeras 3 semanas.
          visitsIn21d: memberDays.filter((d) => d <= accountStartDay + 21).length,
          app: { baseline: ap.base / 2, recent: ap.recent },
          activeReferrer: (referralCount[m.id] || 0) >= 1,
          activeChallenge: ch.recent > 0,
          recentPRs: pr.recent > 0,
          activeSocial: sc.recent > 0,
        };

        const result = computeV4(input, gymWeights);
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
          // El cliente RE-LOCALIZA la frase desde `primary_driver` + esto, así que
          // aquí tiene que viajar todo lo que la frase nombra. Sin `g90`/`drop` la
          // explicación traducida saldría con huecos en la ruta normal (precálculo
          // fresco) y solo se vería bien en el motor en vivo.
          metrics: {
            avgWeeklyVisits, tenureMonths, daysSinceLastActivity, attendance: true,
            g90: input.rhythm.g90, drop: input.rhythm.drop,
            weeklyRate: input.rhythm.weeklyRate, visits: input.rhythm.visits,
            daysSinceLastVisit: input.rhythm.daysSinceLastVisit,
            confidence: result.confidence, klass: input.rhythm.klass,
          },
          model_version: 4,
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

        // ── Holdout: el grupo al que NO se le escribe ──
        //
        // El A/B de abajo compara MENSAJE A contra MENSAJE B, así que sabe cuál
        // funciona mejor pero no si escribir sirve de algo. Este brazo se queda
        // en silencio y se registra igual, y como la detección de "returned"
        // (adminQueries.js) mira actividad posterior a la fila sin importarle el
        // brazo, la medición sale gratis.
        //
        // La asignación usa los DOS PRIMEROS caracteres hex del id, no el
        // último: el último ya decide el brazo A/B, y reusarlo ataría el holdout
        // a la variante — todos los holdout serían del mismo brazo.
        const holdoutPct = Math.max(0, Math.min(40, settings.holdout_pct ?? 0));
        const isHoldout = (profileId: string) =>
          holdoutPct > 0 && parseInt(profileId.slice(0, 2), 16) < (holdoutPct * 255) / 100;

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
          // Control silencioso: se registra que ERA elegible hoy y que
          // deliberadamente no se le escribió. Sin esta fila no hay con qué
          // comparar, y esto no se puede reconstruir hacia atrás.
          if (isHoldout(member.profile_id)) {
            try {
              await supabase.from('win_back_attempts').insert({ user_id: member.profile_id, gym_id: gymId, admin_id: '00000000-0000-0000-0000-000000000000', message: template, outcome: 'no_response', step_number: nextStepNum, variant: 'holdout', ...(campaignId ? { message_template: campaignId } : {}), created_at: now.toISOString() });
            } catch (_) {}
            continue;
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

      // ── Etiquetar desenlaces (alimenta la calibración) ──
      //
      // Aquí había CINCO reglas y cuatro eran circulares: definían "se fue" como
      // `daysSinceActivity >= 30/60` — la MISMA variable que el modelo usa de
      // entrada. Entrenar con eso le enseña al modelo a predecirse a sí mismo, y
      // refuerza justo el sesgo de recencia que el rediseño quiere quitarle. La
      // quinta era directamente falsa: marcaba `frozen` como baja, cuando el
      // propio scorer trata `frozen` como `paused` — una pausa de vacaciones.
      //
      // El objetivo real ("¿vino entre el día 31 y el 90?") lo etiqueta ahora
      // `label_churn_lapses()` por pg_cron (mig 0705), en SQL y sobre socios que
      // estaban VIVOS al puntuar, que es lo que lo hace una predicción y no un
      // eco. Aquí solo se queda la única verdad de base que esta función puede
      // ver: que alguien marcó la membresía como cancelada.
      const outcomeInserts: any[] = [];
      for (const m of members) {
        if (m.membership_status !== 'cancelled') continue;
        const memberScore = rows.find((r) => r.profile_id === m.id);
        if (!memberScore) continue;
        outcomeInserts.push({
          profile_id: m.id, gym_id: gymId, churned: true,
          reason: 'cancelled', source: 'gym_report',
          signal_snapshot: memberSignals[m.id] || {},
          score_at_label: memberScore.score,
          observed_at: now.toISOString().slice(0, 10),
        });
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
