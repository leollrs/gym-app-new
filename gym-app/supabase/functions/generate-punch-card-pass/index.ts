/**
 * Generate Punch Card Apple Wallet Pass — Supabase Edge Function
 * Separate pass type from the membership check-in pass.
 * No QR/barcode — purely a loyalty card showing punch card progress.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PASS_TYPE_ID = Deno.env.get('APPLE_PUNCH_PASS_TYPE_ID') || 'pass.com.tugympr.punchcard';
const TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';
const PASS_CERT_B64 = Deno.env.get('APPLE_PUNCH_CERT_BASE64') || '';
const PASS_KEY_B64 = Deno.env.get('APPLE_PUNCH_KEY_BASE64') || '';
const WWDR_CERT_B64 = Deno.env.get('APPLE_WWDR_CERT_BASE64') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.tugympr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLACEHOLDER_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83,
  222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 0,
  0, 0, 3, 0, 1, 24, 216, 95, 168, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
      // Internal call from webhook — verify token is the actual service-role key
      // (full string comparison, NOT decoded JWT payload which can be spoofed)
      if (token === SUPABASE_SERVICE_ROLE_KEY) {
        userId = bodyProfileId;
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // ── Build punch card progress strings ──
    const cards = punchCards || [];
    const topCard = cards[0];

    // Build visual punch progress: ● ● ● ● ● ○ ○ ○ ○ ○
    const buildPunchVisual = (punches: number, target: number) => {
      const filled = Math.min(punches, target - 1);
      return '●'.repeat(filled) + '○'.repeat(target - 1 - filled) + (punches >= target ? ' 🎁' : ' 🎁');
    };

    // Unique serial per product so each punch card is a separate pass in Wallet
    const slug = (cardName || topCard?.name || 'card').toLowerCase().replace(/[^a-z0-9]/g, '');
    const serialNumber = `punch-${userId}-${slug}`;

    const walletWebhookUrl = `${SUPABASE_URL}/functions/v1/apple-wallet-webhook`;

    const remaining = topCard ? topCard.target - topCard.punches : 0;
    const isComplete = topCard ? topCard.punches >= topCard.target : false;

    // Purchase QR payload — admin scans this to auto-fill member + product
    const productId = topCard?.productId || '';
    const purchaseQR = `gym-purchase:${profile?.gym_id}:${userId}:${productId}`;

    const passJson: any = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      serialNumber,
      webServiceURL: walletWebhookUrl,
      authenticationToken: profile?.wallet_auth_token || crypto.randomUUID(),
      organizationName: gymName || 'TuGymPR',
      description: `${gymName || 'TuGymPR'} Loyalty Card`,
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
          {
            key: 'member',
            label: 'MEMBER',
            value: memberName || 'Member',
          },
          ...(topCard ? [{
            key: 'status',
            label: 'STATUS',
            value: isComplete
              ? '🎁 Reward unlocked'
              : `${remaining} visit${remaining !== 1 ? 's' : ''} left`,
            changeMessage: '%@',
          }] : []),
        ],
        auxiliaryFields: [
          {
            key: 'gym',
            label: 'GYM',
            value: gymName || 'TuGymPR',
          },
          ...(topCard && topCard.completed > 0 ? [{
            key: 'rewards',
            label: 'REWARDS EARNED',
            value: `${topCard.completed}`,
            changeMessage: 'Rewards earned: %@',
          }] : []),
        ],
        backFields: [
          ...(cards.length > 0 ? [{
            key: 'allCards',
            label: 'Your Loyalty Cards',
            value: cards.map((pc: any) => {
              const r = pc.target - pc.punches;
              const earned = pc.completed > 0 ? ` · ${pc.completed} reward${pc.completed !== 1 ? 's' : ''} earned` : '';
              return `${pc.name}\n${pc.punches} / ${pc.target}${r > 0 ? ` — ${r} visit${r !== 1 ? 's' : ''} left` : ' — Reward unlocked!'}${earned}`;
            }).join('\n\n'),
          }] : []),
          {
            key: 'howItWorks',
            label: 'How It Works',
            value: 'Each purchase earns a punch toward a free reward. Your card updates automatically — no action needed.',
          },
        ],
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

    // ── Generate strip image with visual stamps ──
    const stripPng = generateStampStripImage(
      primaryColor,
      topCard ? topCard.punches : 0,
      topCard ? topCard.target : 10,
    );

    // ── Build .pkpass ZIP ──
    const files: Record<string, Uint8Array> = {
      'pass.json': passJsonBytes,
      'icon.png': iconPng,
      'icon@2x.png': iconPng,
      'logo.png': iconPng,
      'logo@2x.png': iconPng,
      'strip.png': stripPng,
      'strip@2x.png': stripPng,
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

      const forge = (await import('https://esm.sh/node-forge@1.3.1?no-dts&target=denonext')).default;

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
        status: 200,
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
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

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

function generateStripImage(accentHex: string): Uint8Array {
  return generateStampStripImage(accentHex, 0, 10);
}

/**
 * Generate a strip image with large, prominent stamp circles.
 * Filled stamps: solid accent fill + white dumbbell icon.
 * Empty stamps: visible ring outline.
 * Last slot: gift/reward icon.
 * @2x resolution: 750x246.
 */
