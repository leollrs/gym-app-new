/**
 * Pure data + math helpers for the Admin → A/B Testing page. Owns the
 * Supabase fetcher, per-variant aggregation, and the two-proportion z-test
 * used to declare winners. No React — safe to import anywhere.
 */

import {
  TrendingUp, Bell, Mail, Tag, Zap, Dumbbell,
} from 'lucide-react';
import { supabase } from '../supabase';
import logger from '../logger';
import { selectAllInBatches } from '../churn/batchedSelect';
import { autoDetectReturns } from '../churn/adminQueries';

// ── Constants ──────────────────────────────────────────────
export const EXPERIMENT_TYPES = {
  win_back:          { color: 'var(--color-danger)', icon: TrendingUp },
  push_notification: { color: 'var(--color-success)', icon: Bell },
  email:             { color: 'var(--color-info)', icon: Mail },
  offer:             { color: 'var(--color-warning)', icon: Tag },
  challenge:         { color: 'var(--color-coach)', icon: Zap },
  class_promo:       { color: 'var(--color-accent)', icon: Dumbbell },
};

export const TIER_COLORS = {
  critical: { bg: 'var(--color-danger-soft)', text: 'var(--color-danger)', border: 'var(--color-danger-soft)' },
  high:     { bg: 'var(--color-warning-soft)', text: 'var(--color-warning)', border: 'var(--color-warning-soft)' },
  medium:   { bg: 'var(--color-info-soft)', text: 'var(--color-info)', border: 'var(--color-info-soft)' },
};

// ── Data fetcher ───────────────────────────────────────────
// `redemption_id` solo existe tras la mig 0706. Si no está aplicada PostgREST
// rechaza el SELECT ENTERO — no devuelve la columna vacía, falla la consulta —
// y quedarse sin `attempts` vaciaría el embudo completo. De ahí el reintento.
//
// `responded_at` ya no se pide: la columna existe (mig 0166) pero NADIE la
// escribe en todo el repo, así que cualquier ratio sobre ella daba 0.0% fijo.
const ATTEMPT_COLS = 'id, user_id, variant, message_template, outcome, created_at, redemption_id';
const ATTEMPT_COLS_PRE_0706 = 'id, user_id, variant, message_template, outcome, created_at';

// Mismo criterio que la página de Recompensas del socio (`Rewards.jsx`): el
// canje cuenta como cumplido en cualquiera de estos estados.
const CLAIMED_STATUSES = new Set(['claimed', 'redeemed', 'approved', 'completed', 'fulfilled']);
export const isClaimedStatus = (s) => CLAIMED_STATUSES.has(String(s || '').toLowerCase());

export async function fetchABTestingData(gymId) {
  const [campaignsRes, attemptsRes] = await Promise.all([
    supabase
      .from('winback_campaigns')
      .select('*')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false }),
    supabase.from('win_back_attempts').select(ATTEMPT_COLS).eq('gym_id', gymId),
  ]);

  let attempts = attemptsRes.data || [];
  if (attemptsRes.error) {
    const retry = await supabase
      .from('win_back_attempts')
      .select(ATTEMPT_COLS_PRE_0706)
      .eq('gym_id', gymId);
    attempts = retry.data || [];
  }

  // El resultado se refresca AQUÍ. `autoDetectReturns` solo se llamaba desde
  // Riesgo de Baja, así que «Recuperados» en esta página enseñaba lo que
  // hubiera dejado la última visita a la OTRA página. Ahora se mantiene sola.
  try {
    const detected = await autoDetectReturns(attempts, gymId, supabase);
    if (detected?.attempts) attempts = detected.attempts;
  } catch (err) {
    logger.error('A/B: auto-detect returns failed', err);
  }

  // Canjes atados a estos envíos. Acotado con `.in('id', ids)` a los que TIENEN
  // vínculo: `reward_redemptions` de un gimnasio pasa de 1000 filas y el tope de
  // PostgREST truncaría en silencio si pidiéramos la tabla entera.
  const linkedIds = [...new Set(attempts.map((a) => a.redemption_id).filter(Boolean))];
  const { data: redemptionRows } = await selectAllInBatches(
    (ids, from, to) => supabase
      .from('reward_redemptions')
      .select('id, status')
      .eq('gym_id', gymId)
      .in('id', ids)
      .order('id', { ascending: true })
      .range(from, to),
    linkedIds,
  );

  // Objeto plano, NO un Map: React Query se persiste a localStorage en esta app
  // y `JSON.stringify(new Map())` da `{}` — al rehidratar el `.get()` reventaría.
  const redemptionStatus = {};
  for (const r of redemptionRows || []) redemptionStatus[r.id] = r.status;

  return {
    campaigns: campaignsRes.data || [],
    attempts,
    redemptionStatus,
  };
}

