import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN');
if (!ALLOWED_ORIGIN) throw new Error('ALLOWED_ORIGIN env var is required');

// Don't throw at module init for missing env vars. A boot-time throw
// makes Supabase return 503 BOOT_ERROR with no CORS headers, which
// surfaces in the browser as a confusing CORS preflight failure.
// Instead, validate inside the handler so we can return a meaningful
// JSON error with proper CORS headers.
const MISSING_ENV = !RESEND_API_KEY
  ? 'RESEND_API_KEY environment variable is not set on the send-admin-email function. Configure it in Supabase: supabase secrets set RESEND_API_KEY=re_...'
  : null;

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Gemelo del `headerSafe` de send-automated-email. Todo lo que acaba en una
// cabecera del correo tiene que pasar por aquí; escHtml NO sirve para eso —
// escapa para el cuerpo HTML, no para una cabecera.
//
// `gymName` sale de gyms.name, que cualquier admin puede escribir sin
// restricción de columna (0013:5-9), y se interpola directo en
// `From: ${gymName} <noreply@tugympr.com>`. Un nombre con CR/LF o con
// `<...>` rompe la estructura de la cabecera: `Gym <quien@sea.com>` produce
// dos direcciones y deja que el intermediario escoja. El remitente es
// noreply@tugympr.com, compartido por TODA la plataforma, así que lo que
// salga mal de aquí le cae a todos los gimnasios.
function headerSafe(s: unknown, max: number): string {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}
const fromDisplayName = (s: unknown, fallback: string): string =>
  headerSafe(s, 64).replace(/["<>]/g, '').trim() || fallback;

const i18nStrings: Record<string, Record<string, string>> = {
  en: { greeting: 'Hey', team: 'Your team', poweredBy: 'Powered by', showQr: 'Show this QR code at the front desk', manualCode: 'Manual code', accessCode: 'Your access code', openApp: 'Get started' },
  es: { greeting: 'Hola', team: 'Tu equipo', poweredBy: 'Powered by', showQr: 'Muestra este código QR en recepción', manualCode: 'Código manual', accessCode: 'Tu código de acceso', openApp: 'Empezar' },
};

// Where a member who doesn't have the app yet is sent. `/get` (AppDownloadLanding)
// reads the visitor's platform and leads with the matching store — an EMAIL
// cannot do that itself, no client runs script, so the detection has to live one
// hop later on a page that can. Both direct store links are still printed for the
// case the mail was opened on a desktop.
const APP_ORIGIN = 'https://app.tugympr.com';

// The download row renders only once a store URL actually exists in app_config.
// Before launch both are blank, and a "Download the app" link pointing at a
// "coming soon" page is a dead end with a button on it. This lights up on its
// own the day the URLs are filled in — no redeploy.
function downloadFooter(lang: string, iosUrl?: string | null, androidUrl?: string | null) {
  if (!iosUrl && !androidUrl) return '';
  const isEs = lang === 'es';
  const t = {
    get: isEs ? '¿No tienes la app?' : "Don't have the app?",
    download: isEs ? 'Descárgala aquí' : 'Download it here',
    ios: 'App Store',
    android: 'Google Play',
  };
  const direct = [
    iosUrl ? `<a href="${escHtml(iosUrl)}" style="color:#6b7280;text-decoration:underline;">${t.ios}</a>` : '',
    androidUrl ? `<a href="${escHtml(androidUrl)}" style="color:#6b7280;text-decoration:underline;">${t.android}</a>` : '',
  ].filter(Boolean).join(' <span style="color:#374151;">·</span> ');
  return `
<tr><td align="center" style="padding:22px 0 0 0;">
<p style="margin:0 0 6px;font-size:12px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
${t.get} <a href="${escHtml(APP_ORIGIN)}/get" style="color:#9ca3af;text-decoration:underline;font-weight:600;">${t.download}</a>
</p>
<p style="margin:0;font-size:11px;color:#4b5563;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${direct}</p>
</td></tr>`;
}

// Readable text ON the gym's accent colour.
//
// The CTA button is filled with `primaryColor`, which is whatever the gym
// picked — and a good number of them pick gold or lime. White on gold is about
// 2:1; the label all but vanishes. Same relative-luminance rule the app uses for
// `--color-text-on-accent`, reimplemented here because an edge function shares
// no code with the client. Falls back to white on an unparseable value, which is
// the safe side for the dark palettes that dominate.
const INK = '#0B1220';
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Compare the two ACTUAL contrast ratios rather than testing luminance against
  // a hand-picked threshold. The first version used `L > 0.45`, and TuGymPR's
  // own gold (#D4AF37) lands at L = 0.4491 — just under, so it chose white, at
  // 2.1:1. Unreadable, on the brand's own colour, on the one button in the mail.
  // A threshold has a boundary and the boundary is always in the wrong place;
  // this has neither.
  const withWhite = 1.05 / (L + 0.05);
  const withInk   = (L + 0.05) / 0.05;
  return withInk >= withWhite ? INK : '#ffffff';
}

function buildEmailHtml({
  gymName,
  logoUrl,
  primaryColor,
  secondaryColor,
  memberFirstName,
  subject,
  body,
  lang = 'en',
  rewardLabel,
  rewardQrCode,
  rewardQrImageUrl,
  accessCode,
  ctaUrl,
  ctaLabel,
  iosStoreUrl,
  androidStoreUrl,
}: {
  gymName: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  memberFirstName: string;
  subject: string;
  body: string;
  lang?: string;
  rewardLabel?: string;
  rewardQrCode?: string;
  rewardQrImageUrl?: string;
  rewardMemberId?: string;
  // Optional STRUCTURE. This template renders `body` as a run of identical grey
  // paragraphs — which is right for prose and wrong for the two things a
  // transactional email actually exists to deliver. An access code set in the
  // same 15px grey as the sentence around it is not a code, it is a word; and a
  // link buried mid-sentence is not a call to action. The template cannot guess
  // which line matters, so the caller says so, and the plain-text path is
  // untouched for every caller that has nothing to declare.
  accessCode?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  iosStoreUrl?: string | null;
  androidStoreUrl?: string | null;
}) {
  const str = i18nStrings[lang] || i18nStrings.en;
  const paragraphs = body
    .split('\n')
    .filter((l: string) => l.trim())
    .map((line: string) =>
      `<p style="margin:0 0 16px;line-height:1.65;color:#d1d5db;font-size:15px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(line)}</p>`,
    )
    .join('\n');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${secondaryColor};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<!-- Full-width background wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${secondaryColor};margin:0;padding:0;">
<tr><td align="center" valign="top" style="padding:48px 20px 48px 20px;">

<!-- Main card — 560px max -->
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-collapse:collapse;">

<!-- ============================================================ -->
<!-- LOGO + GYM NAME BLOCK                                        -->
<!-- ============================================================ -->
<tr><td align="center" style="padding:0 0 32px 0;">
${logoUrl
  ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(gymName)}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:14px;margin:0 auto 16px auto;object-fit:cover;"/>`
  : `<div style="width:56px;height:56px;border-radius:14px;background-color:${primaryColor};margin:0 auto 16px auto;text-align:center;font-size:24px;font-weight:800;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:56px;">${escHtml(gymName.charAt(0).toUpperCase())}</div>`
}
<p style="margin:0;font-size:14px;font-weight:700;color:${primaryColor};letter-spacing:1.5px;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(gymName)}</p>
</td></tr>

<!-- ============================================================ -->
<!-- CONTENT CARD                                                 -->
<!-- ============================================================ -->
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#111827;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">

<!-- Accent top bar -->
<tr><td style="height:3px;background:linear-gradient(90deg,${primaryColor},${primaryColor}88,transparent);font-size:1px;line-height:1px;">&nbsp;</td></tr>

<!-- Greeting + Body -->
<tr><td style="padding:40px 40px 32px 40px;">

<p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.greeting} ${escHtml(memberFirstName)}</p>
<p style="margin:0 0 28px;font-size:13px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(subject)}</p>

