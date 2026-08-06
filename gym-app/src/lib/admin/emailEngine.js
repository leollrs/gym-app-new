/**
 * Motor de correo v2 — port de `eb-engine.jsx` del proyecto de diseño
 * "Email Builder - Guiado (A)".
 *
 * POR QUÉ SUSTITUYE AL ANTERIOR
 *
 * El renderizador de bloques que había producía siempre la misma maqueta:
 * cabecera de color, hero en degradado, párrafos, botón. Cambiaras lo que
 * cambiaras, salía un correo de plantilla de 2010. Este trae seis maquetas de
 * verdad distintas —no seis paletas sobre la misma— y las prácticas que un
 * correo necesita para no verse roto en el buzón:
 *
 *   • 600px de columna única, tablas con role="presentation"
 *   • estilos en línea (ningún cliente serio respeta un <style> externo)
 *   • preheader oculto, que es la línea que se lee en la bandeja
 *   • botones "a prueba de balas" con área táctil ≥44px
 *   • 16px mínimo en el cuerpo — por debajo, iOS hace zoom solo
 *   • alt text, media query móvil, conciencia de modo oscuro
 *   • pie CAN-SPAM: dirección postal + baja real
 *
 * White label de verdad: del gimnasio solo entran logo, nombre, dirección y UN
 * color de acento. Todo lo demás es la maqueta, que no se negocia — que es
 * justo lo que hace que el resultado se vea bien sin que nadie diseñe nada.
 *
 * SIN DEPENDENCIAS Y SIN DOM a propósito: así corre igual en el navegador
 * (vista previa del editor) que en un test de Node, y el port a Deno del
 * enviador es una copia literal en vez de una reescritura.
 */

