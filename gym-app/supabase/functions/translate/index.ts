import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEEPL_API_KEY = Deno.env.get('DEEPL_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Free API uses api-free.deepl.com, Pro uses api.deepl.com
const DEEPL_BASE = DEEPL_API_KEY?.endsWith(':fx')
  ? 'https://api-free.deepl.com'
  : 'https://api.deepl.com';

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