${paragraphs}

${accessCode ? `
<!-- ACCESS CODE — the reason this email exists. Monospace, tracked out, and
     boxed in the gym's accent so it reads as something to TYPE, not to read.
     Tabular figures matter: a proportional font makes 5SKZYX ambiguous. -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px 0;">
<tr><td align="center" style="background-color:#0B1220;border:1px solid ${primaryColor}44;border-radius:14px;padding:22px 16px 20px 16px;">
<p style="margin:0 0 10px;font-size:10px;font-weight:700;color:${primaryColor};text-transform:uppercase;letter-spacing:1.6px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.accessCode}</p>
<p style="margin:0;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:7px;line-height:1.1;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace;">${escHtml(accessCode)}</p>
</td></tr>
</table>
` : ''}

${ctaUrl ? `
<!-- CTA — a real target, not a link inside a sentence. Table-wrapped with the
     radius on BOTH the cell and the anchor: Outlook drops the anchor's box
     model and keeps the cell, everything else does the opposite. Label colour is
     contrast-picked, because a gold-branded gym with white text on the button
     has an invisible label. -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
<tr><td align="center">
<table cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="background-color:${primaryColor};border-radius:12px;">
<a href="${escHtml(ctaUrl)}" style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:700;color:${onColor(primaryColor)};text-decoration:none;border-radius:12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(ctaLabel || str.openApp)}</a>
</td></tr>
</table>
</td></tr>
</table>
<!-- The same URL in plain text. A mail client that strips the button, or a
     member forwarding this to themselves, still has something to tap. -->
<p style="margin:12px 0 0;font-size:11px;line-height:1.5;color:#4b5563;text-align:center;word-break:break-all;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(ctaUrl)}</p>
` : ''}

