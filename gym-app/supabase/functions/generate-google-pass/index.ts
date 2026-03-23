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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    // ── Request body ──
    const { payload, memberName, gymName } = await req.json();
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Missing payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch gym config ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('gym_id')
      .eq('id', user.id)
      .single();

    const { data: branding } = await supabase
      .from('gym_branding')
      .select('primary_color, logo_url')
      .eq('gym_id', profile?.gym_id)
      .single();

    const { data: gymData } = await supabase
      .from('gyms')
      .select('qr_display_format')
      .eq('id', profile?.gym_id)
      .single();

    const displayFormat = gymData?.qr_display_format || 'qr_code';

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

    // ── Map display format to Google Wallet barcode type ──
    const barcodeMapping: Record<string, string> = {
      qr_code: 'QR_CODE',
      barcode_128: 'CODE_128',
      barcode_39: 'CODE_39',
    };
    const barcodeType = barcodeMapping[displayFormat] || 'QR_CODE';

    // ── Build pass class + object ──
    const classId = `${ISSUER_ID}.gym_membership_${profile?.gym_id?.replace(/-/g, '_')}`;
    const objectId = `${ISSUER_ID}.${user.id.replace(/-/g, '_')}_${Date.now()}`;

    const passClass = {
      id: classId,
      classTemplateInfo: {
        cardTemplateOverride: {
          cardRowTemplateInfos: [{
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: 'object.textModulesData["member"]' }],
                },
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: 'object.textModulesData["code"]' }],
                },
              },
            },
          }],
        },
      },
    };

    const passObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      heroImage: logoUrl ? {
        sourceUri: { uri: logoUrl },
        contentDescription: { defaultValue: { language: 'en', value: gymName || 'Gym' } },
      } : undefined,
      textModulesData: [
        { id: 'member', header: 'MEMBER', body: memberName || 'Member' },
        { id: 'gym', header: 'GYM', body: gymName || 'Gym' },
        { id: 'code', header: 'CODE', body: payload },
      ],
      barcode: {
        type: barcodeType,
        value: payload,
        alternateText: payload,
      },
      cardTitle: {
        defaultValue: { language: 'en', value: gymName || 'Gym Membership' },
      },
      header: {
        defaultValue: { language: 'en', value: memberName || 'Member' },
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
      origins: ['*'],
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
    return new Response(JSON.stringify({ error: err.message }), {
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
