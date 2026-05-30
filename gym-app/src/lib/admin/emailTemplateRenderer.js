/**
 * Renderer + helpers for the AdminEmailTemplates surfaces.
 *
 * Pure functions, no React. The renderer (`generateEmailHtml`) emits a
 * production-quality HTML email — table-based layout for Outlook + media
 * queries for mobile, with all dynamic strings HTML-escaped at the
 * boundary. Used by:
 *
 *   - LivePreview (sandboxed iframe in the editor)
 *   - The composer's "Send test" path (when wired to a server)
 *   - Any backend job that wants to render a saved template
 *
 * `dbRowToTemplate` / `templateToDbPayload` convert between the wire
 * format on `email_templates` and the local in-editor shape.
 */

import QRCode from 'qrcode';

// ── XSS helpers ───────────────────────────────────────────────

export function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeColor(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#000000';
}

// ── QR helpers ────────────────────────────────────────────────
// The reward block ships a QR for the redemption code. We render the QR as
// an inline SVG wrapped in a data-URI <img> so it survives every email client
// we care about — modern clients render the SVG, Outlook desktop (which mangles
// SVG) shows the `alt` text with the actual code as a graceful fallback.

/**
 * Build the QR payload for a reward block. Uses the `earned-reward:` prefix
 * so a scan at the front desk routes through the existing redemption pipeline
 * (RewardAttachModal + handleEarnedRewardScan).
 */
