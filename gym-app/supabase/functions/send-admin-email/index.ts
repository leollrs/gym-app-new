import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

if (!RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY environment variable is required');
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const i18nStrings: Record<string, Record<string, string>> = {
  en: { greeting: 'Hey', team: 'Your team', poweredBy: 'Powered by', showQr: 'Show this QR code at the front desk', manualCode: 'Manual code' },
  es: { greeting: 'Hola', team: 'Tu equipo', poweredBy: 'Powered by', showQr: 'Muestra este código QR en recepción', manualCode: 'Código manual' },
};

function buildEmailHtml({
  gymName,
  logoUrl,
  logoBase64,
  logoMimeType,
  primaryColor,
  secondaryColor,
  memberFirstName,
  subject,
  body,
  lang = 'en',
  rewardLabel,
  rewardQrCode,
}: {
  gymName: string;
  logoUrl?: string;
  logoBase64?: string;
  logoMimeType?: string;
  primaryColor: string;
  secondaryColor: string;
  memberFirstName: string;
  subject: string;
  body: string;
  lang?: string;
  rewardLabel?: string;
  rewardQrCode?: string;
  rewardMemberId?: string;
}) {
  const str = i18nStrings[lang] || i18nStrings.en;
  const paragraphs = body
    .split('\n')
    .filter((l: string) => l.trim())
    .map((line: string) =>
      `<p style="margin:0 0 16px;line-height:1.65;color:#d1d5db;font-size:15px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${line}</p>`,
    )
    .join('\n');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${subject}</title>
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
${logoBase64
  ? `<img src="data:${logoMimeType || 'image/png'};base64,${logoBase64}" alt="${gymName}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:14px;margin:0 auto 16px auto;object-fit:cover;"/>`
  : logoUrl
    ? `<img src="${logoUrl}" alt="${gymName}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:14px;margin:0 auto 16px auto;object-fit:cover;"/>`
    : `<div style="width:56px;height:56px;border-radius:14px;background-color:${primaryColor};margin:0 auto 16px auto;text-align:center;line-height:56px;font-size:24px;font-weight:800;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${gymName.charAt(0)}</div>`
}
<p style="margin:0;font-size:14px;font-weight:700;color:${primaryColor};letter-spacing:1.5px;text-transform:uppercase;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${gymName}</p>
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

<p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.greeting} ${memberFirstName} 👋</p>
<p style="margin:0 0 28px;font-size:13px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${subject}</p>

${paragraphs}

${rewardLabel && rewardQrCode ? `
<!-- Reward Voucher -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${primaryColor}10;border:1px solid ${primaryColor}33;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px;text-align:center;">
<p style="margin:0 0 4px;font-size:11px;font-weight:600;color:${primaryColor};text-transform:uppercase;letter-spacing:1px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">&#127873; REWARD</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:700;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${rewardLabel}</p>
<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(JSON.stringify({ code: rewardQrCode, mid: rewardMemberId }))}" alt="QR Code" width="160" height="160" style="display:block;width:160px;height:160px;margin:0 auto 12px auto;border-radius:8px;"/>
<p style="margin:0 0 8px;font-size:13px;color:#d1d5db;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.showQr}</p>
<p style="margin:0;font-size:11px;color:#6b7280;font-family:'Courier New',monospace;letter-spacing:2px;">${str.manualCode}: <strong style="color:#ffffff;">${rewardQrCode}</strong></p>
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

<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${gymName}</p>
<p style="margin:0;font-size:13px;color:#6b7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${str.team}</p>

</td></tr>
</table>
</td></tr>

<!-- ============================================================ -->
<!-- FOOTER                                                       -->
<!-- ============================================================ -->
<tr><td align="center" style="padding:28px 0 0 0;">
<p style="margin:0;font-size:11px;color:#374151;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
${gymName} · ${str.poweredBy} <span style="color:#6b7280;">TuGymPR</span>
</p>
</td></tr>

</table>
<!-- /Main card -->

</td></tr>
</table>

</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResp({ error: 'Missing authorization' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonResp({ error: 'Unauthorized' }, 401);

    // Verify caller is admin
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single();

    if (!callerProfile || !['admin', 'super_admin'].includes(callerProfile.role)) {
      return jsonResp({ error: 'Admin access required' }, 403);
    }

    const { memberId, subject, body, overrideEmail, lang, rewardType, rewardLabel } = await req.json();

    if (!memberId || !subject || !body) {
      return jsonResp({ error: 'memberId, subject, and body are required' }, 400);
    }

    // Get member profile
    const { data: memberProfile } = await supabase
      .from('profiles')
      .select('id, full_name, gym_id')
      .eq('id', memberId)
      .single();

    if (!memberProfile || memberProfile.gym_id !== callerProfile.gym_id) {
      return jsonResp({ error: 'Member not found in your gym' }, 404);
    }

    // Get recipient email
    let finalEmail = overrideEmail || null;
    if (!finalEmail) {
      const { data: authUser } = await supabase.auth.admin.getUserById(memberId);
      finalEmail = authUser?.user?.email;
    }
    if (!finalEmail) {
      return jsonResp({ error: 'Member has no email on file' }, 404);
    }

    // Get gym name + branding
    const { data: gym } = await supabase
      .from('gyms')
      .select('name')
      .eq('id', callerProfile.gym_id)
      .single();

    const { data: branding } = await supabase
      .from('gym_branding')
      .select('logo_url, primary_color, secondary_color, custom_app_name')
      .eq('gym_id', callerProfile.gym_id)
      .maybeSingle();

    const gymName = branding?.custom_app_name || gym?.name || 'Your Gym';
    const primaryColor = branding?.primary_color || '#D4AF37';
    const secondaryColor = branding?.secondary_color || '#0F172A';
    const logoUrl = branding?.logo_url || undefined;

    // Try to fetch logo as base64 for better email client compatibility
    let logoBase64: string | undefined;
    let logoMimeType: string | undefined;
    if (logoUrl) {
      try {
        const logoResp = await fetch(logoUrl);
        if (logoResp.ok) {
          const contentType = logoResp.headers.get('content-type') || 'image/png';
          const arrayBuf = await logoResp.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          logoBase64 = btoa(binary);
          logoMimeType = contentType;
        }
      } catch {
        // Fall back to URL or letter initial
      }
    }

    // Create reward voucher if reward is requested
    let voucherQrCode: string | undefined;
    let voucherLabel: string | undefined;
    if (rewardType && rewardLabel) {
      const { data: voucher, error: voucherErr } = await supabase.rpc('admin_get_or_create_voucher', {
        p_gym_id: callerProfile.gym_id,
        p_member_id: memberId,
        p_admin_id: user.id,
        p_reward_type: rewardType,
        p_reward_label: rewardLabel,
      });
      if (!voucherErr && voucher) {
        const v = typeof voucher === 'string' ? JSON.parse(voucher) : voucher;
        voucherQrCode = v.qr_code;
        voucherLabel = v.reward_label;
      } else {
        console.error('Voucher creation error:', voucherErr);
      }
    }

    const html = buildEmailHtml({
      gymName,
      logoUrl,
      logoBase64,
      logoMimeType,
      primaryColor,
      secondaryColor,
      memberFirstName: memberProfile.full_name.split(' ')[0],
      subject,
      body,
      lang: lang || 'en',
      rewardLabel: voucherLabel,
      rewardQrCode: voucherQrCode,
      rewardMemberId: rewardType && rewardLabel ? memberId : undefined,
    });

    // Send via Resend
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${gymName} <noreply@tugympr.com>`,
        to: [finalEmail],
        subject,
        html,
      }),
    });

    if (!emailResp.ok) {
      const errBody = await emailResp.text();
      console.error('Resend error:', errBody);
      return jsonResp({ error: 'Failed to send email' }, 500);
    }

    return jsonResp({ success: true });
  } catch (err) {
    console.error('send-admin-email error:', err);
    return jsonResp({ error: 'Internal error' }, 500);
  }
});