// ── Color ────────────────────────────────────────────────────────────
function hx(c) {
  let s = String(c || '#000').replace('#', '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}
function toHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) {
  const A = hx(a), B = hx(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function lum(c) {
  const [r, g, b] = hx(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const tint = (c, t) => mix(c, '#ffffff', t);
export const shade = (c, t) => mix(c, '#0B0F12', t);
/** Tinta legible sobre `c`. El umbral 0.46 reproduce las decisiones del diseño. */
export const onColor = (c) => (lum(c) > 0.46 ? '#0B0F12' : '#FFFFFF');

/** Escapa para HTML. TODO texto del admin pasa por aquí antes de entrar. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Destino admisible para un href. Devuelve '' si no lo es y el llamador
 * esconde el enlace. Mismo criterio que `safeLinkUrl` del renderizador
 * compartido: solo https, sin userinfo (`https://app.tugympr.com@evil/`).
 */
export function safeUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.toString();
  } catch { return ''; }
}

// ── Las seis maquetas ────────────────────────────────────────────────
// `head` cambia la cabecera entera, no su color. `display` decide la familia
// del titular. Entre dos presets cambia la composición, no la paleta — es lo
// que hace que escoger uno se note.
export const PRESETS = {
  editorial:   { label: { es: 'Editorial', en: 'Editorial' }, note: { es: 'Crema, serif grande, numerada', en: 'Cream, large serif, numbered' },
                 head: 'masthead', display: 'serif',  titleSize: 46, btn: 'ink',    paper: '#F5F2EC', radius: 4,  rules: true },
  marca:       { label: { es: 'Marca', en: 'Brand' }, note: { es: 'Bloque en tu color, titular enorme', en: 'Block in your colour, huge headline' },
                 head: 'block',    display: 'poster', titleSize: 54, btn: 'ink',    paper: '#FFFFFF', radius: 4 },
  limpio:      { label: { es: 'Limpio', en: 'Clean' }, note: { es: 'Nota personal, sin adornos', en: 'Personal note, no ornament' },
                 head: 'mark',     display: 'serif',  titleSize: 38, btn: 'ghost',  paper: '#FFFFFF', radius: 0 },
  contundente: { label: { es: 'Contundente', en: 'Bold' }, note: { es: 'Papel oscuro, mayúsculas', en: 'Dark paper, uppercase' },
                 head: 'dark',     display: 'poster', titleSize: 56, btn: 'accent', paper: '#0E1316', radius: 4, onDark: true },
  suave:       { label: { es: 'Suave', en: 'Soft' }, note: { es: 'Aireado, redondo, con tinte', en: 'Airy, round, tinted' },
                 head: 'wash',     display: 'serif',  titleSize: 42, btn: 'accent', paper: '#FFFFFF', radius: 22 },
  compacto:    { label: { es: 'Compacto', en: 'Compact' }, note: { es: 'Denso — para resúmenes', en: 'Dense — for digests' },
                 head: 'strip',    display: 'display', titleSize: 30, btn: 'ink',   paper: '#FFFFFF', radius: 6, dense: true, rules: true },
};
export const PRESET_IDS = Object.keys(PRESETS);

export const FAM = {
  serif: "Newsreader,Georgia,'Times New Roman',serif",
  display: "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif",
  body: "Archivo,-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif",
  mono: "'JetBrains Mono','SF Mono',Consolas,'Courier New',monospace",
};

export function tokens(cfg) {
  const p = PRESETS[cfg.preset] || PRESETS.editorial;
  const mob = cfg.device === 'mobile';
  const onDark = !!p.onDark || !!cfg.dark;
  const a = safeHex(cfg.brand?.accent) || '#19B8B8';
  const fs = cfg.fontScale || 15;
  const k = (fs / 15) * (mob ? 0.9 : 1);
  const basePad = ({ compacto: 30, comodo: 38, espacioso: 46 }[cfg.density || 'comodo']) * (p.dense ? 0.82 : 1);
  const pad = Math.round(mob ? Math.max(22, basePad * 0.6) : basePad);
  const paper = cfg.dark ? '#12171A' : p.paper;
  const radius = cfg.radius == null ? p.radius : cfg.radius;
  return {
    p, mob, onDark, a, pad, radius, k,
    aOn: onColor(a),
    aInk: onDark ? tint(a, 0.34) : (lum(a) > 0.44 ? shade(a, 0.46) : a),
    aWash: onDark ? mix(a, paper, 0.86) : tint(a, 0.92),
    aSoft: onDark ? mix(a, paper, 0.68) : tint(a, 0.76),
    paper,
    wrapBg: onDark ? '#07090B' : '#E9E5DC',
    text: onDark ? '#F5F2EC' : '#0B0F12',
    text2: onDark ? 'rgba(245,242,236,0.82)' : '#1F2630',
    sub: onDark ? 'rgba(245,242,236,0.60)' : '#5A6570',
    mute: onDark ? 'rgba(245,242,236,0.42)' : '#96A0AA',
    line: onDark ? 'rgba(255,255,255,0.13)' : '#E4DFD3',
    inkBtn: onDark ? '#F5F2EC' : '#0B0F12',
    t: {
      eyebrow: Math.round(11 * k), title: Math.round(p.titleSize * k), sub: Math.round(16.5 * k),
      body: Math.round(16 * k), small: Math.round(12.5 * k), btn: Math.round(15 * k), num: Math.round(22 * k),
    },
    W: mob ? 360 : 600,
  };
}

/** Solo hex. Un `var(--x)` colándose aquí pintaría el correo de negro. */
function safeHex(c) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? String(c) : '';
}

// ── Átomos ───────────────────────────────────────────────────────────
const rule = (tk, w, color) =>
  `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="${w || '100%'}" style="border-collapse:collapse;margin:0 auto"><tr><td height="1" bgcolor="${color || tk.line}" style="height:1px;line-height:1px;font-size:0">&nbsp;</td></tr></table>`;
const gap = (h) => `<div style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</div>`;
const center = (inner) =>
  `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto"><tr><td align="center">${inner}</td></tr></table>`;

function kicker(txt, tk, color, dash) {
  return `<div style="font-family:${FAM.mono};font-size:${tk.t.eyebrow}px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${color};line-height:1.4">${dash ? '&mdash;&nbsp;' : ''}${esc(txt)}</div>`;
}

function logoTag(cfg, tk, variant, size) {
  const b = cfg.brand || {};
  const s = size || (tk.mob ? 38 : 44);
  if (!cfg.header?.showLogo) return '';
  const url = safeUrl(b.logoUrl);
  if (url) return `<img src="${esc(url)}" width="${s}" height="${s}" alt="${esc(b.name)}" style="display:block;width:${s}px;height:${s}px;border:0;border-radius:${Math.round(s * 0.22)}px"/>`;
  // Sin logo se dibuja un monograma: un hueco vacío donde debería ir la marca
  // se lee como correo roto.
  const skin = variant === 'onAccent' ? { bg: '#FFFFFF', fg: tk.a, bd: '#FFFFFF' }
    : variant === 'onInk' ? { bg: 'transparent', fg: tk.a, bd: tk.a }
      : { bg: '#0B0F12', fg: tk.a, bd: '#0B0F12' };
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>`
    + `<td width="${s}" height="${s}" align="center" valign="middle" bgcolor="${skin.bg === 'transparent' ? '' : skin.bg}" style="width:${s}px;height:${s}px;background:${skin.bg};border:1.5px solid ${skin.bd};border-radius:${Math.round(s * 0.22)}px;font-family:${FAM.display};font-size:${Math.round(s * 0.36)}px;font-weight:900;letter-spacing:-0.02em;line-height:1;color:${skin.fg}">${esc(b.monogram || (b.name || '?').slice(0, 2).toUpperCase())}</td>`
    + `</tr></table>`;
}

const wordmark = (cfg, tk, size, color) =>
  `<div style="font-family:${FAM.display};font-size:${size}px;font-weight:800;letter-spacing:-0.02em;color:${color};line-height:1">${esc(cfg.brand?.name || '')}</div>`;

/**
 * Sustituye los merge tags.
 *
 * En la VISTA PREVIA se rellenan con valores de muestra: enseñar
 * «Tu racha de {{streak_count}} días» no deja juzgar si la frase funciona, que
 * es justo para lo que sirve una vista previa.
 *
 * Al ENVIAR, `cfg.values` trae los del miembro y un token sin valor se queda
 * como está en vez de dejar un hueco — el enviador ya blanquea la línea entera
 * cuando corresponde, y eso sí sabe qué campos pidió cada momento.
 */
const SAMPLE = {
  member_name: 'José Rivera', nombre: 'José Rivera',
  first_name: 'José', pila: 'José', name: 'José Rivera',
  streak_count: '12', racha: '12',
  workout_count: '34', entrenos: '34',
  days_inactive: '7', dias_inactivo: '7',
};
const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/**
 * ¿Se queda coja esta línea?
 *
 * Solo al ENVIAR (`cfg.values` presente). En la vista previa no: ahí los tokens
 * son parte de lo que estás escribiendo y tienen que verse.
 */
function lineIsDead(s, cfg) {
  if (cfg.keepTokens || !cfg.values) return false;
  const found = String(s || '').match(TOKEN_RE);
  if (!found) return false;
  return found.some((m) => {
    const k = m.replace(/[{}\s]/g, '').toLowerCase();
    if (k === 'gym_name' || k === 'gimnasio') return !(cfg.brand && cfg.brand.name);
    const v = cfg.values[k];
    return v == null || String(v).trim() === '';
  });
}

/**
 * Un campo de una sola línea: si su token no resuelve, el campo entero
 * desaparece. «Tu próxima clase es » colgando es peor que no mencionarla.
 */
function field(s, cfg) {
  return lineIsDead(s, cfg) ? '' : fillTokens(s, cfg);
}

export function fillTokens(s, cfg) {
  if (!s) return '';
  const vals = cfg.values || null;
  return String(s).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => {
    // `keepTokens`: renderiza la PLANTILLA, no el correo de nadie. Lo usa
    // Outreach, que monta el HTML una vez y luego sustituye por destinatario.
    // Sin esto se colaban los valores de MUESTRA y a los cuatrocientos miembros
    // les llegaba «Hola José Rivera, llevas 7 días fuera».
    if (cfg.keepTokens) return m;
    const k = key.toLowerCase();
    if (k === 'gym_name' || k === 'gimnasio') return cfg.brand?.name || m;
    if (vals) return vals[k] != null && String(vals[k]).trim() !== '' ? String(vals[k]) : m;
    return SAMPLE[k] != null ? SAMPLE[k] : m;
  });
}

// ── Cabecera ─────────────────────────────────────────────────────────
function renderHeader(cfg, tk) {
  if (!cfg.header?.on) return '';
  let label = (cfg.header.text || '').trim();
  // Nunca repetir el antetítulo del hero en la cabecera: leerlo dos veces
  // seguidas es el tic que delata una plantilla.
  if (label && label.toLowerCase() === (cfg.hero?.eyebrow || '').trim().toLowerCase() && cfg.hero?.on) label = '';
  const P = tk.pad, h = tk.p.head;

  if (h === 'block') {
    const logo = logoTag(cfg, tk, 'onAccent');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tk.a}" style="border-collapse:collapse;background:${tk.a}"><tr><td align="center" style="padding:${P}px ${P}px ${Math.round(P * 0.9)}px">`
      + (logo ? center(logo) + gap(18) : '')
      + (label ? kicker(label, tk, tk.aOn === '#FFFFFF' ? 'rgba(255,255,255,0.86)' : 'rgba(11,15,18,0.7)', true) : '')
      + `</td></tr></table>`;
  }
  if (h === 'dark') {
    const logo = logoTag(cfg, tk, 'onInk');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:${P}px ${P}px ${Math.round(P * 0.5)}px">`
      + (logo ? center(logo) + gap(16) : '')
      + (label ? kicker(label, tk, tk.aInk, true) + gap(Math.round(P * 0.55)) : '')
      + rule(tk, 64, tk.a)
      + `</td></tr></table>`;
  }
  if (h === 'wash') {
    const logo = logoTag(cfg, tk, 'plain', tk.mob ? 40 : 48);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tk.aWash}" style="border-collapse:collapse;background:${tk.aWash}"><tr><td align="center" style="padding:${P}px ${P}px ${Math.round(P * 0.85)}px">`
      + (logo ? center(logo) + gap(16) : '')
      + (label ? kicker(label, tk, tk.aInk, true) : '')
      + `</td></tr></table>`;
  }
  if (h === 'strip') {
    const logo = logoTag(cfg, tk, 'plain', 30);
    const lockup = logo
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td valign="middle" style="padding-right:10px">${logo}</td><td valign="middle">${wordmark(cfg, tk, Math.round(15 * tk.k), tk.text)}</td></tr></table>`
      : wordmark(cfg, tk, Math.round(15 * tk.k), tk.text);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">`
      + `<tr><td height="4" bgcolor="${tk.a}" style="height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>`
      + `<tr><td align="center" style="padding:${Math.round(P * 0.62)}px ${P}px ${Math.round(P * 0.55)}px;border-bottom:1px solid ${tk.line}">`
      + center(lockup)
      + (label ? gap(9) + kicker(label, tk, tk.mute) : '')
      + `</td></tr></table>`;
  }
  if (h === 'mark') {
    const logo = logoTag(cfg, tk, 'plain', tk.mob ? 34 : 38);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:${P}px ${P}px ${Math.round(P * 0.45)}px">`
      + (logo ? center(logo) + gap(13) : '')
      + wordmark(cfg, tk, Math.round(14 * tk.k), tk.sub)
      + `</td></tr></table>`;
  }
  // masthead — la editorial
  const logo = logoTag(cfg, tk, 'plain', tk.mob ? 34 : 40);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:${Math.round(P * 0.85)}px ${P}px ${Math.round(P * 0.62)}px;border-bottom:1px solid ${tk.line}">`
    + (logo ? center(logo) + gap(14) : '')
    + wordmark(cfg, tk, Math.round(16 * tk.k), tk.text)
    + (label ? gap(10) + kicker(label, tk, tk.mute) : '')
    + `</td></tr></table>`;
}

