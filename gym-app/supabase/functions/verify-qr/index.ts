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
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

/** SHA-256 hex digest — used to key the consumed-nonce store without
 *  storing the raw signed payload in the DB. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
    // ── IP-based rate limiting (NOT YET IMPLEMENTED) ─────────────
    // IP-based limiting requires a dedicated table (see TODO at top of file);
    // until that migration ships, only the per-user limit below applies.
    // The previous dead `hashIp(ipRaw)` computation was removed — it was a
    // no-op that produced a value which was immediately discarded.

    // ── Authenticate caller ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Unauthorized' }, 401);

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

    // ── Database-based rate limiting (60 requests per user per hour) ──
    // Use service-role client so RLS on ai_rate_limits can't block the
    // count query and turn the whole verify into a 500. Rate-limit
    // enforcement is purely a server-side concern; the value is keyed
    // on the authenticated user.id resolved above.
    const rlClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: rlError } = await rlClient
      .from('ai_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', user.id)
      .eq('endpoint', 'verify-qr')
      .gte('requested_at', oneHourAgo);

    if (rlError) {
      // Fail CLOSED: if we cannot confirm the caller is under the limit,
      // reject rather than allowing unbounded verification attempts.
      console.error('Rate limit check failed (rejecting):', rlError.message);
      return jsonResp({ error: 'Rate limit check unavailable' }, 503);
    } else if ((count ?? 0) >= 60) {
      return jsonResp({ error: 'Rate limit exceeded — max 60 requests per hour' }, 429);
    }

    // Best-effort insert; ignore failure
    rlClient.from('ai_rate_limits').insert({ profile_id: user.id, endpoint: 'verify-qr' })
      .then(({ error: insErr }) => { if (insErr) console.warn('Rate limit insert failed:', insErr.message); });

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

    // ── Check expiration ─────────────────────────────────────────
    // Reduced from 180_000 (3 minutes) to 60_000 (60 seconds) to shrink the
    // replay window. The QR is presented and scanned immediately at the desk,
    // so 60s is ample for the scan UX.
    const QR_EXPIRY_MS = 60_000; // 60 seconds (was 180_000 / 3 minutes)
    const timestamp = parseInt(parts[parts.length - 1]);

    if (isNaN(timestamp)) {
      return jsonResp({ error: 'Invalid payload format' }, 400);
    }

    if (Date.now() - timestamp > QR_EXPIRY_MS) {
      return jsonResp({ valid: false, error: 'QR code expired' });
    }

    // ── Single-use enforcement (replay protection) ───────────────
    // The signature is valid and the timestamp is within the 60s window.
    // Without this step a captured {payload, signature} pair could be
    // re-verified any number of times inside that window → double check-in /
    // double reward scan. We atomically claim the payload by INSERTing its
    // hash into qr_consumed_nonces (PRIMARY KEY on payload_hash). The FIRST
    // verify wins; a replay hits the unique violation (Postgres 23505) and is
    // rejected as already-used. Rows are pruned after a 10-min TTL by the
    // cron in migration 0478. Uses the service-role client (rlClient) already
    // created above, which bypasses RLS on the service-role-only table.
    const payloadHash = await sha256Hex(payload);
    const { error: nonceErr } = await rlClient
      .from('qr_consumed_nonces')
      .insert({ payload_hash: payloadHash });

    if (nonceErr) {
      // 23505 = unique_violation → this payload was already consumed.
      if (nonceErr.code === '23505') {
        return jsonResp({ valid: false, error: 'QR code already used' });
      }
      // Any other DB error: fail CLOSED. We could not prove the QR is
      // unused, so we must not allow the verify to succeed (a double scan
      // is the exact thing this guards against).
      console.error('Nonce claim failed (rejecting):', nonceErr.message);
      return jsonResp({ error: 'Verification unavailable' }, 503);
    }

    return jsonResp({ valid: true });
  } catch (err) {
    console.error('verify-qr error:', err);
    return jsonResp({ error: 'Internal server error' }, 500);
  }
});
