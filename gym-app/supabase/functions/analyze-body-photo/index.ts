import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const { image } = await req.json();

    if (!image) {
      throw new Error('No image provided');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: image,
                },
              },
              {
                type: 'text',
                text: `Analyze this body photo and estimate body composition. Return ONLY a JSON object with estimated values. Use null for any measurement you cannot reasonably estimate from the photo.

The fields are:
- body_fat_pct: estimated body fat percentage (number, e.g. 18.5)
- chest_cm: chest circumference in cm (number or null)
- waist_cm: waist circumference in cm (number or null)
- hips_cm: hip circumference in cm (number or null)
- left_arm_cm: arm circumference in cm (number or null)
- right_arm_cm: arm circumference in cm (number or null)
- left_thigh_cm: thigh circumference in cm (number or null)
- right_thigh_cm: thigh circumference in cm (number or null)

Important: Body fat % is the most reliably estimable from a photo. For circumference measurements, only estimate if the photo provides enough visual reference to make a reasonable guess. It's better to return null than a bad estimate.

Respond with ONLY the JSON object, no markdown or explanation.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text ?? '{}';

    // Parse the JSON from the response
    let estimates;
    try {
      // Handle potential markdown wrapping
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      estimates = JSON.parse(jsonStr);
    } catch {
      throw new Error('Failed to parse AI response');
    }

    // Validate and clean the estimates
    const clean: Record<string, number | null> = {};
    const fields = [
      'body_fat_pct', 'chest_cm', 'waist_cm', 'hips_cm',
      'left_arm_cm', 'right_arm_cm', 'left_thigh_cm', 'right_thigh_cm',
    ];

    for (const f of fields) {
      const val = estimates[f];
      if (val != null && typeof val === 'number' && val > 0 && val < 500) {
        clean[f] = Math.round(val * 10) / 10;
      } else {
        clean[f] = null;
      }
    }

    return new Response(
      JSON.stringify({ estimates: clean }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
