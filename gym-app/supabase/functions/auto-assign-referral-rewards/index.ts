import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Cron-triggered edge function that auto-assigns referral rewards
 * when the choice deadline has passed without a member picking.
 * Run daily or every 6 hours via Supabase cron.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Timing-safe comparison (HMAC-based, no length leak)
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyA = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const keyB = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msg = enc.encode('timing-safe-compare');
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', keyA, msg),
    crypto.subtle.sign('HMAC', keyB, msg),
  ]);
  const bytesA = new Uint8Array(sigA);
  const bytesB = new Uint8Array(sigB);
  if (bytesA.length !== bytesB.length) return false;
  let result = 0;
  for (let i = 0; i < bytesA.length; i++) result |= bytesA[i] ^ bytesB[i];
  return result === 0;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Auth: require valid cron secret ──
  const cronSecret = Deno.env.get('CRON_SECRET');
  const incomingSecret = req.headers.get('X-Cron-Secret') ?? '';

  if (!cronSecret || !incomingSecret || !(await timingSafeEqual(cronSecret, incomingSecret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Find expired pending rewards
    const { data: pending, error: fetchErr } = await db
      .from('referral_rewards')
      .select('id, profile_id, gym_id, referral_id')
      .eq('choice_status', 'pending')
      .lte('choice_deadline', new Date().toISOString())
      .limit(100);

    if (fetchErr || !pending?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let assigned = 0;

    // Group by gym for batch config fetching
    const gymIds = [...new Set(pending.map(r => r.gym_id))];
    const gymConfigs: Record<string, any> = {};

    for (const gymId of gymIds) {
      const { data: gym } = await db
        .from('gyms')
        .select('referral_config')
        .eq('id', gymId)
        .single();
      gymConfigs[gymId] = gym?.referral_config;
    }

    for (const reward of pending) {
      const config = gymConfigs[reward.gym_id];
      if (!config) continue;

      // Determine if this is the referrer or referred reward
      const { data: referral } = await db
        .from('referrals')
        .select('referrer_id, referred_id')
        .eq('id', reward.referral_id)
        .single();

      if (!referral) continue;

      const isReferrer = reward.profile_id === referral.referrer_id;
      const defaultReward = isReferrer ? config.referrer_reward : config.referred_reward;

      if (!defaultReward) continue;

      // Auto-assign the default reward
      const { error: updateErr } = await db
        .from('referral_rewards')
        .update({
          reward_type: defaultReward.type || 'points',
          reward_value: defaultReward,
          choice_status: 'auto_assigned',
          chosen_at: new Date().toISOString(),
        })
        .eq('id', reward.id);

      if (!updateErr) {
        assigned++;

        // If points-based, credit via RPC
        if (defaultReward.type === 'points' && defaultReward.points) {
          await db.rpc('add_reward_points', {
            p_user_id: reward.profile_id,
            p_gym_id: reward.gym_id,
            p_action: 'referral',
            p_points: defaultReward.points,
            p_description: `Auto-assigned referral reward: ${defaultReward.label || defaultReward.points + ' points'}`,
          });
        }
      }
    }

    return new Response(JSON.stringify({ processed: pending.length, assigned }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('auto-assign-referral-rewards error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
