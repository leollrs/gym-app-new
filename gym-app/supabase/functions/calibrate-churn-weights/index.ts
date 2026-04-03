/**
 * Calibrate Churn Weights — Supabase Edge Function
 * ────────────────────────────────────────────────────
 * Runs weekly (or on-demand). For each gym with enough labeled
 * churn outcomes (≥30), trains a logistic regression model on
 * the signal_snapshot data to learn which signals are most
 * predictive for THAT specific gym.
 *
 * The learned coefficients become per-gym weight multipliers
 * stored in gym_churn_weights. The scoring engine blends these
 * with the research-based defaults using Bayesian shrinkage:
 *
 *   confidence = min(1, labeled_outcomes / 200)
 *   effective_weight = learned * confidence + default * (1 - confidence)
 *
 * This means:
 *   - Gym with 30 outcomes → 15% learned, 85% research defaults
 *   - Gym with 100 outcomes → 50/50 blend
 *   - Gym with 200+ outcomes → fully trusts its own data
 *
 * Uses gradient descent logistic regression (no external ML libs).
 *
 * v2: 12 signals (added anchor_day, app_engagement,
 *     comms_responsiveness, referral_activity, workout_type_shift)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) console.warn('CORS: ALLOWED_ORIGIN env var not set, using default');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || 'https://app.tugympr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIGNAL_KEYS = [
  'visit_frequency',
  'attendance_trend',
  'tenure_risk',
  'social_engagement',
  'session_gaps',
  'goal_progress',
  'engagement_depth',
  // v2 signals
  'anchor_day',
  'app_engagement',
  'comms_responsiveness',
  'referral_activity',
  'workout_type_shift',
];

// Research-based max points per signal (used to normalize to 0–1 range)
// v2 rebalanced: 12 signals totaling 100 points
const SIGNAL_MAX: Record<string, number> = {
  visit_frequency: 22,
  attendance_trend: 14,
  tenure_risk: 12,
  social_engagement: 10,
  session_gaps: 7,
  goal_progress: 7,
  engagement_depth: 5,
  // v2 signals
  anchor_day: 8,
  app_engagement: 5,
  comms_responsiveness: 4,
  referral_activity: 3,
  workout_type_shift: 3,
};

const MIN_OUTCOMES = 30; // minimum labeled outcomes to attempt calibration

// ── Logistic Regression (pure math, no dependencies) ──────────

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Train logistic regression via gradient descent.
 * X: array of feature vectors (each normalized to 0–1)
 * y: array of labels (0 or 1)
 * Returns: coefficient array (same length as feature vector)
 */
function trainLogisticRegression(
  X: number[][],
  y: number[],
  learningRate = 0.1,
  iterations = 500,
  l2Lambda = 0.01, // L2 regularization to prevent overfitting
): { coefficients: number[]; intercept: number; auc: number } {
  const n = X.length;
  const d = X[0].length;

  // Initialize weights
  const w = new Array(d).fill(0);
  let b = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((sum, xj, j) => sum + xj * w[j], 0) + b;
      const pred = sigmoid(z);
      const err = pred - y[i];

      for (let j = 0; j < d; j++) {
        gradW[j] += err * X[i][j];
      }
      gradB += err;
    }

    // Update with L2 regularization
    for (let j = 0; j < d; j++) {
      w[j] -= learningRate * (gradW[j] / n + l2Lambda * w[j]);
    }
    b -= learningRate * (gradB / n);
  }

  // Calculate AUC (area under ROC curve) for model quality
  const predictions = X.map((xi, i) => ({
    pred: sigmoid(xi.reduce((sum, xj, j) => sum + xj * w[j], 0) + b),
    label: y[i],
  }));
  const auc = calculateAUC(predictions);

  return { coefficients: w, intercept: b, auc };
}

/**
 * Calculate AUC-ROC from predictions.
 * Simple trapezoidal approximation.
 */
function calculateAUC(predictions: { pred: number; label: number }[]): number {
  const sorted = [...predictions].sort((a, b) => b.pred - a.pred);
  const nPos = sorted.filter(p => p.label === 1).length;
  const nNeg = sorted.length - nPos;

  if (nPos === 0 || nNeg === 0) return 0.5;

  let tp = 0, fp = 0, prevTp = 0, prevFp = 0;
  let auc = 0;

  for (const p of sorted) {
    if (p.label === 1) tp++;
    else fp++;

    // Trapezoidal area
    auc += (fp - prevFp) * (tp + prevTp) / 2;
    prevTp = tp;
    prevFp = fp;
  }

  return auc / (nPos * nNeg);
}

/**
 * Convert logistic regression coefficients to weight multipliers.
 * Larger positive coefficient → signal is more predictive → higher weight.
 * We normalize relative to the mean coefficient so that the average
 * multiplier is ~1.0 (preserving total score budget).
 */
