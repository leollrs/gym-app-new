import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Fail closed: QR_SIGNING_SECRET must be explicitly configured.
const QR_SIGNING_SECRET = Deno.env.get('QR_SIGNING_SECRET');
if (!QR_SIGNING_SECRET) {
  throw new Error('QR_SIGNING_SECRET environment variable is required');
}

// Fail closed: ALLOWED_ORIGIN must be explicitly configured.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) {
  throw new Error('ALLOWED_ORIGIN environment variable is required');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
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
        .gte('created_at', oneHourAgo);
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
