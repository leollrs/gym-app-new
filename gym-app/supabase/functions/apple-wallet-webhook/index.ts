/**
 * Apple Wallet Web Service — Supabase Edge Function
 *
 * 5 endpoints for pass updates + inline pass generation for both
 * punch card AND membership passes.
 *
 * Fixes applied:
 * - GET registrations now uses profiles.pass_data_updated_at (not registration updated_at)
 * - Membership pass rebuild implemented (was returning 500)
 * - changeMessage added to pass fields so users see lock-screen notifications
 * - Enhanced logging on all endpoints for debugging
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';
import forge from 'https://esm.sh/node-forge@1.3.1?no-dts&target=denonext';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || '';

// Punch card pass signing certs
const PUNCH_PASS_TYPE_ID = Deno.env.get('APPLE_PUNCH_PASS_TYPE_ID') || 'pass.com.tugympr.punchcard';
const TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';
const PUNCH_CERT_B64 = Deno.env.get('APPLE_PUNCH_CERT_BASE64') || '';
const PUNCH_KEY_B64 = Deno.env.get('APPLE_PUNCH_KEY_BASE64') || '';
const WWDR_CERT_B64 = Deno.env.get('APPLE_WWDR_CERT_BASE64') || '';

// Membership pass signing certs
const MEMBER_PASS_TYPE_ID = Deno.env.get('APPLE_PASS_TYPE_ID') || 'pass.com.gymapp.member';
const MEMBER_CERT_B64 = Deno.env.get('APPLE_PASS_CERT_BASE64') || '';
const MEMBER_KEY_B64 = Deno.env.get('APPLE_PASS_KEY_BASE64') || '';

const PLACEHOLDER_PNG = new Uint8Array([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
  0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,
  222,0,0,0,12,73,68,65,84,8,215,99,248,207,192,0,
  0,0,3,0,1,24,216,95,168,0,0,0,0,73,69,78,
  68,174,66,96,130,
]);

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

async function computeHmacSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify HMAC-SHA256 webhook signature from x-webhook-signature header.
 * Returns true if signature is valid, false if invalid, null if header not present.
 */
async function verifyWebhookSignature(req: Request, rawBody: string): Promise<boolean | null> {
  const signatureHeader = req.headers.get('x-webhook-signature');
  if (!signatureHeader) return null; // Header not present — skip HMAC check
  if (!WEBHOOK_SECRET) {
    console.warn('[Wallet] x-webhook-signature header present but WEBHOOK_SECRET not configured');
    return false;
  }
  const expected = await computeHmacSignature(rawBody);
  return timingSafeEqual(expected, signatureHeader);
}

function getAuthToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? '';
  // Apple Wallet WebService sends: "ApplePass <authenticationToken>"
  if (!header.startsWith('ApplePass ')) return '';
  return header.slice(10);
}