// ── Portada ──────────────────────────────────────────────────────────
function renderHero(cfg, tk) {
  if (!cfg.hero?.on) return '';
  const h = cfg.hero, P = tk.pad;
  const title = field(h.title, cfg).trim(), sub = field(h.subtitle, cfg).trim(), eye = field(h.eyebrow, cfg).trim();
  const imageUrl = safeUrl(h.imageUrl);
  const hasPhoto = !!(imageUrl || h.imagePlaceholder);
  if (!title && !sub && !eye && !hasPhoto) return '';
  const poster = tk.p.display === 'poster', serif = tk.p.display === 'serif';
  const fam = poster ? FAM.display : serif ? FAM.serif : FAM.display;
  const titleCss = poster
    ? `font-family:${fam};font-size:${tk.t.title}px;font-weight:900;line-height:0.92;letter-spacing:-0.035em;text-transform:uppercase;color:${tk.text}`
    : serif
      ? `font-family:${fam};font-size:${tk.t.title}px;font-weight:400;line-height:1.02;letter-spacing:-0.025em;color:${tk.text}`
      : `font-family:${fam};font-size:${tk.t.title}px;font-weight:800;line-height:1.1;letter-spacing:-0.03em;color:${tk.text}`;

  let photo = '';
  if (hasPhoto) {
    const ih = Math.round(tk.W / 1.72), r = Math.min(tk.radius, 10);
    photo = imageUrl
      ? `<tr><td align="center" style="padding:0 ${P}px"><img src="${esc(imageUrl)}" width="${tk.W - P * 2}" height="${ih}" alt="${esc(title || cfg.brand?.name || '')}" style="display:block;width:100%;max-width:${tk.W - P * 2}px;height:${ih}px;object-fit:cover;border:0;border-radius:${r}px"/></td></tr>`
      // El marcador solo existe para la vista previa del editor. Al enviar,
      // `imagePlaceholder` va en false, así que nunca sale al buzón.
      : `<tr><td align="center" style="padding:0 ${P}px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>`
        + `<td height="${ih}" align="center" valign="middle" bgcolor="${tk.onDark ? '#1B2226' : '#E4D9C6'}" style="height:${ih}px;border-radius:${r}px;background:repeating-linear-gradient(135deg,${tk.onDark ? '#1B2226' : '#E8DCC7'} 0 14px,${tk.onDark ? '#131A1D' : '#D6C6A8'} 14px 28px)">`
        + `<div style="display:inline-block;padding:6px 11px;border-radius:4px;background:${tk.onDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.78)'};font-family:${FAM.mono};font-size:10.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${tk.onDark ? 'rgba(255,255,255,0.7)' : 'rgba(15,20,25,0.6)'}">foto &middot; 1200&times;700</div>`
        + `</td></tr></table></td></tr>`;
  }

  const typo = (title || sub || eye)
    ? `<tr><td align="center" style="padding:${Math.round(P * (photo ? 0.8 : 1))}px ${P}px 0">`
      + (eye ? kicker(eye, tk, tk.aInk, true) + gap(tk.mob ? 16 : 20) : '')
      + (title ? `<h1 style="margin:0;${titleCss}">${esc(title)}</h1>` : '')
      + (sub ? gap(tk.mob ? 14 : 18) + `<div style="font-family:${FAM.body};font-size:${tk.t.sub}px;line-height:1.55;color:${tk.text2};max-width:${Math.min(470, tk.W - P * 2)}px;margin:0 auto">${esc(sub)}</div>` : '')
      + `</td></tr>`
    : '';

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${typo}${typo && photo ? `<tr><td style="padding:${Math.round(P * 0.8)}px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>` : ''}${photo}</table>`;
}

// ── Cuerpo ───────────────────────────────────────────────────────────
/**
 * `- línea` se convierte en una fila NUMERADA con regla, no en una viñeta:
 * es lo que hace que un correo de gimnasio se lea como una lista de cosas
 * que hacer y no como un volante.
 * `--Título--` abre una sección con antetítulo en mono y una regla.
 */
function renderBody(cfg, tk) {
  const raw = (cfg.body?.text || '').trim();
  if (!cfg.body?.on || !raw) return '';
  // Línea a línea, no el texto entero de golpe: al enviar, una línea cuyo token
  // no resuelve se cae ENTERA. Sin esto el miembro sin clase reservada recibía
  // «📋 Clase: {{next_class_name}}» tal cual, o —peor todavía si el token
  // resolvía a cadena vacía— «📋 Clase:» colgando.
  const P = tk.pad;
  let lines = raw.split('\n').filter((ln) => !lineIsDead(ln, cfg)).map((ln) => fillTokens(ln, cfg));
  // Y si al caerse las líneas una sección se queda sin nada debajo, se cae
  // también su título: un antetítulo con una regla y aire debajo se lee como
  // que el correo se rompió a la mitad.
  lines = lines.filter((ln, i) => {
    if (!/^--\s*.+\s*--$/.test(ln.trim())) return true;
    for (let j = i + 1; j < lines.length; j++) {
      const nxt = lines[j].trim();
      if (!nxt) continue;
      return !/^--\s*.+\s*--$/.test(nxt);
    }
    return false;
  });
  const serifNum = tk.p.display !== 'display';
  let out = '', list = [], first = true, n = 0;

  const flush = () => {
    if (!list.length) return;
    out += (first ? '' : gap(Math.round(P * 0.55)))
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">`
      + list.map((txt, i) => {
        n++; const num = String(n).padStart(2, '0');
        return `<tr><td valign="top" width="${tk.mob ? 34 : 42}" style="padding:${i ? 14 : 0}px 0 14px;border-top:${i ? `1px solid ${tk.line}` : 'none'}">`
          + `<div style="font-family:${serifNum ? FAM.serif : FAM.mono};font-size:${serifNum ? tk.t.num : tk.t.small + 1}px;font-weight:${serifNum ? 400 : 700};${serifNum ? 'font-style:italic;' : ''}color:${tk.aInk};line-height:1.2">${num}</div></td>`
          + `<td valign="top" align="left" style="padding:${i ? 14 : 0}px 0 14px;border-top:${i ? `1px solid ${tk.line}` : 'none'};font-family:${FAM.body};font-size:${tk.t.body}px;line-height:1.5;color:${tk.text}">${esc(txt)}</td></tr>`;
      }).join('')
      + `</table>`;
    list = []; first = false;
  };

  lines.forEach((ln) => {
    const s = ln.trim();
    if (!s) { flush(); return; }
    const head = s.match(/^--\s*(.+?)\s*--$/);
    if (head) {
      flush(); n = 0;
      out += (first ? '' : gap(Math.round(P * 0.85)))
        + kicker(head[1], tk, tk.sub) + gap(13) + rule(tk, '100%') + gap(Math.round(P * 0.5));
      first = true; return;
    }
    if (/^[-·•]\s+/.test(s)) { list.push(s.replace(/^[-·•]\s+/, '')); return; }
    flush();
    out += (first ? '' : gap(Math.round(tk.t.body * 1.05)))
      + `<div style="font-family:${FAM.body};font-size:${tk.t.body}px;line-height:1.6;color:${tk.text};max-width:${Math.min(470, tk.W - P * 2)}px;margin:0 auto">${esc(s)}</div>`;
    first = false;
  });
  flush();
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>`
    + `<td align="center" style="padding:${Math.round(P * 0.9)}px ${P}px 0">${out}</td></tr></table>`;
}

// ── Recompensa ───────────────────────────────────────────────────────
function renderReward(cfg, tk) {
  const r = cfg.reward;
  if (!r?.on) return '';
  const title = (r.title || '').trim();
  if (!title) return '';
  const P = tk.pad, rad = Math.min(tk.radius, 12);
  const code = (r.code || '').trim(), desc = (r.desc || '').trim(), exp = (r.expires || '').trim();
  const strip = tk.onDark ? tk.a : '#0B0F12';
  const stripFg = tk.onDark ? onColor(tk.a) : tk.a;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:${Math.round(P * 0.95)}px ${P}px 0">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1.5px solid ${tk.onDark ? tk.line : '#0B0F12'};border-radius:${rad}px;overflow:hidden">`
    + `<tr><td align="center" bgcolor="${strip}" style="padding:10px 16px;background:${strip};font-family:${FAM.mono};font-size:${tk.t.eyebrow}px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${stripFg}">${esc(r.label || 'Tu recompensa')}</td></tr>`
    + `<tr><td align="center" bgcolor="${tk.paper}" style="padding:${Math.round(P * 0.7)}px ${Math.round(P * 0.6)}px ${Math.round(P * 0.75)}px;background:${tk.paper}">`
    + `<div style="font-family:${tk.p.display === 'poster' ? FAM.display : FAM.serif};font-size:${Math.round(tk.t.num * 1.12)}px;font-weight:${tk.p.display === 'poster' ? 800 : 400};letter-spacing:-0.02em;line-height:1.15;color:${tk.text}${tk.p.display === 'poster' ? ';text-transform:uppercase' : ''}">${esc(title)}</div>`
    + (desc ? gap(8) + `<div style="font-family:${FAM.body};font-size:${tk.t.small + 1}px;line-height:1.5;color:${tk.sub};max-width:340px;margin:0 auto">${esc(desc)}</div>` : '')
    // QR + código. El QR se sirve ALOJADO como PNG desde api.qrserver.com,
    // que es el mismo camino que ya usa el voucher de send-admin-email y por
    // la misma razón documentada allí: Gmail, Yahoo y Outlook web arrancan los
    // `data:` de un <img>, y un CID solo funciona en clientes de escritorio.
    // Una URL https normal es lo único que renderiza en todos.
    //
    // Va con `earned-reward:` delante porque ese prefijo es el que enruta el
    // escáner de recepción (scanRouter.js:154) hacia redeem_earned_reward. Sin
    // el prefijo, escanearlo no hace nada.
    //
    // El código impreso debajo NO es decoración: si la imagen no carga —o el
    // lector tiene las imágenes bloqueadas— recepción todavía puede teclearlo.
    // El QR SOLO si el código es canjeable de verdad (`scannable`).
    //
    // El QR codifica `earned-reward:<código>`, y el escáner de recepción busca
    // ese código en `earned_rewards`. Un código escrito a mano en la plantilla
    // NO tiene fila ahí, así que escanearlo devuelve "recompensa no
    // encontrada" — un QR que promete algo que el mostrador no puede honrar.
    // Solo lo marca `scannable` quien concede de verdad: el enviador
    // automático tras `grant_email_campaign_reward`, y la vista previa con su
    // código de muestra.
    // `keepTokens`: el código es POR MIEMBRO y el HTML se monta una sola vez para
    // toda la campaña, así que viaja como token y lo sustituye el enviador. Para
    // que sobreviva dentro de la URL del QR hay que codificar solo el prefijo y
    // dejar las llaves crudas — `encodeURIComponent` las convertiría en %7B%7B y
    // la sustitución ya no encontraría nada. El código concedido es
    // alfanumérico en mayúsculas, así que no necesita escaparse.
    + (code && r.scannable ? gap(16) + center(
      `<img src="https://api.qrserver.com/v1/create-qr-code/?size=320x320&amp;margin=0&amp;data=${cfg.keepTokens ? `earned-reward%3A${code}` : encodeURIComponent('earned-reward:' + code)}" width="150" height="150" alt="${esc(code)}" style="display:block;width:150px;height:150px;border:0;border-radius:6px;background:#ffffff;padding:10px"/>`,
    ) : '')
    + (code ? gap(13) + center(
      `<div style="font-family:${FAM.mono};font-size:${tk.t.body}px;font-weight:700;letter-spacing:0.16em;color:${tk.text};padding:11px 18px;border:1px dashed ${tk.onDark ? tk.line : 'rgba(11,15,18,0.3)'};border-radius:${Math.min(8, rad)}px">${esc(code)}</div>`,
    ) : '')
    + (exp ? gap(12) + `<div style="font-family:${FAM.mono};font-size:${tk.t.small - 1.5}px;letter-spacing:0.04em;color:${tk.mute}">${esc(cfg.strings?.validUntil || 'Válido hasta el')} ${esc(exp)}</div>` : '')
    + `</td></tr></table></td></tr></table>`;
}

