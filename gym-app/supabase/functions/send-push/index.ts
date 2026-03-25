import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

// ── Environment ──────────────────────────────────────────────
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// APNs — direct to Apple (for iOS)
const APNS_KEY_ID      = Deno.env.get('APNS_KEY_ID') || '';      // 44PA6F2Z9K
const APNS_TEAM_ID     = Deno.env.get('APNS_TEAM_ID') || '';     // J3L5DWU6FT
const APNS_PRIVATE_KEY = Deno.env.get('APNS_PRIVATE_KEY') || ''; // .p8 file contents
const APNS_BUNDLE_ID   = 'com.tugympr.app';
// Use sandbox for dev builds, production for App Store
const APNS_HOST = Deno.env.get('APNS_HOST') || 'api.sandbox.push.apple.com';

// FCM v1 — Google (for Android)
const FCM_PROJECT_ID   = Deno.env.get('FCM_PROJECT_ID') || '';
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL') || '';
const FCM_PRIVATE_KEY  = Deno.env.get('FCM_PRIVATE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  APNs — Direct to Apple (iOS)
// ═══════════════════════════════════════════════════════════════════════════

let apnsJwtCache: { jwt: string; expiresAt: number } | null = null;

async function getAPNsJWT(): Promise<string> {
  // APNs JWTs are valid for up to 1 hour; reuse within 50 mins
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

  // Import the P-256 private key from .p8
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

  // Convert DER signature to raw r||s format that Apple expects
  const sigBytes = new Uint8Array(sig);
  let sigB64: string;

  // crypto.subtle.sign with ECDSA may return DER or raw depending on runtime
  // If it's > 64 bytes, it's DER encoded and needs conversion
  if (sigBytes.length > 64) {
    // Parse DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
    let offset = 2; // skip 0x30 and total length
    if (sigBytes[1] > 0x80) offset += (sigBytes[1] - 0x80);
    offset++; // skip 0x02
    const rLen = sigBytes[offset++];
    const r = sigBytes.slice(offset, offset + rLen);
    offset += rLen;
    offset++; // skip 0x02
    const sLen = sigBytes[offset++];
    const s = sigBytes.slice(offset, offset + sLen);

    // Pad/trim r and s to 32 bytes each
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

async function sendAPNs(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ sent: number; failed: number }> {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) {
    console.warn('APNs credentials not set — skipping iOS push');
    return { sent: 0, failed: 0 };
  }

  const jwt = await getAPNsJWT();
  let sent = 0;
  let failed = 0;

  // APNs payload — alert type for visible notifications
  const payload = JSON.stringify({
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
      'mutable-content': 1,
    },
    ...data,
  });

  // Send concurrently in batches
  const batchSize = 50;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (token) => {
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
          console.error(`APNs error for token ${token.substring(0, 10)}...: ${res.status} ${errBody}`);

          // Clean up invalid tokens
          if (res.status === 410 || res.status === 400) {
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            await supabase.from('push_tokens').delete().eq('token', token);
            console.log(`Removed invalid iOS token: ${token.substring(0, 10)}...`);
          }
          throw new Error(`APNs ${res.status}: ${errBody}`);
        }
        return true;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') sent++;
      else failed++;
    }
  }

  return { sent, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
//  FCM v1 — Google (Android)
// ═══════════════════════════════════════════════════════════════════════════

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

async function sendFCM(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ sent: number; failed: number }> {
  if (!FCM_PROJECT_ID || !FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) {
    console.warn('FCM credentials not set — skipping Android push');
    return { sent: 0, failed: 0 };
  }

  const accessToken = await getFCMAccessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;
  let sent = 0;
  let failed = 0;

  const batchSize = 50;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (token) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              data,
              android: {
                priority: 'high',
                notification: { sound: 'default' },
              },
            },
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error(`FCM error: ${res.status}`, err?.error?.message);
          if (res.status === 404 || res.status === 400) {
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
            await supabase.from('push_tokens').delete().eq('token', token);
          }
          throw new Error(err?.error?.message || `FCM ${res.status}`);
        }
        return true;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') sent++;
      else failed++;
    }
  }

  return { sent, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Handler — routes iOS tokens to APNs, Android to FCM
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Unauthorized' }, 401);

    // Auth client — uses anon key + user's JWT (same pattern as other edge functions)
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      console.error('Auth failed:', authErr?.message);
      return jsonResp({ error: 'Unauthorized' }, 401);
    }

    // Service client — for reading all tokens (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || !['admin', 'super_admin', 'trainer'].includes(callerProfile.role)) {
      return jsonResp({ error: 'Forbidden — admin only' }, 403);
    }

    const { gym_id, title, body, data: pushData } = await req.json();
    const targetGymId = gym_id || callerProfile.gym_id;

    if (!title) return jsonResp({ error: 'title is required' }, 400);

    // Fetch all push tokens WITH platform info
    const { data: tokens, error: tokensErr } = await supabase
      .from('push_tokens')
      .select('token, platform')
      .eq('gym_id', targetGymId);

    if (tokensErr) {
      console.error('Failed to fetch tokens:', tokensErr);
      return jsonResp({ error: 'Failed to fetch tokens' }, 500);
    }

    if (!tokens || tokens.length === 0) {
      return jsonResp({ message: 'No devices registered', sent: 0, failed: 0 });
    }

    // Split by platform
    const iosTokens = tokens.filter((t: { platform: string }) => t.platform === 'ios').map((t: { token: string }) => t.token);
    const androidTokens = tokens.filter((t: { platform: string }) => t.platform === 'android').map((t: { token: string }) => t.token);

    console.log(`Sending push: ${iosTokens.length} iOS, ${androidTokens.length} Android`);

    // Send in parallel — iOS to APNs, Android to FCM
    const [iosResult, androidResult] = await Promise.all([
      iosTokens.length > 0 ? sendAPNs(iosTokens, title, body || '', pushData || {}) : { sent: 0, failed: 0 },
      androidTokens.length > 0 ? sendFCM(androidTokens, title, body || '', pushData || {}) : { sent: 0, failed: 0 },
    ]);

    const totalSent = iosResult.sent + androidResult.sent;
    const totalFailed = iosResult.failed + androidResult.failed;

    return jsonResp({
      message: `Push delivered to ${totalSent} devices`,
      ios: iosResult,
      android: androidResult,
      total_sent: totalSent,
      total_failed: totalFailed,
      total_tokens: tokens.length,
    });
  } catch (err) {
    console.error('send-push error:', err);
    return jsonResp({ error: err.message || 'Internal error' }, 500);
  }
});
