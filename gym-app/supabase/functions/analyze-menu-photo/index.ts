import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Concatenate multiple Uint8Arrays into one */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) return bytes;
  const sig = bytes.slice(0, 8);
  const criticalChunks = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'pHYs'];
  const result: Uint8Array[] = [sig];
  let offset = 8;
  while (offset < bytes.length - 4) {
    const len = (bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3];
    const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
    const chunkTotal = 12 + len;
    if (criticalChunks.includes(type)) {
      result.push(bytes.slice(offset, offset + chunkTotal));
    }
    offset += chunkTotal;
    if (type === 'IEND') break;
  }
  return concatUint8Arrays(result);
}

/** Detect image format via magic bytes. Returns 'jpeg' | 'png' | 'unsupported'. */
function detectImageFormat(base64: string): 'jpeg' | 'png' | 'unsupported' {
  try {
    // Decode just enough of the prefix to read the magic bytes.
    const head = atob(base64.slice(0, 16));
    const b = new Uint8Array(head.length);
    for (let i = 0; i < head.length; i++) b[i] = head.charCodeAt(i);
    // JPEG: FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
      b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
    ) return 'png';
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/**
 * Strip EXIF / metadata from JPEG + PNG to prevent GPS / device info leakage.
 * Fails closed: returns null on any error or unsupported format so the caller
 * never sends unstripped/unknown bytes to OpenAI.
 */
function stripImageMetadata(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    let cleanedBytes: Uint8Array;

    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      const cleaned: number[] = [0xFF, 0xD8];
      let i = 2;
      while (i < bytes.length - 1) {
        if (bytes[i] !== 0xFF) break;
        const marker = bytes[i + 1];
        if (marker === 0xE1 || marker === 0xE2) {
          const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
          i += 2 + segLen;
          continue;
        }
        if (marker === 0xDA) {
          for (let j = i; j < bytes.length; j++) cleaned.push(bytes[j]);
          break;
        }
        const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
        for (let j = i; j < i + 2 + segLen; j++) cleaned.push(bytes[j]);
        i += 2 + segLen;
      }
      cleanedBytes = new Uint8Array(cleaned);
    } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      cleanedBytes = stripPngMetadata(bytes);
    } else {
      return null; // Other formats (WebP, HEIC, etc.): fail closed.
    }

    let result = '';
    for (let j = 0; j < cleanedBytes.length; j++) result += String.fromCharCode(cleanedBytes[j]);
    return btoa(result);
  } catch {
    return null; // Fail closed — never return unstripped bytes.
  }
}

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) {
  console.error('FATAL: ALLOWED_ORIGIN environment variable is not set');
}

// ── Strict allowlist schema validator ──────────────────────────
type SchemaEntry = {
  type: 'number' | 'string' | 'boolean' | 'array';
  min?: number;
  max?: number;
  allowed?: string[];
  maxLength?: number;
  required?: boolean;
  nullable?: boolean;
  items?: Record<string, SchemaEntry>;
  maxItems?: number;
};

