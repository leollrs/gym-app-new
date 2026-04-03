/**
 * Generate Apple Wallet Pass — Supabase Edge Function
 * Pure Deno implementation — no external signing libraries.
 * Returns pass data for the client to handle.
 *
 * Premium pass design with dynamic gym branding, rich strip images,
 * proper barcode format handling, and lock-screen relevance.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';
import forge from 'https://esm.sh/node-forge@1.3.1?no-dts&target=denonext';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PASS_TYPE_ID = Deno.env.get('APPLE_PASS_TYPE_ID') || 'pass.com.gymapp.member';
const TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';
const PASS_CERT_B64 = Deno.env.get('APPLE_PASS_CERT_BASE64') || '';
const PASS_KEY_B64 = Deno.env.get('APPLE_PASS_KEY_BASE64') || '';
const WWDR_CERT_B64 = Deno.env.get('APPLE_WWDR_CERT_BASE64') || '';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) console.warn('CORS: ALLOWED_ORIGIN env var not set, using default');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || 'https://app.tugympr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Minimal 1x1 white PNG for placeholder icons
const PLACEHOLDER_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83,
  222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 0,
  0, 0, 3, 0, 1, 24, 216, 95, 168, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

// ── Contrast color helper ────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

function hexToRgbString(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Returns contrast-appropriate foreground, label colors and darkness flag.
 * Uses relative luminance (sRGB) to decide light vs dark background.
 */
function getContrastColors(hexColor: string): { fg: string; label: string; isDark: boolean } {
  const { r, g, b } = hexToRgb(hexColor);
  // sRGB relative luminance
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const isDark = luminance <= 0.5;

  if (isDark) {
    return { fg: 'rgb(255, 255, 255)', label: 'rgb(180, 180, 190)', isDark: true };
  } else {
    return { fg: 'rgb(20, 20, 30)', label: 'rgb(80, 80, 90)', isDark: false };
  }
}

