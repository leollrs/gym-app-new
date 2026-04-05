import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Adapters ─────────────────────────────────────────────

interface AdapterResult {
  status: number;
  body: string;
}

/** Generic webhook: POST payload to a configured URL with HMAC signature. */
async function webhookAdapter(
  action: string,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const url = config.url as string;
  if (!url) return { status: 400, body: 'No webhook URL configured' };

  const bodyStr = JSON.stringify({ action, payload, timestamp: new Date().toISOString() });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.headers as Record<string, string> || {}),
  };

  // HMAC signature if secret is configured
  const secret = config.secret as string;
  if (secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(bodyStr));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    headers['X-Webhook-Signature'] = `sha256=${hex}`;
  }

  const resp = await fetch(url, { method: 'POST', headers, body: bodyStr });
  const respBody = await resp.text();
  return { status: resp.status, body: respBody.substring(0, 2000) };
}

const ADAPTERS: Record<string, typeof webhookAdapter> = {
  webhook: webhookAdapter,
  // Future adapters: mindbody, clubready, abc_fitness
  // Each would implement the same (action, payload, config) => AdapterResult interface
};

// ── Main handler ─────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const start = Date.now();

  try {
    const { integrationId, action, payload } = await req.json();
    if (!integrationId || !action || !payload) {
      return jsonResp({ error: 'Missing integrationId, action, or payload' }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Fetch integration config
    const { data: integration, error: fetchErr } = await db
      .from('gym_integrations')
      .select('id, gym_id, provider, config, is_active, actions_enabled')
      .eq('id', integrationId)
      .single();

    if (fetchErr || !integration) {
      return jsonResp({ error: 'Integration not found' }, 404);
    }

    if (!integration.is_active) {
      return jsonResp({ error: 'Integration is disabled' }, 400);
    }

    if (!integration.actions_enabled?.includes(action)) {
      return jsonResp({ error: `Action '${action}' not enabled for this integration` }, 400);
    }

    // Dispatch to the appropriate adapter
    const adapter = ADAPTERS[integration.provider];
    if (!adapter) {
      return jsonResp({ error: `No adapter for provider '${integration.provider}'` }, 400);
    }

    const result = await adapter(action, payload, integration.config || {});
    const durationMs = Date.now() - start;

    // Log the result
    await db.from('integration_log').insert({
      gym_id: integration.gym_id,
      integration_id: integration.id,
      action,
      payload,
      response_status: result.status,
      response_body: result.body,
      duration_ms: durationMs,
    });

    const success = result.status >= 200 && result.status < 300;
    return jsonResp({ success, status: result.status, duration_ms: durationMs });

  } catch (err) {
    console.error('integration-webhook error:', err);
    return jsonResp({ error: err.message || 'Internal error' }, 500);
  }
});