function generateStampStripImage(accentHex: string, punches: number, target: number): Uint8Array {
  const W = 750, H = 246;
  const ah = accentHex.replace('#', '');
  const acR = parseInt(ah.substring(0, 2), 16) || 212;
  const acG = parseInt(ah.substring(2, 4), 16) || 175;
  const acB = parseInt(ah.substring(4, 6), 16) || 55;

  const raw = new Uint8Array(W * H * 4);

  // Dark background
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      raw[i] = 10; raw[i + 1] = 13; raw[i + 2] = 20; raw[i + 3] = 255;
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

  // ── Water bottle icon ──
  const drawBottle = (cx: number, cy: number, size: number, r: number, g: number, b: number, alpha: number) => {
    const bodyW = Math.round(size * 0.38);
    const bodyH = Math.round(size * 0.52);
    const neckW = Math.round(size * 0.18);
    const neckH = Math.round(size * 0.18);
    const capW = Math.round(size * 0.24);
    const capH = Math.round(size * 0.1);
    const cornerR = Math.round(bodyW * 0.3);

    // Body (rounded rectangle)
    const bodyTop = cy - Math.round(bodyH * 0.3);
    const bodyLeft = cx - Math.round(bodyW / 2);
    fillRect(bodyLeft, bodyTop + cornerR, bodyW, bodyH - cornerR, r, g, b, alpha);
    fillRect(bodyLeft + cornerR, bodyTop, bodyW - cornerR * 2, cornerR, r, g, b, alpha);
    fillCircle(bodyLeft + cornerR, bodyTop + cornerR, cornerR, r, g, b, alpha);
    fillCircle(bodyLeft + bodyW - cornerR, bodyTop + cornerR, cornerR, r, g, b, alpha);
    // Bottom rounded
    const botR = Math.round(bodyW * 0.25);
    fillCircle(bodyLeft + botR, bodyTop + bodyH - botR, botR, r, g, b, alpha);
    fillCircle(bodyLeft + bodyW - botR, bodyTop + bodyH - botR, botR, r, g, b, alpha);

    // Neck
    const neckTop = bodyTop - neckH;
    fillRect(cx - Math.round(neckW / 2), neckTop, neckW, neckH + 2, r, g, b, alpha);

    // Cap (wider than neck)
    const capTop = neckTop - capH;
    fillRect(cx - Math.round(capW / 2), capTop, capW, capH, r, g, b, alpha);
    // Cap rounded top
    const capR = Math.round(capW * 0.3);
    fillCircle(cx - Math.round(capW / 2) + capR, capTop + capR, capR, r, g, b, alpha);
    fillCircle(cx + Math.round(capW / 2) - capR, capTop + capR, capR, r, g, b, alpha);
  };

  // ── Star icon for gift/reward slot ──
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
  const totalSlots = target;
  const perRow = totalSlots <= 5 ? totalSlots : Math.ceil(totalSlots / 2);
  const numRows = totalSlots <= 5 ? 1 : 2;

  // Make circles as large as possible within the strip
  const maxRadiusFromH = Math.floor((H - 24) / (numRows * 2 + (numRows - 1) * 0.4));
  const maxRadiusFromW = Math.floor((W - 40) / (perRow * 2 + (perRow - 1) * 0.5));
  const radius = Math.min(maxRadiusFromH, maxRadiusFromW, 48); // cap at 48px @2x
  const gap = Math.round(radius * 0.4);
  const circleD = radius * 2;

  const gridH = numRows * circleD + (numRows - 1) * gap;
  const startY = Math.round((H - gridH) / 2) + radius;

  // ── Draw all stamps ──
  for (let i = 0; i < totalSlots; i++) {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : i - perRow;
    const rowSlots = row === 0 ? perRow : totalSlots - perRow;
    const rowW = rowSlots * circleD + (rowSlots - 1) * gap;
    const rowStartX = Math.round((W - rowW) / 2) + radius;
    const cx = rowStartX + col * (circleD + gap);
    const cy = startY + row * (circleD + gap);

    const isFree = i === totalSlots - 1;
    const isFilled = isFree ? punches >= target : i < punches;

    if (isFilled) {
      // Outer glow
      const glowR = radius + 6;
      for (let dy = -glowR; dy <= glowR; dy++) {
        for (let dx = -glowR; dx <= glowR; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius && d <= glowR) {
            blendPixel(cx + dx, cy + dy, acR, acG, acB, Math.round(Math.max(0, 1 - (d - radius) / 6) * 0.3 * 255));
          }
        }
      }

      // Solid filled circle
      fillCircle(cx, cy, radius, acR, acG, acB, 0.85);

      // Accent border ring
      strokeRing(cx, cy, radius, 3, acR, acG, acB, 1.0);

      // Icon inside (white)
      const iconSize = Math.round(radius * 0.7);
      if (isFree) {
        drawStar(cx, cy, iconSize, 255, 255, 255, 0.95);
      } else {
        drawBottle(cx, cy, iconSize, 255, 255, 255, 0.95);
      }
    } else {
      // Empty: visible ring
      strokeRing(cx, cy, radius, 2, 255, 255, 255, isFree ? 0.2 : 0.12);

      // Faint icon inside
      const iconSize = Math.round(radius * 0.55);
      if (isFree) {
        drawStar(cx, cy, iconSize, 255, 255, 255, 0.08);
      } else {
        drawBottle(cx, cy, iconSize, 255, 255, 255, 0.06);
      }
    }
  }

  return encodePNG(W, H, raw);
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