${rewardLabel ? `
<!-- Reward Voucher -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${primaryColor}10;border:1px solid ${primaryColor}33;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px;text-align:center;">
<p style="margin:0 0 4px;font-size:11px;font-weight:600;color:${primaryColor};text-transform:uppercase;letter-spacing:1px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">REWARD</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(rewardLabel!)}</p>
${rewardQrImageUrl
  ? `<img src="${escHtml(rewardQrImageUrl)}" alt="QR ${escHtml(rewardQrCode || '')}" width="160" height="160" style="display:block;width:160px;height:160px;margin:0 auto 12px auto;border-radius:8px;background:#ffffff;padding:8px;"/>`
  : `<div style="display:block;width:160px;height:160px;margin:0 auto 12px auto;border-radius:8px;background:#1a1a2e;border:2px dashed #333;text-align:center;line-height:160px;font-size:12px;color:#6b7280;">QR unavailable</div>`
}
<p style="margin:0 0 8px;font-size:13px;color:#d1d5db;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.showQr}</p>
${rewardQrCode ? `<p style="margin:0;font-size:11px;color:#6b7280;font-family:'Courier New',monospace;letter-spacing:2px;">${str.manualCode}: <strong style="color:#ffffff;">${escHtml(rewardQrCode)}</strong></p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
` : ''}

</td></tr>

<!-- Divider + Signature -->
<tr><td style="padding:0 40px 36px 40px;">

<!-- Short accent line -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
<tr><td style="width:36px;height:2px;background-color:${primaryColor};border-radius:1px;font-size:1px;line-height:1px;">&nbsp;</td><td></td></tr>
</table>

<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(gymName)}</p>
<p style="margin:0;font-size:13px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.team}</p>

</td></tr>
</table>
</td></tr>

<!-- ============================================================ -->
<!-- FOOTER                                                       -->
<!-- ============================================================ -->
${downloadFooter(lang, iosStoreUrl, androidStoreUrl)}
<tr><td align="center" style="padding:22px 0 0 0;">
<p style="margin:0;font-size:11px;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
${escHtml(gymName)} · ${str.poweredBy} <span style="color:#6b7280;">TuGymPR</span>
</p>
</td></tr>

</table>
<!-- /Main card -->

</td></tr>
</table>

</body>
</html>`;
}

const DEPLOY_STAMP = 'DEPLOY_2026_05_29_TESTMODE';

