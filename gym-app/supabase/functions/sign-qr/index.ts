import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Read env at module level but DO NOT throw — throwing here would crash the
// worker boot, returning 500 on every request (including OPTIONS preflight).
// Return a clean 503 inside the handler when these aren't configured.
const QR_SIGNING_SECRET = Deno.env.get('QR_SIGNING_SECRET') || '';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN ?? '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hmacSign(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(QR_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (!ALLOWED_ORIGIN) {
    console.error('[sign-qr] FATAL: ALLOWED_ORIGIN env not set');
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // Fail loudly but cleanly when secrets aren't configured — caller gets a
  // proper 503 with a clear message instead of a worker crash.
  if (!QR_SIGNING_SECRET) {
    return new Response(JSON.stringify({
      error: 'sign-qr is not configured',
      hint: 'Set the QR_SIGNING_SECRET secret in Supabase project settings.',
    }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    // ── Authenticate caller ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Unauthorized' }, 401);

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

    // ── Rate limiting: max 60 QR signs per user per hour (database-backed) ──
    {
      const supabaseRL = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabaseRL
        .from('ai_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('endpoint', 'sign-qr')
        .gte('requested_at', oneHourAgo);
      if ((count ?? 0) >= 60) {
        return jsonResp({ error: 'Rate limit exceeded — too many QR sign requests' }, 429);
      }
      // Record this request for rate limiting
      await supabaseRL
        .from('ai_rate_limits')
        .insert({ profile_id: user.id, endpoint: 'sign-qr' });
    }

    // ── Sign payload ─────────────────────────────────────────────
    const { payload } = await req.json();
    if (typeof payload !== 'string' || !payload) {
      return jsonResp({ error: 'payload is required' }, 400);
    }

    // Append a timestamp so the QR code can expire
    const timestampedPayload = payload + ':' + Date.now();
    const signature = await hmacSign(timestampedPayload);
    return jsonResp({ signature, payload: timestampedPayload });
  } catch (err) {
    console.error('sign-qr error:', err);
    return jsonResp({ error: 'Internal server error' }, 500);
  }
});
