/**
 * Deno-side email renderer — the server twin of
 * `src/lib/admin/emailTemplateRenderer.js`.
 *
 * WHY A SECOND COPY
 *
 * The browser renderer imports the npm `qrcode` package and calls `btoa`, so
 * neither Deno nor SQL can import it. Its own docblock claims "any backend job
 * that wants to render a saved template" uses it; no such job has ever existed.
 * This is that job's renderer.
 *
 * Two deliberate differences from the browser copy, both load-bearing:
 *
 *   1. The reward QR arrives as an already-rendered data URI (`rewardQrDataUri`)
 *      instead of being generated here. That removes the only dependency that
 *      made the module unportable.
 *
 *   2. Token substitution takes REAL values. The browser copy hardcodes
 *      'John Doe' / '14' / '47' for the editor preview — sending that to a
 *      member is the whole failure this feature exists to prevent.
 *
 * The block contract (header/hero/body/cta/reward/footer/colors/typography) is
 * pinned by a test on the JS side so the two cannot drift silently.
 */

export interface TemplateColors { primary: string; background: string; text: string }
export interface TemplateTypography { fontSize?: string; borderRadius?: string; padding?: string; headerStyle?: string }
export interface EmailTemplate {
  header: { enabled: boolean; showLogo: boolean; text: string };
  hero: { enabled: boolean; imageUrl: string; headline: string; subtitle: string };
  body: { text: string };
  cta: { enabled: boolean; text: string; url: string; color: string };
  reward?: { enabled: boolean; title: string; description: string; code: string; expiry: string };
  footer: { enabled: boolean; text: string; unsubscribeText: string };
  colors: TemplateColors;
  typography?: TemplateTypography;
}

export function escHtml(s: unknown): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeColor(c: unknown): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c)) ? String(c) : '#000000';
}

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Substitute `{{tokens}}` — and DROP any line whose tokens didn't resolve.
 *
 * This is the rule that separates a real email from a generic one. A member
 * with no booked class must not receive "Your next class is  on ." — the line
 * has to disappear entirely. Leaving an empty token behind reads worse than
 * never mentioning it, and leaving the literal `{{next_class_name}}` is worse
 * still (which is exactly what ships today: the editor advertises
 * `{{member_name}}` while the sender only substitutes `{{first_name}}`).
 *
 * A line containing no tokens is never dropped.
 */
export function applyTokens(text: string, values: Record<string, string | null | undefined>): string {
  if (!text) return '';
  return text
    .split('\n')
    .filter((line) => {
      const tokens = [...line.matchAll(TOKEN_RE)].map((m) => m[1].toLowerCase());
      if (tokens.length === 0) return true;
      return tokens.every((t) => {
        const v = values[t];
        return v !== undefined && v !== null && String(v).trim() !== '';
      });
    })
    .map((line) => line.replace(TOKEN_RE, (_m, key: string) => String(values[key.toLowerCase()] ?? '')))
    .join('\n');
}

