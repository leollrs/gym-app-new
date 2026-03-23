/**
 * Generate Apple Wallet Pass — Supabase Edge Function
 * Pure Deno implementation — no external signing libraries.
 * Returns pass data for the client to handle.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64Encode } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PASS_TYPE_ID = Deno.env.get('APPLE_PASS_TYPE_ID') || 'pass.com.gymapp.member';
const TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';
const PASS_CERT_B64 = Deno.env.get('APPLE_PASS_CERT_BASE64') || '';
const PASS_KEY_B64 = Deno.env.get('APPLE_PASS_KEY_BASE64') || '';
const WWDR_CERT_B64 = Deno.env.get('APPLE_WWDR_CERT_BASE64') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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
      return new Response(JSON.stringify({ error: 'Unauthorized: ' + (authError?.message || 'no user') }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Request body ──
    const { payload, memberName, gymName, punchCards } = await req.json();
    if (!payload) {
      return new Response(JSON.stringify({ error: 'Missing payload' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Fetch profile (including stable wallet pass serial) ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('gym_id, wallet_pass_serial, wallet_auth_token')
      .eq('id', user.id)
      .single();

    // Ensure stable serial + auth token exist
    let passSerial = profile?.wallet_pass_serial;
    let passAuthToken = profile?.wallet_auth_token;
    if (!passSerial || !passAuthToken) {
      passSerial = `pass-${user.id}`;
      passAuthToken = crypto.randomUUID() + crypto.randomUUID();
      await supabase
        .from('profiles')
        .update({ wallet_pass_serial: passSerial, wallet_auth_token: passAuthToken })
        .eq('id', user.id);
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

    const displayFormat = gymData?.qr_display_format || 'qr_code';
    const primaryColor = branding?.primary_color || '#D4AF37';

    // ── Fetch gym logo if available ──
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

    // ── Build pass.json ──
    const serialNumber = passSerial;
    const walletWebhookUrl = `${SUPABASE_URL}/functions/v1/apple-wallet-webhook`;

    const barcodeMapping: Record<string, { format: string; messageEncoding: string }> = {
      qr_code:     { format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' },
      barcode_128: { format: 'PKBarcodeFormatCode128', messageEncoding: 'iso-8859-1' },
      barcode_39:  { format: 'PKBarcodeFormatCode39', messageEncoding: 'iso-8859-1' },
    };

    const barcodeConfig = barcodeMapping.qr_code;

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE_ID,
      teamIdentifier: TEAM_ID,
      serialNumber,
      webServiceURL: walletWebhookUrl,
      authenticationToken: passAuthToken,
      organizationName: gymName || 'TuGymPR',
      description: `${gymName || 'TuGymPR'} Membership`,
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
          label: gymName || 'TuGymPR',
          value: memberName || 'Member',
        }],
        secondaryFields: [
          ...(punchCards && punchCards.length > 0 ? [{
            key: 'loyalty',
            label: punchCards[0].name.toUpperCase(),
            value: `${punchCards[0].punches} / ${punchCards[0].target}`,
            changeMessage: '%@ punches',
          }] : []),
          { key: 'memberId', label: 'ID', value: payload },
        ],
        auxiliaryFields: [
          ...(punchCards && punchCards.length > 0 ? [{
            key: 'loyaltyStatus',
            label: 'STATUS',
            value: punchCards[0].punches >= punchCards[0].target
              ? '🎁 Reward unlocked'
              : `${punchCards[0].target - punchCards[0].punches} visit${punchCards[0].target - punchCards[0].punches !== 1 ? 's' : ''} left`,
            changeMessage: '%@',
          }] : []),
          ...(punchCards && punchCards.length > 1 ? punchCards.slice(1, 2).map((pc: any) => ({
            key: 'loyalty2',
            label: pc.name.toUpperCase(),
            value: `${pc.punches} / ${pc.target}`,
            changeMessage: '%@ punches',
          })) : []),
        ],
        backFields: [
          ...(punchCards && punchCards.length > 0 ? [{
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

    // ── Generate strip image (dark gradient banner) ──
    const stripPng = generateStripImage(primaryColor);

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

    // ── Sign manifest with PKCS#7 using node-forge (dynamic import) ──
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
      return new Response(JSON.stringify({
        error: 'Signing failed: ' + (signErr?.message || String(signErr)),
        stack: (signErr?.stack || '').substring(0, 500),
      }), {
        status: 200,
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
      error: err?.message || String(err),
      stack: (err?.stack || '').substring(0, 500)
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────

function hexToRgbString(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
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
 * Generate a dark gradient strip image as a raw PNG.
 * Strip dimensions: 375x123 for @1x (storeCard strip).
 * Creates a subtle gradient from dark with a hint of the gym's accent color.
 */
function generateStripImage(accentHex: string): Uint8Array {
  const width = 375;
  const height = 123;

  // Parse accent color
  const ah = accentHex.replace('#', '');
  const ar = parseInt(ah.substring(0, 2), 16) || 0;
  const ag = parseInt(ah.substring(2, 4), 16) || 0;
  const ab = parseInt(ah.substring(4, 6), 16) || 0;

  // Generate raw pixel data (RGBA)
  const rawData = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const t = y / height; // 0 at top, 1 at bottom
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Dark gradient: top is slightly lighter with accent tint, bottom is near-black
      // Subtle horizontal vignette
      const hx = Math.abs(x - width / 2) / (width / 2);
      const vignette = 1 - hx * 0.15;

      // Base dark colors with subtle accent
      const accentStrength = (1 - t) * 0.12 * vignette; // accent fades toward bottom
      const baseR = Math.round((18 + (ar - 18) * accentStrength) * (1 - t * 0.3));
      const baseG = Math.round((20 + (ag - 20) * accentStrength) * (1 - t * 0.3));
      const baseB = Math.round((24 + (ab - 24) * accentStrength) * (1 - t * 0.3));

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