export function rewardQrPayload(reward) {
  if (!reward) return '';
  const raw = reward.code || reward.reward_id || (reward.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reward';
  return `earned-reward:${raw}`;
}

/** Sync SVG-string QR. Returns '' on any failure so the caller can no-op. */
export function rewardQrSvg(payload, size = 160) {
  try {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const data = qr.modules.data;
    let rects = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (data[y * n + x]) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" style="display:block;background:#fff;"><rect width="${n}" height="${n}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  } catch {
    return '';
  }
}

// ── Template-variable substitution ────────────────────────────
// Preview uses fake but plausible values so the admin can see how the
// merge looks. Production sends do their own substitution server-side.
export function replaceVariables(text, gymName) {
  if (!text) return '';
  return text
    .replace(/\{\{member_name\}\}/g, 'John Doe')
    .replace(/\{\{gym_name\}\}/g, gymName || 'Your Gym')
    .replace(/\{\{streak_count\}\}/g, '14')
    .replace(/\{\{workout_count\}\}/g, '47')
    .replace(/\{\{days_inactive\}\}/g, '7');
}

// ── Full HTML renderer ────────────────────────────────────────

export function generateEmailHtml(template, gymName, logoUrl) {
  const c = template.colors;
  const header = template.header;
  const hero = template.hero;
  const reward = template.reward;
  const typo = template.typography || {};
  const fs = typo.fontSize || '15';
  const br = typo.borderRadius || '12';
  const pad = typo.padding || '40';
  const hs = typo.headerStyle || 'gradient';
  const body = template.body;
  const cta = template.cta;
  const footer = template.footer;

  const bodyHtml = replaceVariables(body.text, gymName)
    .split('\n')
    .map(line => {
      if (line.startsWith('---') && line.endsWith('---')) {
        const inner = line.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
        return `<h3 style="font-size:${parseInt(fs)+1}px;font-weight:700;color:${safeColor(c.primary)};margin:28px 0 10px;letter-spacing:-0.01em;">${escHtml(inner)}</h3>`;
      }
      if (line.startsWith('- ')) return `<li style="margin:6px 0;color:${safeColor(c.text)};font-size:${fs}px;line-height:1.7;padding-left:4px;">${escHtml(line.slice(2))}</li>`;
      if (!line.trim()) return '<div style="height:12px;"></div>';
      return `<p style="margin:0 0 10px;line-height:1.75;color:${safeColor(c.text)};font-size:${fs}px;letter-spacing:0.01em;">${escHtml(line)}</p>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none;}
  body{margin:0;padding:0;width:100%!important;}
  @media only screen and (max-width:620px){
    .email-container{width:100%!important;max-width:100%!important;}
    .stack-column{display:block!important;width:100%!important;}
    .hero-pad{padding:40px 24px!important;}
    .body-pad{padding:28px 24px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${safeColor(c.background)};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${safeColor(c.background)};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:${br}px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06),0 1px 4px rgba(0,0,0,0.04);">

${header.enabled && hs === 'gradient' ? `<!-- Header: Gradient -->
<tr><td style="background:linear-gradient(135deg,${safeColor(c.primary)},${safeColor(c.primary)}cc);padding:28px ${pad}px 24px;text-align:center;">
${header.showLogo && logoUrl ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(gymName)}" style="max-height:44px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
${header.text ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;line-height:1.3;">${escHtml(replaceVariables(header.text, gymName))}</h1>` : ''}
</td></tr>` : ''}
${header.enabled && hs === 'solid' ? `<!-- Header: Solid -->
<tr><td style="background:${safeColor(c.primary)};padding:28px ${pad}px 24px;text-align:center;">
${header.showLogo && logoUrl ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(gymName)}" style="max-height:44px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
${header.text ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;line-height:1.3;">${escHtml(replaceVariables(header.text, gymName))}</h1>` : ''}
</td></tr>` : ''}
${header.enabled && hs === 'minimal' ? `<!-- Header: Minimal -->
<tr><td style="padding:28px ${pad}px 24px;text-align:center;">
${header.showLogo && logoUrl ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(gymName)}" style="max-height:44px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />` : ''}
${header.text ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:${safeColor(c.primary)};letter-spacing:-0.02em;line-height:1.3;">${escHtml(replaceVariables(header.text, gymName))}</h1>` : ''}
</td></tr>
<tr><td style="padding:0 ${pad}px;"><div style="height:1px;background:linear-gradient(90deg,transparent,${safeColor(c.primary)}40,transparent);"></div></td></tr>` : ''}

${hero.enabled ? (() => { const safeImageUrl = hero.imageUrl && /^https:\/\//i.test(hero.imageUrl) ? escHtml(hero.imageUrl) : ''; return `<!-- Hero -->
<tr><td style="padding:0;">
${safeImageUrl
  ? `<img src="${safeImageUrl}" alt="Email hero image" style="width:100%;display:block;max-height:280px;object-fit:cover;" />`
  : `<div class="hero-pad" style="background:linear-gradient(135deg,${safeColor(c.primary)} 0%,${safeColor(c.primary)}cc 50%,${safeColor(c.primary)}99 100%);padding:56px ${pad}px;text-align:center;">
<h2 style="margin:0 0 10px;font-size:32px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.15;">${escHtml(replaceVariables(hero.headline, gymName))}</h2>
${hero.subtitle ? `<p style="margin:0;font-size:17px;color:rgba(255,255,255,0.88);line-height:1.5;font-weight:400;">${escHtml(replaceVariables(hero.subtitle, gymName))}</p>` : ''}
</div>`}
</td></tr>`; })() : ''}

<!-- Body -->
<tr><td class="body-pad" style="padding:36px ${pad}px 20px;">
${bodyHtml}
</td></tr>

${reward?.enabled && reward?.title ? (() => {
  // QR is auto-generated from the code (or a slug fallback). Outlook desktop
  // mangles inline SVG, so we embed it as a data-URI image with an `alt` that
  // includes the code — degrades to readable text if the image is stripped.
  const payload = rewardQrPayload(reward);
  const svg = rewardQrSvg(payload, 160);
  // btoa is universal (browser + Node 16+). Our SVG is ASCII-only.
  const b64 = svg ? (typeof btoa === 'function' ? btoa(svg) : '') : '';
  const qrImg = b64
    ? `<img src="data:image/svg+xml;base64,${b64}" width="160" height="160" alt="${escHtml(reward.code || 'Reward code')}" style="display:block;margin:18px auto 0;width:160px;height:160px;border:8px solid #ffffff;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.06);" />`
    : '';
  return `<!-- Reward -->
<tr><td style="padding:8px ${pad}px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,${safeColor(c.primary)}08,${safeColor(c.primary)}15);border:2px dashed ${safeColor(c.primary)}40;border-radius:${Math.min(parseInt(br), 16)}px;overflow:hidden;">
<tr><td style="padding:24px;text-align:center;">
<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${safeColor(c.primary)};text-transform:uppercase;letter-spacing:2px;">🎁 ${escHtml(reward.title)}</p>
${reward.description ? `<p style="margin:8px 0 0;font-size:14px;color:${safeColor(c.text)};line-height:1.5;">${escHtml(reward.description)}</p>` : ''}
${qrImg}
${reward.code ? `<p style="margin:10px 0 0;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:13px;font-weight:700;color:${safeColor(c.text)};letter-spacing:3px;">${escHtml(reward.code)}</p>` : ''}
<p style="margin:6px 0 0;font-size:11px;color:#9CA3AF;">${escHtml(reward.expiry || '')}</p>
</td></tr>
</table>
</td></tr>`;
})() : ''}

${cta.enabled ? `<!-- CTA -->
<tr><td style="padding:8px ${pad}px ${pad}px;text-align:center;">
<a href="${escHtml(cta.url || '#')}" style="display:inline-block;padding:16px 40px;background:${safeColor(cta.color)};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;letter-spacing:0.02em;box-shadow:0 4px 14px ${safeColor(cta.color)}44,0 2px 6px rgba(0,0,0,0.08);mso-padding-alt:0;text-align:center;">
<!--[if mso]><i style="letter-spacing:40px;mso-font-width:-100%;mso-text-raise:30pt">&nbsp;</i><![endif]-->
<span style="mso-text-raise:15pt;">${escHtml(replaceVariables(cta.text, gymName))}</span>
<!--[if mso]><i style="letter-spacing:40px;mso-font-width:-100%">&nbsp;</i><![endif]-->
</a>
</td></tr>` : ''}

${footer.enabled ? `<!-- Footer -->
<tr><td style="padding:0 ${pad}px;"><div style="height:1px;background:#f0f0f0;"></div></td></tr>
<tr><td style="padding:24px ${pad}px 28px;text-align:center;">
<p style="margin:0 0 6px;font-size:12px;color:#9CA3AF;line-height:1.5;letter-spacing:0.01em;">${escHtml(replaceVariables(footer.text, gymName))}</p>
${footer.unsubscribeText ? `<a href="#" style="font-size:11px;color:#D1D5DB;text-decoration:underline;">${escHtml(footer.unsubscribeText)}</a>` : ''}
</td></tr>` : ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── DB row ↔ local template shape ─────────────────────────────
// The wire format on `email_templates` keeps the renderable bits inside
// `template_data` JSONB so we can evolve the structure without altering
// columns; the local shape flattens them for direct binding in the
// editor's controlled inputs.

export function dbRowToTemplate(row) {
  const d = row.template_data || {};
  return {
    id: row.id,
    name: row.name,
    type: row.template_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    is_prebuilt: row.is_prebuilt,
    header: d.header || { enabled: true, showLogo: true, text: '' },
    hero: d.hero || { enabled: false, imageUrl: '', headline: '', subtitle: '' },
    body: d.body || { text: '' },
    cta: d.cta || { enabled: false, text: '', url: '', color: '#D4AF37' },
    reward: d.reward || { enabled: false, reward_id: '', title: '', description: '', code: '', expiry: '' },
    footer: d.footer || { enabled: true, text: '', unsubscribeText: 'Unsubscribe' },
    colors: d.colors || { primary: '#D4AF37', background: '#ffffff', text: '#333333' },
  };
}

export function templateToDbPayload(tpl, gymId) {
  return {
    ...(tpl.id && !tpl.id.startsWith('prebuilt-') ? { id: tpl.id } : {}),
    gym_id: gymId,
    name: tpl.name,
    template_type: tpl.type,
    is_prebuilt: false,
    template_data: {
      header: tpl.header,
      hero: tpl.hero,
      body: tpl.body,
      cta: tpl.cta,
      reward: tpl.reward,
      footer: tpl.footer,
      colors: tpl.colors,
    },
  };
}
