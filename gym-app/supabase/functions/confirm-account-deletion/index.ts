// =============================================================================
// confirm-account-deletion
// =============================================================================
// Public, no-auth-required edge function that consumes a one-time deletion
// token (issued by `request-account-deletion` and emailed to the user) and
// triggers the cascade delete via `delete_user_account_admin(user_id)`.
//
// Called from https://tugympr.com/eliminar-cuenta?token=<token> when the user
// clicks the verification link in the email.
//
// FLOW
// ----
// 1. Hash the incoming token (SHA-256) to match what's stored in
//    account_deletion_requests.token_hash.
// 2. Look up the row. Reject if missing / consumed / expired.
// 3. Mark the row consumed (idempotency guard: a second click can't
//    re-trigger deletion).
// 4. Call delete_user_account_admin(user_id) RPC. This wipes all the user's
//    data + storage objects + auth.users row.
// 5. Return 200 with a success flag. The web page should then show "Your
//    account has been deleted."
//
// SECURITY
// --------
// - No auth required (public endpoint by design — Play Store policy).
// - Only the SHA-256 hash of the token is stored, so a DB leak alone cannot
//   trigger deletions.
// - 1-hour TTL on the token (set by request-account-deletion).
// - Single-use: once consumed_at is set, the row can't be reused.
// - Errors return generic messages; specific reason logged server-side only.
//
// REQUIRED ENV VARS
// -----------------
//   SUPABASE_URL                  (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
//   ALLOWED_ORIGIN                CORS allowlist. Use "*" or "https://tugympr.com".
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// SHA-256 → hex (matches the request side)
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let payload: { token?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const token = (payload?.token ?? '').trim();
  if (!token || token.length < 16 || token.length > 256) {
    return jsonResponse({ error: 'Invalid token' }, 400);
  }

  const tokenHash = await sha256Hex(token);

  // Look up the request row
  const { data: row, error: fetchErr } = await supabase
    .from('account_deletion_requests')
    .select('id, user_id, status, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (fetchErr) {
    console.error('[confirm-account-deletion] fetch error:', fetchErr);
    return jsonResponse({ error: 'Server error' }, 500);
  }

  if (!row) {
    // Generic message — don't reveal whether the token ever existed
    return jsonResponse({ error: 'Invalid or expired token' }, 400);
  }

  if (row.status !== 'pending') {
    return jsonResponse({ error: 'Token already used' }, 400);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    // Best-effort mark expired so it can't be retried
    await supabase
      .from('account_deletion_requests')
      .update({ status: 'expired' })
      .eq('id', row.id);
    return jsonResponse({ error: 'Token expired. Please request a new deletion link.' }, 400);
  }

  if (!row.user_id) {
    // The original request didn't resolve to a user (e.g., email not found).
    // Mark consumed so it can't be retried, return generic success.
    await supabase
      .from('account_deletion_requests')
      .update({ status: 'consumed', consumed_at: new Date().toISOString() })
      .eq('id', row.id);
    return jsonResponse({ ok: true });
  }

  // Mark consumed BEFORE deletion so a duplicate click can't re-fire
  // the cascade. If the cascade fails, the row stays 'consumed' with no
  // matching auth user — operationally fine; the user can try again.
  const { error: markErr } = await supabase
    .from('account_deletion_requests')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending'); // idempotency guard

  if (markErr) {
    console.error('[confirm-account-deletion] mark consumed failed:', markErr);
    return jsonResponse({ error: 'Server error' }, 500);
  }

  // Trigger the cascade
  const { error: rpcErr } = await supabase.rpc('delete_user_account_admin', {
    p_user_id: row.user_id,
  });

  if (rpcErr) {
    console.error('[confirm-account-deletion] RPC failed:', rpcErr);
    // Leave the row marked consumed (above) so it can't be re-triggered.
    // The user should contact support if they see this error.
    return jsonResponse({ error: 'Deletion failed. Please contact support@tugympr.com.' }, 500);
  }

  return jsonResponse({ ok: true });
});
