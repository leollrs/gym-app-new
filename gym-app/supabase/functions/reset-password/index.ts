import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_FAILED_ATTEMPTS = 5;

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) console.warn('CORS: ALLOWED_ORIGIN env var not set, using default');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN || 'https://app.tugympr.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405);

  // --- Request validation ---
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return jsonResp({ error: 'Content-Type must be application/json' }, 415);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonResp({ error: 'Request body must be a JSON object' }, 400);
  }

  try {
    const { token, email_code, email, new_password } = body as Record<string, unknown>;

    if (!token && !email_code) {
      return jsonResp({ error: 'Token or email code is required' }, 400);
    }
    if (typeof token !== 'undefined' && typeof token !== 'string') {
      return jsonResp({ error: 'token must be a string' }, 400);
    }
    if (typeof email_code !== 'undefined' && typeof email_code !== 'string') {
      return jsonResp({ error: 'email_code must be a string' }, 400);
    }
    if (email_code && !email) {
      return jsonResp({ error: 'Email is required when using email code' }, 400);
    }
    if (typeof email !== 'undefined' && typeof email !== 'string') {
      return jsonResp({ error: 'email must be a string' }, 400);
    }
    if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
      return jsonResp({ error: 'Password must be at least 8 characters' }, 400);
    }
    if (new_password.length > 128) {
      return jsonResp({ error: 'Password too long' }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Helper: record a failed attempt and lock after MAX_FAILED_ATTEMPTS
    async function recordFailedAttempt(requestId: string) {
      const ip = req.headers.get('x-forwarded-for') || 'unknown';
      console.warn(`Password reset failed attempt: request_id=${requestId}, ip=${ip}`);
      await adminClient.rpc('increment_failed_reset_attempts', { request_id: requestId });
      // Re-fetch the current count
      const { data: row } = await adminClient
        .from('password_reset_requests')
        .select('failed_attempts')
        .eq('id', requestId)
        .single();
      if (row && row.failed_attempts >= MAX_FAILED_ATTEMPTS) {
        console.warn(`Password reset locked out: request_id=${requestId}, attempts=${row.failed_attempts}, ip=${ip}`);
        await adminClient
          .from('password_reset_requests')
          .update({ status: 'locked' })
          .eq('id', requestId);
      }
    }

    let request;

    if (email_code && email) {
      // Email-code flow: auto-approved (email itself is the verification)
      const { data, error: lookupErr } = await adminClient
        .from('password_reset_requests')
        .select('id, profile_id, status, expires_at, used_at, failed_attempts')
        .eq('email_code', (email_code as string).trim())
        .eq('email', (email as string).toLowerCase().trim())
        .in('status', ['pending', 'approved'])
        .is('used_at', null)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle();

      if (lookupErr || !data) {
        // We cannot record an attempt without a known request id, so just reject
        return jsonResp({ error: 'Invalid or expired code' }, 400);
      }
      if (data.status === 'locked' || data.failed_attempts >= MAX_FAILED_ATTEMPTS) {
        console.warn(`Password reset blocked (locked): request_id=${data.id}, ip=${req.headers.get('x-forwarded-for') || 'unknown'}`);
        return jsonResp({ error: 'This reset request has been locked due to too many failed attempts' }, 429);
      }
      // Verify the code matches the expected status for this flow
      if (data.status !== 'pending') {
        await recordFailedAttempt(data.id);
        return jsonResp({ error: 'Invalid or expired code' }, 400);
      }
      request = data;
    } else {
      // Token flow: requires admin approval
      const { data, error: lookupErr } = await adminClient
        .from('password_reset_requests')
        .select('id, profile_id, status, expires_at, used_at, failed_attempts')
        .eq('token', (token as string).trim())
        .in('status', ['approved', 'locked'])
        .is('used_at', null)
        .gte('expires_at', new Date().toISOString())
        .maybeSingle();

      if (lookupErr || !data) {
        return jsonResp({ error: 'Invalid or expired reset request' }, 400);
      }
      if (data.status === 'locked' || data.failed_attempts >= MAX_FAILED_ATTEMPTS) {
        console.warn(`Password reset blocked (locked): request_id=${data.id}, ip=${req.headers.get('x-forwarded-for') || 'unknown'}`);
        return jsonResp({ error: 'This reset request has been locked due to too many failed attempts' }, 429);
      }
      request = data;
    }

    // Update password
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(
      request.profile_id,
      { password: new_password }
    );

    if (updateErr) {
      console.error('Password update error:', updateErr);
      await recordFailedAttempt(request.id);
      return jsonResp({ error: 'Failed to update password' }, 500);
    }

    // Mark as used
    await adminClient
      .from('password_reset_requests')
      .update({ used_at: new Date().toISOString(), status: 'used' })
      .eq('id', request.id);

    return jsonResp({ success: true });
  } catch (err) {
    console.error('reset-password error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});
