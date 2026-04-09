import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

// ── Environment ──────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// APNs
const APNS_KEY_ID      = Deno.env.get('APNS_KEY_ID') || '';
const APNS_TEAM_ID     = Deno.env.get('APNS_TEAM_ID') || '';
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') || '';
const APNS_BUNDLE_ID   = 'com.tugympr.app';
const APNS_HOST = Deno.env.get('APNS_HOST') || 'api.sandbox.push.apple.com';

// FCM v1
const FCM_PROJECT_ID   = Deno.env.get('FCM_PROJECT_ID') || '';
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL') || '';
const FCM_PRIVATE_KEY  = Deno.env.get('FCM_PRIVATE_KEY') || '';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN env var is required');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Timing-safe comparison ──────────────────────────────────
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // If lengths differ, still compare to avoid leaking length info
  if (aBytes.length !== bBytes.length) {
    // Compare b against itself so timing is constant, then return false
    const key = await crypto.subtle.importKey(
      'raw', aBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sigA = await crypto.subtle.sign('HMAC', key, aBytes);
    const sigB = await crypto.subtle.sign('HMAC', key, bBytes);
    // This comparison result is irrelevant — we return false regardless
    new Uint8Array(sigA).every((v, i) => v === new Uint8Array(sigB)[i]);
    return false;
  }
  // Use HMAC-based comparison: HMAC(key=a, msg=a) === HMAC(key=a, msg=b)
  // only true when a === b, and comparison is constant-time on the digests
  const key = await crypto.subtle.importKey(
    'raw', aBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sigA = new Uint8Array(await crypto.subtle.sign('HMAC', key, aBytes));
  const sigB = new Uint8Array(await crypto.subtle.sign('HMAC', key, bBytes));
  if (sigA.length !== sigB.length) return false;
  let result = 0;
  for (let i = 0; i < sigA.length; i++) {
    result |= sigA[i] ^ sigB[i];
  }
  return result === 0;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── APNs JWT ─────────────────────────────────────────────────
let apnsJwtCache: { jwt: string; expiresAt: number } | null = null;

async function getAPNsJWT(): Promise<string> {
  if (apnsJwtCache && Date.now() < apnsJwtCache.expiresAt) {
    return apnsJwtCache.jwt;
  }

  const header = { alg: 'ES256', kid: APNS_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: APNS_TEAM_ID, iat: now };

  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const headerB64 = b64url(header);
  const claimsB64 = b64url(claims);
  const unsigned = `${headerB64}.${claimsB64}`;

  const pemBody = APNS_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyData = base64Decode(pemBody);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );

  const sigBytes = new Uint8Array(sig);
  let sigB64: string;

  if (sigBytes.length > 64) {
    let offset = 2;
    if (sigBytes[1] > 0x80) offset += (sigBytes[1] - 0x80);
    offset++;
    const rLen = sigBytes[offset++];
    const r = sigBytes.slice(offset, offset + rLen);
    offset += rLen;
    offset++;
    const sLen = sigBytes[offset++];
    const s = sigBytes.slice(offset, offset + sLen);

    const pad32 = (buf: Uint8Array) => {
      if (buf.length === 32) return buf;
      if (buf.length > 32) return buf.slice(buf.length - 32);
      const padded = new Uint8Array(32);
      padded.set(buf, 32 - buf.length);
      return padded;
    };

    const raw = new Uint8Array(64);
    raw.set(pad32(r), 0);
    raw.set(pad32(s), 32);
    sigB64 = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } else {
    sigB64 = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  const jwt = `${unsigned}.${sigB64}`;
  apnsJwtCache = { jwt, expiresAt: Date.now() + 50 * 60 * 1000 };
  return jwt;
}

// ── FCM OAuth ────────────────────────────────────────────────
let fcmTokenCache: { token: string; expiresAt: number } | null = null;

async function getFCMAccessToken(): Promise<string> {
  if (fcmTokenCache && Date.now() < fcmTokenCache.expiresAt) {
    return fcmTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: FCM_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const unsigned = `${b64url(header)}.${b64url(claims)}`;

  const pemBody = FCM_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyData = base64Decode(pemBody);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const jwt = `${unsigned}.${sigB64}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) throw new Error(`FCM OAuth failed: ${res.status} ${await res.text()}`);

  const { access_token, expires_in } = await res.json();
  fcmTokenCache = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Handler — send push to a single user's devices
//  Accepts: { profile_id, gym_id, title, body, data }
//  Auth: the caller must be the same user (self-push) OR an admin/trainer
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // Content-Type validation
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return jsonResp({ error: 'Content-Type must be application/json' }, 415);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Unauthorized' }, 401);

    // Check if caller is using the service role key (system/server call)
    const token = authHeader.replace('Bearer ', '');
    // Timing-safe comparison against the service role key
    const isServiceRole = await timingSafeEqual(token, SUPABASE_SERVICE_KEY);

    let userId: string | null = null;

    if (!isServiceRole) {
      // Normal user auth — verify JWT signature via Supabase auth.getUser()
      const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
      const authClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await authClient.auth.getUser();
      if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);
      userId = user.id;
    }

    let { profile_id, gym_id, title, body, data: pushData } = await req.json();

    if (!title) return jsonResp({ error: 'title is required' }, 400);
    if (!profile_id) return jsonResp({ error: 'profile_id is required' }, 400);

    // Input validation
    if (typeof title !== 'string' || title.length > 200) {
      return jsonResp({ error: 'Title too long (max 200 chars)' }, 400);
    }
    if (typeof body !== 'string' || body.length > 1000) {
      return jsonResp({ error: 'Body too long (max 1000 chars)' }, 400);
    }
    if (pushData && JSON.stringify(pushData).length > 4096) {
      return jsonResp({ error: 'Push data payload too large' }, 400);
    }

    // Strip HTML tags
    title = stripHtml(title);
    body = stripHtml(body);

    // Rate limiting: max 20 pushes per target user per hour (database-backed)
    {
      const supabaseRL = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabaseRL
        .from('ai_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', profile_id)
        .eq('endpoint', 'send-push-user')
        .gte('created_at', oneHourAgo);
      if ((count ?? 0) >= 20) {
        return jsonResp({ error: 'Rate limit exceeded — too many pushes to this user' }, 429);
      }
      // Record this push for rate limiting
      await supabaseRL
        .from('ai_rate_limits')
        .insert({ profile_id: profile_id, endpoint: 'send-push-user' });
    }

    // Auth check: service role can push to anyone; users can only push to themselves or if admin/trainer
    if (!isServiceRole && userId && profile_id !== userId) {
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role, gym_id')
        .eq('id', userId)
        .single();

      if (!callerProfile || !['admin', 'super_admin', 'trainer'].includes(callerProfile.role)) {
        return jsonResp({ error: 'Forbidden — can only push to yourself' }, 403);
      }

      // Gym boundary check: verify target profile belongs to the same gym as the caller
      const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('gym_id')
        .eq('id', profile_id)
        .single();

      if (!targetProfile || targetProfile.gym_id !== callerProfile.gym_id) {
        return jsonResp({ error: 'Forbidden — target user is not in your gym' }, 403);
      }
    }

    // Service client to read tokens (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: tokens, error: tokensErr } = await supabase
      .from('push_tokens')
      .select('token, platform')
      .eq('profile_id', profile_id);

    if (tokensErr) {
      console.error('Failed to fetch tokens:', tokensErr);
      return jsonResp({ error: 'Failed to fetch tokens' }, 500);
    }

    if (!tokens || tokens.length === 0) {
      return jsonResp({ message: 'No devices registered', sent: 0, failed: 0 });
    }

    const iosTokens = tokens.filter((t: { platform: string }) => t.platform === 'ios').map((t: { token: string }) => t.token);
    const androidTokens = tokens.filter((t: { platform: string }) => t.platform === 'android').map((t: { token: string }) => t.token);

    console.log(`[send-push-user] Sending to profile ${profile_id}: ${iosTokens.length} iOS, ${androidTokens.length} Android`);

    let iosSent = 0, iosFailed = 0, androidSent = 0, androidFailed = 0;

    // ── iOS (APNs) ──
    if (iosTokens.length > 0 && APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY) {
      const jwt = await getAPNsJWT();
      const payload = JSON.stringify({
        aps: {
          alert: { title, body: body || '' },
          sound: 'default',
          badge: 1,
          'mutable-content': 1,
        },
        ...(pushData || {}),
      });

      const results = await Promise.allSettled(
        iosTokens.map(async (token: string) => {
          const res = await fetch(`https://${APNS_HOST}/3/device/${token}`, {
            method: 'POST',
            headers: {
              'authorization': `bearer ${jwt}`,
              'apns-topic': APNS_BUNDLE_ID,
              'apns-push-type': 'alert',
              'apns-priority': '10',
              'apns-expiration': '0',
              'content-type': 'application/json',
            },
            body: payload,
          });
          if (!res.ok) {
            const errBody = await res.text();
            console.error(`APNs error: ${res.status} ${errBody}`);
            if (res.status === 410 || res.status === 400) {
              const { error: deleteErr } = await supabase.from('push_tokens').delete().eq('token', token);
              if (deleteErr) console.error(`Failed to remove invalid iOS token ${token.substring(0, 10)}...: ${deleteErr.message}`);
            }
            throw new Error(`APNs ${res.status}`);
          }
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') iosSent++;
        else iosFailed++;
      }
    }

    // ── Android (FCM) ──
    if (androidTokens.length > 0 && FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY) {
      const accessToken = await getFCMAccessToken();
      const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

      const results = await Promise.allSettled(
        androidTokens.map(async (token: string) => {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body: body || '' },
                data: pushData || {},
                android: { priority: 'high', notification: { sound: 'default' } },
              },
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error(`FCM error: ${res.status}`, err?.error?.message);
            if (res.status === 404 || res.status === 400) {
              const { error: deleteErr } = await supabase.from('push_tokens').delete().eq('token', token);
              if (deleteErr) console.error(`Failed to remove invalid FCM token ${token.substring(0, 10)}...: ${deleteErr.message}`);
            }
            throw new Error(`FCM ${res.status}`);
          }
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') androidSent++;
        else androidFailed++;
      }
    }

    return jsonResp({
      message: `Push sent to ${iosSent + androidSent} devices`,
      ios: { sent: iosSent, failed: iosFailed },
      android: { sent: androidSent, failed: androidFailed },
      total_sent: iosSent + androidSent,
      total_failed: iosFailed + androidFailed,
    });
  } catch (err) {
    console.error('send-push-user error:', err);
    return jsonResp({ error: 'Internal server error' }, 500);
  }
});
