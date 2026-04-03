import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
// TODO: Ideally use a dedicated QR_SIGNING_SECRET instead of SERVICE_ROLE_KEY
// to limit blast radius if the signing secret is ever compromised.
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY             = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.tugympr.com',
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
    encoder.encode(SUPABASE_SERVICE_KEY),
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

    // ── Check expiration (5-minute window) ───────────────────────
    const QR_EXPIRY_MS = 300_000; // 5 minutes
    const parts = payload.split(':');
    const timestamp = parseInt(parts[parts.length - 1]);

    if (isNaN(timestamp)) {
      // Backward compatibility: accept payloads without a timestamp but warn
      console.warn('verify-qr: payload has no timestamp — accepting for backward compatibility');
      return jsonResp({ valid: true });
    }

    if (Date.now() - timestamp > QR_EXPIRY_MS) {
      return jsonResp({ valid: false, error: 'QR code expired' });
    }

    return jsonResp({ valid: true });
  } catch (err) {
    console.error('verify-qr error:', err);
    return jsonResp({ error: err.message || 'Internal error' }, 500);
  }
});
