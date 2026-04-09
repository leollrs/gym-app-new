import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Cron-triggered edge function that retries failed integration writes.
 * Runs every 5 minutes (configure via Supabase dashboard cron).
 *
 * Selects pending/failed items from integration_queue, retries via
 * the integration-webhook function, and updates status accordingly.
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
    // Fetch items ready for retry
    const { data: items, error: fetchErr } = await db
      .from('integration_queue')
      .select('id, gym_id, integration_id, action, payload, attempts, max_attempts')
      .in('status', ['pending', 'failed'])
      .lte('next_retry_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(50);

    if (fetchErr || !items?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      // Mark as processing
      await db
        .from('integration_queue')
        .update({ status: 'processing' })
        .eq('id', item.id);

      try {
        // Invoke the webhook function
        const { data, error } = await db.functions.invoke('integration-webhook', {
          body: {
            integrationId: item.integration_id,
            action: item.action,
            payload: item.payload,
          },
        });

        if (error || !data?.success) {
          throw new Error(error?.message || data?.error || 'Webhook call failed');
        }

        // Success — mark completed
        await db
          .from('integration_queue')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            attempts: item.attempts + 1,
          })
          .eq('id', item.id);

        succeeded++;

      } catch (err) {
        const newAttempts = item.attempts + 1;

        if (newAttempts >= item.max_attempts) {
          // Max attempts reached — mark as permanently failed
          await db
            .from('integration_queue')
            .update({
              status: 'failed',
              attempts: newAttempts,
              last_error: err.message?.substring(0, 500) || 'Unknown error',
            })
            .eq('id', item.id);
        } else {
          // Exponential backoff: attempts^2 * 60 seconds
          const backoffMs = Math.pow(newAttempts, 2) * 60_000;
          const nextRetry = new Date(Date.now() + backoffMs).toISOString();

          await db
            .from('integration_queue')
            .update({
              status: 'failed',
              attempts: newAttempts,
              last_error: err.message?.substring(0, 500) || 'Unknown error',
              next_retry_at: nextRetry,
            })
            .eq('id', item.id);
        }

        failed++;
      }

      processed++;
    }

    return new Response(JSON.stringify({ processed, succeeded, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('process-integration-queue error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
