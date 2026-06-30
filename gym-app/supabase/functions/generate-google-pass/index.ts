/**
 * Generate Google Wallet Pass — Supabase Edge Function
 * ─────────────────────────────────────────────────────
 * Creates a Google Wallet pass (generic pass) for a gym member's QR/barcode.
 *
 * Google Wallet uses JWT-based passes:
 *   1. Define a pass class (one-time, per gym) via Google Wallet API
 *   2. Create a pass object (per member) as a signed JWT
 *   3. Return a save URL: https://pay.google.com/gp/v/save/{jwt}
 *
 * Required environment variables:
 *   GOOGLE_WALLET_ISSUER_ID    — your Google Wallet issuer ID
 *   GOOGLE_WALLET_KEY_BASE64   — base64-encoded service account JSON key
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64UrlEncode } from 'https://deno.land/std@0.177.0/encoding/base64url.ts';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ISSUER_ID = Deno.env.get('GOOGLE_WALLET_ISSUER_ID') || '';
const SERVICE_ACCOUNT_KEY_B64 = Deno.env.get('GOOGLE_WALLET_KEY_BASE64') || '';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

const corsHeaders = ALLOWED_ORIGIN
  ? {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }
  : null;

serve(async (req: Request) => {
  if (!corsHeaders) return new Response('Server misconfiguration: ALLOWED_ORIGIN not set', { status: 500 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Database-based rate limiting (10 requests per user per hour) ──
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: rlError } = await supabase
      .from('ai_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', user.id)
      .eq('endpoint', 'generate-google-pass')
      .gte('created_at', oneHourAgo);

    if (rlError) {
      console.error('Rate limit check failed:', rlError);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if ((count ?? 0) >= 10) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded — max 10 requests per hour' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabase.from('ai_rate_limits').insert({ profile_id: user.id, endpoint: 'generate-google-pass' });

    // ── Request body ──
    // `payload`/`referralCode` from the client are NOT trusted for the
    // MEMBERSHIP pass — we always embed the caller's own server-fetched
    // qr_code_payload there (else an authed user could mint a pass with someone
    // else's identity QR). Referral codes and punch-card product ids carry no
    // such impersonation risk, so those kinds may use the client-supplied values.
    const body = await req.json();
    const kind = body.kind || 'membership';
    const memberName = body.memberName || 'Member';
    const gymName = body.gymName || 'Gym';

    // ── Fetch gym + qr payload (server-trusted) ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('gym_id, qr_code_payload, created_at, membership_status')
      .eq('id', user.id)
      .single();

    // ── Branding: logo + primary color (used to brand the pass) ──
    const { data: branding } = await supabase
      .from('gym_branding')
      .select('logo_url, primary_color')
      .eq('gym_id', profile?.gym_id)
      .single();

    // ── Resolve logo URL for pass ──
    let logoUrl = '';
    if (branding?.logo_url) {
      try {
        const { data: signed } = await supabase.storage
          .from('gym-logos')
          .createSignedUrl(branding.logo_url, 60 * 60 * 24 * 7); // 7 days
        if (signed?.signedUrl) logoUrl = signed.signedUrl;
      } catch { /* no logo */ }
    }

    // Brand the pass with the gym's primary color when it's a valid 6-digit hex
    // (Google auto-contrasts the text); otherwise a premium dark default. This
    // + a proper logo (below) is what makes the pass look intentional instead
    // of the old stretched-logo-as-hero default.
    const pc = branding?.primary_color || '';
    const hexBackgroundColor = /^#[0-9a-fA-F]{6}$/.test(pc) ? pc : '#0A0E12';

    // ── Check if Google Wallet is configured ──
    if (!ISSUER_ID || !SERVICE_ACCOUNT_KEY_B64) {
      return new Response(JSON.stringify({
        unsupported: true,
        message: 'Google Wallet not configured. Set GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_KEY_BASE64 environment variables.',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Parse service account key ──
    const serviceAccountKey = JSON.parse(atob(SERVICE_ACCOUNT_KEY_B64));

    // ── Build the pass content for the requested kind ──
    // (membership = identity check-in QR · referral = share code · punchcard =
    // loyalty card whose barcode the admin scans to add a punch.)
    const sanitizeId = (s: string) => String(s || '').replace(/[^a-zA-Z0-9_]/g, '_');
    let barcodeValue = '';
    let cardTitleText = gymName;
    let headerText = memberName;
    let textModules: Array<{ id: string; header: string; body: string }> = [];
    let classSuffix = 'membership';

    if (kind === 'referral') {
      const referralCode = String(body.referralCode || body.payload || '').trim();
      if (!referralCode) {
        return new Response(JSON.stringify({ error: 'No referral code provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      barcodeValue = referralCode;
      headerText = 'Refer a friend';
      classSuffix = 'referral';
      textModules = [
        { id: 'code', header: 'YOUR CODE', body: referralCode },
        ...(body.referralReward ? [{ id: 'reward', header: 'YOU EARN', body: String(body.referralReward) }] : []),
        { id: 'how', header: 'HOW IT WORKS', body: 'Share this code — when a friend joins, you both get rewarded.' },
      ];
    } else if (kind === 'punchcard') {
      const cards = Array.isArray(body.punchCards) ? body.punchCards : [];
      const top = cards[0] || {};
      const productName = top.name || body.cardName || 'Loyalty';
      const punches = Number(top.punches) || 0;
      const target = Number(top.target) || 10;
      const productId = top.productId || '';
      // Same barcode contract as the Apple punch pass: admin scans → auto-fills
      // member + product in AdminStore.
      barcodeValue = `gym-purchase:${profile?.gym_id}:${user.id}:${productId}`;
      headerText = productName;
      classSuffix = `punch_${sanitizeId(productId) || 'card'}`;
      textModules = [
        { id: 'progress', header: 'PUNCHES', body: `${punches} / ${target}${punches >= target ? '  •  Reward unlocked!' : ''}` },
        ...(top.reward ? [{ id: 'reward', header: 'REWARD', body: String(top.reward) }] : []),
        { id: 'member', header: 'MEMBER', body: memberName },
      ];
    } else {
      // membership (default) — server-trusted identity QR (never the client value).
      const payload = profile?.qr_code_payload;
      if (!payload) {
        return new Response(JSON.stringify({ error: 'No QR payload on profile' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      barcodeValue = payload;
      headerText = memberName;
      classSuffix = 'membership';
      // Match the Apple pass's richer info: member, status, member-since, code.
      const memberSince = profile?.created_at
        ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : '';
      const statusRaw = profile?.membership_status || 'active';
      const statusLabel = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
      textModules = [
        { id: 'member', header: 'MEMBER', body: memberName },
        { id: 'status', header: 'STATUS', body: statusLabel },
        ...(memberSince ? [{ id: 'since', header: 'MEMBER SINCE', body: memberSince }] : []),
        { id: 'code', header: 'CODE', body: payload },
      ];
    }

    const classId = `${ISSUER_ID}.tugympr_${sanitizeId(profile?.gym_id)}_${classSuffix}`;
    const objectId = `${ISSUER_ID}.${sanitizeId(user.id)}_${classSuffix}_${Date.now()}`;

    const passClass = { id: classId };

    const passObject: Record<string, unknown> = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      hexBackgroundColor,
      logo: logoUrl ? {
        sourceUri: { uri: logoUrl },
        contentDescription: { defaultValue: { language: 'en', value: gymName } },
      } : undefined,
      cardTitle: { defaultValue: { language: 'en', value: cardTitleText } },
      header: { defaultValue: { language: 'en', value: headerText } },
      textModulesData: textModules,
      barcode: {
        type: 'QR_CODE',
        value: barcodeValue,
        alternateText: barcodeValue,
      },
    };

    // ── Sign JWT ──
    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = { alg: 'RS256', typ: 'JWT' };
    const jwtPayload = {
      iss: serviceAccountKey.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: now,
      origins: [ALLOWED_ORIGIN],
      payload: {
        genericClasses: [passClass],
        genericObjects: [passObject],
      },
    };

    const jwt = await createJwt(jwtHeader, jwtPayload, serviceAccountKey.private_key);
    const saveUrl = `https://pay.google.com/gp/v/save/${jwt}`;

    return new Response(JSON.stringify({ saveUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('generate-google-pass error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── JWT signing with RS256 ──────────────────────────────────

async function createJwt(
  header: Record<string, string>,
  payload: Record<string, unknown>,
  privateKeyPem: string
): Promise<string> {
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  );

  const sigB64 = base64UrlEncode(new Uint8Array(signature));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and decode
  const pemBody = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}
