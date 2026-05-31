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

/**
 * Validates `data` against `schema` allowlist:
 *  - drops unknown keys with console.warn
 *  - enforces type / range / allowed / maxLength
 *  - returns { valid: boolean, value: any, missing: string[] }
 */
function validateSchema(
  data: any,
  schema: Record<string, SchemaEntry>
): { valid: boolean; value: Record<string, any>; missing: string[] } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, value: {}, missing: ['<root>'] };
  }
  const out: Record<string, any> = {};
  const missing: string[] = [];

  // Drop unknown keys
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
        if (rule.required) missing.push(key);
        out[key] = rule.nullable ? null : undefined;
        continue;
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
        && Boolean(aiConsent.body);
      if (!consented) {
        return new Response(
          JSON.stringify({ error: 'consent_required', feature: 'body-analysis' }),
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
          p_endpoint: 'analyze-body-photo',
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

    // Accepts: { image, sideImage?, weight_lbs?, height_inches?, sex? }
    const body = await req.json();
    const frontImage = body.image;
    const sideImage = body.sideImage;
    const weight = body.weight_lbs;
    const height = body.height_inches;
    const sex = body.sex || 'unknown';
    const lang = body.language === 'es' ? 'es' : 'en';
    const langInstruction = lang === 'es'
      ? '\n\nIMPORTANT: All text values in the JSON (muscle_quality, scan_quality, scan_notes) MUST be in Spanish. Responde completamente en español.'
      : '';

    if (!frontImage) {
      return new Response(
        JSON.stringify({ error: 'No image provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── INPUT SIZE VALIDATION (max 10MB base64) ───────────────
    const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB
    const frontSize = typeof frontImage === 'string' ? frontImage.length : 0;
    const sideSize = typeof sideImage === 'string' ? sideImage.length : 0;
    if (frontSize > MAX_BASE64_SIZE || sideSize > MAX_BASE64_SIZE) {
      return new Response(
        JSON.stringify({ error: 'Image payload too large. Maximum size is 10MB per image.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── RATE LIMIT (15/hour) — insert-first to close race condition ──
    let rateLimitOk = false;
    try {
      const RATE_LIMIT = 15;
      const ENDPOINT = 'analyze-body-photo';
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Insert first so concurrent requests both consume a slot. If the insert
      // FAILS we must fail closed — an unchecked insert error meant the counter
      // could silently under-count and let a user blow past the cap (unbounded
      // paid OpenAI calls). Reject rather than proceed when we can't claim a slot.
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

      // Then check total count (including the one we just inserted)
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

      rateLimitOk = true;
    } catch (rateLimitError) {
      console.error('Rate limit check failed:', rateLimitError);
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Image format validation (reject HEIC/WebP/etc.) ─────────
    // Server-side backstop: only JPEG/PNG are allowed. Any other format
    // (HEIC — iOS camera default — WebP, TIFF…) is rejected rather than
    // having its EXIF (GPS/device serial) forwarded to OpenAI.
    if (detectImageFormat(frontImage) === 'unsupported'
      || (sideImage && detectImageFormat(sideImage) === 'unsupported')) {
      return new Response(
        JSON.stringify({ error: 'Unsupported image format. Please upload a JPEG or PNG.' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Strip EXIF metadata before sending to AI ────────────────
    // stripImageMetadata fails closed (returns null) on error/unsupported.
    const cleanFront = stripImageMetadata(frontImage);
    const cleanSide = sideImage ? stripImageMetadata(sideImage) : null;
    if (cleanFront === null || (sideImage && cleanSide === null)) {
      return new Response(
        JSON.stringify({ error: 'Unsupported image format. Please upload a JPEG or PNG.' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Build image inputs ──────────────────────────────────────
    const imageInputs: any[] = [
      {
        type: 'input_image',
        image_url: `data:image/jpeg;base64,${cleanFront}`,
      },
    ];
    if (cleanSide) {
      imageInputs.push({
        type: 'input_image',
        image_url: `data:image/jpeg;base64,${cleanSide}`,
      });
    }

    // ── Context string for better estimates ──────────────────────
    let contextStr = '';
    if (weight) contextStr += `Subject weighs ${weight} lbs. `;
    if (height) contextStr += `Height: ${height} inches. `;
    if (sex !== 'unknown') contextStr += `Sex: ${sex}. `;

    const photoCountStr = sideImage
      ? 'You are given TWO photos: the first is a FRONT view, the second is a SIDE view. Use both to make more accurate estimates. The side view is critical for waist depth, abdominal fat, and posture-related measurements.'
      : 'You are given a FRONT view photo only.';

    // ── AI CALL ─────────────────────────────────────────────────
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
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
              content: `You are a precise body composition analysis API. Respond with ONLY a valid JSON object.

CRITICAL RULES:
- Use real anatomical and fitness knowledge
- Body fat % ranges: elite athlete 6-13% (M) / 14-20% (F), fit 14-17% (M) / 21-24% (F), average 18-24% (M) / 25-31% (F)
- Circumference estimates should be realistic for the apparent build
- Return null for any measurement you cannot reasonably estimate
- It is better to return null than a bad guess

IMPORTANT: If the image contains inappropriate, explicit, or offensive content that is not a legitimate body/fitness photo, respond with exactly: {"error": "inappropriate_content", "message": "This image cannot be analyzed"}${langInstruction}`,
            },
            {
              role: 'user',
              content: [
                ...imageInputs,
                {
                  type: 'input_text',
                  text: `${photoCountStr}

${contextStr ? `Known info: ${contextStr}` : ''}

Analyze body composition and estimate measurements. Return JSON with these fields:
- body_fat_pct: estimated body fat percentage (number)
- chest_cm: chest circumference in cm (number or null)
- waist_cm: waist circumference in cm (number or null)
- hips_cm: hip circumference in cm (number or null)
- left_arm_cm: relaxed arm circumference in cm (number or null)
- right_arm_cm: relaxed arm circumference in cm (number or null)
- left_thigh_cm: thigh circumference in cm (number or null)
- right_thigh_cm: thigh circumference in cm (number or null)
- neck_cm: neck circumference in cm (number or null)
- shoulder_cm: shoulder width in cm (number or null)
- muscle_quality: "low" | "moderate" | "athletic" | "muscular" (string)
- scan_quality: "good" | "fair" | "poor" (based on lighting, clothing, angle)
- scan_notes: brief note about what could improve the scan (string, max 80 chars)`,
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

    if (!response.ok) {
      const errText = await response.text();
      console.error(`OpenAI API error: ${response.status} - ${errText}`);
      throw new Error('AI analysis temporarily unavailable');
    }

    const result = await response.json();
    const text = result.output?.find((o: any) => o.type === 'message')
      ?.content?.find((c: any) => c.type === 'output_text')?.text ?? '{}';

    let estimates;
    try {
      let jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
      estimates = JSON.parse(jsonStr);
    } catch {
      throw new Error('Failed to parse AI response');
    }

    // ── Content moderation check ────────────────────────────────
    if (estimates.error === 'inappropriate_content') {
      return new Response(
        JSON.stringify({ error: 'inappropriate_content', message: 'This image cannot be analyzed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── STRICT ALLOWLIST VALIDATION ─────────────────────────────
    const bodySchema: Record<string, SchemaEntry> = {
      body_fat_pct: { type: 'number', min: 3, max: 60, required: true, nullable: false },
      chest_cm: { type: 'number', min: 30, max: 250, nullable: true },
      waist_cm: { type: 'number', min: 30, max: 250, nullable: true },
      hips_cm: { type: 'number', min: 30, max: 250, nullable: true },
      left_arm_cm: { type: 'number', min: 15, max: 100, nullable: true },
      right_arm_cm: { type: 'number', min: 15, max: 100, nullable: true },
      left_thigh_cm: { type: 'number', min: 20, max: 150, nullable: true },
      right_thigh_cm: { type: 'number', min: 20, max: 150, nullable: true },
      neck_cm: { type: 'number', min: 20, max: 80, nullable: true },
      shoulder_cm: { type: 'number', min: 30, max: 100, nullable: true },
      muscle_quality: { type: 'string', allowed: ['low', 'moderate', 'athletic', 'muscular'], required: true },
      scan_quality: { type: 'string', allowed: ['good', 'fair', 'poor'], required: true },
      scan_notes: { type: 'string', maxLength: 200, nullable: true },
    };

    const { valid, value: validated, missing } = validateSchema(estimates, bodySchema);
    if (!valid) {
      console.warn('analyze-body-photo: ai_output_invalid, missing/invalid:', missing);
      return new Response(
        JSON.stringify({ error: 'ai_output_invalid' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clean: Record<string, any> = {};
    const numericFields = [
      'body_fat_pct', 'chest_cm', 'waist_cm', 'hips_cm',
      'left_arm_cm', 'right_arm_cm', 'left_thigh_cm', 'right_thigh_cm',
      'neck_cm', 'shoulder_cm',
    ];
    for (const f of numericFields) {
      const v = validated[f];
      clean[f] = (typeof v === 'number') ? Math.round(v * 10) / 10 : null;
    }
    clean.muscle_quality = validated.muscle_quality;
    clean.scan_quality = validated.scan_quality;
    clean.scan_notes = typeof validated.scan_notes === 'string' ? validated.scan_notes : '';

    // Calculate derived metrics
    if (weight && clean.body_fat_pct != null) {
      const weightKg = weight * 0.453592;
      const fatMassKg = weightKg * (clean.body_fat_pct / 100);
      const leanMassKg = weightKg - fatMassKg;
      clean.lean_mass_kg = Math.round(leanMassKg * 10) / 10;
      clean.fat_mass_kg = Math.round(fatMassKg * 10) / 10;

      if (height) {
        const heightM = height * 0.0254;
        clean.ffmi = Math.round((leanMassKg / (heightM * heightM)) * 10) / 10;
        clean.bmi = Math.round((weightKg / (heightM * heightM)) * 10) / 10;
      }
    }

    if (clean.waist_cm != null && clean.hips_cm != null) {
      clean.waist_to_hip = Math.round((clean.waist_cm / clean.hips_cm) * 100) / 100;
    }

    return new Response(
      JSON.stringify({ estimates: clean }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('analyze-body-photo error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
