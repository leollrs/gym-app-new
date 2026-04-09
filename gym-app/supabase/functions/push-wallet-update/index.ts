/**
 * Push Wallet Update — Supabase Edge Function
 *
 * Sends an empty APNs push notification to all devices registered for a
 * member's Apple Wallet pass. This triggers the device to call the
 * apple-wallet-webhook to fetch the updated pass.
 *
 * Called after punch card changes (via the record_gym_purchase RPC or manually).
 *
 * Body: { profileId: string, reason?: string }
 *
 * Requires env vars:
 *   APPLE_PASS_TYPE_ID     — Pass type identifier (e.g. pass.com.gymapp.member)
 *   APPLE_PUSH_KEY_BASE64  — APNs auth key (.p8) base64-encoded
 *   APPLE_PUSH_KEY_ID      — Key ID from Apple Developer
 *   APPLE_TEAM_ID          — Team ID
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { decode as base64Decode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PASS_TYPE_ID = Deno.env.get('APPLE_PASS_TYPE_ID') || 'pass.com.gymapp.member';
const PUSH_KEY_B64 = Deno.env.get('APPLE_PUSH_KEY_BASE64') || '';
const PUSH_KEY_ID = Deno.env.get('APPLE_PUSH_KEY_ID') || '';
const TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

const corsHeaders = ALLOWED_ORIGIN
  ? {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }
  : null;

/**
 * Build a JWT for APNs authentication (ES256 / P-256).
 * Apple requires the token be signed with the .p8 key using ES256.
 */
async function buildApnsJwt(): Promise<string> {
  const header = { alg: 'ES256', kid: PUSH_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: TEAM_ID, iat: now };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const claimsB64 = base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${claimsB64}`;

  // Import the P-256 private key from PEM
  const keyPem = atob(PUSH_KEY_B64);
  const pemBody = keyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const keyData = base64Decode(pemBody);

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    enc.encode(signingInput)
  );

  // Convert DER signature to raw r||s for JWT
  const sigB64 = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${sigB64}`;
}

function base64UrlEncode(data: Uint8Array): string {
  return base64Encode(data)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

serve(async (req: Request) => {
  if (!corsHeaders) return new Response('Server misconfiguration: ALLOWED_ORIGIN not set', { status: 500 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth: require service-role token or cron secret ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const cronSecret = Deno.env.get('CRON_SECRET');
    const incomingSecret = req.headers.get('X-Cron-Secret') ?? '';

    const isServiceRole = token && timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY);
    const isCronAuth = cronSecret && incomingSecret && timingSafeEqual(incomingSecret, cronSecret);

    let profileId: string | undefined;
    let reason = 'punch_card_update';

    if (!isServiceRole && !isCronAuth) {
      // Try user auth — only allow if user is requesting their own profile
      const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
      const authClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      const body = await req.json();
      if (!user || user.id !== body.profileId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      profileId = body.profileId;
      reason = body.reason || 'punch_card_update';
    } else {
      const body = await req.json();
      profileId = body.profileId;
      reason = body.reason || 'punch_card_update';
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!profileId) {
      return new Response(JSON.stringify({ error: 'Missing profileId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Rate limit: max 1 push per member per 5 minutes ──
    // Apple throttles passes that update too frequently and shows
    // a disruptive "too many updates" warning to the user.
    const RATE_LIMIT_SECONDS = 300; // 5 minutes
    const { data: recentPush } = await supabase
      .from('wallet_pass_update_log')
      .select('created_at')
      .eq('profile_id', profileId)
      .eq('push_sent', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentPush) {
      const secondsSince = (Date.now() - new Date(recentPush.created_at).getTime()) / 1000;
      if (secondsSince < RATE_LIMIT_SECONDS) {
        console.log(`[Push] Rate limited: last push ${Math.round(secondsSince)}s ago for ${profileId}`);
        return new Response(JSON.stringify({
          message: `Rate limited — last push ${Math.round(secondsSince)}s ago, need ${RATE_LIMIT_SECONDS}s gap`,
          pushed: 0,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Check if push certs are configured
    if (!PUSH_KEY_B64 || !PUSH_KEY_ID || !TEAM_ID) {
      // Log the update but skip push (certs not configured yet)
      await supabase
        .from('wallet_pass_update_log')
        .insert({ profile_id: profileId, reason, push_sent: false, devices_count: 0 });

      return new Response(JSON.stringify({
        message: 'APNs push not configured — update logged only',
        pushed: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all device registrations for this member's pass
    const { data: profile } = await supabase
      .from('profiles')
      .select('wallet_pass_serial')
      .eq('id', profileId)
      .single();

    if (!profile?.wallet_pass_serial) {
      return new Response(JSON.stringify({ message: 'No wallet pass for this member', pushed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get ALL registrations for this member — both membership and punch card passes
    const { data: registrations } = await supabase
      .from('wallet_pass_registrations')
      .select('push_token, device_library_identifier, serial_number, pass_type_identifier')
      .eq('profile_id', profileId);

    if (!registrations?.length) {
      await supabase
        .from('wallet_pass_update_log')
        .insert({ profile_id: profileId, reason, push_sent: false, devices_count: 0 });

      return new Response(JSON.stringify({ message: 'No devices registered', pushed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build APNs JWT
    const jwt = await buildApnsJwt();
    const apnsHost = 'https://api.push.apple.com'; // Production; use api.sandbox.push.apple.com for dev

    let pushCount = 0;
    const errors: string[] = [];

    // Send empty push to each registered device
    for (const reg of registrations) {
      try {
        // Use the registration's own pass type as the APNs topic
        const res = await fetch(`${apnsHost}/3/device/${reg.push_token}`, {
          method: 'POST',
          headers: {
            'authorization': `bearer ${jwt}`,
            'apns-topic': reg.pass_type_identifier || PASS_TYPE_ID,
            'apns-push-type': 'background',
            'apns-priority': '5',
          },
          body: '{}',
        });

        if (res.ok) {
          pushCount++;
        } else {
          const errBody = await res.text();
          errors.push(`${reg.device_library_identifier}: ${res.status} ${errBody}`);

          if (res.status === 410) {
            await supabase
              .from('wallet_pass_registrations')
              .delete()
              .eq('device_library_identifier', reg.device_library_identifier)
              .eq('serial_number', reg.serial_number);
          }
        }
      } catch (err: any) {
        console.error(`APNs push failed for device ${reg.device_library_identifier}:`, err?.message, err?.stack);
        errors.push(`${reg.device_library_identifier}: push failed`);
      }
    }

    // Note: pass_data_updated_at on profiles is already bumped by
    // notify_wallet_pass_update() in the DB transaction BEFORE this function
    // runs, so the webhook can immediately answer "what changed?" queries
    // even if this function hasn't finished yet. No need to update
    // wallet_pass_registrations.updated_at — that was the old race condition.

    // Log the update
    await supabase
      .from('wallet_pass_update_log')
      .insert({
        profile_id: profileId,
        reason,
        push_sent: pushCount > 0,
        devices_count: pushCount,
      });

    return new Response(JSON.stringify({
      pushed: pushCount,
      total: registrations.length,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('push-wallet-update error:', err?.message, err?.stack);
    return new Response(JSON.stringify({ error: 'Wallet update failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
