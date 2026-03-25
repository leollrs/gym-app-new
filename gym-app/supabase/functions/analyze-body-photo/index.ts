import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: `Auth failed: ${authError?.message || 'no user'}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── END AUTH CHECK ─────────────────────────────────────────

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Accepts: { image, sideImage?, weight_lbs?, height_inches?, sex? }
    const body = await req.json();
    const frontImage = body.image;
    const sideImage = body.sideImage;
    const weight = body.weight_lbs;
    const height = body.height_inches;
    const sex = body.sex || 'unknown';

    if (!frontImage) {
      throw new Error('No image provided');
    }

    // ── RATE LIMIT (15/hour) ────────────────────────────────────
    try {
      const RATE_LIMIT = 15;
      const ENDPOINT = 'analyze-body-photo';
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

      supabase.from('ai_rate_limits').insert({
        profile_id: user.id,
        endpoint: ENDPOINT,
      });
    } catch {
      // proceed anyway
    }

    // ── Build image inputs ──────────────────────────────────────
    const imageInputs: any[] = [
      {
        type: 'input_image',
        image_url: `data:image/jpeg;base64,${frontImage}`,
      },
    ];
    if (sideImage) {
      imageInputs.push({
        type: 'input_image',
        image_url: `data:image/jpeg;base64,${sideImage}`,
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
    const response = await fetch('https://api.openai.com/v1/responses', {
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
- It is better to return null than a bad guess`,
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

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
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
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