// ── Botón ────────────────────────────────────────────────────────────
export const DEST_LABEL = {
  app:    { es: 'Abrir la app',      en: 'Open the app' },
  plan:   { es: 'Ver mi plan',       en: 'See my plan' },
  clase:  { es: 'Reservar la clase', en: 'Book the class' },
  tienda: { es: 'Ver la tienda',     en: 'See the shop' },
  web:    { es: 'Ver más',           en: 'See more' },
};

function renderCta(cfg, tk) {
  const c = cfg.cta;
  if (!c?.on) return '';
  const lang = cfg.lang === 'en' ? 'en' : 'es';
  // El texto NUNCA queda vacío: sin etiqueta se usa la del destino. Antes se
  // pintaba una píldora de color sin nada dentro, que es lo que salía en la
  // vista previa como "un botón random abajo".
  const label = (c.label || '').trim() || DEST_LABEL[c.dest]?.[lang] || DEST_LABEL.app[lang];
  const href = safeUrl(c.url);
  if (!href) return '';
  const P = tk.pad, st = tk.p.btn;
  const bg = safeHex(c.color) || (st === 'accent' ? tk.a : st === 'ink' ? tk.inkBtn : 'transparent');
  const fg = st === 'ghost' ? tk.text : onColor(bg === 'transparent' ? tk.paper : bg);
  const bd = st === 'ghost' ? (tk.onDark ? 'rgba(255,255,255,0.3)' : 'rgba(11,15,18,0.22)') : bg;
  const py = tk.p.dense ? 14 : 17, px = 28;
  // `separate`, NO `collapse`.
  //
  // Por especificación, `border-radius` no tiene ningún efecto sobre una celda
  // de tabla cuando `border-collapse` es `collapse`. El fondo sí se pinta
  // redondeado, pero el borde se pinta CUADRADO — y entre los dos asoman las
  // cuatro esquinas del papel. Eso es la "caja alrededor del botón" que salía en
  // el correo real. `cellspacing="0"` ya deja `border-spacing` a cero, así que
  // separar no cambia nada más.
  const btn = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0"><tr>`
    + `<td align="center" bgcolor="${bg === 'transparent' ? '' : bg}" style="border-radius:999px;background:${bg};border:1.5px solid ${bd};padding:${py}px ${px}px">`
    + `<a href="${esc(href)}" style="display:block;font-family:${FAM.display};font-size:${tk.t.btn}px;font-weight:700;letter-spacing:-0.01em;color:${fg};text-decoration:none">${esc(label)} &nbsp;&rarr;</a>`
    + `</td></tr></table>`;
  // La leyenda es lo que hace honesto mandarle esto a alguien que TODAVÍA no
  // tiene la app — un prospecto. Sin ella, "Abrir la app" es una promesa falsa.
  const note = c.dest && c.dest !== 'web' && cfg.ctaNote !== false
    ? `<div style="font-family:${FAM.body};font-size:${tk.t.small}px;line-height:1.5;color:${tk.mute}">${esc(cfg.strings?.ctaNote || (lang === 'en'
      ? 'Opens the app if you have it — otherwise the web version, with the download.'
      : 'Abre la app si la tienes; si no, la versión web con la descarga.'))}</div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:${Math.round(P * 0.95)}px ${P}px 0">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">`
    + `<tr><td align="center" style="padding:0">${btn}</td></tr>`
    + (note ? `<tr><td align="center" style="padding:13px 0 0">${note}</td></tr>` : '')
    + `</table></td></tr></table>`;
}