function coefficientsToWeights(coefficients: number[]): Record<string, number> {
  // Use absolute values (we care about magnitude of predictive power)
  // but keep sign: positive coefficients predict churn (correct direction)
  const positiveCoeffs = coefficients.map(c => Math.max(0.1, c));

  // Normalize so mean = 1.0
  const mean = positiveCoeffs.reduce((s, c) => s + c, 0) / positiveCoeffs.length;
  const normalized = positiveCoeffs.map(c => c / mean);

  // Clamp to reasonable range (0.3 – 2.5) to prevent extreme swings
  const clamped = normalized.map(c => Math.min(2.5, Math.max(0.3, c)));

  const weights: Record<string, number> = {};
  SIGNAL_KEYS.forEach((key, i) => {
    weights[key] = Math.round(clamped[i] * 100) / 100;
  });

  return weights;
}

// ── Timing-safe string comparison (prevents timing attacks) ──

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// ── Main handler ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    // ── Auth: only allow calls with a valid cron secret or service-role token ──
    const cronSecret = Deno.env.get('CRON_SECRET');
    const authHeader = req.headers.get('Authorization') ?? '';
    const incomingSecret = req.headers.get('X-Cron-Secret') ?? '';

    const isCronAuth = !!(cronSecret && incomingSecret && timingSafeEqual(cronSecret, incomingSecret));

    if (!isCronAuth) {
      const token = authHeader.replace('Bearer ', '');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      if (!token || !serviceKey || !timingSafeEqual(token, serviceKey)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();

    // Get all gyms
    const { data: gyms } = await supabase.from('gyms').select('id');
    if (!gyms?.length) {
      return new Response(JSON.stringify({ message: 'No gyms' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: any[] = [];

    for (const gym of gyms) {
      const gymId = gym.id;

      // Fetch labeled outcomes with signal snapshots
      const { data: outcomes } = await supabase
        .from('churn_outcomes')
        .select('churned, signal_snapshot')
        .eq('gym_id', gymId);

      if (!outcomes || outcomes.length < MIN_OUTCOMES) {
        results.push({
          gym_id: gymId,
          status: 'skipped',
          reason: `Only ${outcomes?.length ?? 0} outcomes (need ${MIN_OUTCOMES})`,
        });
        continue;
      }

      // Build feature matrix and label vector
      const X: number[][] = [];
      const y: number[] = [];

      for (const outcome of outcomes) {
        const snapshot = outcome.signal_snapshot;
        if (!snapshot) continue;

        // Normalize each signal score to 0–1 range
        // For v2 signals that may be missing from older snapshots, default to 0
        const features = SIGNAL_KEYS.map(key => {
          const rawScore = snapshot[key]?.score ?? snapshot[key] ?? 0;
          const max = SIGNAL_MAX[key];
          return Math.min(1, Math.max(0, rawScore / max));
        });

        X.push(features);
        y.push(outcome.churned ? 1 : 0);
      }

      if (X.length < MIN_OUTCOMES) {
        results.push({ gym_id: gymId, status: 'skipped', reason: 'Not enough valid snapshots' });
        continue;
      }

      // Check class balance — need at least 10% of each class
      const posRate = y.filter(v => v === 1).length / y.length;
      if (posRate < 0.1 || posRate > 0.9) {
        results.push({
          gym_id: gymId,
          status: 'skipped',
          reason: `Imbalanced classes (${Math.round(posRate * 100)}% churned)`,
        });
        continue;
      }

      // Train logistic regression
      const { coefficients, auc } = trainLogisticRegression(X, y);

      // Only update weights if model is meaningfully better than random
      if (auc < 0.55) {
        results.push({
          gym_id: gymId,
          status: 'skipped',
          reason: `Model AUC too low (${auc.toFixed(3)})`,
        });
        continue;
      }

      // Convert coefficients to weight multipliers
      const weights = coefficientsToWeights(coefficients);
      const confidence = Math.min(1, X.length / 200);

      // Upsert gym weights
      const { error: upsertError } = await supabase
        .from('gym_churn_weights')
        .upsert({
          gym_id: gymId,
          w_visit_frequency: weights.visit_frequency,
          w_attendance_trend: weights.attendance_trend,
          w_tenure_risk: weights.tenure_risk,
          w_social_engagement: weights.social_engagement,
          w_session_gaps: weights.session_gaps,
          w_goal_progress: weights.goal_progress,
          w_engagement_depth: weights.engagement_depth,
          // v2 weight columns
          w_anchor_day: weights.anchor_day,
          w_app_engagement: weights.app_engagement,
          w_comms_responsiveness: weights.comms_responsiveness,
          w_referral_activity: weights.referral_activity,
          w_workout_type_shift: weights.workout_type_shift,
          labeled_outcomes: X.length,
          confidence,
          last_calibrated_at: now.toISOString(),
          calibration_auc: Math.round(auc * 1000) / 1000,
          updated_at: now.toISOString(),
        }, { onConflict: 'gym_id' });

      results.push({
        gym_id: gymId,
        status: upsertError ? 'error' : 'calibrated',
        outcomes: X.length,
        confidence: Math.round(confidence * 100) + '%',
        auc: Math.round(auc * 1000) / 1000,
        weights,
        error: upsertError?.message,
      });
    }

    return new Response(
      JSON.stringify({ success: true, calibrated_at: now.toISOString(), results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('calibrate-churn-weights error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