async function hashAuthToken(token: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Verify Apple Wallet auth token against stored profile tokens */
async function verifyAuthToken(
  req: Request,
  supabase: ReturnType<typeof createClient>,
  selectFields = 'id, gym_id'
): Promise<Record<string, unknown> | null> {
  const token = getAuthToken(req);
  if (!token) return null;
  const hashed = await hashAuthToken(token);
  const { data } = await supabase
    .from('profiles')
    .select(selectFields)
    .eq('wallet_auth_token', hashed)
    .maybeSingle();
  return data;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const v1Idx = segments.lastIndexOf('v1');
  const api = v1Idx >= 0 ? segments.slice(v1Idx + 1) : [];

  console.log(`[Wallet] ${req.method} /${api.join('/')} query=${url.search}`);

  // ── Read raw body once for HMAC verification + later JSON parsing ──
  const rawBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
    ? await req.text()
    : '';

  // ── HMAC-SHA256 webhook signature verification (additional security layer) ──
  // When x-webhook-signature header is present, verify it against the raw body.
  // If the header is present but the signature is invalid, AND the existing
  // Apple Wallet auth also fails, reject with 401.
  const hmacResult = await verifyWebhookSignature(req, rawBody);
  const hmacPassed = hmacResult === true;
  const hmacFailed = hmacResult === false; // header present but signature invalid

  if (hmacFailed) {
    console.warn('[Wallet] HMAC signature verification failed');
  }

  try {
    // ── POST /v1/log ──
    if (api[0] === 'log' && req.method === 'POST') {
      const body = rawBody ? JSON.parse(rawBody) : {};
      console.log('[Wallet Log] Device logs:', JSON.stringify(body));
      return new Response('', { status: 200 });
    }

    // ── GET /v1/devices/{id}/registrations/{passType} — List updatable passes ──
    // FIX: Uses profiles.pass_data_updated_at instead of registration.updated_at
    // to avoid the race condition where push-wallet-update hasn't finished yet.
    if (api[0] === 'devices' && req.method === 'GET') {
      // Verify Apple Wallet auth token
      const profile = await verifyAuthToken(req, supabase);
      if (!profile && !hmacPassed) {
        console.warn('[Wallet] GET registrations: no valid auth (Apple Wallet token or HMAC)');
        return new Response('Unauthorized', { status: 401 });
      }

      const deviceId = api[1];
      const passTypeId = decodeURIComponent(api[3] || '');
      const passesUpdatedSince = url.searchParams.get('passesUpdatedSince');

      console.log(`[Wallet] Get registrations: device=${deviceId} passType=${passTypeId} since=${passesUpdatedSince}`);

      // Get all registrations for this device + pass type, joined with profile
      const { data: regs, error: regErr } = await supabase
        .from('wallet_pass_registrations')
        .select('serial_number, profile_id, profiles!inner(pass_data_updated_at)')
        .eq('device_library_identifier', deviceId)
        .eq('pass_type_identifier', passTypeId);

      if (regErr) {
        console.error('[Wallet] Registration query error:', regErr.message);
        return new Response(null, { status: 204 });
      }

      if (!regs?.length) {
        console.log('[Wallet] No registrations found for device');
        return new Response(null, { status: 204 });
      }

      // Filter by pass_data_updated_at if passesUpdatedSince is provided
      let filtered = regs;
      if (passesUpdatedSince) {
        filtered = regs.filter((r: any) => {
          const updatedAt = r.profiles?.pass_data_updated_at;
          return updatedAt && updatedAt > passesUpdatedSince;
        });
      }

      if (!filtered.length) {
        console.log('[Wallet] No passes updated since', passesUpdatedSince);
        return new Response(null, { status: 204 });
      }

      // Use the latest pass_data_updated_at as the lastUpdated tag
      const lastUpdated = filtered.reduce((m: string, r: any) => {
        const t = r.profiles?.pass_data_updated_at || '';
        return t > m ? t : m;
      }, filtered[0].profiles?.pass_data_updated_at || new Date().toISOString());

      const serialNumbers = filtered.map((r: any) => r.serial_number);
      console.log(`[Wallet] Returning ${serialNumbers.length} updated serials: ${serialNumbers.join(', ')}`);

      return new Response(JSON.stringify({
        serialNumbers,
        lastUpdated,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── POST /v1/devices/{id}/registrations/{passType}/{serial} — Register ──
    if (api[0] === 'devices' && req.method === 'POST') {
      const deviceId = api[1], passTypeId = api[3], serial = api[4];
      const authToken = getAuthToken(req);
      if (!authToken && !hmacPassed) return new Response('', { status: 401 });

      // Profile data is required for registration insert (profile_id, gym_id)
      let profile: Record<string, unknown> | null = null;
      if (authToken) {
        const hashedToken = await hashAuthToken(authToken);
        const { data } = await supabase.from('profiles').select('id, gym_id')
          .eq('wallet_auth_token', hashedToken).single();
        profile = data;
      }
      if (!profile) return new Response('', { status: 401 });

      const body = rawBody ? JSON.parse(rawBody) : {};
      if (!body.pushToken) return new Response('', { status: 400 });

      console.log(`[Wallet] Register: device=${deviceId} serial=${serial} profile=${profile.id}`);

      const { data: existing } = await supabase.from('wallet_pass_registrations').select('id')
        .eq('device_library_identifier', deviceId).eq('pass_type_identifier', passTypeId)
        .eq('serial_number', serial).maybeSingle();

      if (existing) {
        await supabase.from('wallet_pass_registrations')
          .update({ push_token: body.pushToken, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        console.log('[Wallet] Updated existing registration');
        return new Response('', { status: 200 });
      }

      await supabase.from('wallet_pass_registrations').insert({
        device_library_identifier: deviceId, push_token: body.pushToken,
        pass_type_identifier: passTypeId, serial_number: serial,
        profile_id: profile.id, gym_id: profile.gym_id,
      });
      console.log('[Wallet] Created new registration');
      return new Response('', { status: 201 });
    }

    // ── DELETE /v1/devices/{id}/registrations/{passType}/{serial} — Unregister ──
    if (api[0] === 'devices' && req.method === 'DELETE') {
      const deviceId = api[1], passTypeId = api[3], serial = api[4];
      const authToken = getAuthToken(req);
      if (!authToken && !hmacPassed) return new Response('', { status: 401 });

      // Verify the token matches the registration before allowing deletion
      const { data: reg } = await supabase.from('wallet_pass_registrations')
        .select('id, profile_id')
        .eq('device_library_identifier', deviceId)
        .eq('pass_type_identifier', passTypeId)
        .eq('serial_number', serial)
        .maybeSingle();

      if (!reg) return new Response('', { status: 404 });

      // Verify the auth token belongs to the profile that owns this registration
      // (skip ownership check if HMAC-authenticated — trusted server-to-server call)
      if (!hmacPassed) {
        const hashedToken = await hashAuthToken(authToken);
        const { data: profile } = await supabase.from('profiles').select('id')
          .eq('wallet_auth_token', hashedToken)
          .eq('id', reg.profile_id)
          .maybeSingle();

        if (!profile) {
          console.warn(`[Wallet] DELETE auth mismatch: device=${deviceId} serial=${serial}`);
          return new Response('', { status: 401 });
        }
      }

      console.log(`[Wallet] Unregister: device=${deviceId} serial=${serial}`);
      await supabase.from('wallet_pass_registrations').delete().eq('id', reg.id);
      return new Response('', { status: 200 });
    }

    // ── GET /v1/passes/{passType}/{serial} — Return updated .pkpass ──
    if (api[0] === 'passes' && req.method === 'GET') {
      const passTypeId = api[1], serial = api[2];
      const authToken = getAuthToken(req);
      if (!authToken && !hmacPassed) return new Response('', { status: 401 });

      console.log(`[Wallet] Fetch pass: type=${passTypeId} serial=${serial}`);

      // Profile data is required to build the pass — auth token must resolve to a profile.
      // HMAC alone is not sufficient here since we need member-specific data.
      let profile: Record<string, unknown> | null = null;
      if (authToken) {
        const hashedToken = await hashAuthToken(authToken);
        const { data } = await supabase.from('profiles')
          .select('id, gym_id, full_name, wallet_auth_token, wallet_pass_serial, qr_code_payload')
          .eq('wallet_auth_token', hashedToken).single();
        profile = data;
      }
      if (!profile) return new Response('', { status: 401 });

      // Fetch punch cards (needed for both pass types)
      const { data: pcRaw } = await supabase.from('member_punch_cards')
        .select('punches, total_completed, product_id, gym_products!inner(id, name, punch_card_target, punch_card_enabled)')
        .eq('member_id', profile.id).eq('gym_id', profile.gym_id)
        .eq('gym_products.punch_card_enabled', true);

      const punchCards = (pcRaw || []).map((c: any) => ({
        name: c.gym_products.name, productId: c.gym_products.id || c.product_id,
        punches: c.punches, target: c.gym_products.punch_card_target, completed: c.total_completed,
      }));

      const { data: gym } = await supabase.from('gyms')
        .select('name, qr_display_format')
        .eq('id', profile.gym_id).single();
      const gymName = gym?.name || 'TuGymPR';
      const memberName = profile.full_name || 'Member';
      const isPunchCard = serial.startsWith('punch-');

      // Fetch branding for strip color
      const { data: branding } = await supabase.from('gym_branding')
        .select('primary_color')
        .eq('gym_id', profile.gym_id)
        .single();
      const primaryColor = branding?.primary_color || '#D4AF37';

      let passJson: any;
      let certB64: string, keyB64: string;

      if (isPunchCard) {
        // ── Punch Card Pass ──
        const prefix = `punch-${profile.id}-`;
        const slug = serial.startsWith(prefix) ? serial.slice(prefix.length) : '';
        const matched = punchCards.find((pc: any) => pc.name.toLowerCase().replace(/[^a-z0-9]/g, '') === slug);
        const topCard = matched || punchCards[0];

        const buildVisual = (p: number, t: number) => '●'.repeat(Math.min(p, t-1)) + '○'.repeat(Math.max(0, t-1-p)) + ' 🎁';

        certB64 = PUNCH_CERT_B64;
        keyB64 = PUNCH_KEY_B64;

        const remaining = topCard ? topCard.target - topCard.punches : 0;
        const isComplete = topCard ? topCard.punches >= topCard.target : false;
        const purchaseQR = `gym-purchase:${profile.gym_id}:${profile.id}:${topCard?.productId || ''}`;

        passJson = {
          formatVersion: 1,
          passTypeIdentifier: PUNCH_PASS_TYPE_ID,
          teamIdentifier: TEAM_ID,
          serialNumber: serial,
          webServiceURL: `${SUPABASE_URL}/functions/v1/apple-wallet-webhook`,
          authenticationToken: profile.wallet_auth_token,
          organizationName: gymName,
          description: `${gymName} Loyalty Card`,
          foregroundColor: 'rgb(255, 255, 255)',
          backgroundColor: 'rgb(10, 13, 20)',
          labelColor: 'rgb(130, 130, 140)',
          barcodes: [{
            message: purchaseQR,
            format: 'PKBarcodeFormatQR',
            messageEncoding: 'iso-8859-1',
          }],
          barcode: {
            message: purchaseQR,
            format: 'PKBarcodeFormatQR',
            messageEncoding: 'iso-8859-1',
          },
          storeCard: {
            headerFields: [{
              key: 'count',
              label: topCard ? topCard.name.toUpperCase() : 'LOYALTY',
              value: topCard ? `${topCard.punches} / ${topCard.target}` : '0 / 0',
              changeMessage: '%@ punches',
            }],
            secondaryFields: [
              { key: 'member', label: 'MEMBER', value: memberName },
              ...(topCard ? [{
                key: 'status',
                label: 'STATUS',
                value: isComplete ? '🎁 Reward unlocked' : `${remaining} visit${remaining !== 1 ? 's' : ''} left`,
                changeMessage: '%@',
              }] : []),
            ],
            auxiliaryFields: [
              { key: 'gym', label: 'GYM', value: gymName },
              ...(topCard && topCard.completed > 0 ? [{
                key: 'rewards',
                label: 'REWARDS EARNED',
                value: `${topCard.completed}`,
                changeMessage: 'Rewards earned: %@',
              }] : []),
            ],
            backFields: [
              ...(punchCards.length > 0 ? [{
                key: 'allCards',
                label: 'Your Loyalty Cards',
                value: punchCards.map((pc: any) => {
                  const r = pc.target - pc.punches;
                  const earned = pc.completed > 0 ? ` · ${pc.completed} reward${pc.completed !== 1 ? 's' : ''} earned` : '';
                  return `${pc.name}\n${pc.punches} / ${pc.target}${r > 0 ? ` — ${r} visit${r !== 1 ? 's' : ''} left` : ' — Reward unlocked!'}${earned}`;
                }).join('\n\n'),
              }] : []),
              { key: 'howItWorks', label: 'How It Works', value: 'Each purchase earns a punch toward a free reward. Your card updates automatically — no action needed.' },
            ],
          },
        };
      } else {
        // ── Membership Pass (was returning 500 — now fully implemented) ──
        certB64 = MEMBER_CERT_B64;
        keyB64 = MEMBER_KEY_B64;

        const payload = profile.qr_code_payload || profile.id;
        const displayFormat = gym?.qr_display_format || 'qr_code';

        const barcodeMapping: Record<string, { format: string; messageEncoding: string }> = {
          qr_code:     { format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
          barcode_128: { format: 'PKBarcodeFormatCode128', messageEncoding: 'iso-8859-1' },
          barcode_39:  { format: 'PKBarcodeFormatCode39', messageEncoding: 'iso-8859-1' },
        };
        const barcodeConfig = barcodeMapping[displayFormat] || barcodeMapping.qr_code;

        passJson = {
          formatVersion: 1,
          passTypeIdentifier: MEMBER_PASS_TYPE_ID,
          teamIdentifier: TEAM_ID,
          serialNumber: serial,
          webServiceURL: `${SUPABASE_URL}/functions/v1/apple-wallet-webhook`,
          authenticationToken: profile.wallet_auth_token,
          organizationName: gymName,
          description: `${gymName} Membership`,
          foregroundColor: 'rgb(255, 255, 255)',
          backgroundColor: 'rgb(10, 13, 20)',
          labelColor: 'rgb(130, 130, 140)',
          barcodes: [{
            message: payload,
            format: barcodeConfig.format,
            messageEncoding: barcodeConfig.messageEncoding,
            altText: payload,
          }],
          barcode: {
            message: payload,
            format: barcodeConfig.format,
            messageEncoding: barcodeConfig.messageEncoding,
            altText: payload,
          },
          storeCard: {
            headerFields: [{
              key: 'status',
              label: 'MEMBER',
              value: 'Active',
            }],
            primaryFields: [{
              key: 'member',
              label: gymName,
              value: memberName,
            }],
            secondaryFields: [
              ...(punchCards.length > 0 ? [{
                key: 'loyalty',
                label: punchCards[0].name.toUpperCase(),
                value: `${punchCards[0].punches} / ${punchCards[0].target}`,
                changeMessage: '%@ punches',
              }] : []),
              { key: 'memberId', label: 'ID', value: payload },
            ],
            auxiliaryFields: [
              ...(punchCards.length > 0 ? [{
                key: 'loyaltyStatus',
                label: 'STATUS',
                value: punchCards[0].punches >= punchCards[0].target
                  ? '🎁 Reward unlocked'
                  : `${punchCards[0].target - punchCards[0].punches} visit${punchCards[0].target - punchCards[0].punches !== 1 ? 's' : ''} left`,
                changeMessage: '%@',
              }] : []),
              ...(punchCards.length > 1 ? punchCards.slice(1, 2).map((pc: any) => ({
                key: 'loyalty2',
                label: pc.name.toUpperCase(),
                value: `${pc.punches} / ${pc.target}`,
                changeMessage: '%@ punches',
              })) : []),
            ],
            backFields: [
              ...(punchCards.length > 0 ? [{
                key: 'loyaltyInfo',
                label: 'Your Loyalty Cards',
                value: punchCards.map((pc: any) => {
                  const r = pc.target - pc.punches;
                  const earned = pc.completed > 0 ? ` · ${pc.completed} reward${pc.completed !== 1 ? 's' : ''} earned` : '';
                  return `${pc.name}\n${pc.punches} / ${pc.target}${r > 0 ? ` — ${r} visit${r !== 1 ? 's' : ''} left` : ' — Reward unlocked!'}${earned}`;
                }).join('\n\n'),
              }] : []),
              {
                key: 'terms',
                label: 'Terms',
                value: 'This digital membership card is for personal use only. Present at the gym entrance for check-in.',
              },
            ],
          },
        };
      }

      // ── Sign and build .pkpass ──
      if (!certB64 || !keyB64 || !WWDR_CERT_B64 || !TEAM_ID) {
        console.error('[Wallet] Missing signing certs for', isPunchCard ? 'punch card' : 'membership');
        return new Response('', { status: 500 });
      }

      const passJsonBytes = new TextEncoder().encode(JSON.stringify(passJson));
      // For punch cards, render visual stamps in the strip; for membership, plain gradient
      const stripPng = isPunchCard
        ? generateStampStripImage(primaryColor, punchCards[0]?.punches || 0, punchCards[0]?.target || 10)
        : generateStripImage(primaryColor);

      const files: Record<string, Uint8Array> = {
        'pass.json': passJsonBytes,
        'icon.png': PLACEHOLDER_PNG, 'icon@2x.png': PLACEHOLDER_PNG,
        'logo.png': PLACEHOLDER_PNG, 'logo@2x.png': PLACEHOLDER_PNG,
        'strip.png': stripPng, 'strip@2x.png': stripPng,
      };

      const manifest: Record<string, string> = {};
      for (const [name, data] of Object.entries(files)) {
        const hash = await crypto.subtle.digest('SHA-1', data);
        manifest[name] = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      files['manifest.json'] = manifestBytes;

      // Sign with PKCS#7
      if (typeof globalThis.process === 'undefined') (globalThis as any).process = { env: {} };
      if (typeof (globalThis as any).crypto?.randomBytes !== 'function') {
        const nc = { randomBytes: (n: number) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return { ...b, toString: (e: string) => e === 'hex' ? Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('') : new TextDecoder().decode(b) }; }};
        (globalThis as any).require = (m: string) => { if (m === 'crypto') return nc; throw new Error(`Cannot require ${m}`); };
      }

      const cert = forge.pki.certificateFromPem(atob(certB64));
      const key = forge.pki.privateKeyFromPem(atob(keyB64));
      const wwdr = forge.pki.certificateFromPem(atob(WWDR_CERT_B64));

      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(new TextDecoder().decode(manifestBytes));
      p7.addCertificate(cert);
      p7.addCertificate(wwdr);
      p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha1,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime, value: new Date() },
        ],
      });
      p7.sign({ detached: true });

      const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
      const signature = new Uint8Array(der.length);
      for (let i = 0; i < der.length; i++) signature[i] = der.charCodeAt(i);
      files['signature'] = signature;

      const zipBytes = buildZip(files);

      console.log(`[Wallet] Serving updated ${isPunchCard ? 'punch card' : 'membership'} pass for serial=${serial}`);

      return new Response(zipBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.pkpass',
          'Last-Modified': new Date().toUTCString(),
        },
      });
    }

    console.log(`[Wallet] 404: unmatched route /${api.join('/')}`);
    return new Response('', { status: 404 });
  } catch (err: any) {
    console.error('[Wallet] Error:', err?.message, err?.stack);
    return new Response('', { status: 500 });
  }
});

// ── Helpers ──
function buildZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries = Object.entries(files); const parts: Uint8Array[] = []; const centralDir: Uint8Array[] = []; let offset = 0;
  for (const [name, data] of entries) {
    const nb = new TextEncoder().encode(name); const crc = crc32(data);
    const lh = new Uint8Array(30 + nb.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nb.length, true);
    lh.set(nb, 30); parts.push(lh); parts.push(data);
    const cd = new Uint8Array(46 + nb.length); const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true); cd.set(nb, 46);
    centralDir.push(cd); offset += lh.length + data.length;
  }
  const cdOff = offset; let cdSz = 0; for (const c of centralDir) cdSz += c.length;
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSz, true); ev.setUint32(16, cdOff, true);
  const r = new Uint8Array(offset + cdSz + 22); let p = 0;
  for (const x of parts) { r.set(x, p); p += x.length; }
  for (const x of centralDir) { r.set(x, p); p += x.length; }
  r.set(eocd, p); return r;
}

