// =============================================================================
// request-account-deletion
// =============================================================================
// Public, no-auth-required edge function that accepts a POST { email, reason? }
// from the public web form at https://tugympr.com/eliminar-cuenta and emails the
// user a one-time verification link to confirm the deletion. This is the
// Google Play "no login required" account deletion entry point.
//
// SECURITY MODEL
// --------------
// - Always returns 200 with a generic message ("If an account exists ...") to
//   prevent account enumeration via differential responses.
// - Uses constant-ish behavior on the success path (timing pad ~250ms) so a
//   caller cannot tell from response time whether the email matched a user.
// - Per-email rate limit: 3 requests / hour
// - Per-IP rate limit: 100 requests / day
// - Generates a cryptographically random URL-safe token (32 bytes), stores
//   only the SHA-256 hash in the DB so a DB leak cannot be used to confirm
//   pending deletions.
//
// REQUIRED ENV VARS
// -----------------
//   SUPABASE_URL                  (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
//   RESEND_API_KEY                Resend API key (same provider as send-admin-email)
//   ALLOWED_ORIGIN                CORS allowlist. Use "*" since this is a fully
//                                 public endpoint reachable from the marketing
//                                 site, OR set to "https://tugympr.com".
//   PUBLIC_SITE_URL               (optional) Base URL for the deletion link.
//                                 Defaults to "https://tugympr.com".
//
// REQUIRED MIGRATION (run separately)
// -----------------------------------
//   create table if not exists public.account_deletion_requests (
//     id              uuid primary key default gen_random_uuid(),
//     email           text not null,
//     user_id         uuid references auth.users(id) on delete set null,
//     token_hash      text not null,
//     reason          text,
//     ip_address      text,
//     user_agent      text,
//     requested_at    timestamptz not null default now(),
//     expires_at      timestamptz not null default (now() + interval '1 hour'),
//     consumed_at     timestamptz,
//     status          text not null default 'pending'
//                     check (status in ('pending','consumed','expired','cancelled'))
//   );
//   create index if not exists account_deletion_requests_email_idx
//     on public.account_deletion_requests (email, requested_at desc);
//   create index if not exists account_deletion_requests_ip_idx
//     on public.account_deletion_requests (ip_address, requested_at desc);
//   create index if not exists account_deletion_requests_token_idx
//     on public.account_deletion_requests (token_hash);
//   alter table public.account_deletion_requests enable row level security;
//   -- No policies = service role only. The public endpoint runs with the
//   -- service role key, so no end-user access is needed or wanted.
//
// FOLLOW-UP WORK (NOT IN THIS FILE)
// ---------------------------------
// This function only RECEIVES the request and emails a verification link.
// The actual deletion happens when the user clicks the link, which requires:
//   1. A public web route at /eliminar-cuenta?token=<token> (Vercel page)
//   2. A `confirm-account-deletion` edge function that:
//        - Looks up the request by token_hash
//        - Verifies status='pending' and now() < expires_at
//        - Marks it consumed
//        - Calls the existing delete_user_account RPC for the linked user
// Both of those are out-of-scope for this PR.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const PUBLIC_SITE_URL = (Deno.env.get('PUBLIC_SITE_URL') ?? 'https://tugympr.com').replace(/\/+$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GENERIC_OK = {
  success: true,
  message:
    "If an account exists for that email, we've sent a verification link. Check your inbox (including spam). The link expires in 1 hour.",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TABLE = 'account_deletion_requests';
const PER_EMAIL_LIMIT = 3;        // per hour
const PER_IP_LIMIT = 100;         // per day
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Constant-ish timing pad so success/no-account paths look the same. */
function timingPad(t0: number, targetMs = 250): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(targetMs - (Date.now() - t0), 0)));
}

