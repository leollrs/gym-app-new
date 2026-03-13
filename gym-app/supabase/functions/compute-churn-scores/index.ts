/**
 * Compute Churn Scores — Supabase Edge Function
 * ───────────────────────────────────────────────
 * Runs on a schedule (daily recommended) via cron or manual trigger.
 * Computes churn risk scores for ALL active members across ALL gyms
 * and persists them to the churn_risk_scores table for historical
 * trend analysis and velocity tracking.
 *
 * Research-backed signal weights (see churnScore.js for details):
 *   1. Visit frequency        (28 pts)
 *   2. Attendance trend        (17 pts)
 *   3. Tenure risk             (15 pts)
 *   4. Social & group          (14 pts)
 *   5. Session gap pattern     (10 pts)
 *   6. Goal progress            (9 pts)
 *   7. Engagement depth         (7 pts)
 *
 * Also triggers automated follow-up notifications for gyms that
 * have enabled churn_followup_settings.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ── Signal calculators (mirrored from churnScore.js for edge runtime) ──

function signalVisitFrequency(avgWeekly: number, goal: number) {
  const MAX = 28;
  const target = Math.max(goal || 3, 2);
  const ratio = target > 0 ? avgWeekly / target : 0;

  if (avgWeekly === 0)   return { score: MAX, maxPts: MAX, label: 'Zero visits in last 30 days' };
  if (ratio < 0.25)      return { score: Math.round(MAX * 0.85), maxPts: MAX, label: `Only ${avgWeekly.toFixed(1)}x/week` };
  if (ratio < 0.5)       return { score: Math.round(MAX * 0.65), maxPts: MAX, label: `Visiting ${avgWeekly.toFixed(1)}x/week (50% below goal)` };
  if (ratio < 0.75)      return { score: Math.round(MAX * 0.35), maxPts: MAX, label: `Below visit goal` };
  if (ratio < 1.0)       return { score: Math.round(MAX * 0.15), maxPts: MAX, label: `Nearly hitting visit goal` };
  return { score: ratio >= 1.25 ? -3 : 0, maxPts: MAX, label: 'Meeting visit goal' };
}

function signalAttendanceTrend(avg: number, prev: number) {
  const MAX = 17;
  if (prev <= 0.2) return { score: avg === 0 ? 8 : 0, maxPts: MAX, label: avg === 0 ? 'No visit pattern' : 'Building baseline' };
  const drop = (prev - avg) / prev;
  if (drop >= 0.75)  return { score: MAX, maxPts: MAX, label: `Visits crashed ${Math.round(drop * 100)}%` };
  if (drop >= 0.5)   return { score: Math.round(MAX * 0.75), maxPts: MAX, label: `Visits dropped ${Math.round(drop * 100)}%` };
  if (drop >= 0.3)   return { score: Math.round(MAX * 0.5), maxPts: MAX, label: `Visits declined ${Math.round(drop * 100)}%` };
  if (drop >= 0.15)  return { score: Math.round(MAX * 0.25), maxPts: MAX, label: `Slight dip` };
  if (drop < -0.15)  return { score: -3, maxPts: MAX, label: 'Attendance trending up' };
  return { score: 0, maxPts: MAX, label: 'Stable' };
}

function signalTenureRisk(months: number, first90Sessions: number | null) {
  const MAX = 15;
  if (months < 1)        return { score: Math.round(MAX * 0.55), maxPts: MAX, label: 'Brand new (< 1 month)' };
  if (months <= 3) {
    if (first90Sessions !== null && first90Sessions >= 24)
      return { score: Math.round(MAX * 0.25), maxPts: MAX, label: '90-day window — hit milestone' };
    return { score: MAX, maxPts: MAX, label: 'Critical 90-day dropout window' };
  }
  if (months <= 6)       return { score: Math.round(MAX * 0.55), maxPts: MAX, label: 'Early risk (3-6mo)' };
  if (months <= 12)      return { score: Math.round(MAX * 0.25), maxPts: MAX, label: 'Established (6-12mo)' };
  return { score: Math.round(MAX * 0.07), maxPts: MAX, label: 'Long-tenure' };
}

function signalSocial(friends: number, inChallenge: boolean, hasTrainer: boolean) {
  const MAX = 14;
  let score = 0;
  const parts: string[] = [];
  if (friends === 0) { score += 6; parts.push('No connections'); }
  else if (friends === 1) { score += 3; parts.push('1 connection'); }
  if (!inChallenge) { score += 5; parts.push('No challenges'); }
  if (!hasTrainer) { score += 3; parts.push('No trainer'); }
  return { score, maxPts: MAX, label: parts.length ? parts.join('; ') : 'Socially engaged' };
}

function signalSessionGaps(gaps: number[]) {
  const MAX = 10;
  if (!gaps || gaps.length < 4) return { score: 0, maxPts: MAX, label: 'Not enough gap data' };
  const mid = Math.floor(gaps.length / 2);
  const recentAvg = gaps.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const olderAvg = gaps.slice(mid).reduce((a, b) => a + b, 0) / (gaps.length - mid);
  if (olderAvg <= 0.5) return { score: 0, maxPts: MAX, label: 'Consistent timing' };
  const accel = (recentAvg - olderAvg) / olderAvg;
  if (accel >= 1.0)  return { score: MAX, maxPts: MAX, label: 'Session gaps doubled' };
  if (accel >= 0.5)  return { score: Math.round(MAX * 0.7), maxPts: MAX, label: 'Gaps growing fast' };
  if (accel >= 0.25) return { score: Math.round(MAX * 0.4), maxPts: MAX, label: 'Gaps widening' };
  if (accel < -0.15) return { score: -2, maxPts: MAX, label: 'Gaps shrinking' };
  return { score: 0, maxPts: MAX, label: 'Consistent spacing' };
}

function signalGoalProgress(hasPRs: boolean, hasBody: boolean, tenureMonths: number) {
  const MAX = 9;
  if (tenureMonths > 6) {
    return (!hasPRs && !hasBody)
      ? { score: 3, maxPts: MAX, label: 'No recent milestones' }
      : { score: 0, maxPts: MAX, label: 'Hitting milestones' };
  }
  let score = 0;
  const parts: string[] = [];
  if (!hasPRs) { score += 4; parts.push('No recent PRs'); }
  if (!hasBody) { score += 3; parts.push('No body tracking'); }
  return { score: Math.min(MAX, score), maxPts: MAX, label: parts.length ? parts.join('; ') : 'On track' };
}

function signalEngagement(completed: number, abandoned: number, durLast: number, durPrior: number) {
  const MAX = 7;
  let score = 0;
  const parts: string[] = [];
  const total = completed + abandoned;
  if (total >= 3) {
    const rate = abandoned / total;
    if (rate >= 0.4) { score += 4; parts.push(`${Math.round(rate * 100)}% abandoned`); }
    else if (rate >= 0.2) { score += 2; parts.push('Some incomplete'); }
  }
  if (durPrior > 0 && durLast > 0) {
    const change = (durLast - durPrior) / durPrior;
    if (change <= -0.35) { score += 3; parts.push('Sessions much shorter'); }
    else if (change <= -0.2) { score += 1; parts.push('Sessions slightly shorter'); }
  }
  return { score: Math.min(MAX, score), maxPts: MAX, label: parts.length ? parts.join('; ') : 'Good depth' };
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  visit_frequency: 1.0, attendance_trend: 1.0, tenure_risk: 1.0,
  social_engagement: 1.0, session_gaps: 1.0, goal_progress: 1.0, engagement_depth: 1.0,
};

function computeScore(
  signals: Record<string, { score: number; maxPts: number; label: string }>,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
) {
  let weightedSum = 0;
  let weightedMax = 0;
  for (const [key, sig] of Object.entries(signals)) {
    const m = weights[key] ?? 1.0;
    weightedSum += sig.score * m;
    weightedMax += sig.maxPts * m;
  }
  const pct = weightedMax > 0 ? (Math.max(0, weightedSum) / weightedMax) * 100 : 0;
  return Math.min(100, Math.round(pct * 10) / 10);
}

function getRiskTier(score: number): string {
  if (score >= 80) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

// ── Main handler ─────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * MS_PER_DAY).toISOString();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * MS_PER_DAY).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();

    // Get all gyms
    const { data: gyms } = await supabase.from('gyms').select('id');
    if (!gyms?.length) {
      return new Response(JSON.stringify({ message: 'No gyms found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalScored = 0;
    let totalFollowups = 0;

    for (const gym of gyms) {
      const gymId = gym.id;

      // Load per-gym adaptive weights (blended with defaults via confidence)
      let gymWeights = { ...DEFAULT_WEIGHTS };
      try {
        const { data: wRow } = await supabase
          .from('gym_churn_weights')
          .select('*')
          .eq('gym_id', gymId)
          .single();

        if (wRow && wRow.confidence > 0) {
          const c = wRow.confidence;
          for (const key of Object.keys(DEFAULT_WEIGHTS)) {
            const col = `w_${key}`;
            if (wRow[col] != null) {
              gymWeights[key] = wRow[col] * c + DEFAULT_WEIGHTS[key] * (1 - c);
            }
          }
        }
      } catch (_) {
        // Table may not exist yet — use defaults
      }

      // Fetch all active members
      const { data: members } = await supabase
        .from('profiles')
        .select('id, created_at, training_frequency, membership_status, assigned_program_id')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .in('membership_status', ['active', 'frozen']);

      if (!members?.length) continue;

      const memberIds = members.map((m: any) => m.id);

      // Parallel data fetches
      const [
        checkInsRes, sessionsRes, allSessionsRes, friendsRes,
        challengesRes, bodyRes, trainerRes, prsRes,
      ] = await Promise.all([
        supabase.from('check_ins').select('profile_id, checked_in_at')
          .eq('gym_id', gymId).gte('checked_in_at', sixtyDaysAgo).in('profile_id', memberIds),
        supabase.from('workout_sessions').select('profile_id, status, started_at, duration_seconds, total_volume_lbs')
          .eq('gym_id', gymId).gte('started_at', ninetyDaysAgo).in('profile_id', memberIds)
          .order('started_at', { ascending: false }),
        supabase.from('workout_sessions').select('profile_id, started_at')
          .eq('gym_id', gymId).eq('status', 'completed').in('profile_id', memberIds),
        supabase.from('friendships').select('requester_id, addressee_id')
          .eq('status', 'accepted').or(
            memberIds.map((id: string) => `requester_id.eq.${id}`).join(',') + ',' +
            memberIds.map((id: string) => `addressee_id.eq.${id}`).join(',')
          ),
        supabase.from('challenge_participants').select('profile_id').in('profile_id', memberIds),
        supabase.from('body_weight_logs').select('profile_id')
          .eq('gym_id', gymId).gte('logged_at', sixtyDaysAgo).in('profile_id', memberIds),
        supabase.from('trainer_clients').select('client_id')
          .eq('gym_id', gymId).in('client_id', memberIds),
        supabase.from('activity_feed_items').select('actor_id')
          .eq('gym_id', gymId).eq('type', 'pr_hit').gte('created_at', thirtyDaysAgo)
          .in('actor_id', memberIds),
      ]);

      // Build lookup maps
      const checkIns = checkInsRes.data || [];
      const sessions = sessionsRes.data || [];
      const allSessions = allSessionsRes.data || [];

      const checkInsLast30: Record<string, number> = {};
      const checkInsPrior30: Record<string, number> = {};
      checkIns.forEach((r: any) => {
        if (r.checked_in_at >= thirtyDaysAgo) checkInsLast30[r.profile_id] = (checkInsLast30[r.profile_id] || 0) + 1;
        else checkInsPrior30[r.profile_id] = (checkInsPrior30[r.profile_id] || 0) + 1;
      });

      const sessionData: Record<string, any> = {};
      sessions.forEach((r: any) => {
        if (!sessionData[r.profile_id]) sessionData[r.profile_id] = {
          compL30: 0, abL30: 0, compP: 0, abP: 0, durL30: [] as number[], durP30: [] as number[], dates: [] as Date[],
        };
        const sd = sessionData[r.profile_id];
        const recent = r.started_at >= thirtyDaysAgo;
        if (r.status === 'completed') {
          if (recent) { sd.compL30++; if (r.duration_seconds) sd.durL30.push(r.duration_seconds); }
          else { sd.compP++; if (r.duration_seconds) sd.durP30.push(r.duration_seconds); }
        } else if (r.status === 'abandoned') {
          if (recent) sd.abL30++; else sd.abP++;
        }
        if (r.started_at) sd.dates.push(new Date(r.started_at));
      });

      // Compute gaps
      Object.values(sessionData).forEach((sd: any) => {
        sd.dates.sort((a: Date, b: Date) => b.getTime() - a.getTime());
        sd.gaps = [];
        for (let i = 0; i < sd.dates.length - 1; i++) {
          sd.gaps.push((sd.dates[i].getTime() - sd.dates[i + 1].getTime()) / MS_PER_DAY);
        }
      });

      const friendCount: Record<string, number> = {};
      (friendsRes.data || []).forEach((r: any) => {
        friendCount[r.requester_id] = (friendCount[r.requester_id] || 0) + 1;
        friendCount[r.addressee_id] = (friendCount[r.addressee_id] || 0) + 1;
      });

      const challengeSet = new Set((challengesRes.data || []).map((r: any) => r.profile_id));
      const trainerSet = new Set((trainerRes.data || []).map((r: any) => r.client_id));
      const bodySet = new Set((bodyRes.data || []).map((r: any) => r.profile_id));
      const prSet = new Set((prsRes.data || []).map((r: any) => r.actor_id));

      // First-90-day sessions
      const first90: Record<string, number> = {};
      members.forEach((m: any) => {
        const cutoff = new Date(new Date(m.created_at).getTime() + 90 * MS_PER_DAY);
        first90[m.id] = allSessions.filter(
          (s: any) => s.profile_id === m.id && new Date(s.started_at) <= cutoff
        ).length;
      });

      // Score each member
      const rows: any[] = [];

      for (const m of members) {
        const tenure = (now.getTime() - new Date(m.created_at).getTime()) / (MS_PER_DAY * 30.44);
        const avgWeekly = (checkInsLast30[m.id] || 0) / 4.33;
        const prevWeekly = (checkInsPrior30[m.id] || 0) / 4.33;
        const sd = sessionData[m.id] || { compL30: 0, abL30: 0, durL30: [], durP30: [], gaps: [] };
        const avgDurL = sd.durL30.length ? sd.durL30.reduce((a: number, b: number) => a + b, 0) / sd.durL30.length : 0;
        const avgDurP = sd.durP30.length ? sd.durP30.reduce((a: number, b: number) => a + b, 0) / sd.durP30.length : 0;

        const signals = {
          visit_frequency: signalVisitFrequency(avgWeekly, m.training_frequency || 3),
          attendance_trend: signalAttendanceTrend(avgWeekly, prevWeekly),
          tenure_risk: signalTenureRisk(tenure, tenure <= 4 ? first90[m.id] : null),
          social_engagement: signalSocial(friendCount[m.id] || 0, challengeSet.has(m.id), trainerSet.has(m.id)),
          session_gaps: signalSessionGaps(sd.gaps),
          goal_progress: signalGoalProgress(prSet.has(m.id), bodySet.has(m.id), tenure),
          engagement_depth: signalEngagement(sd.compL30, sd.abL30, avgDurL, avgDurP),
        };

        const score = computeScore(signals, gymWeights);
        const tier = getRiskTier(score);

        const keySignals = Object.entries(signals)
          .filter(([, s]) => s.score > 0)
          .sort((a, b) => (b[1].score * (gymWeights[b[0]] ?? 1)) - (a[1].score * (gymWeights[a[0]] ?? 1)))
          .slice(0, 3)
          .map(([, s]) => s.label);

        rows.push({
          profile_id: m.id,
          gym_id: gymId,
          score,
          risk_tier: tier,
          signals,
          key_signals: keySignals,
          velocity: 0, // will be updated after insert from history
          metrics: { avgWeekly, prevWeekly, tenure, friends: friendCount[m.id] || 0 },
          computed_at: now.toISOString(),
        });
      }

      // Batch insert scores (delete today's existing scores first for idempotent re-runs)
      if (rows.length > 0) {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

        await supabase
          .from('churn_risk_scores')
          .delete()
          .eq('gym_id', gymId)
          .gte('computed_at', todayStart)
          .lt('computed_at', tomorrowStart);

        const { error: insertError } = await supabase
          .from('churn_risk_scores')
          .insert(rows);

        if (insertError) {
          console.error(`Insert error for gym ${gymId}:`, insertError);
        }

        totalScored += rows.length;
      }

      // ── Automated follow-ups ───────────────────────────────
      const { data: settings } = await supabase
        .from('churn_followup_settings')
        .select('*')
        .eq('gym_id', gymId)
        .single();

      if (settings?.enabled) {
        const threshold = settings.threshold || 61;
        const cooldownDays = settings.cooldown_days || 7;
        const template = settings.message_template;
        const cooldownDate = new Date(now.getTime() - cooldownDays * MS_PER_DAY).toISOString();

        // Get members above threshold
        const atRisk = rows.filter(r => r.score >= threshold);

        for (const member of atRisk) {
          // Check cooldown — was a churn_followup notification sent recently?
          const { data: recent } = await supabase
            .from('notifications')
            .select('id')
            .eq('profile_id', member.profile_id)
            .eq('type', 'churn_followup')
            .gte('created_at', cooldownDate)
            .limit(1);

          if (recent && recent.length > 0) continue;

          // Send follow-up notification
          await supabase.from('notifications').insert({
            profile_id: member.profile_id,
            gym_id: gymId,
            type: 'churn_followup',
            title: 'We miss you!',
            body: template,
            data: { source: 'churn_auto', score: member.score, tier: member.risk_tier },
          });

          totalFollowups++;
        }

        // Update last run
        await supabase
          .from('churn_followup_settings')
          .update({ last_run_at: now.toISOString(), last_run_count: atRisk.length })
          .eq('gym_id', gymId);
      }

      // ── Auto-label churn outcomes (feeds calibration model) ──
      // Build a signal snapshot map for quick lookup
      const signalMap: Record<string, any> = {};
      rows.forEach(r => { signalMap[r.profile_id] = r.signals; });

      const outcomeInserts: any[] = [];

      for (const m of members) {
        const memberScore = rows.find(r => r.profile_id === m.id);
        if (!memberScore) continue;

        const tenure = (now.getTime() - new Date(m.created_at).getTime()) / (MS_PER_DAY * 30.44);

        // Label: inactive 30+ days → churned
        const lastCI = checkIns.find((c: any) => c.profile_id === m.id);
        const lastSession = sessions.find((s: any) => s.profile_id === m.id);
        const lastActivity = lastCI?.checked_in_at || lastSession?.started_at;
        const daysSinceActivity = lastActivity
          ? (now.getTime() - new Date(lastActivity).getTime()) / MS_PER_DAY
          : 999;

        if (daysSinceActivity >= 60) {
          outcomeInserts.push({
            profile_id: m.id, gym_id: gymId, churned: true,
            reason: 'inactive_60d',
            signal_snapshot: signalMap[m.id] || {},
            score_at_label: memberScore.score,
          });
        } else if (daysSinceActivity >= 30) {
          outcomeInserts.push({
            profile_id: m.id, gym_id: gymId, churned: true,
            reason: 'inactive_30d',
            signal_snapshot: signalMap[m.id] || {},
            score_at_label: memberScore.score,
          });
        }

        // Label: membership cancelled or frozen → churned
        if (m.membership_status === 'cancelled') {
          outcomeInserts.push({
            profile_id: m.id, gym_id: gymId, churned: true,
            reason: 'cancelled',
            signal_snapshot: signalMap[m.id] || {},
            score_at_label: memberScore.score,
          });
        } else if (m.membership_status === 'frozen') {
          outcomeInserts.push({
            profile_id: m.id, gym_id: gymId, churned: true,
            reason: 'frozen',
            signal_snapshot: signalMap[m.id] || {},
            score_at_label: memberScore.score,
          });
        }

        // Label: active 6+ months with no 14-day gap → retained (negative label)
        if (tenure >= 6 && daysSinceActivity < 14 && m.membership_status === 'active') {
          outcomeInserts.push({
            profile_id: m.id, gym_id: gymId, churned: false,
            reason: 'retained_6m',
            signal_snapshot: signalMap[m.id] || {},
            score_at_label: memberScore.score,
          });
        }
      }

      // Batch insert outcomes (duplicates within same day will be
      // rejected by the unique index — that's fine, we just ignore errors)
      if (outcomeInserts.length > 0) {
        for (const outcome of outcomeInserts) {
          await supabase
            .from('churn_outcomes')
            .insert(outcome)
            .then(() => {}); // ignore duplicate key errors
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scored: totalScored,
        followups_sent: totalFollowups,
        computed_at: now.toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('compute-churn-scores error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