function crc32(d: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < d.length; i++) { c ^= d[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function generateStripImage(hex: string): Uint8Array {
  const w = 375, h = 123, ah = hex.replace('#', '');
  const ar = parseInt(ah.substring(0,2),16)||0, ag = parseInt(ah.substring(2,4),16)||0, ab = parseInt(ah.substring(4,6),16)||0;
  const raw = new Uint8Array(w*h*4);
  for (let y=0;y<h;y++) { const t=y/h; for (let x=0;x<w;x++) { const i=(y*w+x)*4; const hx=Math.abs(x-w/2)/(w/2); const v=1-hx*0.15; const s=(1-t)*0.18*v;
    raw[i]=Math.min(255,Math.max(0,Math.round((18+(ar-18)*s)*(1-t*0.3)))); raw[i+1]=Math.min(255,Math.max(0,Math.round((20+(ag-20)*s)*(1-t*0.3))));
    raw[i+2]=Math.min(255,Math.max(0,Math.round((24+(ab-24)*s)*(1-t*0.3)))); raw[i+3]=255; }}
  return encodePNG(w,h,raw);
}

function generateStampStripImage(accentHex: string, punches: number, target: number): Uint8Array {
  const W = 750, H = 246;
  const ah = accentHex.replace('#', '');
  const acR = parseInt(ah.substring(0,2),16)||212, acG = parseInt(ah.substring(2,4),16)||175, acB = parseInt(ah.substring(4,6),16)||55;
  const raw = new Uint8Array(W * H * 4);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const i=(y*W+x)*4; raw[i]=10;raw[i+1]=13;raw[i+2]=20;raw[i+3]=255; }

  const blendPixel = (px:number,py:number,r:number,g:number,b:number,a:number) => {
    if(px<0||px>=W||py<0||py>=H||a<=0) return; const i=(py*W+px)*4;
    const sa=a/255,da=raw[i+3]/255,oa=sa+da*(1-sa); if(oa===0) return;
    raw[i]=Math.round((r*sa+raw[i]*da*(1-sa))/oa); raw[i+1]=Math.round((g*sa+raw[i+1]*da*(1-sa))/oa);
    raw[i+2]=Math.round((b*sa+raw[i+2]*da*(1-sa))/oa); raw[i+3]=Math.round(oa*255);
  };
  const fillCircle = (cx:number,cy:number,r:number,cr:number,cg:number,cb:number,alpha:number) => {
    for(let dy=-r-1;dy<=r+1;dy++) for(let dx=-r-1;dx<=r+1;dx++) { const d=Math.sqrt(dx*dx+dy*dy);
      if(d<=r) blendPixel(cx+dx,cy+dy,cr,cg,cb,Math.round(Math.min(1,(r-d)*1.5)*alpha*255)); }
  };
  const fillRect = (x:number,y:number,w:number,h:number,cr:number,cg:number,cb:number,alpha:number) => {
    for(let py=y;py<y+h;py++) for(let px=x;px<x+w;px++) blendPixel(px,py,cr,cg,cb,Math.round(alpha*255));
  };
  const strokeRing = (cx:number,cy:number,r:number,th:number,cr:number,cg:number,cb:number,alpha:number) => {
    const inner=r-th;
    for(let dy=-r-1;dy<=r+1;dy++) for(let dx=-r-1;dx<=r+1;dx++) { const d=Math.sqrt(dx*dx+dy*dy);
      if(d>=inner&&d<=r) { const aa=Math.min(1,(r-d)*1.5)*Math.min(1,(d-inner)*1.5)*alpha; blendPixel(cx+dx,cy+dy,cr,cg,cb,Math.round(aa*255)); }}
  };
  const drawBottle = (cx:number,cy:number,size:number,r:number,g:number,b:number,alpha:number) => {
    const bodyW=Math.round(size*0.38),bodyH=Math.round(size*0.52),neckW=Math.round(size*0.18),neckH=Math.round(size*0.18);
    const capW=Math.round(size*0.24),capH=Math.round(size*0.1),cornerR=Math.round(bodyW*0.3);
    const bodyTop=cy-Math.round(bodyH*0.3),bodyLeft=cx-Math.round(bodyW/2);
    fillRect(bodyLeft,bodyTop+cornerR,bodyW,bodyH-cornerR,r,g,b,alpha);
    fillRect(bodyLeft+cornerR,bodyTop,bodyW-cornerR*2,cornerR,r,g,b,alpha);
    fillCircle(bodyLeft+cornerR,bodyTop+cornerR,cornerR,r,g,b,alpha);
    fillCircle(bodyLeft+bodyW-cornerR,bodyTop+cornerR,cornerR,r,g,b,alpha);
    const botR=Math.round(bodyW*0.25);
    fillCircle(bodyLeft+botR,bodyTop+bodyH-botR,botR,r,g,b,alpha);
    fillCircle(bodyLeft+bodyW-botR,bodyTop+bodyH-botR,botR,r,g,b,alpha);
    const neckTop=bodyTop-neckH; fillRect(cx-Math.round(neckW/2),neckTop,neckW,neckH+2,r,g,b,alpha);
    const capTop=neckTop-capH; fillRect(cx-Math.round(capW/2),capTop,capW,capH,r,g,b,alpha);
    const capR=Math.round(capW*0.3);
    fillCircle(cx-Math.round(capW/2)+capR,capTop+capR,capR,r,g,b,alpha);
    fillCircle(cx+Math.round(capW/2)-capR,capTop+capR,capR,r,g,b,alpha);
  };
  const drawStar = (cx:number,cy:number,size:number,r:number,g:number,b:number,alpha:number) => {
    const outerR=size*0.45,innerR=size*0.2;
    for(let dy=-Math.ceil(outerR)-1;dy<=Math.ceil(outerR)+1;dy++) for(let dx=-Math.ceil(outerR)-1;dx<=Math.ceil(outerR)+1;dx++) {
      const d=Math.sqrt(dx*dx+dy*dy); if(d>outerR+1) continue;
      const angle=Math.atan2(dy,dx)+Math.PI/2, sector=((angle%(2*Math.PI))+2*Math.PI)%(2*Math.PI), slice=(Math.PI*2)/10;
      const idx=Math.floor(sector/slice), frac=(sector-idx*slice)/slice;
      const r1=idx%2===0?outerR:innerR, r2=idx%2===0?innerR:outerR, edgeR=r1+(r2-r1)*frac;
      if(d<=edgeR) blendPixel(cx+dx,cy+dy,r,g,b,Math.round(Math.min(1,(edgeR-d)*1.5)*alpha*255));
    }
  };

  const totalSlots=target, perRow=totalSlots<=5?totalSlots:Math.ceil(totalSlots/2), numRows=totalSlots<=5?1:2;
  const maxRH=Math.floor((H-24)/(numRows*2+(numRows-1)*0.4)), maxRW=Math.floor((W-40)/(perRow*2+(perRow-1)*0.5));
  const radius=Math.min(maxRH,maxRW,48), gap=Math.round(radius*0.4), circleD=radius*2;
  const gridH=numRows*circleD+(numRows-1)*gap, startY=Math.round((H-gridH)/2)+radius;

  for(let i=0;i<totalSlots;i++) {
    const row=i<perRow?0:1, col=row===0?i:i-perRow, rowSlots=row===0?perRow:totalSlots-perRow;
    const rowW=rowSlots*circleD+(rowSlots-1)*gap, rowStartX=Math.round((W-rowW)/2)+radius;
    const cx=rowStartX+col*(circleD+gap), cy=startY+row*(circleD+gap);
    const isFree=i===totalSlots-1, isFilled=isFree?punches>=target:i<punches;
    if(isFilled) {
      const glowR=radius+6;
      for(let dy=-glowR;dy<=glowR;dy++) for(let dx=-glowR;dx<=glowR;dx++) { const d=Math.sqrt(dx*dx+dy*dy);
        if(d>radius&&d<=glowR) blendPixel(cx+dx,cy+dy,acR,acG,acB,Math.round(Math.max(0,1-(d-radius)/6)*0.3*255)); }
      fillCircle(cx,cy,radius,acR,acG,acB,0.85);
      strokeRing(cx,cy,radius,3,acR,acG,acB,1.0);
      const iconSize=Math.round(radius*0.7);
      if(isFree) drawStar(cx,cy,iconSize,255,255,255,0.95); else drawBottle(cx,cy,iconSize,255,255,255,0.95);
    } else {
      strokeRing(cx,cy,radius,2,255,255,255,isFree?0.2:0.12);
      const iconSize=Math.round(radius*0.55);
      if(isFree) drawStar(cx,cy,iconSize,255,255,255,0.08); else drawBottle(cx,cy,iconSize,255,255,255,0.06);
    }
  }
  return encodePNG(W,H,raw);
}

function encodePNG(w:number,h:number,rgba:Uint8Array):Uint8Array {
  const f=new Uint8Array(h*(w*4+1)); for(let y=0;y<h;y++){f[y*(w*4+1)]=0;f.set(rgba.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);}
  const d=deflateStore(f); const s=new Uint8Array([137,80,78,71,13,10,26,10]);
  const ih=new Uint8Array(13); const iv=new DataView(ih.buffer); iv.setUint32(0,w); iv.setUint32(4,h); ih[8]=8; ih[9]=6;
  const ic=pngChunk('IHDR',ih),dc=pngChunk('IDAT',d),ec=pngChunk('IEND',new Uint8Array(0));
  const r=new Uint8Array(s.length+ic.length+dc.length+ec.length); let o=0;
  r.set(s,o);o+=s.length; r.set(ic,o);o+=ic.length; r.set(dc,o);o+=dc.length; r.set(ec,o); return r;
}

function pngChunk(t:string,d:Uint8Array):Uint8Array {
  const c=new Uint8Array(12+d.length); const v=new DataView(c.buffer); v.setUint32(0,d.length);
  c[4]=t.charCodeAt(0);c[5]=t.charCodeAt(1);c[6]=t.charCodeAt(2);c[7]=t.charCodeAt(3);
  c.set(d,8); v.setUint32(8+d.length,crc32(c.subarray(4,8+d.length))); return c;
}

function deflateStore(d:Uint8Array):Uint8Array {
  const mx=65535,nb=Math.ceil(d.length/mx)||1,o=new Uint8Array(2+nb*5+d.length+4); let p=0;
  o[p++]=0x78;o[p++]=0x01; let rem=d.length,off=0;
  while(rem>0||off===0){const bs=Math.min(rem,mx),last=rem<=mx;o[p++]=last?1:0;o[p++]=bs&0xFF;o[p++]=(bs>>8)&0xFF;
    o[p++]=(~bs)&0xFF;o[p++]=((~bs)>>8)&0xFF;o.set(d.subarray(off,off+bs),p);p+=bs;off+=bs;rem-=bs;if(bs===0)break;}
  let a=1,b=0;for(let i=0;i<d.length;i++){a=(a+d[i])%65521;b=(b+a)%65521;}const ad=((b<<16)|a)>>>0;
  o[p++]=(ad>>24)&0xFF;o[p++]=(ad>>16)&0xFF;o[p++]=(ad>>8)&0xFF;o[p++]=ad&0xFF; return o.subarray(0,p);
}