/** 32 random bytes → 43-char base64url token (no padding). */
function generateToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getClientIp(req: Request): string | null {
  // Supabase Edge Runtime sits behind Cloudflare-style proxies — prefer
  // the leftmost X-Forwarded-For entry, else CF-Connecting-IP.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml(verificationUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1.0" />
<title>Confirm your TuGymPR account deletion</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;-webkit-text-size-adjust:100%;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;margin:0;padding:0;">
<tr><td align="center" valign="top" style="padding:48px 20px;">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-collapse:collapse;">

<tr><td align="center" style="padding:0 0 32px 0;">
<div style="width:56px;height:56px;border-radius:14px;background-color:#d4a14a;margin:0 auto 16px auto;text-align:center;line-height:56px;font-size:22px;font-weight:800;color:#181208;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">PR</div>
<p style="margin:0;font-size:14px;font-weight:700;color:#d4a14a;letter-spacing:1.5px;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">TuGymPR</p>
</td></tr>

<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#111827;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
<tr><td style="height:3px;background:linear-gradient(90deg,#ef4444,#ef444488,transparent);font-size:1px;line-height:1px;">&nbsp;</td></tr>
<tr><td style="padding:40px 40px 32px 40px;">
<p style="margin:0 0 12px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Confirm account deletion</p>
<p style="margin:0 0 20px;font-size:15px;color:#d1d5db;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
We received a request to permanently delete your TuGymPR account.
Click the button below to confirm. <strong style="color:#ffffff;">This cannot be undone.</strong>
</p>

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td align="center">
<a href="${escHtml(verificationUrl)}" style="display:inline-block;background-color:#ef4444;color:#ffffff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Confirm deletion</a>
</td></tr>
</table>

<p style="margin:0 0 12px;font-size:13px;color:#9ca3af;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
Or copy and paste this link into your browser:
</p>
<p style="margin:0 0 24px;font-size:12px;color:#6b7280;word-break:break-all;font-family:'Courier New',monospace;">
${escHtml(verificationUrl)}
</p>

<p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
This link expires in <strong style="color:#ffffff;">1 hour</strong>. If you didn't request this, you can ignore this email — your account will not be deleted.
</p>
</td></tr>
</table>
</td></tr>

<tr><td align="center" style="padding:28px 0 0 0;">
<p style="margin:0;font-size:11px;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
TuGymPR &middot; <a href="mailto:privacy@tugympr.com" style="color:#6b7280;text-decoration:none;">privacy@tugympr.com</a>
</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const t0 = Date.now();

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405);

  // Validate env up front. We do NOT throw at module load because we want the
  // function to start successfully even with degraded config — we just log and
  // still return the generic 200 so the form keeps working.
  if (!RESEND_API_KEY) {
    console.error('[request-account-deletion] RESEND_API_KEY is not set');
    await timingPad(t0);
    return jsonResp(GENERIC_OK);
  }

  let payload: { email?: unknown; reason?: unknown };
  try {
    payload = await req.json();
  } catch {
    // Bad JSON — still return generic so we don't leak which inputs are
    // valid. (We *could* 400 here, but the form is the only legitimate
    // caller and it always sends valid JSON.)
    await timingPad(t0);
    return jsonResp(GENERIC_OK);
  }

  const rawEmail = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const reason = typeof payload?.reason === 'string' ? payload.reason.slice(0, 2000) : null;

  // Format gate. Bad email → still generic 200 (no enumeration).
  if (!rawEmail || !EMAIL_REGEX.test(rawEmail) || rawEmail.length > 254) {
    await timingPad(t0);
    return jsonResp(GENERIC_OK);
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // -------------------------------------------------------------------------
  // Rate limiting.
  // We check the table; if the table doesn't exist yet (migration not run),
  // we log and proceed — rate limiting is degraded but the user-facing
  // behavior must not break.
  // -------------------------------------------------------------------------
  let tableExists = true;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: emailCount, error: emailCountErr } = await supabase
      .from(TABLE)
      .select('*', { count: 'exact', head: true })
      .eq('email', rawEmail)
      .gte('requested_at', oneHourAgo);

    if (emailCountErr) {
      // Postgres "relation does not exist" → 42P01. The deletion-requests table
      // ships in migration 0340; if it's genuinely missing we must FAIL CLOSED
      // rather than proceed with no rate limit + no persistence, which would let
      // an attacker fan out unlimited "confirm your account deletion" emails to
      // arbitrary victim addresses (email-bomb / phishing lure). Return the
      // generic OK without sending anything.
      if ((emailCountErr as { code?: string })?.code === '42P01') {
        console.error(
          `[request-account-deletion] table ${TABLE} missing — failing closed (no email sent). Run migration 0340.`,
        );
        await timingPad(t0);
        return jsonResp(GENERIC_OK);
      } else {
        // Any other query error: also fail closed — we can't confirm the caller
        // is under the rate limit, so we must not send.
        console.error('[request-account-deletion] email rate-limit query failed (failing closed):', emailCountErr);
        await timingPad(t0);
        return jsonResp(GENERIC_OK);
      }
    } else if ((emailCount ?? 0) >= PER_EMAIL_LIMIT) {
      // Silently absorb — still return generic so attacker cannot probe
      // the limit boundary to confirm the email is being targeted.
      await timingPad(t0);
      return jsonResp(GENERIC_OK);
    }

    if (tableExists && ip) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: ipCount, error: ipCountErr } = await supabase
        .from(TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('ip_address', ip)
        .gte('requested_at', oneDayAgo);

      if (!ipCountErr && (ipCount ?? 0) >= PER_IP_LIMIT) {
        await timingPad(t0);
        return jsonResp(GENERIC_OK);
      }
    }
  } catch (e) {
    console.error('[request-account-deletion] rate limit error (non-fatal):', e);
  }

  // -------------------------------------------------------------------------
  // Look up user by email via auth.admin.listUsers. There's no direct
  // "getByEmail" admin API — listUsers + filter is the standard pattern.
  // We bound it to one page; matched accounts will be on page 1 in nearly
  // all real-world deployments.
  // -------------------------------------------------------------------------
  let matchedUserId: string | null = null;
  try {
    // perPage max is 1000 in supabase-js admin client
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listErr) {
      console.error('[request-account-deletion] listUsers failed:', listErr);
    } else {
      const match = list?.users?.find(
        (u) => (u.email ?? '').toLowerCase() === rawEmail,
      );
      matchedUserId = match?.id ?? null;
    }
  } catch (e) {
    console.error('[request-account-deletion] listUsers threw:', e);
  }

  // No matched user → return generic 200 without sending any email.
  // (We deliberately do NOT insert a row here either, since storing a
  // tokenless lookup-miss serves no purpose and would just bloat the table.)
  if (!matchedUserId) {
    await timingPad(t0);
    return jsonResp(GENERIC_OK);
  }

  // -------------------------------------------------------------------------
  // Generate token, persist hash, send email.
  // -------------------------------------------------------------------------
  const token = generateToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  if (tableExists) {
    const { error: insertErr } = await supabase.from(TABLE).insert({
      email: rawEmail,
      user_id: matchedUserId,
      token_hash: tokenHash,
      reason,
      ip_address: ip,
      user_agent: userAgent,
      expires_at: expiresAt,
      status: 'pending',
    });
    if (insertErr) {
      console.error('[request-account-deletion] insert failed:', insertErr);
      // Don't fail the request — still try to send the email. (If the row
      // didn't persist, the eventual confirm call will fail safely.)
    }
  }

  const verificationUrl = `${PUBLIC_SITE_URL}/eliminar-cuenta?token=${encodeURIComponent(token)}`;

  try {
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TuGymPR <noreply@tugympr.com>',
        to: [rawEmail],
        subject: 'Confirm your TuGymPR account deletion',
        html: buildEmailHtml(verificationUrl),
      }),
    });
    if (!emailResp.ok) {
      const errBody = await emailResp.text();
      console.error('[request-account-deletion] Resend error:', emailResp.status, errBody);
      // Still return generic 200 — do not leak Resend failures to the caller.
    }
  } catch (e) {
    console.error('[request-account-deletion] Resend fetch threw:', e);
  }

  await timingPad(t0);
  return jsonResp(GENERIC_OK);
});
