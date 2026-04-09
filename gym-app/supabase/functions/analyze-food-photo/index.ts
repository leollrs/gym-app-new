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

/** Strip EXIF/metadata from JPEG and PNG to prevent GPS/device info leakage */
function stripImageMetadata(base64: string): string {
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
    // Other formats (WebP, etc.): return as-is
    else {
      return base64;
    }

    let result = '';
    for (let j = 0; j < cleanedBytes.length; j++) result += String.fromCharCode(cleanedBytes[j]);
    return btoa(result);
  } catch {
    return base64; // On error, return original
  }
}

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) {
  console.error('FATAL: ALLOWED_ORIGIN environment variable is not set');
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
    // Strip EXIF metadata before sending to AI
    const image = stripImageMetadata(rawImage);

    // ── RATE LIMIT CHECK (15 requests/hour per user) — fail closed ──
    // Insert FIRST to claim a slot, then count. This prevents race conditions
    // where two concurrent requests both pass the check before either inserts.
    let rateLimitOk = false;
    try {
      const RATE_LIMIT = 15;
      const ENDPOINT = 'analyze-food-photo';
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Insert the rate limit record first to claim the slot
      await supabase.from('ai_rate_limits').insert({
        profile_id: user.id,
        endpoint: ENDPOINT,
      });

      // Now count including the just-inserted record
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
                  detail: 'low',
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

    if (!parsed.items?.length) {
      throw new Error('No food items identified');
    }

    // ── Build response from AI macros directly ──────────────────
    const items = parsed.items.map((item: any) => {
      const grams = Math.max(1, Math.min(item.estimated_grams ?? 100, 5000));
      return {
        name: item.name,
        grams,
        calories: Math.round(item.calories ?? 0),
        protein_g: Math.round((item.protein_g ?? 0) * 10) / 10,
        carbs_g: Math.round((item.carbs_g ?? 0) * 10) / 10,
        fat_g: Math.round((item.fat_g ?? 0) * 10) / 10,
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
        food_name: parsed.food_name || 'Unknown meal',
        confidence: parsed.confidence || 'medium',
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
