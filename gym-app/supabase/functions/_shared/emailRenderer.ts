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

/**
 * Destino admisible para un `href` del correo. Devuelve '' cuando no lo es, y
 * el llamador esconde el botón entero (`&& ctaUrl`) — mejor sin botón que con
 * un botón que va a cualquier parte.
 *
 * Aquí NO había ninguna comprobación: `cta.url` es texto libre que escribe el
 * admin y se metía en el href tal cual. Eso vale para tres cosas distintas:
 *
 *   • `javascript:` / `data:` — inertes en clientes de correo serios, pero no
 *     en las previsualizaciones web, y no hay razón para dejarlos pasar.
 *   • `http://` a secas — degrada un correo de marca a texto en claro.
 *   • `https://app.tugympr.com@evil.example/` — el truco clásico: todo lo
 *     anterior a la `@` es userinfo, o sea decoración. El lector ve el dominio
 *     bueno; el navegador va al malo. Por eso se rechaza cualquier userinfo.
 *
 * Deliberadamente NO es una lista blanca de dominios: el gimnasio enlaza su
 * propia web, su Instagram o su página de reservas, y eso es legítimo. Lo que
 * se cierra es la forma del enlace, no su destino.
 */
export function safeLinkUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500) return '';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return ''; // relativo o basura: en un correo no hay base contra la que resolver
  }
  if (u.protocol !== 'https:') return '';
  if (u.username || u.password) return '';
  return u.toString();
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

/**
 * Sustituir tokens dentro de HTML YA RENDERIZADO (los diseños de la galería,
 * guardados como HTML fijo con los tokens sin resolver).
 *
 * Dos diferencias con applyTokens, y las dos importan:
 *
 *  1. Los valores se ESCAPAN como HTML. En el camino de bloques no hace falta
 *     porque renderEmailHtml escapa al insertar; aquí el valor entra crudo en
 *     el documento, así que un `full_name` con marcado inyectaría HTML activo
 *     en el correo del miembro.
 *  2. NO se borra la línea cuando un token no resuelve. Esa regla existe para
 *     bloques de texto; sobre HTML una "línea" puede ser medio `<tr>`, y
 *     tirarla rompe la maqueta. Un token sin valor se sustituye por vacío.
 */
export function applyTokensToHtml(
  html: string,
  values: Record<string, string | null | undefined>,
): string {
  if (!html) return '';
  return html.replace(TOKEN_RE, (_m, key: string) => {
    const v = values[key.toLowerCase()];
    return v === undefined || v === null ? '' : escHtml(String(v));
  });
}

/**
 * Pie de cumplimiento para el HTML de un diseño: baja real + dirección postal.
 *
 * Los diseños del catálogo traen su propio pie visual, pero con
 * `href="#"` — un enlace de baja muerto es peor que ninguno, y CAN-SPAM exige
 * además una dirección física en el correo comercial. Se añade un bloque
 * propio antes de `</body>` en vez de intentar reescribir el suyo: sustituir a
 * ciegas dentro de HTML ajeno es justo como se rompen las maquetas.
 */
export function appendComplianceFooter(
  html: string,
  opts: { unsubscribeUrl?: string | null; postalAddress?: string | null; gymName?: string | null },
): string {
  const bits: string[] = [];
  if (opts.postalAddress) {
    bits.push(`<div style="margin-bottom:6px;">${escHtml(opts.postalAddress)}</div>`);
  }
  if (opts.unsubscribeUrl) {
    const safe = safeLinkUrl(opts.unsubscribeUrl);
    if (safe) {
      bits.push(`<a href="${escHtml(safe)}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a>`);
    }
  }
  if (!bits.length) return html;

  const block = `<div style="max-width:600px;margin:0 auto;padding:18px 24px 28px;text-align:center;`
    + `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#9CA3AF;">`
    + bits.join('') + `</div>`;

  // El `(?![\s\S]*<\/body>)` ancla al ÚLTIMO </body>: un diseño con una tabla
  // fantasma de MSO puede llevar más de uno.
  return html.includes('</body>')
    ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, `${block}</body>`)
    : html + block;
}

/** Adonde manda el botón de canjear: Recompensas dentro de la app. */
const REWARDS_DEEP_LINK = 'https://app.tugympr.com/invite/go/rewards';

/**
 * Caducidad legible. Gemela de `formatExpiry` en
 * src/lib/admin/emailTemplateRenderer.js — si una cambia, la otra también, o
 * la vista previa del editor deja de predecir lo que se envía.
 *
 * Acepta la fecha ISO del selector nuevo y devuelve tal cual cualquier otra
 * cosa: las plantillas anteriores tienen ahí texto libre y perderlo sería
 * peor que no formatearlo.
 */
