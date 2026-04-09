import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Strip metadata from images (JPEG EXIF + PNG ancillary chunks) to prevent GPS/device info leakage */
function stripImageMetadata(base64: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // JPEG (FF D8)
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
      const cleanedBytes = new Uint8Array(cleaned);
      let result = '';
      for (let j = 0; j < cleanedBytes.length; j++) result += String.fromCharCode(cleanedBytes[j]);
      return btoa(result);
    }

    // PNG (89 50 4E 47) — strip non-critical chunks (tEXt, iTXt, zTXt, eXIf, etc.)
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const keep = ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'pHYs'];
      const parts: Uint8Array[] = [bytes.slice(0, 8)];
      let offset = 8;
      while (offset < bytes.length - 4) {
        const len = (bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3];
        const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
        const chunkTotal = 12 + len;
        if (keep.includes(type)) parts.push(bytes.slice(offset, offset + chunkTotal));
        offset += chunkTotal;
        if (type === 'IEND') break;
      }
      const totalLen = parts.reduce((s, a) => s + a.length, 0);
      const out = new Uint8Array(totalLen);
      let pos = 0;
      for (const p of parts) { out.set(p, pos); pos += p.length; }
      let result = '';
      for (let j = 0; j < out.length; j++) result += String.fromCharCode(out[j]);
      return btoa(result);
    }

    return base64;
  } catch {
    return base64;
  }
}

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN env var is required');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
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

      // Insert first so concurrent requests both consume a slot
      await supabase.from('ai_rate_limits').insert({
        profile_id: user.id,
        endpoint: ENDPOINT,
      });

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

    // ── Strip EXIF metadata before sending to AI ────────────────
    const cleanFront = stripImageMetadata(frontImage);
    const cleanSide = sideImage ? stripImageMetadata(sideImage) : null;

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

    // Validate numeric fields
    const clean: Record<string, any> = {};
    const numericFields = [
      'body_fat_pct', 'chest_cm', 'waist_cm', 'hips_cm',
      'left_arm_cm', 'right_arm_cm', 'left_thigh_cm', 'right_thigh_cm',
      'neck_cm', 'shoulder_cm',
    ];

    for (const f of numericFields) {
      const val = estimates[f];
      if (val != null && typeof val === 'number' && val > 0 && val < 500) {
        clean[f] = Math.round(val * 10) / 10;
      } else {
        clean[f] = null;
      }
    }

    // Pass through string fields
    clean.muscle_quality = ['low', 'moderate', 'athletic', 'muscular'].includes(estimates.muscle_quality)
      ? estimates.muscle_quality : 'moderate';
    clean.scan_quality = ['good', 'fair', 'poor'].includes(estimates.scan_quality)
      ? estimates.scan_quality : 'fair';
    clean.scan_notes = typeof estimates.scan_notes === 'string'
      ? estimates.scan_notes.slice(0, 100) : '';

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
