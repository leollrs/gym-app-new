import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

/** Strip metadata chunks from PNG, keeping only critical/rendering chunks */
function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) return bytes;
  const sig = bytes.slice(0, 8);

  const criticalChunks = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'pHYs'];
  const result: Uint8Array[] = [sig];
  let offset = 8;

  while (offset < bytes.length - 4) {
    const len = (bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3];
    const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
    const chunkTotal = 12 + len; // 4 len + 4 type + data + 4 crc

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
 * Strip EXIF/metadata from JPEG and PNG to prevent GPS/device info leakage.
 * Fails closed: returns null on any error or unsupported format so the caller
 * never sends unstripped/unknown bytes to OpenAI.
 */
function stripImageMetadata(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    let cleanedBytes: Uint8Array;

    // JPEG: starts with FF D8
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      const cleaned: number[] = [0xFF, 0xD8];
      let i = 2;
      while (i < bytes.length - 1) {
        if (bytes[i] !== 0xFF) break;
        const marker = bytes[i + 1];
        // Remove APP1 (EXIF) and APP2 (ICC profile) markers
        if (marker === 0xE1 || marker === 0xE2) {
          const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
          i += 2 + segLen;
          continue;
        }
        // Start of scan — rest is image data
        if (marker === 0xDA) {
          for (let j = i; j < bytes.length; j++) cleaned.push(bytes[j]);
          break;
        }
        const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
        for (let j = i; j < i + 2 + segLen; j++) cleaned.push(bytes[j]);
        i += 2 + segLen;
      }
      cleanedBytes = new Uint8Array(cleaned);
    }
    // PNG: starts with 89 50 4E 47
    else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      cleanedBytes = stripPngMetadata(bytes);
    }
    // Other formats (WebP, HEIC, etc.): fail closed — do NOT leak metadata.
    else {
      return null;
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

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).auth.getUser(token);
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
        && Boolean(aiConsent.food);
      if (!consented) {
        return new Response(
          JSON.stringify({ error: 'consent_required', feature: 'food-analysis' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // ── END AI CONSENT CHECK ───────────────────────────────────

      // ── GYM MONTHLY CAP CHECK — DISABLED ─────────────────────────
      // The `check_and_increment_gym_usage` RPC is buggy: it ignores p_limit and
      // returns !ok on the very FIRST request, fail-closing every call to a 429
      // ("gym_monthly_cap_exceeded") even at zero real usage — the same issue
      // already disabled in send-sms / send-admin-email. Cost stays bounded by
      // the per-user 15/hour AI rate limit below. Re-enable once the RPC is fixed.
      // ── END (DISABLED) ──────────────────────────────────────────
    }
    // ── END GYM USAGE CAP CHECK ─────────────────────────────────

    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Service not available' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { image: rawImage, language } = await req.json();
    const lang = (language || 'en').startsWith('es') ? 'es' : 'en';
    const langInstruction = lang === 'es'
      ? '\n\nCRITICAL LANGUAGE RULE: You MUST respond with ALL text values in Spanish. The "food_name" field and every item "name" field MUST be in Spanish. Example: "Pechuga de pollo a la plancha" NOT "Grilled chicken breast". Responde completamente en español.'
      : '';
    if (!rawImage) {
      return new Response(
        JSON.stringify({ error: 'No image provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── INPUT SIZE VALIDATION (max 10 MB) ─────────────────────
    const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
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
    // Insert FIRST to claim a slot, then count. This prevents race conditions
    // where two concurrent requests both pass the check before either inserts.
    let rateLimitOk = false;
    try {
      const RATE_LIMIT = 15;
      const ENDPOINT = 'analyze-food-photo';
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Insert the rate limit record first to claim the slot. Fail closed if the
      // insert errors — otherwise the counter under-counts and the per-user cap
      // (the real OpenAI cost-control) can be bypassed indefinitely.
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

      // Now count including the just-inserted record
      const { count: requestCount } = await supabase
        .from('ai_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('endpoint', ENDPOINT)
        .gte('created_at', oneHourAgo);

      if ((requestCount ?? 0) > RATE_LIMIT) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      rateLimitOk = true;
    } catch (rateLimitError) {
      console.error('Rate limit check failed:', rateLimitError);
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── END RATE LIMIT ──────────────────────────────────────────

    // ── AI Vision — identify foods, portions, and macros ────────
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
            {
              role: 'system',
              content: `You are a precise food nutrition API. You MUST respond with ONLY a valid JSON object.

CRITICAL RULES:
- Water, sparkling water, mineral water = ALWAYS 0 calories, 0 protein, 0 carbs, 0 fat
- Diet/zero-sugar drinks = 0 calories, 0 protein, 0 carbs, 0 fat
- Be precise with macros using real nutritional data
- Common references per 100g: chicken breast 165cal/31P/0C/3.6F, white rice cooked 130cal/2.7P/28C/0.3F, banana 89cal/1.1P/23C/0.3F, egg 155cal/13P/1.1C/11F, bread 265cal/9P/49C/3.2F
- Regular Coke 355ml can = 140cal/0P/39C/0F
- Do NOT hallucinate or guess. Use real nutritional knowledge only.

IMPORTANT: If the image contains inappropriate, explicit, or offensive content that is not a legitimate food photo, respond with exactly: {"error": "inappropriate_content", "message": "This image cannot be analyzed"}${langInstruction}`,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: `data:image/jpeg;base64,${image}`,
                  // Bumped from 'low' → 'auto' so OpenAI Vision uses the high
                  // tile path when the photo benefits from it (small items,
                  // labels, mixed plates). 'auto' costs ~2-3× 'low' tokens
                  // for complex images but gives materially better food ID
                  // accuracy. Field tests with 'low' produced too many
                  // misidentifications on multi-item plates.
                  detail: 'auto',
                },
                {
                  type: 'input_text',
                  text: `Identify each food/drink item in this photo. For each item provide the name, estimated weight in grams (or ml for liquids), and accurate macronutrient values for that portion.

Return JSON: { "food_name": "short meal description", "items": [{ "name": "food name", "estimated_grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number }], "confidence": "high"|"medium"|"low" }

If no food or drink visible: { "error": "no_food_detected" }${lang === 'es' ? '\n\nREMEMBER: All text in the JSON response MUST be in Spanish.' : ''}`,
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

    // ── Content moderation check ────────────────────────────────
    if (parsed.error === 'inappropriate_content') {
      return new Response(
        JSON.stringify({ error: 'inappropriate_content', message: 'This image cannot be analyzed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (parsed.error === 'no_food_detected') {
      return new Response(
        JSON.stringify({ error: 'no_food_detected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── STRICT ALLOWLIST VALIDATION ─────────────────────────────
    const foodItemSchema: Record<string, SchemaEntry> = {
      name: { type: 'string', maxLength: 80, required: true },
      estimated_grams: { type: 'number', min: 0, max: 5000, nullable: true },
      calories: { type: 'number', min: 0, max: 5000, required: true },
      protein_g: { type: 'number', min: 0, max: 300, required: true },
      carbs_g: { type: 'number', min: 0, max: 500, required: true },
      fat_g: { type: 'number', min: 0, max: 300, required: true },
    };
    const foodSchema: Record<string, SchemaEntry> = {
      food_name: { type: 'string', maxLength: 120, nullable: true },
      confidence: { type: 'string', allowed: ['high', 'medium', 'low'], nullable: true },
      items: { type: 'array', maxItems: 20, items: foodItemSchema, required: true },
    };

    const { valid, value: validated, missing } = validateSchema(parsed, foodSchema);
    if (!valid || !Array.isArray(validated.items) || validated.items.length === 0) {
      console.warn('analyze-food-photo: ai_output_invalid, missing/invalid:', missing);
      return new Response(
        JSON.stringify({ error: 'ai_output_invalid' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Build response from validated AI macros ─────────────────
    const items = validated.items.map((item: any) => {
      const grams = Math.max(1, Math.min(item.estimated_grams ?? 100, 5000));
      return {
        name: item.name,
        grams,
        calories: Math.round(item.calories),
        protein_g: Math.round(item.protein_g * 10) / 10,
        carbs_g: Math.round(item.carbs_g * 10) / 10,
        fat_g: Math.round(item.fat_g * 10) / 10,
        usda_match: false,
      };
    });

    const total_calories = items.reduce((s: number, i: any) => s + i.calories, 0);
    const total_protein_g = Math.round(items.reduce((s: number, i: any) => s + i.protein_g, 0) * 10) / 10;
    const total_carbs_g = Math.round(items.reduce((s: number, i: any) => s + i.carbs_g, 0) * 10) / 10;
    const total_fat_g = Math.round(items.reduce((s: number, i: any) => s + i.fat_g, 0) * 10) / 10;

    if (total_calories < 0 || total_calories > 10000) {
      throw new Error('Estimated calories out of reasonable range');
    }

    return new Response(
      JSON.stringify({
        food_name: validated.food_name || 'Unknown meal',
        confidence: validated.confidence || 'medium',
        total_calories,
        total_protein_g,
        total_carbs_g,
        total_fat_g,
        items,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('analyze-food-photo error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
