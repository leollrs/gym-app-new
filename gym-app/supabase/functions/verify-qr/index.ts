import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const QR_SIGNING_SECRET    = Deno.env.get('QR_SIGNING_SECRET');
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGIN       = Deno.env.get('ALLOWED_ORIGIN');

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

/**
 * Constant-time comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
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
  // ── Fail-closed env checks ────────────────────────────────────
  if (!ALLOWED_ORIGIN) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!QR_SIGNING_SECRET) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

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

    // ── Verify signature ─────────────────────────────────────────
    const { payload, signature } = await req.json();
    if (typeof payload !== 'string' || typeof signature !== 'string') {
      return jsonResp({ error: 'payload and signature are required' }, 400);
    }

    const expected = await hmacSign(payload);
    const valid = timingSafeEqual(expected, signature);

    if (!valid) {
      return jsonResp({ valid: false });
    }

    // ── Validate payload structure ─────────────────────────────
    // Expected format: <qr_code_payload>:<timestamp>  (at least 2 colon-separated parts)
    const parts = payload.split(':');
    if (parts.length < 2 || !parts[0]) {
      return jsonResp({ error: 'Invalid payload format' }, 400);
    }

    // ── Check expiration (5-minute window) ───────────────────────
    const QR_EXPIRY_MS = 60_000; // 60 seconds
    const timestamp = parseInt(parts[parts.length - 1]);

    if (isNaN(timestamp)) {
      return jsonResp({ error: 'Invalid payload format' }, 400);
    }

    if (Date.now() - timestamp > QR_EXPIRY_MS) {
      return jsonResp({ valid: false, error: 'QR code expired' });
    }

    return jsonResp({ valid: true });
  } catch (err) {
    console.error('verify-qr error:', err);
    return jsonResp({ error: 'Internal server error' }, 500);
  }
});
