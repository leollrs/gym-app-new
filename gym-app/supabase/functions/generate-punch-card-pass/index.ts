/**
 * Generate Punch Card Apple Wallet Pass — Supabase Edge Function
 * Separate pass type from the membership check-in pass.
 * No QR/barcode — purely a loyalty card showing punch card progress.
 * Per-product branded with distinct color schemes and visual strip images.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';
import forge from 'https://esm.sh/node-forge@1.3.1?no-dts&target=denonext';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PASS_TYPE_ID = Deno.env.get('APPLE_PUNCH_PASS_TYPE_ID') || 'pass.com.tugympr.punchcard';
const TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';
const PASS_CERT_B64 = Deno.env.get('APPLE_PUNCH_CERT_BASE64') || '';
const PASS_KEY_B64 = Deno.env.get('APPLE_PUNCH_KEY_BASE64') || '';
const WWDR_CERT_B64 = Deno.env.get('APPLE_WWDR_CERT_BASE64') || '';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

const corsHeaders = ALLOWED_ORIGIN
  ? {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }
  : null;

const PLACEHOLDER_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83,
  222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 0,
  0, 0, 3, 0, 1, 24, 216, 95, 168, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

// ── Per-product color system ──────────────────────────────────

interface ProductColors {
  bg: string;
  fg: string;
  label: string;
  accent: string;
}

function getProductColor(productName: string, categoryHint?: string): ProductColors {
  const name = (productName || '').toLowerCase();
  const cat = (categoryHint || '').toLowerCase();
  const combined = `${name} ${cat}`;

  // Beverages / shakes / smoothies / juice → emerald
  if (/\b(beverage|shake|smoothie|juice|drink|agua|water|coffee|tea|lemonade)\b/.test(combined)) {
    return { bg: 'rgb(6, 78, 59)', fg: 'rgb(255, 255, 255)', label: 'rgb(167, 243, 208)', accent: '#10B981' };
  }

  // Supplements / vitamins / protein → blue
  if (/\b(supplement|vitamin|protein|creatine|bcaa|pre[-\s]?workout|amino|whey|capsule|pill)\b/.test(combined)) {
    return { bg: 'rgb(30, 58, 138)', fg: 'rgb(255, 255, 255)', label: 'rgb(191, 219, 254)', accent: '#3B82F6' };
  }

  // Training / sessions / personal / class → gold
  if (/\b(training|session|personal|class|coach|lesson|pt|consultation|massage|recovery)\b/.test(combined)) {
    return { bg: 'rgb(120, 83, 9)', fg: 'rgb(255, 255, 255)', label: 'rgb(253, 230, 138)', accent: '#D4AF37' };
  }

  // Merchandise / shirt / towel / gear → purple
  if (/\b(merch|merchandise|shirt|towel|gear|apparel|hat|cap|hoodie|shorts|glove|bag|bottle|accessory|accessories)\b/.test(combined)) {
    return { bg: 'rgb(88, 28, 135)', fg: 'rgb(255, 255, 255)', label: 'rgb(216, 180, 254)', accent: '#A78BFA' };
  }

  // Default — use null to signal "use gym primary color"
  return null as any;
}

function getDefaultColors(primaryColorHex: string): ProductColors {
  const hex = primaryColorHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 212;
  const g = parseInt(hex.substring(2, 4), 16) || 175;
  const b = parseInt(hex.substring(4, 6), 16) || 55;

  // Auto-contrast: compute luminance to decide fg color
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const fg = luminance > 0.5 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';

  // Darken bg significantly
  const bgR = Math.round(r * 0.25);
  const bgG = Math.round(g * 0.25);
  const bgB = Math.round(b * 0.25);

  // Lighter label
  const lR = Math.min(255, Math.round(r * 0.6 + 100));
  const lG = Math.min(255, Math.round(g * 0.6 + 100));
  const lB = Math.min(255, Math.round(b * 0.6 + 100));

  return {
    bg: `rgb(${bgR}, ${bgG}, ${bgB})`,
    fg,
    label: `rgb(${lR}, ${lG}, ${lB})`,
    accent: primaryColorHex,
  };
}

function resolveColors(productName: string, categoryHint: string | undefined, primaryColor: string): ProductColors {
  const colors = getProductColor(productName, categoryHint);
  if (colors) return colors;
  return getDefaultColors(primaryColor);
}

// ── Motivational message ──────────────────────────────────────

function getMotivationalMessage(punches: number, target: number): string {
  if (punches >= target) return '🎉 REWARD UNLOCKED!';
  const remaining = target - punches;
  const pct = (punches / target) * 100;
  if (punches === 0) return 'Start your journey!';
  if (pct < 50) return `${remaining} more to go!`;
  if (pct < 90) return 'Halfway there! Keep it up!';
  return `Almost there! Just ${remaining} left!`;
}

// ── Pick top card (most punches or closest to reward) ─────────

function pickTopCard(cards: any[]): any {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) return cards[0];

  // Prefer card closest to completion (highest percentage), tiebreak by most punches
  return cards.slice().sort((a, b) => {
    const pctA = a.target > 0 ? a.punches / a.target : 0;
    const pctB = b.target > 0 ? b.punches / b.target : 0;
    if (pctB !== pctA) return pctB - pctA;
    return b.punches - a.punches;
  })[0];
}

// ── Timing-safe string comparison (prevents timing attacks) ──

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ka = await crypto.subtle.importKey('raw', enc.encode(a), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kb = await crypto.subtle.importKey('raw', enc.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sa = new Uint8Array(await crypto.subtle.sign('HMAC', ka, enc.encode('compare')));
  const sb = new Uint8Array(await crypto.subtle.sign('HMAC', kb, enc.encode('compare')));
  if (sa.length !== sb.length) return false;
  let result = 0;
  for (let i = 0; i < sa.length; i++) result |= sa[i] ^ sb[i];
  return result === 0;
}

serve(async (req: Request) => {
  if (!corsHeaders) return new Response('Server misconfiguration: ALLOWED_ORIGIN not set', { status: 500 });
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');

    // ── Request body ──
    const { memberName, gymName, punchCards, cardName, profileId: bodyProfileId } = await req.json();

    // ── Auth: try user token first, fall back to service role + profileId ──
    let userId: string | null = null;

    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      userId = user.id;
    } else if (bodyProfileId) {
      if (await timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY)) {
        userId = bodyProfileId;
      }
    }

    if (!userId) {
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
      .eq('profile_id', userId)
      .eq('endpoint', 'generate-punch-card-pass')
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

    await supabase.from('ai_rate_limits').insert({ profile_id: userId, endpoint: 'generate-punch-card-pass' });

    // ── Fetch profile ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('gym_id, wallet_auth_token')
      .eq('id', userId)
      .single();

    const { data: branding } = await supabase
      .from('gym_branding')
      .select('primary_color, logo_url')
      .eq('gym_id', profile?.gym_id)
      .single();

    const primaryColor = branding?.primary_color || '#D4AF37';

    // ── Fetch gym logo ──
    let iconPng = PLACEHOLDER_PNG;
    if (branding?.logo_url) {
      try {
        const { data: signed } = await supabase.storage
          .from('gym-logos')
          .createSignedUrl(branding.logo_url, 60);
        if (signed?.signedUrl) {
          const logoRes = await fetch(signed.signedUrl);
          if (logoRes.ok) {
            iconPng = new Uint8Array(await logoRes.arrayBuffer());
          }
        }
      } catch { /* use placeholder */ }
    }

    // ── Pick top card from cards array ──
    const cards = punchCards || [];
    const topCard = pickTopCard(cards);
    const productName = topCard?.name || cardName || 'Loyalty';
    const categoryHint = topCard?.category || '';

    // Resolve per-product colors
    const colors = resolveColors(productName, categoryHint, primaryColor);

    const punches = topCard ? topCard.punches : 0;
    const target = topCard ? topCard.target : 10;
    const remaining = target - punches;
    const isComplete = punches >= target;
    const completedCount = topCard?.completed || 0;
    const rewardDescription = topCard?.reward || `Free ${productName}`;

    // Unique serial per product so each punch card is a separate pass in Wallet
    const slug = productName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const serialNumber = `punch-${userId}-${slug}`;

    const walletWebhookUrl = `${SUPABASE_URL}/functions/v1/apple-wallet-webhook`;

    // Purchase QR payload — admin scans this to auto-fill member + product
    const productId = topCard?.productId || '';
    const purchaseQR = `gym-purchase:${profile?.gym_id}:${userId}:${productId}`;

    // ── Build back fields ──
    const backFields: any[] = [];

    // All cards summary
    if (cards.length > 0) {
      backFields.push({
        key: 'allCards',
        label: 'Your Loyalty Cards',
        value: cards.map((pc: any) => {
          const r = pc.target - pc.punches;
          const earned = pc.completed > 0 ? ` · ${pc.completed} reward${pc.completed !== 1 ? 's' : ''} earned` : '';
          return `${pc.name}\n${pc.punches} / ${pc.target}${r > 0 ? ` — ${r} more to go` : ' — Reward unlocked!'}${earned}`;
        }).join('\n\n'),
      });
    }

    backFields.push({
      key: 'howItWorks',
      label: 'How It Works',
      value: '1. Make a purchase and earn a punch\n2. Collect all punches to unlock your reward\n3. Your card updates automatically — no action needed\n4. Rewards are applied at checkout by staff',
    });

    backFields.push({
      key: 'terms',
      label: 'Terms & Conditions',
      value: 'Punch cards are non-transferable. Rewards expire 30 days after being unlocked. One reward per completed card. The gym reserves the right to modify or discontinue the loyalty program at any time.',
    });

    // ── Build pass.json ──
    const passJson: any = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      serialNumber,
      webServiceURL: walletWebhookUrl,
      authenticationToken: profile?.wallet_auth_token || crypto.randomUUID(),
      organizationName: gymName || 'TuGymPR',
      description: `${productName} Punch Card — ${gymName || 'TuGymPR'}`,
      foregroundColor: colors.fg,
      backgroundColor: colors.bg,
      labelColor: colors.label,
      relevantDate: new Date().toISOString(),
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
          key: 'progress',
          label: productName.toUpperCase(),
          value: `${punches} / ${target}`,
          changeMessage: '%@ punches',
        }],
        primaryFields: [{
          key: 'message',
          label: '',
          value: getMotivationalMessage(punches, target),
        }],
        secondaryFields: [
          {
            key: 'member',
            label: 'MEMBER',
            value: memberName || 'Member',
          },
          {
            key: 'reward',
            label: 'REWARD',
            value: rewardDescription,
          },
        ],
        auxiliaryFields: [
          {
            key: 'gym',
            label: 'GYM',
            value: gymName || 'TuGymPR',
          },
          ...(completedCount > 0 ? [{
            key: 'earned',
            label: 'REWARDS EARNED',
            value: `${completedCount}`,
            changeMessage: 'Rewards earned: %@',
          }] : []),
        ],
        backFields,
      },
    };

    const passJsonBytes = new TextEncoder().encode(JSON.stringify(passJson));

    // ── Check signing certs ──
    if (!PASS_CERT_B64 || !PASS_KEY_B64 || !WWDR_CERT_B64 || !TEAM_ID) {
      return new Response(JSON.stringify({
        unsupported: true,
        message: 'Punch card pass signing not configured.',
        passData: passJson,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Generate strip images at proper sizes ──
    const strip1x = generateStampStripImage(colors, punches, target, productName, 1);
    const strip2x = generateStampStripImage(colors, punches, target, productName, 2);
    const strip3x = generateStampStripImage(colors, punches, target, productName, 3);

    // ── Build .pkpass ZIP ──
    const files: Record<string, Uint8Array> = {
      'pass.json': passJsonBytes,
      'icon.png': iconPng,
      'icon@2x.png': iconPng,
      'logo.png': iconPng,
      'logo@2x.png': iconPng,
      'strip.png': strip1x,
      'strip@2x.png': strip2x,
      'strip@3x.png': strip3x,
    };

    // Generate manifest
    const manifest: Record<string, string> = {};
    for (const [name, data] of Object.entries(files)) {
      const hash = await crypto.subtle.digest('SHA-1', data);
      manifest[name] = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    files['manifest.json'] = manifestBytes;

    // ── Sign with PKCS#7 ──
    let signature: Uint8Array;
    try {
      if (typeof globalThis.process === 'undefined') {
        (globalThis as any).process = { env: {} };
      }
      if (typeof (globalThis as any).crypto?.randomBytes !== 'function') {
        const nodeCrypto = { randomBytes: (n: number) => {
          const buf = new Uint8Array(n);
          crypto.getRandomValues(buf);
          return { ...buf, toString: (enc: string) => {
            if (enc === 'hex') return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
            return new TextDecoder().decode(buf);
          }};
        }};
        (globalThis as any).require = (mod: string) => {
          if (mod === 'crypto') return nodeCrypto;
          throw new Error(`Cannot require ${mod}`);
        };
      }

      const certPem = atob(PASS_CERT_B64);
      const keyPem = atob(PASS_KEY_B64);
      const wwdrPem = atob(WWDR_CERT_B64);

      const cert = forge.pki.certificateFromPem(certPem);
      const key = forge.pki.privateKeyFromPem(keyPem);
      const wwdrCert = forge.pki.certificateFromPem(wwdrPem);

      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(new TextDecoder().decode(manifestBytes));
      p7.addCertificate(cert);
      p7.addCertificate(wwdrCert);
      p7.addSigner({
        key,
        certificate: cert,
        digestAlgorithm: forge.pki.oids.sha1,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime, value: new Date() },
        ],
      });
      p7.sign({ detached: true });

      const asn1 = p7.toAsn1();
      const derBuffer = forge.asn1.toDer(asn1);
      const derString = derBuffer.getBytes();
      signature = new Uint8Array(derString.length);
      for (let i = 0; i < derString.length; i++) {
        signature[i] = derString.charCodeAt(i);
      }
    } catch (signErr: any) {
      console.error('Punch card pass signing error:', signErr?.message, signErr?.stack);
      return new Response(JSON.stringify({
        error: 'Pass generation failed',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    files['signature'] = signature;
    const zipBytes = buildZip(files);

    return new Response(JSON.stringify({
      pkpass: base64Encode(zipBytes),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('generate-punch-card-pass error:', err?.message, err?.stack);
    return new Response(JSON.stringify({
      error: 'Pass generation failed',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Strip image generation ──────────────────────────────────────

function parseRgb(rgbStr: string): [number, number, number] {
  const m = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return [10, 13, 20];
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

/**
 * Generate a strip image with large, prominent stamp circles.
 * Per-product branded with gradient background and modern design.
 * @param colors - Product color scheme
 * @param punches - Current punch count
 * @param target - Target punch count
 * @param productName - Product name for context
 * @param scale - 1, 2, or 3 for @1x, @2x, @3x
 */
function generateStampStripImage(
  colors: ProductColors,
  punches: number,
  target: number,
  productName: string,
  scale: number,
): Uint8Array {
  const W = 375 * scale;
  const H = 123 * scale;

  const [bgR, bgG, bgB] = parseRgb(colors.bg);
  const [acR, acG, acB] = parseHex(colors.accent);

  const raw = new Uint8Array(W * H * 4);

  // ── Rich gradient background (lighter center, darker edges) ──
  const centerX = W / 2, centerY = H / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dx = x - centerX, dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      // Center is 40% lighter, edges are 20% darker
      const lightFactor = 1.0 + 0.4 * (1 - dist) - 0.2 * dist;
      raw[i]     = Math.min(255, Math.round(bgR * lightFactor));
      raw[i + 1] = Math.min(255, Math.round(bgG * lightFactor));
      raw[i + 2] = Math.min(255, Math.round(bgB * lightFactor));
      raw[i + 3] = 255;
    }
  }

  // ── Pixel helpers ──
  const blendPixel = (px: number, py: number, r: number, g: number, b: number, a: number) => {
    if (px < 0 || px >= W || py < 0 || py >= H || a <= 0) return;
    const i = (py * W + px) * 4;
    const sa = a / 255, da = raw[i + 3] / 255, oa = sa + da * (1 - sa);
    if (oa === 0) return;
    raw[i]     = Math.round((r * sa + raw[i] * da * (1 - sa)) / oa);
    raw[i + 1] = Math.round((g * sa + raw[i + 1] * da * (1 - sa)) / oa);
    raw[i + 2] = Math.round((b * sa + raw[i + 2] * da * (1 - sa)) / oa);
    raw[i + 3] = Math.round(oa * 255);
  };

  const fillCircle = (cx: number, cy: number, r: number, cr: number, cg: number, cb: number, alpha: number) => {
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r) {
          const aa = Math.min(1, (r - d) * 1.5) * alpha;
          blendPixel(cx + dx, cy + dy, cr, cg, cb, Math.round(aa * 255));
        }
      }
    }
  };

  const fillRect = (x: number, y: number, w: number, h: number, cr: number, cg: number, cb: number, alpha: number) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        blendPixel(px, py, cr, cg, cb, Math.round(alpha * 255));
      }
    }
  };

  const strokeRing = (cx: number, cy: number, r: number, thickness: number, cr: number, cg: number, cb: number, alpha: number) => {
    const outer = r, inner = r - thickness;
    for (let dy = -outer - 1; dy <= outer + 1; dy++) {
      for (let dx = -outer - 1; dx <= outer + 1; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= inner && d <= outer) {
          const outerAA = Math.min(1, (outer - d) * 1.5);
          const innerAA = Math.min(1, (d - inner) * 1.5);
          const aa = outerAA * innerAA * alpha;
          blendPixel(cx + dx, cy + dy, cr, cg, cb, Math.round(aa * 255));
        }
      }
    }
  };

  // ── Checkmark shape (simple geometric V) ──
  const drawCheckmark = (cx: number, cy: number, size: number, r: number, g: number, b: number, alpha: number) => {
    const thick = Math.max(2, Math.round(size * 0.18));
    // V shape: left arm from (-0.35, 0) to (0, 0.35), right arm from (0, 0.35) to (0.45, -0.35)
    const pts = [
      { x: -0.35, y: 0 },
      { x: 0, y: 0.35 },
      { x: 0.45, y: -0.35 },
    ];

    // Draw thick line segments
    const drawThickLine = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const steps = Math.ceil(len);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = Math.round(x1 + (x2 - x1) * t);
        const py = Math.round(y1 + (y2 - y1) * t);
        fillCircle(px, py, thick, r, g, b, alpha);
      }
    };

    const p0x = cx + Math.round(pts[0].x * size);
    const p0y = cy + Math.round(pts[0].y * size);
    const p1x = cx + Math.round(pts[1].x * size);
    const p1y = cy + Math.round(pts[1].y * size);
    const p2x = cx + Math.round(pts[2].x * size);
    const p2y = cy + Math.round(pts[2].y * size);

    drawThickLine(p0x, p0y, p1x, p1y);
    drawThickLine(p1x, p1y, p2x, p2y);
  };

  // ── Star icon for reward slot ──
  const drawStar = (cx: number, cy: number, size: number, r: number, g: number, b: number, alpha: number) => {
    const outerR = size * 0.45;
    const innerR = size * 0.2;
    const points = 5;
    for (let dy = -Math.ceil(outerR) - 1; dy <= Math.ceil(outerR) + 1; dy++) {
      for (let dx = -Math.ceil(outerR) - 1; dx <= Math.ceil(outerR) + 1; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > outerR + 1) continue;
        const angle = Math.atan2(dy, dx) + Math.PI / 2;
        const sector = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const slice = (Math.PI * 2) / (points * 2);
        const idx = Math.floor(sector / slice);
        const frac = (sector - idx * slice) / slice;
        const isOuter = idx % 2 === 0;
        const r1 = isOuter ? outerR : innerR;
        const r2 = isOuter ? innerR : outerR;
        const edgeR = r1 + (r2 - r1) * frac;
        if (d <= edgeR) {
          const aa = Math.min(1, (edgeR - d) * 1.5) * alpha;
          blendPixel(cx + dx, cy + dy, r, g, b, Math.round(aa * 255));
        }
      }
    }
  };

  // ── Layout calculation ──
  // Cap display at 12 stamps
  const displaySlots = Math.min(target, 12);
  const hasOverflow = target > 12;

  const perRow = displaySlots <= 6 ? displaySlots : Math.ceil(displaySlots / 2);
  const numRows = displaySlots <= 6 ? 1 : 2;

  // Progress bar height at the bottom
  const progressBarH = Math.round(6 * scale);
  const usableH = H - progressBarH - Math.round(4 * scale);

  // Larger circles: 60px radius @2x = 30*scale
  const idealRadius = 30 * scale;
  const maxRadiusFromH = Math.floor((usableH - 12 * scale) / (numRows * 2 + (numRows - 1) * 0.4));
  const maxRadiusFromW = Math.floor((W - 20 * scale) / (perRow * 2 + (perRow - 1) * 0.5));
  const radius = Math.min(maxRadiusFromH, maxRadiusFromW, idealRadius);
  const gap = Math.round(radius * 0.4);
  const circleD = radius * 2;

  const gridH = numRows * circleD + (numRows - 1) * gap;
  const startY = Math.round((usableH - gridH) / 2) + radius;

  const rewardUnlocked = punches >= target;

  // ── Draw all stamps ──
  for (let i = 0; i < displaySlots; i++) {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : i - perRow;
    const rowSlots = row === 0 ? perRow : displaySlots - perRow;
    const rowW = rowSlots * circleD + (rowSlots - 1) * gap;
    const rowStartX = Math.round((W - rowW) / 2) + radius;
    const cx = rowStartX + col * (circleD + gap);
    const cy = startY + row * (circleD + gap);

    const isRewardSlot = i === displaySlots - 1;
    // For overflow, the reward slot represents the last stamp
    const mappedIndex = hasOverflow && isRewardSlot ? target - 1 : i;
    const isFilled = isRewardSlot ? rewardUnlocked : mappedIndex < punches;

    // Reward slot is slightly larger
    const slotRadius = isRewardSlot ? Math.round(radius * 1.12) : radius;

    if (isFilled) {
      // Filled stamp: solid white circle with checkmark (or star for reward)
      fillCircle(cx, cy, slotRadius, 255, 255, 255, 0.95);

      const iconSize = Math.round(slotRadius * 0.7);
      if (isRewardSlot) {
        // Gold star on filled reward
        drawStar(cx, cy, iconSize, acR, acG, acB, 0.95);
      } else {
        // Dark checkmark inside white circle
        drawCheckmark(cx, cy, iconSize, bgR, bgG, bgB, 0.9);
      }
    } else {
      // Empty stamp: thin white ring with subtle fill
      fillCircle(cx, cy, slotRadius, 255, 255, 255, 0.05);
      const strokeW = Math.max(1, Math.round(2 * scale));
      strokeRing(cx, cy, slotRadius, strokeW, 255, 255, 255, isRewardSlot ? 0.35 : 0.25);

      if (isRewardSlot) {
        // Faint star inside empty reward slot (accent color)
        const iconSize = Math.round(slotRadius * 0.55);
        drawStar(cx, cy, iconSize, acR, acG, acB, 0.15);

        // If reward unlocked (all filled), glow effect around reward
        if (rewardUnlocked) {
          const glowR = slotRadius + Math.round(8 * scale);
          for (let dy = -glowR; dy <= glowR; dy++) {
            for (let dx = -glowR; dx <= glowR; dx++) {
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d > slotRadius && d <= glowR) {
                const intensity = Math.max(0, 1 - (d - slotRadius) / (8 * scale));
                blendPixel(cx + dx, cy + dy, acR, acG, acB, Math.round(intensity * 0.4 * 255));
              }
            }
          }
        }
      }
    }
  }

  // ── Draw "..." indicator for overflow ──
  if (hasOverflow) {
    // Place dots between the second-to-last and last stamp in the last row
    const lastRow = numRows - 1;
    const rowSlots = lastRow === 0 ? perRow : displaySlots - perRow;
    const rowW = rowSlots * circleD + (rowSlots - 1) * gap;
    const rowStartX = Math.round((W - rowW) / 2) + radius;
    // Dots at the right edge before the reward slot
    const dotsX = rowStartX + (rowSlots - 2) * (circleD + gap) + circleD + Math.round(gap * 0.5);
    const dotsY = startY + lastRow * (circleD + gap);
    const dotR = Math.max(2, Math.round(3 * scale));
    const dotGap = Math.round(dotR * 2.5);
    fillCircle(dotsX - dotGap, dotsY, dotR, 255, 255, 255, 0.5);
    fillCircle(dotsX, dotsY, dotR, 255, 255, 255, 0.5);
    fillCircle(dotsX + dotGap, dotsY, dotR, 255, 255, 255, 0.5);
  }

  // ── Bottom progress bar ──
  const barY = H - progressBarH;
  const progressPct = target > 0 ? Math.min(punches / target, 1.0) : 0;
  // Bar background (dark)
  fillRect(0, barY, W, progressBarH, 0, 0, 0, 0.3);
  // Filled portion in accent color
  const filledW = Math.round(W * progressPct);
  if (filledW > 0) {
    fillRect(0, barY, filledW, progressBarH, acR, acG, acB, 0.8);
  }

  return encodePNG(W, H, raw);
}

// ── Helpers (same as generate-apple-pass) ──────────────────

function buildZip(files: Record<string, Uint8Array>): Uint8Array {
  const entries = Object.entries(files);
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    localHeader.set(nameBytes, 30);
    parts.push(localHeader);
    parts.push(data);

    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdEntry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cdEntry.set(nameBytes, 46);
    centralDir.push(cdEntry);
    offset += localHeader.length + data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const totalLen = offset + cdSize + 22;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  for (const cd of centralDir) { result.set(cd, pos); pos += cd.length; }
  result.set(eocd, pos);
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const filtered = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (width * 4 + 1)] = 0;
    filtered.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const deflated = deflateStore(filtered);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width); iv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6;
  const ihdrC = pngChunk('IHDR', ihdr);
  const idatC = pngChunk('IDAT', deflated);
  const iendC = pngChunk('IEND', new Uint8Array(0));
  const total = sig.length + ihdrC.length + idatC.length + iendC.length;
  const png = new Uint8Array(total);
  let off = 0;
  png.set(sig, off); off += sig.length;
  png.set(ihdrC, off); off += ihdrC.length;
  png.set(idatC, off); off += idatC.length;
  png.set(iendC, off);
  return png;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk[4] = type.charCodeAt(0); chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2); chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function deflateStore(data: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const numBlocks = Math.ceil(data.length / maxBlock) || 1;
  const out = new Uint8Array(2 + numBlocks * 5 + data.length + 4);
  let pos = 0;
  out[pos++] = 0x78; out[pos++] = 0x01;
  let remaining = data.length, offset = 0;
  while (remaining > 0 || offset === 0) {
    const blockSize = Math.min(remaining, maxBlock);
    const isLast = remaining <= maxBlock;
    out[pos++] = isLast ? 1 : 0;
    out[pos++] = blockSize & 0xFF; out[pos++] = (blockSize >> 8) & 0xFF;
    out[pos++] = (~blockSize) & 0xFF; out[pos++] = ((~blockSize) >> 8) & 0xFF;
    out.set(data.subarray(offset, offset + blockSize), pos);
    pos += blockSize; offset += blockSize; remaining -= blockSize;
    if (blockSize === 0) break;
  }
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0;
  out[pos++] = (adler >> 24) & 0xFF; out[pos++] = (adler >> 16) & 0xFF;
  out[pos++] = (adler >> 8) & 0xFF; out[pos++] = adler & 0xFF;
  return out.subarray(0, pos);
}