export function formatExpiry(value: unknown, lang = 'es'): string {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // A mano y no `new Date(raw)`: esa forma lee el ISO corto como UTC y en
  // Puerto Rico (UTC-4) retrocede un día.
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return raw;
  try {
    return dt.toLocaleDateString(lang === 'en' ? 'en-US' : 'es', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch {
    return raw;
  }
}

export interface RenderOptions {
  gymName: string;
  logoUrl?: string | null;
  /** Real, working unsubscribe URL. Required for anything automated. */
  unsubscribeUrl?: string | null;
  /** Physical postal address — CAN-SPAM requires one on commercial mail. */
  postalAddress?: string | null;
  /** Idioma del envío — decide el texto fijo del bloque de recompensa. */
  lang?: string;
  values: Record<string, string | null | undefined>;
}

export function renderEmailHtml(template: EmailTemplate, opts: RenderOptions): string {
  const c = template.colors;
  const { header, hero, body, cta, footer } = template;
  const reward = template.reward;
  // `rewardQrDataUri` se cayó de RenderOptions. Se pasaba un QR en data-URI
  // que NUNCA llegaba a verse: Gmail, Outlook y Yahoo bloquean SVG, y Gmail
  // además tira toda imagen en `data:`. Lo que recibía el miembro era un
  // recuadro vacío. Ahora el bloque manda el código en texto —que siempre se
  // ve— y un botón a Recompensas de la app, donde el QR sí existe y recepción
  // lo escanea.
  const lang = opts.lang === 'en' ? 'en' : 'es';
  const rewardCopy = lang === 'en'
    ? { eyebrow: 'Your reward', code: 'Your code', redeem: 'Redeem in the app', expires: 'Valid through' }
    : { eyebrow: 'Tu recompensa', code: 'Tu código', redeem: 'Canjear en la app', expires: 'Válido hasta el' };
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
  const { gymName, logoUrl, unsubscribeUrl, postalAddress, values } = opts;

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
  const ctaUrl = safeLinkUrl(tk(cta?.url || ''));

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
  // Misma regla que el CTA. El `^https://` que había dejaba pasar userinfo
  // (`https://cdn.gimnasio.com@evil.example/x.png`), que en una imagen no
  // engaña a nadie pero sí manda la IP y el User-Agent del lector al host que
  // el atacante quiera.
  const img = escHtml(safeLinkUrl(hero.imageUrl));
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
<table width="100%" cellpadding="0" cellspacing="0" style="background:${safeColor(c.primary)}0d;border:1px solid ${safeColor(c.primary)}2b;border-radius:${Math.min(parseInt(br), 16)}px;overflow:hidden;">
<tr><td style="padding:26px 24px;text-align:center;">
<p style="margin:0 0 6px;font-size:10px;font-weight:700;color:${safeColor(c.primary)};text-transform:uppercase;letter-spacing:2px;">${escHtml(rewardCopy.eyebrow)}</p>
<p style="margin:0;font-size:19px;font-weight:800;color:${safeColor(c.text)};letter-spacing:-0.02em;line-height:1.25;">${escHtml(reward.title)}</p>
${reward.description ? `<p style="margin:7px 0 0;font-size:14px;color:${safeColor(c.text)};opacity:0.72;line-height:1.55;">${escHtml(reward.description)}</p>` : ''}
${reward.code ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&amp;margin=0&amp;data=${encodeURIComponent('earned-reward:' + reward.code)}" width="150" height="150" alt="${escHtml(reward.code)}" style="display:block;width:150px;height:150px;margin:16px auto 0;border:0;border-radius:6px;background:#ffffff;padding:10px;" />
<div style="margin:13px auto 0;display:inline-block;background:#ffffff;border:1px solid ${safeColor(c.primary)}33;border-radius:${Math.min(parseInt(br), 14)}px;padding:14px 22px;">
<p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:1.5px;">${escHtml(rewardCopy.code)}</p>
<p style="margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;font-weight:700;color:${safeColor(c.text)};letter-spacing:4px;line-height:1.2;">${escHtml(reward.code)}</p>
</div>` : ''}
<div style="margin:16px 0 0;"><a href="${escHtml(REWARDS_DEEP_LINK)}" style="display:inline-block;padding:12px 28px;background:${safeColor(c.primary)};color:#ffffff;font-size:13.5px;font-weight:700;text-decoration:none;border-radius:50px;">${escHtml(rewardCopy.redeem)}</a></div>
${reward.expiry ? `<p style="margin:12px 0 0;font-size:11.5px;color:#9CA3AF;">${escHtml(rewardCopy.expires)} ${escHtml(formatExpiry(reward.expiry, lang))}</p>` : ''}
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