// ── Pie ──────────────────────────────────────────────────────────────
function renderFooter(cfg, tk) {
  if (!cfg.footer?.on) return '';
  const P = tk.pad, f = cfg.footer;
  const link = `color:${tk.sub};text-decoration:underline`;
  const unsubUrl = safeUrl(f.unsubUrl);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td align="center" style="padding:${Math.round(P * 1.1)}px ${P}px ${Math.round(P * 1.05)}px">`
    + rule(tk, '100%') + gap(Math.round(P * 0.75))
    + (cfg.header?.showLogo ? center(logoTag(cfg, tk, 'plain', 22)) + gap(11) : '')
    + wordmark(cfg, tk, Math.round(13 * tk.k), tk.sub)
    + (f.address ? gap(8) + `<div style="font-family:${FAM.body};font-size:${tk.t.small - 1}px;line-height:1.6;letter-spacing:0.02em;color:${tk.mute}">${esc(f.address)}</div>` : '')
    // La baja se OMITE si no hay URL real, en vez de pintar un href="#". Un
    // enlace de baja muerto es peor que ninguno: es el que genera la queja.
    + (unsubUrl && f.unsub ? gap(14) + `<div style="font-family:${FAM.body};font-size:${tk.t.small - 1}px;line-height:1.7;color:${tk.mute}"><a href="${esc(unsubUrl)}" style="${link}">${esc(f.unsub)}</a></div>` : '')
    + gap(13)
    + `<div style="font-family:${FAM.mono};font-size:${tk.t.small - 2}px;letter-spacing:0.06em;color:${tk.mute};opacity:0.85">${esc(f.text || '')}</div>`
    + `</td></tr></table>`;
}

// ── Montaje ──────────────────────────────────────────────────────────
export const BLOCK_ORDER = ['header', 'hero', 'body', 'reward', 'cta', 'footer'];
const RENDERERS = { header: renderHeader, hero: renderHero, body: renderBody, reward: renderReward, cta: renderCta, footer: renderFooter };

/** Solo el cuerpo del correo (sin <html>). Lo usa la vista previa escalada. */
export function buildEmail(cfg) {
  const tk = tokens(cfg);
  const rows = (cfg.order || BLOCK_ORDER).map((id) => {
    const html = RENDERERS[id] ? RENDERERS[id](cfg, tk) : '';
    return html ? `<tr data-block="${id}"><td style="padding:0">${html}</td></tr>` : '';
  }).filter(Boolean).join('');
  const outer = tk.mob ? 0 : Math.round(tk.pad * 0.7);
  return `<div style="background:${tk.wrapBg}">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tk.wrapBg}" style="border-collapse:collapse;background:${tk.wrapBg}">`
    + `<tr><td align="center" style="padding:${outer}px ${outer ? 16 : 0}px">`
    + `<table role="presentation" width="${tk.W}" cellpadding="0" cellspacing="0" border="0" align="center" class="eb-w" style="width:${tk.W}px;border-collapse:separate;margin:0 auto;background:${tk.paper};border-radius:${tk.radius}px;overflow:hidden;border:1px solid ${tk.onDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,20,25,0.07)'}">${rows}</table>`
    + `</td></tr></table></div>`;
}

