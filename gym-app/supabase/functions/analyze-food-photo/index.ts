import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Strip EXIF metadata from JPEG to prevent GPS/device info leakage */
function stripExifFromJpeg(base64: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return base64;
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
  } catch {
    return base64;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://app.tugympr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── AUTH CHECK ──────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: `Auth failed: ${authError?.message || 'no user'}` }),
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
    const image = stripExifFromJpeg(rawImage);

    // ── RATE LIMIT CHECK (15 requests/hour per user) — fail closed ──
    let rateLimitOk = false;
    try {
      const RATE_LIMIT = 15;
      const ENDPOINT = 'analyze-food-photo';
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { count: requestCount } = await supabase
        .from('ai_rate_limits')
        .select('*', { count: 'exact', head: true })
        .eq('profile_id', user.id)
        .eq('endpoint', ENDPOINT)
        .gte('requested_at', oneHourAgo);

      if ((requestCount ?? 0) >= RATE_LIMIT) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase.from('ai_rate_limits').insert({
        profile_id: user.id,
        endpoint: ENDPOINT,
      });
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
    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
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

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`OpenAI API error: ${aiResponse.status} - ${errText}`);
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
      throw new Error('Failed to parse AI response: ' + aiText.slice(0, 200));
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
