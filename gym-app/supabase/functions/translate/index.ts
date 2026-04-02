import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const DEEPL_API_KEY = Deno.env.get('DEEPL_API_KEY');
// Free API uses api-free.deepl.com, Pro uses api.deepl.com
const DEEPL_BASE = DEEPL_API_KEY?.endsWith(':fx')
  ? 'https://api-free.deepl.com'
  : 'https://api.deepl.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!DEEPL_API_KEY) {
      return new Response(JSON.stringify({ error: 'DeepL API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { texts, target_lang = 'ES' } = await req.json();
    // source_lang omitted = DeepL auto-detects

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return new Response(JSON.stringify({ error: 'texts array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter out empty strings, keep track of indices
    const nonEmpty = texts.map((t: string, i: number) => ({ t, i })).filter((x: { t: string }) => x.t.trim());

    if (nonEmpty.length === 0) {
      return new Response(JSON.stringify({ translations: texts.map(() => ''), detected_lang: null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(`${DEEPL_BASE}/v2/translate`, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: nonEmpty.map((x: { t: string }) => x.t),
        target_lang,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `DeepL error: ${res.status}`, details: err }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();

    // DeepL returns detected_source_language per translation
    const detected_lang = data.translations[0]?.detected_source_language || null;

    // Rebuild full array with empty strings in original positions
    const translations = texts.map(() => '');
    nonEmpty.forEach((x: { i: number }, idx: number) => {
      translations[x.i] = data.translations[idx]?.text || '';
    });

    return new Response(JSON.stringify({ translations, detected_lang }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