serve(async (req: Request) => {
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
      console.error('Auth failed:', authError?.message || 'no user');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Request body ──
    const { payload, memberName, gymName, punchCards } = await req.json();
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Missing payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch profile (including stable wallet pass serial + created_at for "member since") ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('gym_id, wallet_pass_serial, wallet_auth_token, created_at')
      .eq('id', user.id)
      .single();

    // Ensure stable serial + auth token exist
    let passSerial = profile?.wallet_pass_serial;
    let passAuthToken = profile?.wallet_auth_token;
    if (!passSerial || !passAuthToken) {
      passSerial = `pass-${user.id}`;
      const rawToken = crypto.randomUUID() + crypto.randomUUID();
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
      const hashedToken = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      await supabase
        .from('profiles')
        .update({ wallet_pass_serial: passSerial, wallet_auth_token: hashedToken })
        .eq('id', user.id);
      // Use the raw (unhashed) token in the pass so Apple Wallet can authenticate
      passAuthToken = rawToken;
    }

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

    // ── Fetch gym hours for back fields ──
    const { data: gymHours } = await supabase
      .from('gym_hours')
      .select('day_of_week, open_time, close_time, is_closed')
      .eq('gym_id', profile?.gym_id)
      .order('day_of_week', { ascending: true });

    // ── Fetch gym location from recent check-ins (gyms table has no lat/lng) ──
    // Use the most common check-in coordinates as the gym's approximate location
    const { data: recentCheckin } = await supabase
      .from('check_ins')
      .select('latitude, longitude')
      .eq('gym_id', profile?.gym_id)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('checked_in_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const displayFormat = gymData?.qr_display_format || 'qr_code';
    const primaryColor = branding?.primary_color || '#D4AF37';
    const { fg, label, isDark } = getContrastColors(primaryColor);

    // ── Format "Member Since" from profile.created_at ──
    let memberSinceStr = 'N/A';
    if (profile?.created_at) {
      const d = new Date(profile.created_at);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      memberSinceStr = `${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    // ── Fetch gym logo if available ──
    let iconPng = PLACEHOLDER_PNG;
    let hasLogo = false;
    if (branding?.logo_url) {
      try {
        const { data: signed } = await supabase.storage
          .from('gym-logos')
          .createSignedUrl(branding.logo_url, 60);
        if (signed?.signedUrl) {
          const logoRes = await fetch(signed.signedUrl);
          if (logoRes.ok) {
            iconPng = new Uint8Array(await logoRes.arrayBuffer());
            hasLogo = true;
          }
        }
      } catch { /* use placeholder */ }
    }

    // If no logo, generate a colored rectangle with the first letter of the gym name
    // (simple solid-color PNG — can't do real text in raw PNG without a font renderer)
    if (!hasLogo) {
      iconPng = generateLetterIcon(primaryColor, gymName || 'G');
    }

    // ── Build pass.json ──
    const serialNumber = passSerial;
    const walletWebhookUrl = `${SUPABASE_URL}/functions/v1/apple-wallet-webhook`;

    const barcodeMapping: Record<string, { format: string; messageEncoding: string }> = {
      qr_code:     { format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
      barcode_128: { format: 'PKBarcodeFormatCode128', messageEncoding: 'iso-8859-1' },
      barcode_39:  { format: 'PKBarcodeFormatCode39', messageEncoding: 'iso-8859-1' },
    };

    // Use the gym's configured display format, fallback to QR if not found
    const barcodeConfig = barcodeMapping[displayFormat] || barcodeMapping.qr_code;

    // ── Build back fields ──
    const backFields: any[] = [];

    // Loyalty summary
    if (punchCards && punchCards.length > 0) {
      backFields.push({
        key: 'loyaltyInfo',
        label: 'Your Loyalty Cards',
        value: punchCards.map((pc: any) => {
          const r = pc.target - pc.punches;
          const earned = pc.completed > 0 ? ` · ${pc.completed} reward${pc.completed !== 1 ? 's' : ''} earned` : '';
          return `${pc.name}\n${pc.punches} / ${pc.target}${r > 0 ? ` — ${r} visit${r !== 1 ? 's' : ''} left` : ' — Reward unlocked!'}${earned}`;
        }).join('\n\n'),
      });
    }

    // Gym hours
    if (gymHours && gymHours.length > 0) {
      const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const hoursLines = gymHours.map((h: any) => {
        const dayName = dayNames[h.day_of_week] || `Day ${h.day_of_week}`;
        if (h.is_closed) return `${dayName}: Closed`;
        const openStr = h.open_time?.substring(0, 5) || '?';
        const closeStr = h.close_time?.substring(0, 5) || '?';
        return `${dayName}: ${openStr} - ${closeStr}`;
      });
      backFields.push({
        key: 'gymHours',
        label: 'Gym Hours',
        value: hoursLines.join('\n'),
      });
    }

    // Terms
    backFields.push({
      key: 'terms',
      label: 'Terms',
      value: 'This digital membership card is for personal use only. Present at the gym entrance for check-in.',
    });

    // ── Build secondary fields ──
    const secondaryFields: any[] = [
      { key: 'memberId', label: 'MEMBER ID', value: payload },
    ];
    if (punchCards && punchCards.length > 0) {
      secondaryFields.push({
        key: 'loyalty',
        label: punchCards[0].name.toUpperCase(),
        value: `${punchCards[0].punches} / ${punchCards[0].target}`,
        changeMessage: '%@ punches',
      });
    }

    // ── Build auxiliary fields ──
    const auxiliaryFields: any[] = [
      { key: 'status', label: 'STATUS', value: 'Active' },
      { key: 'gym', label: 'GYM', value: gymName || 'TuGymPR' },
    ];

    // ── Locations (for lock screen relevance near the gym) ──
    const locations: any[] = [];
    if (recentCheckin?.latitude && recentCheckin?.longitude) {
      locations.push({
        latitude: parseFloat(recentCheckin.latitude),
        longitude: parseFloat(recentCheckin.longitude),
        relevantText: `Welcome to ${gymName || 'the gym'}!`,
      });
    }

    const passJson: any = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      serialNumber,
      webServiceURL: walletWebhookUrl,
      authenticationToken: passAuthToken,
      organizationName: gymName || 'TuGymPR',
      description: `${gymName || 'TuGymPR'} Membership`,
      foregroundColor: fg,
      backgroundColor: hexToRgbString(primaryColor),
      labelColor: label,
      // relevantDate — surfaces pass on lock screen when recently updated
      relevantDate: new Date().toISOString(),
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
          key: 'memberSince',
          label: 'MEMBER SINCE',
          value: memberSinceStr,
        }],
        primaryFields: [{
          key: 'name',
          label: gymName || 'TuGymPR',
          value: memberName || 'Member',
        }],
        secondaryFields,
        auxiliaryFields,
        backFields,
      },
    };

    // Add locations if available
    if (locations.length > 0) {
      passJson.locations = locations;
    }

    const passJsonBytes = new TextEncoder().encode(JSON.stringify(passJson));

    // ── Check if signing certs are configured ──
    if (!PASS_CERT_B64 || !PASS_KEY_B64 || !WWDR_CERT_B64 || !TEAM_ID) {
      return new Response(JSON.stringify({
        unsupported: true,
        message: 'Apple Wallet pass signing not configured.',
        passData: passJson,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Generate strip images at 3 sizes ──
    const strip1x = generateStripImage(primaryColor, gymName || 'TuGymPR', 375, 123);
    const strip2x = generateStripImage(primaryColor, gymName || 'TuGymPR', 750, 246);
    const strip3x = generateStripImage(primaryColor, gymName || 'TuGymPR', 1125, 369);

    // ── Build .pkpass ZIP ──
    // Icon and logo: use the gym logo at all sizes (can't resize in edge functions without sharp/canvas)
    // Ideal sizes — icon: 29x29 @1x / 58x58 @2x / 87x87 @3x; logo: 160x50 @1x / 320x100 @2x
    const files: Record<string, Uint8Array> = {
      'pass.json': passJsonBytes,
      'icon.png': iconPng,
      'icon@2x.png': iconPng,
      'icon@3x.png': iconPng,
      'logo.png': iconPng,
      'logo@2x.png': iconPng,
      'strip.png': strip1x,
      'strip@2x.png': strip2x,
      'strip@3x.png': strip3x,
    };

    // Generate manifest.json (SHA-1 hash of each file — Apple PassKit spec)
    const manifest: Record<string, string> = {};
    for (const [name, data] of Object.entries(files)) {
      const hash = await crypto.subtle.digest('SHA-1', data);
      manifest[name] = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    files['manifest.json'] = manifestBytes;

    // ── Sign manifest with PKCS#7 using node-forge ──
    let signature: Uint8Array;
    try {
      // Polyfill Node.js crypto.randomBytes for Deno
      if (typeof globalThis.process === 'undefined') {
        (globalThis as any).process = { env: {} };
      }
      if (typeof (globalThis as any).crypto?.randomBytes !== 'function') {
        const nodeCrypto = { randomBytes: (n: number) => {
          const buf = new Uint8Array(n);
          crypto.getRandomValues(buf);
          // Return a Buffer-like object with toString
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
      console.error('Pass signing failed:', signErr?.message, signErr?.stack);
      return new Response(JSON.stringify({
        error: 'Pass generation failed',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    files['signature'] = signature;

    // Build ZIP
    const zipBytes = buildZip(files);

    return new Response(JSON.stringify({
      pkpass: base64Encode(zipBytes),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('generate-apple-pass error:', err?.message, err?.stack);
    return new Response(JSON.stringify({
      error: 'Pass generation failed',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────

/**
 * Generate a simple colored square icon with the first letter of the gym name.
 * Since we can't render real fonts in raw PNG, we draw a solid-color square.
 * The Apple Wallet pass will show this as the icon/logo thumbnail.
 */
function generateLetterIcon(hexColor: string, gymName: string): Uint8Array {
  const size = 87; // @3x icon size, works for all scales
  const { r, g, b } = hexToRgb(hexColor);
  const rawData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      rawData[idx]     = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = 255;
    }
  }

  return encodePNG(size, size, rawData);
}

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
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    parts.push(localHeader);
    parts.push(data);

    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdEntry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
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
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);

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

/**
 * Generate a premium strip image as a raw PNG.
 * Features:
 *  - Rich gradient from the gym's primary color (darker at edges, lighter in center)
 *  - Subtle radial glow in the center
 *  - Fine dot pattern overlay (2px dots at 8% opacity, 12px grid)
 *  - Thin gold accent line at the bottom (3px tall, #D4AF37)
 */
function generateStripImage(accentHex: string, _gymName: string, width: number, height: number): Uint8Array {
  // Parse primary/accent color
  const { r: ar, g: ag, b: ab } = hexToRgb(accentHex);

  // Derive darker and lighter variants of the primary color
  const darkerR = Math.round(ar * 0.35);
  const darkerG = Math.round(ag * 0.35);
  const darkerB = Math.round(ab * 0.35);
  const lighterR = Math.min(255, Math.round(ar * 1.15));
  const lighterG = Math.min(255, Math.round(ag * 1.15));
  const lighterB = Math.min(255, Math.round(ab * 1.15));

  // Gold accent line color
  const goldR = 212, goldG = 175, goldB = 55; // #D4AF37

  // Scale-aware sizes
  const scale = width / 375; // 1x, 2x, or 3x
  const dotRadius = Math.round(2 * scale);
  const dotSpacing = Math.round(12 * scale);
  const accentLineHeight = Math.round(3 * scale);
  const diagonalSpacing = Math.round(20 * scale);

  // Generate raw pixel data (RGBA)
  const rawData = new Uint8Array(width * height * 4);

  const centerX = width / 2;
  const centerY = height / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // ── Base gradient: radial from center (lighter) to edges (darker) ──
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist; // 0 at center, ~1 at corners
      const gradientT = Math.min(1, dist * 1.2); // slightly exaggerated

      // Smooth interpolation (ease-in-out)
      const smooth = gradientT * gradientT * (3 - 2 * gradientT);

      let baseR = Math.round(lighterR + (darkerR - lighterR) * smooth);
      let baseG = Math.round(lighterG + (darkerG - lighterG) * smooth);
      let baseB = Math.round(lighterB + (darkerB - lighterB) * smooth);

      // ── Radial glow: subtle bright spot in the center ──
      const glowDist = Math.sqrt(dx * dx + (dy * 1.5) * (dy * 1.5)) / maxDist;
      const glow = Math.max(0, 1 - glowDist * 2.5);
      const glowStrength = glow * glow * 0.15; // subtle
      baseR = Math.round(baseR + (255 - baseR) * glowStrength);
      baseG = Math.round(baseG + (255 - baseG) * glowStrength);
      baseB = Math.round(baseB + (255 - baseB) * glowStrength);

      // ── Diagonal line pattern overlay (thin white lines at 15% opacity, 45deg, 20px spacing) ──
      // Line at 45 degrees: x + y = constant, repeating every diagonalSpacing pixels
      const diagVal = (x + y) % diagonalSpacing;
      const lineThickness = Math.max(1, Math.round(1 * scale));
      if (diagVal < lineThickness) {
        // Blend white at 15% opacity
        baseR = Math.round(baseR + (255 - baseR) * 0.15);
        baseG = Math.round(baseG + (255 - baseG) * 0.15);
        baseB = Math.round(baseB + (255 - baseB) * 0.15);
      }

      // ── Dot pattern overlay (2px dots at 8% opacity, 12px grid) ──
      const gridX = x % dotSpacing;
      const gridY = y % dotSpacing;
      const dotCenterX = dotSpacing / 2;
      const dotCenterY = dotSpacing / 2;
      const dotDx = gridX - dotCenterX;
      const dotDy = gridY - dotCenterY;
      const dotDist = Math.sqrt(dotDx * dotDx + dotDy * dotDy);
      if (dotDist <= dotRadius) {
        // Blend white at 8% opacity
        baseR = Math.round(baseR + (255 - baseR) * 0.08);
        baseG = Math.round(baseG + (255 - baseG) * 0.08);
        baseB = Math.round(baseB + (255 - baseB) * 0.08);
      }

      // ── Gold accent line at the bottom ──
      if (y >= height - accentLineHeight) {
        baseR = goldR;
        baseG = goldG;
        baseB = goldB;
      }

      rawData[idx]     = Math.min(255, Math.max(0, baseR));
      rawData[idx + 1] = Math.min(255, Math.max(0, baseG));
      rawData[idx + 2] = Math.min(255, Math.max(0, baseB));
      rawData[idx + 3] = 255; // fully opaque
    }
  }

  return encodePNG(width, height, rawData);
}

/** Encode raw RGBA pixel data as a minimal PNG */
function encodePNG(width: number, height: number, rgba: Uint8Array): Uint8Array {
  // PNG filter: prepend 0 (None filter) to each row
  const filtered = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (width * 4 + 1)] = 0; // filter byte
    filtered.set(
      rgba.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1
    );
  }

  // Deflate using a simple store (no compression) for compatibility
  const deflated = deflateStore(filtered);

  // Build PNG
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', deflated);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(total);
  let off = 0;
  png.set(signature, off); off += signature.length;
  png.set(ihdrChunk, off); off += ihdrChunk.length;
  png.set(idatChunk, off); off += idatChunk.length;
  png.set(iendChunk, off);

  return png;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);

  // CRC32 over type + data
  const crcData = chunk.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcData));

  return chunk;
}

/** Minimal deflate using stored blocks (no compression). Good enough for small PNGs. */
function deflateStore(data: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const numBlocks = Math.ceil(data.length / maxBlock) || 1;
  // zlib header (2 bytes) + blocks (5 + blockSize each) + adler32 (4 bytes)
  const out = new Uint8Array(2 + numBlocks * 5 + data.length + 4);
  let pos = 0;

  // zlib header: CMF=0x78 (deflate, window=32K), FLG=0x01 (no dict, check bits)
  out[pos++] = 0x78;
  out[pos++] = 0x01;

  let remaining = data.length;
  let offset = 0;

  while (remaining > 0 || offset === 0) {
    const blockSize = Math.min(remaining, maxBlock);
    const isLast = remaining <= maxBlock;

    out[pos++] = isLast ? 1 : 0; // BFINAL + BTYPE=00 (stored)
    out[pos++] = blockSize & 0xFF;
    out[pos++] = (blockSize >> 8) & 0xFF;
    out[pos++] = (~blockSize) & 0xFF;
    out[pos++] = ((~blockSize) >> 8) & 0xFF;

    out.set(data.subarray(offset, offset + blockSize), pos);
    pos += blockSize;
    offset += blockSize;
    remaining -= blockSize;

    if (blockSize === 0) break;
  }

  // Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  out[pos++] = (adler >> 24) & 0xFF;
  out[pos++] = (adler >> 16) & 0xFF;
  out[pos++] = (adler >> 8) & 0xFF;
  out[pos++] = adler & 0xFF;

  return out.subarray(0, pos);
}