// ── Helpers ────────────────────────────────────────────────
export function calcVariantStats(attempts, campaignId, variant) {
  const rows = attempts.filter(
    (a) => a.message_template === campaignId && a.variant === variant,
  );
  const sent = rows.length;
  const returned = rows.filter((a) => a.outcome === 'returned').length;
  return {
    sent,
    returned,
    returnRate: sent > 0 ? ((returned / sent) * 100).toFixed(1) : '0.0',
  };
}

// Two-proportion z-test (one-sided / two-sided gives the same |z|).
// Returns { significant, marginal, winner, zScore, requiresMoreData, perArmSize }.
//
// Significance rule:
//   - Cada brazo necesita MIN_PER_ARM muestras.
//   - |z| ≥ 1.96 → significant at 95% (p ≈ 0.05).
//   - |z| ≥ 1.645 → marginal (90% confidence).
//
// EL SUELO ERA 30 Y ERA MENTIRA. 30 es la regla de bolsillo para que la
// aproximación normal valga, NO un cálculo de potencia. Con 30 por brazo el
// test cantaba ganador con ruido puro: para detectar 20%→30% al 80% de potencia
// y α=0.05 hacen falta ~294 por brazo, y ~1.100 para 20%→25%.
//
//     n ≈ 2·(1,96+0,84)²·p̄(1-p̄) / δ²
//
// 300 es ese número redondeado, o sea el mínimo con el que «ganó A» significa
// algo. Un gimnasio solo tarda años en llegar ahí — esa es justamente la
// respuesta honesta, y por eso la tarjeta lo dice en vez de inventar un ganador.
export function abSignificance(statsA, statsB) {
  const xA = statsA.returned;
  const xB = statsB.returned;
  const nA = statsA.sent;
  const nB = statsB.sent;
  const MIN_PER_ARM = 300;

  if (nA < MIN_PER_ARM || nB < MIN_PER_ARM) {
    return {
      significant: false,
      marginal: false,
      winner: null,
      zScore: null,
      requiresMoreData: true,
      perArmSize: { a: nA, b: nB, min: MIN_PER_ARM },
    };
  }

  const pA = xA / nA;
  const pB = xB / nB;
  const pPooled = (xA + xB) / (nA + nB);
  const seSquared = pPooled * (1 - pPooled) * ((1 / nA) + (1 / nB));
  // Edge case: pPooled is 0 or 1 → SE is 0 → variance is undefined. Treat as
  // not enough variation to call it.
  if (seSquared <= 0) {
    return { significant: false, marginal: false, winner: null, zScore: 0, requiresMoreData: false, perArmSize: { a: nA, b: nB, min: MIN_PER_ARM } };
  }
  const z = (pA - pB) / Math.sqrt(seSquared);
  const absZ = Math.abs(z);

  return {
    significant: absZ >= 1.96,
    marginal: absZ >= 1.645 && absZ < 1.96,
    winner: absZ >= 1.645 ? (z > 0 ? 'A' : 'B') : null,
    zScore: z,
    requiresMoreData: false,
    perArmSize: { a: nA, b: nB, min: MIN_PER_ARM },
  };
}

export function getExperimentType(campaign) {
  return campaign.type
    || campaign.variant_a?.experiment_type
    || 'win_back';
}

export function getVariantSummary(variant, t) {
  if (!variant) return '—';
  const parts = [];
  if (variant.offer_type) {
    // Translate stable enum key (e.g., 'pt_session'); falls back to raw value
    // for any legacy rows that stored an English label directly.
    parts.push(
      t
        ? t(`admin.churn.campaign.offer.${variant.offer_type}`, variant.offer_type)
        : variant.offer_type,
    );
  }
  if (variant.discount_pct) parts.push(`${variant.discount_pct}%`);
  if (variant.free_days) parts.push(`${variant.free_days}d free`);
  if (parts.length > 0) return parts.join(' · ');
  if (variant.message) return variant.message.slice(0, 40) + (variant.message.length > 40 ? '...' : '');
  return '—';
}

// Siempre la tasa de retorno. Antes, para email y push, devolvía `responseRate`
// — que se calculaba sobre `responded_at`, la columna que nadie escribe — así
// que justo esos dos tipos enseñaban 0.0% en las dos variantes hiciera lo que
// hiciera el mensaje. Volver es el único desenlace que el sistema observa solo.
export function getKeyMetric(type, statsA, statsB) {
  return { label: 'returnRate', a: statsA.returnRate, b: statsB.returnRate };
}