/** El documento completo que se envía. */
export function emailDoc(cfg) {
  const tk = tokens({ ...cfg, device: 'desktop' });
  return `<!doctype html><html lang="${cfg.lang === 'en' ? 'en' : 'es'}"><head><meta charset="utf-8"/>`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"/>`
    + `<meta name="x-apple-disable-message-reformatting"/>`
    + `<meta name="color-scheme" content="light dark"/><meta name="supported-color-schemes" content="light dark"/>`
    + `<title>${esc(cfg.subject || cfg.brand?.name || '')}</title>`
    + `<!--[if mso]><style>body,table,td,h1,div,a{font-family:Georgia,'Times New Roman',serif!important}</style><![endif]-->`
    + `<style>body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}`
    + `img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}`
    + `table{border-collapse:collapse!important}a{text-decoration:none}`
    + `@media only screen and (max-width:620px){.eb-w{width:100%!important;border-radius:0!important}`
    + `h1{font-size:34px!important;line-height:1.06!important}}</style>`
    + `</head><body style="margin:0;padding:0;background:${tk.wrapBg}">`
    // Preheader: la línea que se lee en la bandeja junto al asunto. Sin ella
    // el cliente enseña el primer texto que encuentre, que suele ser el logo.
    // Con fillTokens: el preheader es lo que se lee en la BANDEJA, junto al
    // asunto. Sin rellenarlo, el miembro veía «Llevas {{days_inactive}} días…»
    // antes siquiera de abrir el correo — y ahí no hay forma de recuperarse.
    + `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(fillTokens(cfg.preheader || cfg.hero?.subtitle || '', cfg))}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    + buildEmail({ ...cfg, device: 'desktop' })
    + `</body></html>`;
}