/** Same rule for a single-line field (headline, subject, CTA label). */
export function applyTokensInline(text: string, values: Record<string, string | null | undefined>): string {
  if (!text) return '';
  const tokens = [...text.matchAll(TOKEN_RE)].map((m) => m[1].toLowerCase());
  const unresolved = tokens.some((t) => {
    const v = values[t];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (unresolved) return '';
  return text.replace(TOKEN_RE, (_m, key: string) => String(values[key.toLowerCase()] ?? ''));
}

export interface RenderOptions {
  gymName: string;
  logoUrl?: string | null;
  /** Pre-rendered `data:image/svg+xml;base64,…`. Omitted → no QR block. */
  rewardQrDataUri?: string | null;
  /** Real, working unsubscribe URL. Required for anything automated. */
  unsubscribeUrl?: string | null;
  /** Physical postal address — CAN-SPAM requires one on commercial mail. */
  postalAddress?: string | null;
  values: Record<string, string | null | undefined>;
}

export function renderEmailHtml(template: EmailTemplate, opts: RenderOptions): string {
  const c = template.colors;
  const { header, hero, body, cta, footer } = template;
  const reward = template.reward;
  // Estos cuatro se interpolan SIN escapar dentro de style="…" en 13 sitios, y
  // salen de campos de texto libre del admin guardados verbatim en JSONB y
  // parcheables por PostgREST. Un padding de
  //   0" style="x"><a href="https://evil/">Verificar cuenta</a><td style="
  // derrota todos los escHtml del archivo. Los clientes de correo no ejecutan
  // JS, así que no es XSS — es un enlace arbitrario saliendo del remitente
  // compartido de toda la plataforma. Se acotan numéricamente, que además
  // arregla el `NaNpx` que producía cualquier basura.
  const typo = template.typography || {};
  const clamp = (v: unknown, def: number, lo: number, hi: number) => {
    const n = parseInt(String(v ?? ''), 10);
    return String(Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : def);
  };
  const fs  = clamp(typo.fontSize, 15, 10, 28);
  const br  = clamp(typo.borderRadius, 12, 0, 32);
  const pad = clamp(typo.padding, 40, 0, 64);
  const hs  = ['gradient', 'solid', 'minimal'].includes(String(typo.headerStyle))
    ? String(typo.headerStyle) : 'gradient';
  const { gymName, logoUrl, rewardQrDataUri, unsubscribeUrl, postalAddress, values } = opts;

  const tk = (s: string) => applyTokensInline(s, values);

  const bodyHtml = applyTokens(body?.text || '', values)
    .split('\n')
    .map((line) => {
      if (line.startsWith('---') && line.endsWith('---')) {
        const inner = line.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
        return `<h3 style="font-size:${parseInt(fs) + 1}px;font-weight:700;color:${safeColor(c.primary)};margin:28px 0 10px;letter-spacing:-0.01em;">${escHtml(inner)}</h3>`;
      }
      if (line.startsWith('- ')) return `<li style="margin:6px 0;color:${safeColor(c.text)};font-size:${fs}px;line-height:1.7;padding-left:4px;">${escHtml(line.slice(2))}</li>`;
      if (!line.trim()) return '<div style="height:12px;"></div>';
      return `<p style="margin:0 0 10px;line-height:1.75;color:${safeColor(c.text)};font-size:${fs}px;letter-spacing:0.01em;">${escHtml(line)}</p>`;
    })
    .join('');

  const logoTag = (colorOnDark: boolean) =>
    header?.showLogo && logoUrl
      ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(gymName)}" style="max-height:44px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />`
      : (colorOnDark ? '' : '');

  const headerText = tk(header?.text || '');
  const heroHeadline = tk(hero?.headline || '');
  const heroSubtitle = tk(hero?.subtitle || '');
  const ctaText = tk(cta?.text || '');
  // tk() igual que todo lo demás. Sin esto, buildLinks() era código muerto:
  // los cinco tokens de URL que arma el enviador (today_plan_url,
  // next_class_url, classes_url, checkin_url, app_url) no se podían usar, y un
  // botón apuntando a {{next_class_url}} emitía href="{{next_class_url}}"
  // literal — la regla de blanqueo no lo salva porque solo mira bloques de
  // texto. El `&& ctaUrl` de abajo esconde el botón entero si no resuelve.
  const ctaUrl = tk(cta?.url || '');

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
    .hero-pad{padding:40px 24px!important;}
    .body-pad{padding:28px 24px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${safeColor(c.background)};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${safeColor(c.background)};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:${br}px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06),0 1px 4px rgba(0,0,0,0.04);">

${header?.enabled && hs === 'gradient' ? `<tr><td style="background:linear-gradient(135deg,${safeColor(c.primary)},${safeColor(c.primary)}cc);padding:28px ${pad}px 24px;text-align:center;">
${logoTag(true)}
${headerText ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;line-height:1.3;">${escHtml(headerText)}</h1>` : ''}
</td></tr>` : ''}
${header?.enabled && hs === 'solid' ? `<tr><td style="background:${safeColor(c.primary)};padding:28px ${pad}px 24px;text-align:center;">
${logoTag(true)}
${headerText ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;line-height:1.3;">${escHtml(headerText)}</h1>` : ''}
</td></tr>` : ''}
${header?.enabled && hs === 'minimal' ? `<tr><td style="padding:28px ${pad}px 24px;text-align:center;">
${logoTag(false)}
${headerText ? `<h1 style="margin:0;font-size:22px;font-weight:700;color:${safeColor(c.primary)};letter-spacing:-0.02em;line-height:1.3;">${escHtml(headerText)}</h1>` : ''}
</td></tr>
<tr><td style="padding:0 ${pad}px;"><div style="height:1px;background:linear-gradient(90deg,transparent,${safeColor(c.primary)}40,transparent);"></div></td></tr>` : ''}

${hero?.enabled ? (() => {
  const img = hero.imageUrl && /^https:\/\//i.test(hero.imageUrl) ? escHtml(hero.imageUrl) : '';
  // A hero whose headline was dropped for an unresolved token would render an
  // empty coloured slab. Skip the whole block instead.
  if (!img && !heroHeadline) return '';
  return `<tr><td style="padding:0;">
${img
  ? `<img src="${img}" alt="" style="width:100%;display:block;max-height:280px;object-fit:cover;" />`
  : `<div class="hero-pad" style="background:linear-gradient(135deg,${safeColor(c.primary)} 0%,${safeColor(c.primary)}cc 50%,${safeColor(c.primary)}99 100%);padding:56px ${pad}px;text-align:center;">
<h2 style="margin:0 0 10px;font-size:32px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.15;">${escHtml(heroHeadline)}</h2>
${heroSubtitle ? `<p style="margin:0;font-size:17px;color:rgba(255,255,255,0.88);line-height:1.5;font-weight:400;">${escHtml(heroSubtitle)}</p>` : ''}
</div>`}
</td></tr>`;
})() : ''}

<tr><td class="body-pad" style="padding:36px ${pad}px 20px;">
${bodyHtml}
</td></tr>

${reward?.enabled && reward?.title ? `<tr><td style="padding:8px ${pad}px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,${safeColor(c.primary)}08,${safeColor(c.primary)}15);border:2px dashed ${safeColor(c.primary)}40;border-radius:${Math.min(parseInt(br), 16)}px;overflow:hidden;">
<tr><td style="padding:24px;text-align:center;">
<p style="margin:0 0 4px;font-size:11px;font-weight:700;color:${safeColor(c.primary)};text-transform:uppercase;letter-spacing:2px;">${escHtml(reward.title)}</p>
${reward.description ? `<p style="margin:8px 0 0;font-size:14px;color:${safeColor(c.text)};line-height:1.5;">${escHtml(reward.description)}</p>` : ''}
${rewardQrDataUri ? `<img src="${escHtml(rewardQrDataUri)}" width="160" height="160" alt="${escHtml(reward.code || 'Reward code')}" style="display:block;margin:18px auto 0;width:160px;height:160px;border:8px solid #ffffff;border-radius:8px;" />` : ''}
${reward.code ? `<p style="margin:10px 0 0;font-family:ui-monospace,Menlo,monospace;font-size:13px;font-weight:700;color:${safeColor(c.text)};letter-spacing:3px;">${escHtml(reward.code)}</p>` : ''}
${reward.expiry ? `<p style="margin:6px 0 0;font-size:11px;color:#9CA3AF;">${escHtml(reward.expiry)}</p>` : ''}
</td></tr>
</table>
</td></tr>` : ''}

${cta?.enabled && ctaText && ctaUrl ? `<tr><td style="padding:8px ${pad}px ${pad}px;text-align:center;">
<a href="${escHtml(ctaUrl)}" style="display:inline-block;padding:16px 40px;background:${safeColor(cta.color)};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;letter-spacing:0.02em;mso-padding-alt:0;text-align:center;">
<!--[if mso]><i style="letter-spacing:40px;mso-font-width:-100%;mso-text-raise:30pt">&nbsp;</i><![endif]-->
<span style="mso-text-raise:15pt;">${escHtml(ctaText)}</span>
<!--[if mso]><i style="letter-spacing:40px;mso-font-width:-100%">&nbsp;</i><![endif]-->
</a>
<p style="margin:12px 0 0;font-size:11px;color:#9CA3AF;word-break:break-all;">${escHtml(ctaUrl)}</p>
</td></tr>` : ''}

${footer?.enabled ? `<tr><td style="padding:0 ${pad}px;"><div style="height:1px;background:#f0f0f0;"></div></td></tr>
<tr><td style="padding:24px ${pad}px 28px;text-align:center;">
${footer.text ? `<p style="margin:0 0 6px;font-size:12px;color:#9CA3AF;line-height:1.5;">${escHtml(applyTokensInline(footer.text, values))}</p>` : ''}
${postalAddress ? `<p style="margin:0 0 8px;font-size:11px;color:#B0B6BE;line-height:1.5;">${escHtml(gymName)} · ${escHtml(postalAddress)}</p>` : ''}
${unsubscribeUrl
  ? `<a href="${escHtml(unsubscribeUrl)}" style="font-size:11px;color:#9CA3AF;text-decoration:underline;">${escHtml(footer.unsubscribeText || 'Unsubscribe')}</a>`
  : ''}
</td></tr>` : ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}
