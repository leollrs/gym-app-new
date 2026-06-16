// Health probe used by (a) the Platform Operations page and (b) an EXTERNAL
// uptime monitor (UptimeRobot / healthchecks.io / Better Stack — see
// docs/OPERATIONS.md). It now does a real, lightweight DB round-trip so it
// reflects actual stack health, not just "the edge runtime booted":
//   - DB reachable → 200 { ok:true,  db:'up',   time }
//   - DB down/slow → 503 { ok:false, db:'down', time, error }
// An external monitor pinging this every 1-5 min will page you when the stack
// is actually unhealthy. (An internal pg_cron can't do this job: it lives
// inside the same Supabase project, so it's blind to its own host being down.)
//
// No auth required — the body carries no sensitive data (just up/down + timing).

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Do not advertise a wildcard ACAO. If ALLOWED_ORIGIN is unset, fall back to ''
// (no cross-origin). The probe itself remains callable server-to-server.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const DB_TIMEOUT_MS = 4000;

// Resolves true if a trivial PK-indexed read succeeds within the timeout.
// `gyms` is small and always present, so this is a cheap liveness signal.
async function dbIsUp(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const probe = admin.from('gyms').select('id').limit(1);
  const timeout = new Promise<{ error: unknown }>((resolve) =>
    setTimeout(() => resolve({ error: new Error('db_timeout') }), DB_TIMEOUT_MS),
  );
  try {
    const { error } = await Promise.race([probe, timeout]) as { error: unknown };
    return !error;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const time = new Date().toISOString();
  const ok = await dbIsUp();

  return new Response(
    JSON.stringify({ ok, db: ok ? 'up' : 'down', time, ...(ok ? {} : { error: 'database_unreachable' }) }),
    {
      status: ok ? 200 : 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