Deno.serve(async (req) => {
  console.log('[send-admin-email]', DEPLOY_STAMP, 'method=', req.method, 'url=', req.url);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Only POST is served. (A prior unauthenticated GET debug-stamp endpoint
  // was removed — it leaked deploy metadata with no auth.)
  if (req.method !== 'POST') {
    return jsonResp({ error: 'Method not allowed' }, 405);
  }

  if (MISSING_ENV) {
    return jsonResp({ error: 'Email service not configured', detail: MISSING_ENV, stamp: DEPLOY_STAMP }, 503);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Missing authorization' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

    // Verify caller has admin authority — primary `role` OR `additional_roles`
    // bag (migration 0332 introduced multi-role; a member can also hold admin).
    const { data: callerProfile, error: callerErr } = await supabase
      .from('profiles')
      .select('role, gym_id, additional_roles')
      .eq('id', user.id)
      .single();

    const ADMIN_ROLES = ['admin', 'super_admin'];
    const hasAdminPrimary = !!callerProfile && ADMIN_ROLES.includes(callerProfile.role);
    const hasAdminAdditional = !!callerProfile && Array.isArray(callerProfile.additional_roles)
      && callerProfile.additional_roles.some((r: string) => ADMIN_ROLES.includes(r));

    if (!callerProfile || (!hasAdminPrimary && !hasAdminAdditional)) {
      // Log detail server-side; return a generic response to the client so we
      // don't leak the actor id, roles, or profile-lookup internals.
      console.warn('[send-admin-email] forbidden', {
        actor: user.id,
        role: callerProfile?.role ?? null,
        additional_roles: callerProfile?.additional_roles ?? null,
        profileFound: !!callerProfile,
        profileErr: callerErr?.message ?? null,
      });
      return jsonResp({ error: 'forbidden' }, 403);
    }

    // ── GYM USAGE CAP CHECK ──
    // DISABLED pending review: the `check_and_increment_gym_usage` RPC was
    // ignoring our p_limit argument and returning !ok on the very first
    // request of the day, blocking all sends. Until the RPC is fixed (or
    // we move the counter to client-side SQL) we rely on the per-admin
    // hourly rate limit below + the admin_audit_log entry per send for
    // abuse protection.
    // ── END GYM USAGE CAP CHECK ─────────────────────────────────

    const payload = await req.json();
    // `scope` marca un envío COMERCIAL (campañas de Outreach). Cuando viene, se
    // consulta email_allowed_for y se emite List-Unsubscribe. Cuando no viene,
    // el envío es transaccional (código de acceso, reset) y NO se gatea — un
    // miembro que se dio de baja de las promociones sigue necesitando su código.
    const { memberId, subject, body, overrideEmail, emailOverrideAcknowledged, lang, rewardType, rewardLabel, testMode, to, html, prerenderedHtml, accessCode, ctaUrl, ctaLabel, scope } = payload;

    // ── TEST MODE: admin previewing a template by sending it to a free-form address ──
    // Skips member lookup, audit-log linkage, and the buildEmailHtml branding wrap —
    // the client provides the fully-rendered HTML.
    if (testMode === true) {
      if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return jsonResp({ error: 'Valid `to` is required in testMode' }, 400);
      }
      if (typeof subject !== 'string' || subject.length === 0 || subject.length > 200) {
        return jsonResp({ error: 'Subject must be 1-200 characters' }, 400);
      }
      if (typeof html !== 'string' || html.length === 0 || html.length > 200000) {
        return jsonResp({ error: 'HTML must be 1-200000 characters' }, 400);
      }

      // testMode sends the caller-supplied `html` verbatim from
      // noreply@tugympr.com so the admin can preview the fully-rendered template
      // in whatever real inbox they choose — their own, a teammate's, or a
      // personal Gmail to sanity-check cross-client rendering. The recipient is
      // any valid email (format validated above). The HTML is intentionally not
      // run through buildEmailHtml escaping because the whole point of testMode
      // is to preview the template exactly as it will ship. Abuse is bounded by:
      // admin/super_admin-only (checked above), the per-admin hourly rate limit
      // (below), and an admin_audit_log row written per send.

      // Rate limiting: same cap as the live-send path, applied here too so
      // testMode is not an unbounded send channel. Counts all of this admin's
      // email actions (live + test) in the last hour.
      const { count: recentTestCount } = await supabase
        .from('admin_audit_log')
        .select('*', { count: 'exact', head: true })
        .eq('actor_id', user.id)
        .in('action', ['send_email', 'send_test_email'])
        .gte('created_at', new Date(Date.now() - 3600000).toISOString());
      if ((recentTestCount ?? 0) >= 5000) {
        return jsonResp({ error: 'admin_hourly_limit_exceeded', limit: 5000 }, 429);
      }

      const { data: gymRow } = await supabase
        .from('gyms').select('name').eq('id', callerProfile.gym_id).single();
      const fromName = fromDisplayName(gymRow?.name, 'Your Gym');

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <noreply@tugympr.com>`,
          to: [to],
          subject: headerSafe(subject, 200),
          html,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[send-admin-email] testMode Resend error:', resp.status, errText);
        return jsonResp({ error: 'Failed to send email' }, 502);
      }

      // Light audit (no member_id since this is a self-test).
      // Column names must match the non-test path (entity_type/entity_id/details, NOT
      // target_type/target_id/metadata) and gym_id is NOT NULL on the table.
      await supabase.from('admin_audit_log').insert({
        gym_id: callerProfile.gym_id,
        actor_id: user.id,
        action: 'send_test_email',
        entity_type: 'template',
        entity_id: null,
        details: { to, subject },
      }).then(({ error }) => {
        if (error) console.warn('[send-admin-email] test-mode audit insert failed (non-fatal):', error.message);
      });

      return jsonResp({ ok: true, testMode: true });
    }

    // A pre-rendered designer template may be supplied via `html` (the unified
    // Outreach composer renders the gym-branded designer HTML client-side and
    // personalizes its merge tokens — already HTML-escaped — per recipient).
    // When present, `body` is optional (the HTML is the email). When absent we
    // fall back to the branded buildEmailHtml wrap around `body`.
    const designerHtml = (typeof html === 'string' && html.length > 0)
      ? html
      : (typeof prerenderedHtml === 'string' && prerenderedHtml.length > 0 ? prerenderedHtml : null);

    if (!memberId || !subject || (!body && !designerHtml)) {
      return jsonResp({ error: 'memberId, subject, and body (or html) are required' }, 400);
    }

    // Input length limits
    if (typeof subject !== 'string' || subject.length > 200) {
      return jsonResp({ error: 'Subject must be 200 characters or fewer' }, 400);
    }
    if (body != null && (typeof body !== 'string' || body.length > 10000)) {
      return jsonResp({ error: 'Body must be 10000 characters or fewer' }, 400);
    }
    if (designerHtml && designerHtml.length > 200000) {
      return jsonResp({ error: 'HTML must be 200000 characters or fewer' }, 400);
    }

    // SECURITY: overrideEmail bypasses the member's stored email address.
    // Admins may legitimately need to correct a typo, send to an alternate
    // (work vs personal), or test against their own address — so we don't
    // gate this behind a domain allowlist anymore. Protections still in place:
    //   1. Caller must be admin/super_admin (checked above).
    //   2. `emailOverrideAcknowledged: true` is required so the client must
    //      explicitly opt into the override path.
    //   3. Per-admin hourly rate limit (below) caps abuse volume.
    //   4. admin_audit_log records both stored_email and override_email so
    //      every override is traceable to an actor.
    if (overrideEmail) {
      if (emailOverrideAcknowledged !== true) {
        return jsonResp({ error: 'emailOverrideAcknowledged must be true when using overrideEmail' }, 400);
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof overrideEmail !== 'string' || !emailRegex.test(overrideEmail)) {
        return jsonResp({ error: 'Invalid overrideEmail format' }, 400);
      }
    }

    // Rate limiting: max 5000 emails per hour per admin
    const { count: recentEmailCount } = await supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('actor_id', user.id)
      .eq('action', 'send_email')
      .gte('created_at', new Date(Date.now() - 3600000).toISOString());
    if ((recentEmailCount ?? 0) >= 5000) {
      return jsonResp({ error: 'admin_hourly_limit_exceeded', limit: 5000, recent: recentEmailCount }, 429);
    }

    // Get member profile
    const { data: memberProfile } = await supabase
      .from('profiles')
      .select('id, full_name, gym_id, email_unsub_token')
      .eq('id', memberId)
      .single();

    if (!memberProfile || memberProfile.gym_id !== callerProfile.gym_id) {
      return jsonResp({ error: 'Member not found in your gym' }, 404);
    }

    // ── Consentimiento, SOLO para envíos comerciales ──
    //
    // Toda la plataforma manda desde el mismo noreply@tugympr.com, así que las
    // quejas de spam de UN gimnasio tumban invitaciones, resets y códigos de
    // acceso de TODOS. Construimos el aparato de consentimiento en 0685 y este
    // enviador — el que un admin usa a diario desde Outreach — lo esquivaba por
    // completo: cero referencias a consent, unsubscribe o supresión.
    //
    // Un `scope` desconocido hace que email_allowed_for compruebe el interruptor
    // maestro, que haya dirección usable, y la lista de supresión — sin exigir
    // ningún opt-in por tipo. Eso es exactamente lo que corresponde a un envío
    // masivo iniciado por el admin: baja voluntaria respetada, sin dejar la
    // herramienta en cero el primer día.
    const isCommercial = typeof scope === 'string' && scope.length > 0;
    let unsubscribeUrl: string | null = null;
    if (isCommercial) {
      const { data: allowed, error: allowErr } = await supabase
        .rpc('email_allowed_for', { p_profile_id: memberId, p_scope: scope });
      if (allowErr) {
        console.error('email_allowed_for failed:', allowErr);
        return jsonResp({ error: 'Consent check failed' }, 500);
      }
      if (allowed !== true) {
        return jsonResp({ sent: false, reason: 'opted_out' });
      }
      unsubscribeUrl = memberProfile.email_unsub_token
        ? `${APP_ORIGIN}/u/${memberProfile.email_unsub_token}`
        : null;
    }

    // Resolve the member's real email.
    //
    // auth.users.email is NOT it for anyone an admin created. admin_create_member
    // (mig 0467:126) provisions a SHADOW auth user on a synthetic placeholder
    // ('invite-<uuid>@invite.tugympr.invalid') so the member's real address isn't
    // claimed before they sign up themselves; the real one is stashed in
    // raw_user_meta_data.pending_email and on gym_invites.email. Migration 0603
    // taught the DISPLAY rpcs (admin_get_member_email) that rule — this function
    // never learned it, so mailing a not-yet-activated member either addressed
    // the .invalid placeholder or died on "Member has no email on file".
    //
    // The lookup error was also discarded, so ANY failure here — not just a
    // missing address — surfaced as that same misleading message.
    const { data: authUser, error: authLookupErr } = await supabase.auth.admin.getUserById(memberId);
    if (authLookupErr) {
      console.error('send-admin-email: auth lookup failed', memberId, authLookupErr);
    }
    const rawEmail = authUser?.user?.email || null;
    const isPlaceholder = !!rawEmail && /@[^@]*\.invalid$/i.test(rawEmail);
    let storedEmail = isPlaceholder ? null : rawEmail;

    if (!storedEmail) {
      storedEmail = (authUser?.user?.user_metadata?.pending_email as string | undefined) || null;
    }
    if (!storedEmail) {
      // Last resort: the invite the admin created carries the address they typed.
      const { data: inviteRow } = await supabase
        .from('gym_invites')
        .select('email')
        .eq('used_by', memberId)
        .not('email', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      storedEmail = inviteRow?.email || null;
    }

    // Determine the actual recipient email
    const finalEmail = overrideEmail || storedEmail;
    if (!finalEmail) {
      return jsonResp({
        error: authLookupErr
          ? 'Could not read the member record to find their email'
          : 'Member has no email on file',
      }, 404);
    }

    // Get gym name + branding + store links (parallel — independent queries).
    // `app_config` row 1 is the same source `get_app_version` serves to the app,
    // so the footer links stay in step with the update banner instead of being a
    // second place to remember to edit.
    const [{ data: gym }, { data: branding }, { data: appCfg }] = await Promise.all([
      supabase.from('gyms')
        .select('name')
        .eq('id', callerProfile.gym_id)
        .single(),
      supabase.from('gym_branding')
        .select('logo_url, primary_color, secondary_color, custom_app_name')
        .eq('gym_id', callerProfile.gym_id)
        .maybeSingle(),
      supabase.from('app_config')
        .select('ios_store_url, android_store_url')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    // Source of truth is `gyms.name` — that's what the admin UI updates.
    // `gym_branding.custom_app_name` is a read-only legacy field used only
    // as a last-resort fallback if the gyms row is somehow missing.
    const gymName = gym?.name || branding?.custom_app_name || 'Your Gym';
    const primaryColor = branding?.primary_color || '#D4AF37';
    const secondaryColor = branding?.secondary_color || '#0F172A';

    // gym_branding.logo_url is stored as a bucket-relative path (e.g.
    // "<gym_id>/logo.png") in the private `gym-logos` bucket. We mirror
    // the app header pattern (AuthContext.jsx) and serve a signed URL.
    // Expiry is 1 year — long enough that the email won't break even if
    // archived and re-opened weeks later, well below the JWT practical max.
    // If the stored value is already an https URL we use it as-is.
    const rawLogoRef = branding?.logo_url || undefined;
    let logoUrl: string | undefined;
    let logoUrlDebug: Record<string, unknown> = { ref: rawLogoRef ?? null };
    if (rawLogoRef) {
      try {
        if (/^https?:\/\//i.test(rawLogoRef)) {
          logoUrl = rawLogoRef;
          logoUrlDebug.source = 'external';
        } else {
          const { data: signed, error: signErr } = await supabase
            .storage.from('gym-logos').createSignedUrl(rawLogoRef, 60 * 60 * 24 * 365);
          if (signErr) {
            console.warn('[send-admin-email] signed-URL creation failed', { path: rawLogoRef, err: signErr.message });
            logoUrlDebug.signErr = signErr.message;
          } else if (signed?.signedUrl) {
            logoUrl = signed.signedUrl;
            logoUrlDebug.source = 'signed';
          }
        }
      } catch (e) {
        console.warn('[send-admin-email] logo URL resolution error', { ref: rawLogoRef, err: (e as Error)?.message });
        logoUrlDebug.err = (e as Error)?.message;
      }
    }

    // Create reward voucher if reward is requested
    let voucherQrCode: string | undefined;
    let voucherLabel: string | undefined;
    let voucherDebug: Record<string, unknown> = { attempted: false };
    if (rewardType && rewardLabel) {
      const { data: voucher, error: voucherErr } = await supabase.rpc('admin_get_or_create_voucher', {
        p_gym_id: callerProfile.gym_id,
        p_member_id: memberId,
        p_admin_id: user.id,
        p_reward_type: rewardType,
        p_reward_label: rewardLabel,
      });
      voucherDebug = {
        attempted: true,
        rewardType,
        rewardLabel,
        rpcErr: voucherErr?.message ?? null,
        rpcCode: voucherErr?.code ?? null,
        gotVoucher: !!voucher,
      };
      if (!voucherErr && voucher) {
        const v = typeof voucher === 'string' ? JSON.parse(voucher) : voucher;
        voucherQrCode = v.qr_code;
        voucherLabel = v.reward_label;
        voucherDebug.qrCode = voucherQrCode;
        voucherDebug.parsedLabel = voucherLabel;
      } else {
        console.error('Voucher creation error:', voucherErr);
      }
      // If the voucher RPC failed but the admin explicitly attached a reward,
      // still show the reward block — just without the manual QR code. The
      // member will see the offer in the email and can ask front desk to
      // honor it. Better than silently dropping the entire reward.
      if (!voucherLabel) {
        voucherLabel = rewardLabel;
        voucherDebug.fallbackUsed = true;
      }
    }

    // QR code: rendered remotely by api.qrserver.com. Inline base64 was
    // tried first but Gmail/Yahoo/Outlook web all strip `data:` URIs from
    // <img src>, and CID attachments only render cleanly in desktop mail
    // clients. A plain HTTPS image URL is the only approach that renders
    // reliably across all major webmail. api.qrserver.com is free, has no
    // auth, and has been stable for years (used by Stripe receipts among
    // others). 320×320 matches what the previous inline renderer used.
    let voucherQrImageUrl: string | undefined;
    if (voucherQrCode) {
      // The scannable QR MUST carry the `gym-voucher:` prefix so the front-desk
      // scanner (scanRouter.js) routes it to the voucher handler and extracts the
      // bare code. Encoding just the bare 12-char code made the router fall
      // through to the check-in catch-all → "Member not found", so no emailed
      // win-back voucher could ever be redeemed. (rewardQrCode below stays the
      // bare code — it's the human-readable "manual code" display, not the QR.)
      voucherQrImageUrl =
        `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent('gym-voucher:' + voucherQrCode)}`;
    }

    // When the caller supplied a pre-rendered designer template, send it
    // verbatim (it's already gym-branded + personalized + token-escaped by the
    // composer). The recipient is a verified member of the caller's gym, so
    // — unlike testMode — there's no phishing-to-arbitrary-address risk. The
    // branded buildEmailHtml wrap is only used for the plain-text body path.
    const renderedHtml = designerHtml || buildEmailHtml({
      gymName,
      logoUrl,
      primaryColor,
      secondaryColor,
      memberFirstName: memberProfile.full_name.split(' ')[0],
      subject,
      body,
      lang: lang || 'en',
      rewardLabel: voucherLabel,
      rewardQrCode: voucherQrCode,
      rewardQrImageUrl: voucherQrImageUrl,
      rewardMemberId: rewardType && rewardLabel ? memberId : undefined,
      // Optional structure — see buildEmailHtml. Bounded here rather than in the
      // template so a malformed payload can't stretch the layout or smuggle
      // markup past escHtml's length assumptions.
      iosStoreUrl: appCfg?.ios_store_url || null,
      androidStoreUrl: appCfg?.android_store_url || null,
      accessCode: typeof accessCode === 'string' ? accessCode.trim().slice(0, 24) : undefined,
      // Host-allowlisted, matching send-invite:215-217. Previously any https URL
      // passed, so a gym-branded email sent from the platform's shared
      // noreply@tugympr.com could point anywhere — an open redirect wearing the
      // sender's reputation. The legacy tugympr.app host stays tolerated for
      // already-shipped app builds, same as send-invite.
      ctaUrl: typeof ctaUrl === 'string'
        && /^https:\/\/(app\.tugympr\.com|([a-z0-9-]+\.)?tugympr\.app)\//i.test(ctaUrl.trim())
        ? ctaUrl.trim().slice(0, 300)
        : undefined,
      ctaLabel: typeof ctaLabel === 'string' ? ctaLabel.trim().slice(0, 40) : undefined,
    });

    // Un enlace de baja VISIBLE, no solo la cabecera: CAN-SPAM lo exige en el
    // cuerpo. Se inyecta aquí y no en buildEmailHtml porque renderedHtml puede
    // venir de tres sitios distintos (plantilla propia, `html`, o
    // `prerenderedHtml`) y los tres necesitan el enlace.
    let finalHtml = renderedHtml;
    if (isCommercial && unsubscribeUrl) {
      const label = lang === 'es' ? 'Darse de baja' : 'Unsubscribe';
      const block = `<div style="margin:24px auto 0;max-width:600px;text-align:center;font-family:Arial,sans-serif;">`
        + `<a href="${unsubscribeUrl}" style="font-size:12px;color:#9CA3AF;text-decoration:underline;">${label}</a></div>`;
      finalHtml = finalHtml.includes('</body>')
        ? finalHtml.replace(/<\/body>(?![\s\S]*<\/body>)/, `${block}</body>`)
        : finalHtml + block;
    }

    // Send via Resend — images are remote URLs (logo: signed Supabase URL,
    // QR: api.qrserver.com). No attachments needed.
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromDisplayName(gymName, 'TuGymPR')} <noreply@tugympr.com>`,
        to: [finalEmail],
        subject: headerSafe(subject, 200),
        html: finalHtml,
        // Obligatorio en Gmail/Yahoo para remitentes masivos desde feb-2024.
        // Se emite SOLO en comercial: el correo transaccional no lleva baja.
        ...(isCommercial && memberProfile.email_unsub_token
          ? {
              headers: {
                'List-Unsubscribe': `<${SUPABASE_URL}/functions/v1/unsubscribe-oneclick?t=${memberProfile.email_unsub_token}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
      }),
    });

    if (!emailResp.ok) {
      const errBody = await emailResp.text().catch(() => '');
      console.error('Resend error:', emailResp.status, errBody);
      // The old comment here already named the most common cause — "sender
      // domain not verified → 403 with detail" — and then withheld it "so we
      // don't leak upstream internals". Every caller of this endpoint is an
      // authenticated gym ADMIN: they are the operator, and the provider's
      // message is the only thing that tells them whether to verify the domain,
      // rotate the key, or wait out a rate limit. Withholding it is what made
      // email look permanently broken next to a working SMS.
      let reason = '';
      try { reason = JSON.parse(errBody)?.message || JSON.parse(errBody)?.error?.message || ''; } catch { /* not JSON */ }
      return jsonResp({
        error: `Email provider refused the send (${emailResp.status})${reason ? `: ${reason}` : ''}`,
        provider: 'resend',
        providerStatus: emailResp.status,
      }, 502);
    }

    // Log for audit trail and rate limiting.
    // When overrideEmail is used, log both addresses so the override is traceable.
    const auditDetails: Record<string, unknown> = { subject: subject.slice(0, 100) };
    if (overrideEmail) {
      auditDetails.email_override = true;
      auditDetails.stored_email = storedEmail ?? null;
      auditDetails.override_email = overrideEmail;
    }
    await supabase.from('admin_audit_log').insert({
      gym_id: callerProfile.gym_id,
      actor_id: user.id,
      action: 'send_email',
      entity_type: 'member',
      entity_id: memberId,
      details: auditDetails,
    });

    return jsonResp({ success: true });
  } catch (err) {
    // Keep the full error (incl. message/stack) server-side only; return a
    // generic message so internals aren't leaked to the client.
    console.error('send-admin-email error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});
