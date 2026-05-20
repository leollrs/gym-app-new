/**
 * Pure data + math helpers for the Admin → A/B Testing page. Owns the
 * Supabase fetcher, per-variant aggregation, and the two-proportion z-test
 * used to declare winners. No React — safe to import anywhere.
 */

import {
  TrendingUp, Bell, Mail, Tag, Zap, Dumbbell,
} from 'lucide-react';
import { supabase } from '../supabase';

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
export async function fetchABTestingData(gymId) {
  const [campaignsRes, attemptsRes] = await Promise.all([
    supabase
      .from('winback_campaigns')
      .select('*')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false }),
    supabase
      .from('win_back_attempts')
      .select('id, variant, message_template, outcome, responded_at, created_at')
      .eq('gym_id', gymId),
  ]);

  return {
    campaigns: campaignsRes.data || [],
    attempts: attemptsRes.data || [],
  };
}

// ── Helpers ────────────────────────────────────────────────
export function calcVariantStats(attempts, campaignId, variant) {
  const rows = attempts.filter(
    (a) => a.message_template === campaignId && a.variant === variant,
  );
  const sent = rows.length;
  const responded = rows.filter((a) => a.responded_at != null).length;
  const returned = rows.filter((a) => a.outcome === 'returned').length;
  return {
    sent,
    responded,
    returned,
    responseRate: sent > 0 ? ((responded / sent) * 100).toFixed(1) : '0.0',
    returnRate: sent > 0 ? ((returned / sent) * 100).toFixed(1) : '0.0',
  };
}

// Two-proportion z-test (one-sided / two-sided gives the same |z|).
// Returns { significant, marginal, winner, zScore, requiresMoreData, perArmSize }.
//
// Significance rule:
//   - Each arm needs ≥30 samples (rule of thumb for normal approximation
//     and to keep early stopping from declaring noise as a winner).
//   - |z| ≥ 1.96 → significant at 95% (p ≈ 0.05).
//   - |z| ≥ 1.645 → marginal (90% confidence).
//
// metric: 'response' or 'return' — picks which numerator to use.
export function abSignificance(statsA, statsB, metric = 'return') {
  const xA = metric === 'response' ? statsA.responded : statsA.returned;
  const xB = metric === 'response' ? statsB.responded : statsB.returned;
  const nA = statsA.sent;
  const nB = statsB.sent;
  const MIN_PER_ARM = 30;

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

export function getKeyMetric(type, statsA, statsB) {
  // Return the most relevant metric label and values per type
  if (type === 'email' || type === 'push_notification') {
    return { label: 'responseRate', a: statsA.responseRate, b: statsB.responseRate };
  }
  return { label: 'returnRate', a: statsA.returnRate, b: statsB.returnRate };
}
