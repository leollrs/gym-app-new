import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN env var is required');

// SSRF protection: block internal/private network URLs
function isInternalUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname.toLowerCase();
    if (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' ||
      h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('172.') ||
      h.endsWith('.local') || h.endsWith('.internal') || url.protocol === 'file:'
    ) return true;
    return false;
  } catch { return true; }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
  if (isInternalUrl(url)) return { status: 400, body: 'Internal URLs are not allowed for webhooks' };

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

  // Content-Type validation
  const ct = req.headers.get('content-type') || '';
  if (req.method === 'POST' && !ct.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const start = Date.now();

  try {
    // ── Auth: require valid cron secret OR admin JWT ──
    const cronSecret = Deno.env.get('CRON_SECRET');
    const incomingSecret = req.headers.get('X-Cron-Secret') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';

    const isCronAuth = !!(cronSecret && incomingSecret && (await timingSafeEqual(cronSecret, incomingSecret)));

    if (!isCronAuth) {
      // Check for valid admin JWT or service-role key
      const token = authHeader.replace('Bearer ', '');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

      let isServiceRole = false;
      if (token && serviceKey) {
        isServiceRole = await timingSafeEqual(token, serviceKey);
      }

      if (!isServiceRole) {
        // Try JWT auth — verify the token and check for admin role
        let isAdmin = false;
        if (token) {
          const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
          const { data: { user } } = await authClient.auth.getUser(token);
          if (user) {
            const { data: profile } = await authClient
              .from('profiles')
              .select('role')
              .eq('id', user.id)
              .single();
            isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
          }
        }

        if (!isAdmin) {
          return jsonResp({ error: 'Unauthorized' }, 401);
        }
      }
    }

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
