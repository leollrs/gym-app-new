// TODO(ip-rate-limit): Add a dedicated table for IP-based rate limiting.
// The existing `ai_rate_limits` table has a NOT NULL FK on profile_id ->
// profiles(id), so we cannot overload it with an IP-hash value (UUID type
// + FK constraint would both reject the insert). When ready, create a new
// table e.g.:
//   CREATE TABLE ip_rate_limits (
//     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     ip_hash TEXT NOT NULL,
//     endpoint TEXT NOT NULL,
//     requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
//   );
//   CREATE INDEX ON ip_rate_limits (endpoint, ip_hash, requested_at DESC);
// Then enforce 10 req/min/IP for endpoint='verify-qr' here. Until that
// migration ships, the IP rate-limit check below is a SAFE NO-OP — the
// existing per-user limit (60/hr) still applies.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const QR_SIGNING_SECRET    = Deno.env.get('QR_SIGNING_SECRET');
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGIN       = Deno.env.get('ALLOWED_ORIGIN');
const IP_HASH_SALT         = Deno.env.get('IP_HASH_SALT') || Deno.env.get('DENO_DEPLOYMENT_ID') || '';

/**
 * SHA-256 hash of (ip + salt). We never store raw IPs; the hash is used as
 * an opaque dedup key for sliding-window IP rate limiting. Kept here so the
 * helper is in scope when the dedicated `ip_rate_limits` table lands (see
 * TODO at top of file).
 */
async function hashIp(ip: string): Promise<string> {
  const enc = new TextEncoder().encode(ip + IP_HASH_SALT);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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
 * Uses HMAC-SHA256 to normalize both inputs to the same length before
 * comparing, so the comparison time does not leak the expected value's length.
 */
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
    // ── IP-based rate limiting ───────────────────────────────────
    // Extract client IP from forwarded headers. We compute the hash so the
    // wiring is complete; the actual DB check is skipped until a dedicated
    // table exists (see TODO at top of file). The FK on ai_rate_limits.
    // profile_id -> profiles(id) prevents overloading that table with an
    // IP hash value, so doing the check there would break the endpoint.
    const ipRaw = (req.headers.get('x-forwarded-for')
                 ?? req.headers.get('x-real-ip')
                 ?? 'unknown').split(',')[0].trim();
    // Compute the hash so the helper is exercised and ready for use; it's
    // intentionally unused at the DB layer until the migration ships.
    void (await hashIp(ipRaw));

    // ── Authenticate caller ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Unauthorized' }, 401);

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

    // ── Database-based rate limiting (60 requests per user per hour) ──
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: rlError } = await authClient
      .from('ai_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', user.id)
      .eq('endpoint', 'verify-qr')
      .gte('requested_at', oneHourAgo);

    if (rlError) {
      console.error('Rate limit check failed:', rlError);
      return jsonResp({ error: 'Internal server error' }, 500);
    }

    if ((count ?? 0) >= 60) {
      return jsonResp({ error: 'Rate limit exceeded — max 60 requests per hour' }, 429);
    }

    await authClient.from('ai_rate_limits').insert({ profile_id: user.id, endpoint: 'verify-qr' });

    // ── Verify signature ─────────────────────────────────────────
    const { payload, signature } = await req.json();
    if (typeof payload !== 'string' || typeof signature !== 'string') {
      return jsonResp({ error: 'payload and signature are required' }, 400);
    }

    const expected = await hmacSign(payload);
    const valid = await timingSafeEqual(expected, signature);

    if (!valid) {
      return jsonResp({ valid: false });
    }

    // ── Validate payload structure ─────────────────────────────
    // Expected format: <qr_code_payload>:<timestamp>  (at least 2 colon-separated parts)
    const parts = payload.split(':');
    if (parts.length < 2 || !parts[0]) {
      return jsonResp({ error: 'Invalid payload format' }, 400);
    }

    // ── Check expiration (3-minute window) ───────────────────────
    const QR_EXPIRY_MS = 180_000; // 3 minutes
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
