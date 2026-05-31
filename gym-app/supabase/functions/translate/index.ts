import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEEPL_API_KEY = Deno.env.get('DEEPL_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Free API uses api-free.deepl.com, Pro uses api.deepl.com
const DEEPL_BASE = DEEPL_API_KEY?.endsWith(':fx')
  ? 'https://api-free.deepl.com'
  : 'https://api.deepl.com';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');

serve(async (req) => {
  if (!ALLOWED_ORIGIN) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration: ALLOWED_ORIGIN not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

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
        JSON.stringify({ error: 'Authentication failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // ── END AUTH CHECK ─────────────────────────────────────────

    // ── GYM USAGE CAP CHECK (must run BEFORE any expensive call) ──
    {
      const { data: profile } = await supabase
        .from('profiles')
        .select('gym_id')
        .eq('id', user.id)
        .maybeSingle();
      const gymId = profile?.gym_id;
      if (gymId) {
        const { data: cap } = await supabase
          .from('gym_usage_caps').select('*').eq('gym_id', gymId).maybeSingle();
        const limit = cap?.ai_translate_monthly_cap ?? 20000;
        const { data: ok } = await supabase.rpc('check_and_increment_gym_usage', {
          p_gym_id: gymId,
          p_endpoint: 'translate',
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

    // ── Database-based rate limiting (60 requests per user per hour) ──
    // Insert FIRST, then count, then reject if over the cap. This avoids the
    // TOCTOU race where two concurrent requests both see count<60 and both
    // insert, blowing past the limit. With insert-first the post-check is
    // race-free because every winning request is already counted.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // Fail closed if the slot insert errors — an unchecked insert lets the
    // counter under-count and the per-user cap (DeepL cost control) be bypassed.
    const { error: rlInsErr } = await supabase.from('ai_rate_limits').insert({ profile_id: user.id, endpoint: 'translate' });
    if (rlInsErr) {
      console.error('Rate-limit slot insert failed (rejecting):', rlInsErr.message);
      return new Response(
        JSON.stringify({ error: 'Rate limit unavailable. Try again later.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { count, error: rlError } = await supabase
      .from('ai_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', user.id)
      .eq('endpoint', 'translate')
      .gte('requested_at', oneHourAgo);

    if (rlError) {
      console.error('Rate limit check failed:', rlError);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if ((count ?? 0) > 60) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded — max 60 requests per hour' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!DEEPL_API_KEY) {
      return new Response(JSON.stringify({ error: 'DeepL API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { texts, target_lang = 'ES' } = await req.json();
    // source_lang omitted = DeepL auto-detects

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return new Response(JSON.stringify({ error: 'texts must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (texts.length > 50) {
      return new Response(JSON.stringify({ error: 'Too many texts (max 50)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const totalChars = texts.reduce((sum: number, t: string) => sum + (typeof t === 'string' ? t.length : 0), 0);
    if (totalChars > 50000) {
      return new Response(JSON.stringify({ error: 'Total text too long (max 50000 chars)' }), {
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
      console.error(`DeepL error: ${res.status}`, err);
      return new Response(JSON.stringify({ error: 'Translation service error' }), {
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
    console.error('translate error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
