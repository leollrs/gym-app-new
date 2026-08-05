import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// =============================================================================
// send-invite — deliver a gym invitation to a NOT-YET-MEMBER via our own
// providers (Resend for email, Twilio for SMS).
//
// Why a dedicated function (vs send-admin-email / send-sms): those resolve the
// recipient's contact from an existing `profiles` / auth.users row by memberId.
// An invitee isn't in the system yet — the only contact we have is the free-text
// email/phone the admin typed into "Invitar miembro". This function sends to that
// free-text recipient.
//
// Anti-abuse: the email body is SERVER-CONSTRUCTED from a fixed invite template
// (gym branding + the invite code + link) — never caller-supplied HTML — so it
// can't be used as a phishing primitive. Admin-gated, rate-limited, audited.
// =============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '';

// Per-gym monthly SMS cap — same source of truth as send-sms: platform_config
// 'sms_monthly_cap' (seeded by migration 0597, displayed by SmsUsageCard).
// Env SMS_MONTHLY_CAP wins (per-deploy override), then platform_config, then 500.
const SMS_CAP_FALLBACK = 500;
const SMS_MONTHLY_CAP_ENV = (() => {
  const raw = Deno.env.get('SMS_MONTHLY_CAP');
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

// Resolve the cap for a request. Parses platform_config the same way
// SmsUsageCard does (strip surrounding quotes off the JSONB value, parseInt).
async function getMonthlyCap(supabase: ReturnType<typeof createClient>): Promise<number> {
  if (SMS_MONTHLY_CAP_ENV !== null) return SMS_MONTHLY_CAP_ENV;
  try {
    const { data } = await supabase
      .from('platform_config')
      .select('value')
      .eq('key', 'sms_monthly_cap')
      .maybeSingle();
    if (data?.value != null) {
      const parsed = parseInt(String(data.value).replace(/^"+|"+$/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch (e) {
    console.warn('getMonthlyCap lookup failed, using fallback:', e);
  }
  return SMS_CAP_FALLBACK;
}

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
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

// Readable text ON the gym's accent colour. The button below is filled with
// `primaryColor` — whatever the gym picked — and white on a gold or lime brand
// runs about 2:1. Compares the two ACTUAL contrast ratios rather than testing
// luminance against a threshold, because a threshold has a boundary and
// TuGymPR's own gold sits right on it.
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
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? INK : '#ffffff';
}

// An email cannot detect a device, so `/get` does it one hop later. The row only
// renders once app_config actually holds a store URL — before launch it would be
// a link to a "coming soon" page.
const APP_ORIGIN = 'https://app.tugympr.com';
function downloadFooter(isEs: boolean, iosUrl?: string | null, androidUrl?: string | null) {
  if (!iosUrl && !androidUrl) return '';
  const get = isEs ? '¿No tienes la app?' : "Don't have the app?";
  const dl = isEs ? 'Descárgala aquí' : 'Download it here';
  const direct = [
    iosUrl ? `<a href="${escHtml(iosUrl)}" style="color:#6b7280;text-decoration:underline;">App Store</a>` : '',
    androidUrl ? `<a href="${escHtml(androidUrl)}" style="color:#6b7280;text-decoration:underline;">Google Play</a>` : '',
  ].filter(Boolean).join(' <span style="color:#374151;">·</span> ');
  return `<tr><td align="center" style="padding:22px 0 0 0;">
<p style="margin:0 0 6px;font-size:12px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${get} <a href="${APP_ORIGIN}/get" style="color:#9ca3af;text-decoration:underline;font-weight:600;">${dl}</a></p>
<p style="margin:0;font-size:11px;color:#4b5563;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${direct}</p>
</td></tr>`;
}

function buildInviteEmailHtml({
  gymName, logoUrl, primaryColor, secondaryColor, memberFirstName, inviteCode, inviteUrl, lang, iosStoreUrl, androidStoreUrl,
}: {
  gymName: string; logoUrl?: string; primaryColor: string; secondaryColor: string;
  memberFirstName: string; inviteCode: string; inviteUrl: string; lang: string;
  iosStoreUrl?: string | null; androidStoreUrl?: string | null;
}) {
  const isEs = lang === 'es';
  const t = {
    greeting: isEs ? 'Hola' : 'Hey',
    invited: isEs ? `Te invitaron a unirte a ${escHtml(gymName)}.` : `You've been invited to join ${escHtml(gymName)}.`,
    sub: isEs ? 'Tu gimnasio usa TuGymPR para seguir tus entrenos y mantenerte en racha.' : 'Your gym uses TuGymPR to track your workouts and keep you on streak.',
    codeLabel: isEs ? 'Tu código de invitación' : 'Your invite code',
    cta: isEs ? 'Unirme ahora' : 'Join now',
    manual: isEs ? 'O abre la app e ingresa el código manualmente.' : 'Or open the app and enter the code manually.',
    team: isEs ? 'Tu equipo' : 'Your team',
    poweredBy: isEs ? 'Con tecnología de' : 'Powered by',
  };
  const button = inviteUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:8px auto 4px auto;"><tr><td align="center" style="border-radius:10px;background-color:${primaryColor};"><a href="${escHtml(inviteUrl)}" target="_blank" style="display:inline-block;padding:13px 30px;font-size:14px;font-weight:700;color:${onColor(primaryColor)};text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;border-radius:10px;">${t.cta}</a></td></tr></table>`
    : '';
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${escHtml(gymName)}</title></head>
<body style="margin:0;padding:0;background-color:${secondaryColor};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${secondaryColor};margin:0;padding:0;"><tr><td align="center" valign="top" style="padding:48px 20px;">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-collapse:collapse;">
<tr><td align="center" style="padding:0 0 32px 0;">
${logoUrl
  ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(gymName)}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:14px;margin:0 auto 16px auto;object-fit:cover;"/>`
  : `<div style="width:56px;height:56px;border-radius:14px;background-color:${primaryColor};margin:0 auto 16px auto;text-align:center;font-size:24px;font-weight:800;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:56px;">${escHtml(gymName.charAt(0).toUpperCase())}</div>`}
<p style="margin:0;font-size:14px;font-weight:700;color:${primaryColor};letter-spacing:1.5px;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(gymName)}</p>
</td></tr>
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#111827;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
<tr><td style="height:3px;background:linear-gradient(90deg,${primaryColor},${primaryColor}88,transparent);font-size:1px;line-height:1px;">&nbsp;</td></tr>
<tr><td style="padding:40px 40px 32px 40px;">
<p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${t.greeting} ${escHtml(memberFirstName)}</p>
<p style="margin:0 0 22px;font-size:15px;color:#d1d5db;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${t.invited}<br/>${t.sub}</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td style="background-color:#0f172a;border:1px solid ${primaryColor}33;border-radius:12px;padding:18px;text-align:center;">
<p style="margin:0 0 6px;font-size:11px;font-weight:600;color:${primaryColor};text-transform:uppercase;letter-spacing:1px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${t.codeLabel}</p>
<p style="margin:0;font-size:30px;font-weight:800;color:#ffffff;letter-spacing:6px;font-family:'Courier New',monospace;">${escHtml(inviteCode)}</p>
</td></tr></table>
${button}
<p style="margin:14px 0 0;font-size:12px;color:#6b7280;text-align:center;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${t.manual}</p>
</td></tr>
<tr><td style="padding:0 40px 36px 40px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;"><tr><td style="width:36px;height:2px;background-color:${primaryColor};border-radius:1px;font-size:1px;line-height:1px;">&nbsp;</td><td></td></tr></table>
<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(gymName)}</p>
<p style="margin:0;font-size:13px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${t.team}</p>
</td></tr></table>
</td></tr>
${downloadFooter(isEs, iosStoreUrl, androidStoreUrl)}
<tr><td align="center" style="padding:22px 0 0 0;"><p style="margin:0;font-size:11px;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${escHtml(gymName)} · ${t.poweredBy} <span style="color:#6b7280;">TuGymPR</span></p></td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResp({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Missing authorization' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

    // Admin authority — primary role OR additional_roles bag (multi-role).
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, gym_id, additional_roles')
      .eq('id', user.id)
      .single();
    const ADMIN_ROLES = ['admin', 'super_admin'];
    const additional = Array.isArray(callerProfile?.additional_roles) ? callerProfile.additional_roles : [];
    const isAdmin = !!callerProfile && (ADMIN_ROLES.includes(callerProfile.role) || additional.some((r: string) => ADMIN_ROLES.includes(r)));
    if (!callerProfile || !isAdmin || !callerProfile.gym_id) {
      return jsonResp({ error: 'forbidden' }, 403);
    }
    const gymId = callerProfile.gym_id;

    const payload = await req.json();
    const channel = payload.channel === 'sms' ? 'sms' : 'email';
    const to = typeof payload.to === 'string' ? payload.to.trim() : '';
    const memberName = typeof payload.memberName === 'string' ? payload.memberName.trim().slice(0, 80) : '';
    const inviteCode = typeof payload.inviteCode === 'string' ? payload.inviteCode.trim().slice(0, 32) : '';
    const inviteUrl = typeof payload.inviteUrl === 'string' ? payload.inviteUrl.trim().slice(0, 300) : '';
    const lang = payload.lang === 'es' ? 'es' : 'en';

    if (!inviteCode) return jsonResp({ error: 'inviteCode is required' }, 400);
    // Guard the link: only our own invite domain may appear in the branded email/SMS.
    // Canonical host is app.tugympr.com (the only app-link-associated domain).
    // Legacy `tugympr.app` is still tolerated so already-shipped app builds (which
    // send that host) don't start erroring mid-migration — their links are dead
    // either way and get fixed by the app update, not by rejecting the send.
    if (inviteUrl && !/^https:\/\/(app\.tugympr\.com|([a-z0-9-]+\.)?tugympr\.app)\//i.test(inviteUrl)) {
      return jsonResp({ error: 'inviteUrl must be an app.tugympr.com https link' }, 400);
    }

    // Per-admin hourly rate limit (shared bucket for both channels).
    const { count: recent } = await supabase
      .from('admin_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('actor_id', user.id)
      .eq('action', 'send_invite')
      .gte('created_at', new Date(Date.now() - 3600000).toISOString());
    if ((recent ?? 0) >= 200) return jsonResp({ error: 'rate_limit_exceeded', limit: 200 }, 429);

    // Gym name + branding (shared by both channels).
    // app_config row 1 is the same source get_app_version serves the app, so the
    // footer's store links can never drift from the update banner's.
    const [{ data: gym }, { data: branding }, { data: appCfg }] = await Promise.all([
      supabase.from('gyms').select('name, sms_phone_number').eq('id', gymId).single(),
      supabase.from('gym_branding').select('logo_url, primary_color, secondary_color, custom_app_name').eq('gym_id', gymId).maybeSingle(),
      supabase.from('app_config').select('ios_store_url, android_store_url').eq('id', 1).maybeSingle(),
    ]);
    const gymName = gym?.name || branding?.custom_app_name || 'Your Gym';

    // ───────────────────────── EMAIL ─────────────────────────
    if (channel === 'email') {
      if (!RESEND_API_KEY) return jsonResp({ error: 'Email service not configured' }, 503);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(to)) return jsonResp({ error: 'Valid `to` email is required' }, 400);

      const primaryColor = branding?.primary_color || '#D4AF37';
      const secondaryColor = branding?.secondary_color || '#0F172A';

      // Resolve logo (signed URL for private bucket, pass-through for external).
      let logoUrl: string | undefined;
      const rawLogoRef = branding?.logo_url || undefined;
      if (rawLogoRef) {
        try {
          if (/^https?:\/\//i.test(rawLogoRef)) logoUrl = rawLogoRef;
          else {
            const { data: signed } = await supabase.storage.from('gym-logos').createSignedUrl(rawLogoRef, 60 * 60 * 24 * 365);
            if (signed?.signedUrl) logoUrl = signed.signedUrl;
          }
        } catch { /* logo optional */ }
      }

      const subject = lang === 'es' ? `Te invitaron a ${gymName}` : `You're invited to ${gymName}`;
      const firstName = memberName ? memberName.split(' ')[0] : (lang === 'es' ? 'allí' : 'there');
      const html = buildInviteEmailHtml({ gymName, logoUrl, primaryColor, secondaryColor, memberFirstName: firstName, inviteCode, inviteUrl, lang, iosStoreUrl: appCfg?.ios_store_url || null, androidStoreUrl: appCfg?.android_store_url || null });

      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${gymName} <noreply@tugympr.com>`, to: [to], subject, html }),
      });
      if (!resp.ok) {
        // SAY WHAT RESEND SAID. This used to answer a flat 'Failed to send
        // email', so the one thing an admin needed — WHY — existed only in the
        // function logs. From the app it looked like email was simply broken
        // forever, with SMS working beside it. Resend's own message names the
        // real cause every time: an unverified `tugympr.com` sending domain, a
        // key that isn't live, or the sandbox rule that only lets you mail your
        // own account address.
        const detail = await resp.text().catch(() => '');
        console.error('[send-invite] Resend error', resp.status, detail);
        let reason = '';
        try { reason = JSON.parse(detail)?.message || JSON.parse(detail)?.error?.message || ''; } catch { /* not JSON */ }
        return jsonResp({
          error: `Email provider refused the send (${resp.status})${reason ? `: ${reason}` : ''}`,
          provider: 'resend',
          providerStatus: resp.status,
        }, 502);
      }

      await supabase.from('admin_audit_log').insert({
        gym_id: gymId, actor_id: user.id, action: 'send_invite',
        entity_type: 'invite', entity_id: null, details: { channel: 'email', to, code: inviteCode },
      }).then(({ error }) => { if (error) console.warn('[send-invite] audit insert failed:', error.message); });

      return jsonResp({ ok: true, channel: 'email' });
    }

    // ───────────────────────── SMS ─────────────────────────
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return jsonResp({ error: 'SMS service not configured' }, 503);
    const finalPhone = normalizePhone(to);
    if (!/^\+1\d{10}$/.test(finalPhone)) {
      return jsonResp({ error: 'Invalid phone number format (expected +1XXXXXXXXXX)' }, 400);
    }

    // Monthly SMS cap (shared with regular SMS usage).
    const smsMonthlyCap = await getMonthlyCap(supabase);
    const currentMonth = new Date().toISOString().slice(0, 7);
    let newCount: number | null = null;
    try {
      // El error se destructura y se lanza, igual que en send-sms. Antes solo
      // se leía `data`: un rpc() de Supabase RESUELVE con {data:null, error} y
      // nunca lanza, así que el catch no disparaba, newCount quedaba null,
      // `newCount && …` era falso y EL ENVÍO SEGUÍA SIN TOPE.
      //
      // Importa más aquí que en send-sms: CreateInviteModal manda por esta
      // función el SMS de "Añadir miembro", así que este era el camino con
      // tráfico real y sin acotar.
      const { data, error: usageErr } = await supabase.rpc('increment_sms_usage', { p_gym_id: gymId, p_month: currentMonth, p_count: 1 });
      if (usageErr) throw usageErr;
      newCount = data;
      if (newCount && newCount > smsMonthlyCap) {
        await supabase.rpc('increment_sms_usage', { p_gym_id: gymId, p_month: currentMonth, p_count: -1 });
        return jsonResp({ error: `SMS limit reached (${smsMonthlyCap}/month).`, usage: { used: smsMonthlyCap, limit: smsMonthlyCap } }, 429);
      }
    } catch (e) {
      // Falla CERRADO: esto gasta dinero real y un contador roto no puede ser
      // barra libre.
      console.error('increment_sms_usage failed — refusing to send:', e);
      return jsonResp({ error: 'SMS usage could not be verified. Try again shortly.' }, 429);
    }

    const fromNumber = gym?.sms_phone_number || TWILIO_PHONE_NUMBER;
    if (!fromNumber) return jsonResp({ error: 'This gym does not have an SMS phone number configured' }, 400);

    // An SMS can't carry the email's branding, so what it has is structure and a
    // name. The old one-liner buried the link mid-sentence after a full stop,
    // used the recipient's name nowhere despite having it, and read like a
    // system dump. Three short lines instead — greeting, code, link alone on the
    // last line, which is also the shape a phone is most willing to render a
    // link preview for. The gym name is NOT repeated in the body: `smsBody`
    // already opens with it, and SMS with accented characters bills at 70
    // characters a segment, so every repeated word costs real money.
    const smsFirst = memberName ? memberName.split(' ')[0] : '';
    const smsLines = lang === 'es'
      ? [
          smsFirst ? `Hola ${smsFirst}, te invitaron a entrenar con nosotros.` : 'Te invitaron a entrenar con nosotros.',
          `Código: ${inviteCode}`,
        ]
      : [
          smsFirst ? `Hi ${smsFirst}, you're invited to train with us.` : "You're invited to train with us.",
          `Code: ${inviteCode}`,
        ];
    if (inviteUrl) smsLines.push(inviteUrl);
    const smsBody = `[${gymName}] ${smsLines.join('\n')}`;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', finalPhone);
    formData.append('Body', smsBody);

    const twilioResp = await fetch(twilioUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
    if (!twilioResp.ok) {
      console.error('[send-invite] Twilio error', twilioResp.status, await twilioResp.text());
      try { await supabase.rpc('increment_sms_usage', { p_gym_id: gymId, p_month: currentMonth, p_count: -1 }); } catch {}
      return jsonResp({ error: 'Failed to send SMS' }, 502);
    }
    let twilioSid: string | null = null;
    try { twilioSid = (await twilioResp.json()).sid; } catch {}

    await supabase.from('admin_audit_log').insert({
      gym_id: gymId, actor_id: user.id, action: 'send_invite',
      entity_type: 'invite', entity_id: null, details: { channel: 'sms', to: finalPhone, code: inviteCode },
    }).then(({ error }) => { if (error) console.warn('[send-invite] audit insert failed:', error.message); });

    return jsonResp({ ok: true, channel: 'sms', messageSid: twilioSid });
  } catch (err) {
    console.error('send-invite error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});