function validateSchema(
  data: any,
  schema: Record<string, SchemaEntry>
): { valid: boolean; value: Record<string, any>; missing: string[] } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, value: {}, missing: ['<root>'] };
  }
  const out: Record<string, any> = {};
  const missing: string[] = [];

  for (const k of Object.keys(data)) {
    if (!(k in schema)) {
      console.warn(`validateSchema: dropping unknown key "${k}"`);
    }
  }

  for (const [key, rule] of Object.entries(schema)) {
    const v = data[key];
    const isNullish = v === null || v === undefined;
    if (isNullish) {
      if (rule.required) missing.push(key);
      out[key] = rule.nullable ? null : undefined;
      continue;
    }

    if (rule.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        if (rule.required) missing.push(key); out[key] = rule.nullable ? null : undefined; continue;
      }
      if (rule.min != null && v < rule.min) { if (rule.required) missing.push(key); out[key] = rule.nullable ? null : undefined; continue; }
      if (rule.max != null && v > rule.max) { if (rule.required) missing.push(key); out[key] = rule.nullable ? null : undefined; continue; }
      out[key] = v;
    } else if (rule.type === 'string') {
      if (typeof v !== 'string') { if (rule.required) missing.push(key); out[key] = rule.nullable ? null : undefined; continue; }
      let s = v;
      if (rule.maxLength != null) s = s.slice(0, rule.maxLength);
      if (rule.allowed && !rule.allowed.includes(s)) { if (rule.required) missing.push(key); out[key] = rule.nullable ? null : undefined; continue; }
      out[key] = s;
    } else if (rule.type === 'boolean') {
      if (typeof v !== 'boolean') { if (rule.required) missing.push(key); out[key] = rule.nullable ? null : undefined; continue; }
      out[key] = v;
    } else if (rule.type === 'array') {
      if (!Array.isArray(v)) { if (rule.required) missing.push(key); out[key] = []; continue; }
      const limited = rule.maxItems != null ? v.slice(0, rule.maxItems) : v;
      if (rule.items) {
        const cleaned: any[] = [];
        for (const it of limited) {
          const r = validateSchema(it, rule.items);
          if (r.valid) cleaned.push(r.value);
        }
        out[key] = cleaned;
      } else {
        out[key] = limited;
      }
    }
  }

  return { valid: missing.length === 0, value: out, missing };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (!ALLOWED_ORIGIN) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    // ── AUTH CHECK ──────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── END AUTH CHECK ─────────────────────────────────────────

    // ── GYM USAGE CAP CHECK (must run BEFORE any expensive call) ──
    {
      const { data: profile } = await supabase
        .from('profiles')
        .select('gym_id, ai_consent')
        .eq('id', user.id)
        .maybeSingle();

      // ── AI CONSENT CHECK (GDPR Art. 7) — fail closed ───────────
      // Consent is recorded per-feature in profiles.ai_consent JSONB as
      // { body: ISO8601, food: ISO8601, menu: ISO8601, version: 1 }.
      // A feature is consented when its timestamp is truthy AND the
      // consent version matches. Missing profile/consent ⇒ not consented.
      const aiConsent = profile?.ai_consent;
      const consented = !!aiConsent
        && typeof aiConsent === 'object'
        && aiConsent.version === 1
        && Boolean(aiConsent.menu);
      if (!consented) {
        return new Response(
          JSON.stringify({ error: 'consent_required', feature: 'menu-analysis' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // ── END AI CONSENT CHECK ───────────────────────────────────

      const gymId = profile?.gym_id;
      if (gymId) {
        const { data: cap } = await supabase
          .from('gym_usage_caps').select('*').eq('gym_id', gymId).maybeSingle();
        const limit = cap?.ai_vision_monthly_cap ?? 5000;
        const { data: ok } = await supabase.rpc('check_and_increment_gym_usage', {
          p_gym_id: gymId,
          p_endpoint: 'analyze-menu-photo',
          p_profile_id: user.id,
          p_window: '30 days',
          p_limit: limit,
        });
        if (!ok) {
          return new Response(
            JSON.stringify({ error: 'gym_monthly_cap_exceeded' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }
    // ── END GYM USAGE CAP CHECK ─────────────────────────────────

    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Service not available' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Accept both {imageBase64} (per spec) and {image} (to match analyze-food-photo)
    const body = await req.json();
    const rawImage: string | undefined = body?.imageBase64 || body?.image;
    const language: string | undefined = body?.language;
    const lang = (language || 'en').startsWith('es') ? 'es' : 'en';
    const langInstruction = lang === 'es'
      ? '\n\nCRITICAL LANGUAGE RULE: You MUST respond with ALL text values in Spanish — item names, descriptions, and section labels all in Spanish.'
      : '';

    if (!rawImage) {
      return new Response(
        JSON.stringify({ error: 'No image provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── INPUT SIZE VALIDATION (max 10 MB) ─────────────────────
    const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
    if (typeof rawImage !== 'string' || rawImage.length > MAX_PAYLOAD_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Image payload too large. Maximum size is 10 MB.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Image format validation (reject HEIC/WebP/etc.) ─────────
    // Server-side backstop: only JPEG/PNG are allowed. Any other format
    // is rejected rather than having its EXIF forwarded to OpenAI.
    if (detectImageFormat(rawImage) === 'unsupported') {
      return new Response(
        JSON.stringify({ error: 'Unsupported image format. Please upload a JPEG or PNG.' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strip EXIF metadata before sending to AI (fails closed → null)
    const image = stripImageMetadata(rawImage);
    if (image === null) {
      return new Response(
        JSON.stringify({ error: 'Unsupported image format. Please upload a JPEG or PNG.' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── RATE LIMIT CHECK (15 requests/hour per user) — fail closed ──
    try {
      const RATE_LIMIT = 15;
      const ENDPOINT = 'analyze-menu-photo';
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Fail closed if the slot insert errors — otherwise the counter
      // under-counts and the per-user OpenAI cost cap can be bypassed.
      const { error: rlInsErr } = await supabase.from('ai_rate_limits').insert({
        profile_id: user.id,
        endpoint: ENDPOINT,
      });
      if (rlInsErr) {
        console.error('Rate-limit slot insert failed (rejecting):', rlInsErr.message);
        return new Response(
          JSON.stringify({ error: 'Rate limit unavailable. Try again later.' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { count: requestCount } = await supabase
        .from('ai_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('endpoint', ENDPOINT)
        .gte('requested_at', oneHourAgo);

      if ((requestCount ?? 0) > RATE_LIMIT) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (rateLimitError) {
      console.error('Rate limit check failed:', rateLimitError);
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── END RATE LIMIT ──────────────────────────────────────────

    // ── AI Vision — extract menu items + estimate macros ────────
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const systemPrompt = `You are analyzing a restaurant menu photo. Return every distinct menu item you can read, with best-effort macro estimates for a typical single-serving. If a price is visible, include it.

Respond in ${lang === 'es' ? 'Spanish' : 'English'}.${langInstruction}

Return strictly valid JSON matching this schema:
{
  "items": [{
    "name": "string — clean, just the dish name, max 40 chars",
    "description": "string — short 1-sentence description if visible",
    "section": "string | null — menu section like 'Appetizers', 'Mains', etc.",
    "price": "string | null",
    "calories": "number",
    "protein_g": "number",
    "carbs_g": "number",
    "fat_g": "number",
    "confidence": "number — 0 to 1"
  }],
  "restaurant_name": "string | null — if visible at top of menu"
}

If no menu is visible: {"error": "no_menu_detected"}
If inappropriate content: {"error": "inappropriate_content"}`;

    let aiResponse: Response;
    try {
      aiResponse = await fetch('https://api.openai.com/v1/responses', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-5-nano',
          input: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: `data:image/jpeg;base64,${image}`,
                  // Menu OCR REQUIRES 'high' — many menus have small print
                  // and stylized fonts that 'low' (512×512 tile) cannot
                  // resolve. The token cost is ~5× 'low', accepted as a
                  // necessary trade-off for legibility.
                  detail: 'high',
                },
                {
                  type: 'input_text',
                  text: `Extract every distinct menu item from this photo. Return ONLY the JSON object described in the system prompt — no prose.${lang === 'es' ? ' All text values MUST be in Spanish.' : ''}`,
                },
              ],
            },
          ],
          text: { format: { type: 'json_object' } },
        }),
      });
      clearTimeout(timeout);
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'AI analysis timed out' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw fetchErr;
    }

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`OpenAI API error: ${aiResponse.status} - ${errText}`);
      throw new Error('AI analysis temporarily unavailable');
    }

    const aiResult = await aiResponse.json();
    const aiText = aiResult.output?.find((o: any) => o.type === 'message')
      ?.content?.find((c: any) => c.type === 'output_text')?.text ?? '{}';

    let parsed: any;
    try {
      let jsonStr = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('Failed to parse AI response:', aiText);
      throw new Error('Failed to parse AI response');
    }

    if (parsed.error === 'inappropriate_content') {
      return new Response(
        JSON.stringify({ error: 'inappropriate_content', message: 'This image cannot be analyzed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (parsed.error === 'no_menu_detected') {
      return new Response(
        JSON.stringify({ error: 'no_menu_detected', items: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── STRICT ALLOWLIST VALIDATION ─────────────────────────────
    const menuItemSchema: Record<string, SchemaEntry> = {
      name: { type: 'string', maxLength: 40, required: true },
      description: { type: 'string', maxLength: 200, nullable: true },
      section: { type: 'string', maxLength: 40, nullable: true },
      price: { type: 'string', maxLength: 20, nullable: true },
      calories: { type: 'number', min: 0, max: 5000, required: true },
      protein_g: { type: 'number', min: 0, max: 300, required: true },
      carbs_g: { type: 'number', min: 0, max: 500, required: true },
      fat_g: { type: 'number', min: 0, max: 300, required: true },
      confidence: { type: 'number', min: 0, max: 1, nullable: true },
    };
    const menuSchema: Record<string, SchemaEntry> = {
      items: { type: 'array', maxItems: 40, items: menuItemSchema, required: true },
      restaurant_name: { type: 'string', maxLength: 60, nullable: true },
    };

    const { valid, value: validated, missing } = validateSchema(parsed, menuSchema);
    if (!valid || !Array.isArray(validated.items) || validated.items.length === 0) {
      console.warn('analyze-menu-photo: ai_output_invalid, missing/invalid:', missing);
      return new Response(
        JSON.stringify({ error: 'ai_output_invalid' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const items = validated.items.map((it: any) => ({
      name: it.name.trim(),
      description: typeof it.description === 'string' ? it.description.trim() : null,
      section: typeof it.section === 'string' ? it.section.trim() : null,
      price: typeof it.price === 'string' ? it.price.trim() : null,
      calories: Math.round(it.calories),
      protein_g: Math.round(it.protein_g * 10) / 10,
      carbs_g: Math.round(it.carbs_g * 10) / 10,
      fat_g: Math.round(it.fat_g * 10) / 10,
      confidence: typeof it.confidence === 'number' ? it.confidence : 0.6,
    }));

    return new Response(
      JSON.stringify({
        items,
        restaurant_name: typeof validated.restaurant_name === 'string'
          ? validated.restaurant_name.trim()
          : null,
        analyzed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('analyze-menu-photo error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
