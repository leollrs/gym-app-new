/**
 * Designer email templates — the polished "Email System" handoff brought to
 * life as real, send-safe HTML.
 *
 * These are 13+ fixed editorial layouts (magazine recaps, certificates,
 * boarding-pass class reminders, coach-chat winbacks). They are NOT block-
 * editable. The gym picks one; we inject its name, logo, an on-brand palette
 * derived from its colors, and merge tokens; then it ships through Outreach.
 *
 * Three things make these "real":
 *   1. PALETTE — the warm editorial structure (cream/ink neutrals, Archivo /
 *      Newsreader / JetBrains Mono) is fixed, but the *accents* (the teal /
 *      orange / soft-tint families) are re-derived from the gym's primary +
 *      secondary brand colors, contrast-checked so text stays legible.
 *   2. PERSONALIZATION — member-specific copy uses merge tokens
 *      ({{first_name}}, {{streak_count}}, {{workout_count}}, {{days_inactive}}).
 *      In preview they show sample numbers; at send time the Outreach pipeline
 *      fills them per recipient. Coach + gym names are render-time constants.
 *   3. EMAIL-CLIENT SAFETY — inline styles, a centering table, MSO ghost-table
 *      wrappers + Arial fallbacks so Outlook desktop degrades to a clean
 *      single-column version instead of breaking.
 *
 * `renderDesignerEmail(id, ctx)` returns `{ subject, preview, html }`.
 */

// ── Color math (pure, no DOM — runs in node tests too) ─────────────
import { appDeepLink } from '../appUrls';

const _clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex({ r, g, b }) {
  const t = (v) => _clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + t(r) + t(g) + t(b);
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}
const lighten = (hex, amt) => mix(hex, '#ffffff', amt);
const darken = (hex, amt) => mix(hex, '#000000', amt);

function relLum(hex) {
  const { r, g, b } = hexToRgb(hex);
  const ch = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
// Pick a legible fg. Prefer white when it clears the 3:1 large-text ratio,
// otherwise near-black. This happens to reproduce the original design's choices
// (ink text on teal, white on orange, ink on gold) while adapting to any brand.
function onColor(hex) {
  return (1.05) / (relLum(hex) + 0.05) >= 3.0 ? '#ffffff' : '#0B0F12';
}

function hexToHsl(hex) {
  let { r, g, b } = hexToRgb(hex); r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}
function hslToHex({ h, s, l }) {
  h = (h % 360) / 360; let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
  }
  return rgbToHex({ r: r * 255, g: g * 255, b: b * 255 });
}
// A solid hero/background color the accent can take while keeping white text
// readable: cap lightness, floor saturation.
function bgVariant(hex) { const c = hexToHsl(hex); c.l = Math.min(c.l, 0.5); c.s = Math.max(c.s, 0.55); return hslToHex(c); }
// Light tint of the accent for soft callout panels.
function softVariant(hex) { return mix(hex, '#fbfaf6', 0.84); }
// A dark, slightly-desaturated ink version of the accent for text on its tint.
function inkVariant(hex) { const c = hexToHsl(hex); c.l = Math.min(c.l, 0.26); c.s = _clamp(c.s, 0.3, 0.85); return hslToHex(c); }
// Keep an accent visible against cream when used as a small solid fill.
function visibleAccent(hex) { const c = hexToHsl(hex); c.l = Math.min(c.l, 0.66); return hslToHex(c); }

// ── Brand tokens ───────────────────────────────────────────────────
// Neutrals + type stay fixed (the editorial base). Accent families get
// overridden per-gym by buildPalette().
const BASE_E = {
  cream: '#f0eee9', creamElev: '#faf8f3', paper: '#ffffff',
  ink: '#0B0F12', ink2: '#1f2630', sub: '#5A6570', mute: '#96A0AA',
  faint: '#cdd3da', line: '#e8e4db',
  lineSoft: 'rgba(15,20,25,0.07)', lineStrong: 'rgba(15,20,25,0.16)',
  teal: '#19B8B8', tealDk: '#0F9E9E', tealSoft: '#D9F1F1', tealInk: '#08585A',
  hot: '#FF5A2E', hotDk: '#E64614', hotSoft: '#FFE3D6', hotInk: '#7A2A0F',
  gold: '#E8C547', goldSoft: '#F9F0CC', goldInk: '#5C4710',
  coach: '#6D5FDB', good: '#2FA66B', dark: '#0E1316', dark2: '#161C20',
  onTeal: onColor('#19B8B8'), onHot: onColor('#FF5A2E'), onGold: onColor('#E8C547'),
};

// Build a gym-adapted palette from primary (+ optional secondary). Neutrals are
// preserved; the teal* family maps to the primary, the hot* family to the
// secondary (or a safe fallback), and gold stays as the achievement accent.
function buildPalette(primary, secondary) {
  if (!primary) return BASE_E;
  const p = primary;
  const s = secondary || BASE_E.hot;
  const teal = visibleAccent(p);
  const hot = bgVariant(s);
  return {
    ...BASE_E,
    teal, tealDk: darken(teal, 0.16), tealSoft: softVariant(p), tealInk: inkVariant(p),
    hot, hotDk: darken(hot, 0.14), hotSoft: softVariant(s), hotInk: inkVariant(s),
    onTeal: onColor(teal), onHot: onColor(hot), onGold: onColor(BASE_E.gold),
  };
}

// Active palette. Reassigned (synchronously) per render by renderDesignerEmail,
// read by every component/template below at call time, then restored.
let E = BASE_E;

const F = {
  display: '"Archivo", system-ui, sans-serif',
  serif: '"Newsreader", "Times New Roman", serif',
  body: '"Archivo", -apple-system, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

const FONTS_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600;700;800;900&family=Newsreader:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>';

// ── Tiny hyperscript → HTML string ─────────────────────────────────
const UNITLESS = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice',
  'borderImageWidth', 'columnCount', 'columns', 'flex', 'flexGrow', 'flexShrink',
  'order', 'orphans', 'tabSize', 'widows', 'zIndex', 'zoom', 'fillOpacity',
  'floodOpacity', 'stopOpacity', 'strokeOpacity', 'strokeWidth', 'fontWeight',
  'lineHeight', 'opacity', 'gridRow', 'gridColumn',
]);
const VOID = new Set(['img', 'br', 'hr', 'meta', 'link', 'input']);

const kebab = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

function cssString(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v}`)
    .join(';');
}

export function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderChildren(children) {
  if (children == null || children === false) return '';
  if (Array.isArray(children)) return children.map(renderChildren).join('');
  return String(children);
}

function h(tag, props, children) {
  let attrs = '';
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'style') { attrs += ` style='${cssString(v)}'`; continue; }
      if (v === true) { attrs += ` ${k}`; continue; }
      attrs += ` ${k}='${v}'`;
    }
  }
  if (VOID.has(tag)) return `<${tag}${attrs}/>`;
  return `<${tag}${attrs}>${renderChildren(children)}</${tag}>`;
}

// ── Table-based layout helpers (email-client safe alternatives to flex) ──
// tRow: builds a single-row presentation table. Each cell is { children, width?, align?, valign?, style? }.
// opts: { style?, tableStyle?, width?, gap? } — gap inserts thin spacer cells between content cells.
function tRow(cells, opts = {}) {
  const { tableStyle = {}, width, gap } = opts;
  const baseTable = { borderCollapse: 'collapse', ...tableStyle };
  const tableAttrs = {
    role: 'presentation',
    cellpadding: '0',
    cellspacing: '0',
    border: '0',
    style: baseTable,
  };
  if (width != null) tableAttrs.width = String(width);
  const cellHtml = [];
  cells.forEach((c, i) => {
    if (!c) return;
    if (gap && i > 0) {
      cellHtml.push(h('td', { width: String(gap), style: { width: gap, fontSize: 0, lineHeight: 0 } }, ' '));
    }
    const tdAttrs = { style: { verticalAlign: c.valign || 'middle', ...(c.style || {}) } };
    if (c.width != null) { tdAttrs.width = String(c.width); tdAttrs.style.width = c.width; }
    if (c.align) tdAttrs.align = c.align;
    if (c.valign) tdAttrs.valign = c.valign;
    if (c.colspan) tdAttrs.colspan = String(c.colspan);
    cellHtml.push(h('td', tdAttrs, c.children));
  });
  return h('table', tableAttrs, h('tr', null, cellHtml));
}

// tGrid: stack of rows for a 2D grid. rows is array of arrays of cells (same shape as tRow cells).
function tGrid(rows, opts = {}) {
  const { tableStyle = {}, width } = opts;
  const baseTable = { borderCollapse: 'collapse', ...tableStyle };
  const tableAttrs = {
    role: 'presentation',
    cellpadding: '0',
    cellspacing: '0',
    border: '0',
    style: baseTable,
  };
  if (width != null) tableAttrs.width = String(width);
  const trs = rows.map((row) => h('tr', null, row.map((c) => {
    if (!c) return '';
    const tdAttrs = { style: { verticalAlign: c.valign || 'middle', ...(c.style || {}) } };
    if (c.width != null) { tdAttrs.width = String(c.width); tdAttrs.style.width = c.width; }
    if (c.align) tdAttrs.align = c.align;
    if (c.valign) tdAttrs.valign = c.valign;
    if (c.colspan) tdAttrs.colspan = String(c.colspan);
    return h('td', tdAttrs, c.children);
  })));
  return h('table', tableAttrs, trs);
}

// ── Icons ──────────────────────────────────────────────────────────
const EI = {
  flame: '<path d="M8.5 14.5A4.5 4.5 0 0 0 12 22a5 5 0 0 0 5-5c0-1.14-.76-2.35-1.76-3.32M12 13a2 2 0 1 1-4 0c0-1 1-2 2-4 1-2 4-3 5-6 0 3 2 4 2 7 0 2-1 3-2 4"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trophy: '<path d="M6 9H4a2 2 0 0 1-2-2V5h4M18 9h2a2 2 0 0 0 2-2V5h-4M6 3h12v6a6 6 0 0 1-12 0V3z"/><path d="M8 21h8M12 17v4"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

function eIco(inner, { size = 16, stroke = 1.8, color = 'currentColor', fill = 'none', style = {} } = {}) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill,
    stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    style: { verticalAlign: 'middle', ...style },
  }, inner);
}

// ── Shared brand components ────────────────────────────────────────
function eLogo({ size = 36, dark = true, gymName = 'Gym', logoUrl = '' }) {
  if (logoUrl) {
    return h('img', {
      src: escHtml(logoUrl), alt: escHtml(gymName),
      style: { height: size, width: 'auto', maxWidth: size * 3, display: 'inline-block', verticalAlign: 'middle', borderRadius: size * 0.18 },
    });
  }
  const initial = escHtml((gymName || 'G').trim().charAt(0).toUpperCase() || 'G');
  const inner = h('table', {
    role: 'presentation', cellpadding: '0', cellspacing: '0', border: '0', width: String(size),
    style: { width: size, height: size, borderCollapse: 'collapse' },
  }, h('tr', null, h('td', {
    align: 'center', valign: 'middle',
    style: { width: size, height: size, textAlign: 'center', verticalAlign: 'middle' },
  }, h('div', {
    style: {
      width: size * 0.6, height: size * 0.6, borderRadius: '50%',
      border: `${Math.max(1.5, size * 0.07)}px solid ${E.gold}`,
      color: E.gold, fontFamily: F.display, fontWeight: 900,
      fontSize: size * 0.34, letterSpacing: -0.5, lineHeight: `${size * 0.6 - Math.max(3, size * 0.14)}px`,
      textAlign: 'center', display: 'inline-block',
    },
  }, initial))));
  return h('div', {
    style: {
      width: size, height: size, borderRadius: size * 0.22,
      background: dark ? 'radial-gradient(circle at 35% 30%, #2a2d32 0%, #0a0c0f 100%)' : E.paper,
      verticalAlign: 'middle', display: 'inline-block',
      border: dark ? '1px solid #1a1d22' : `1px solid ${E.line}`,
    },
  }, inner);
}

function eWordmark({ size = 14, color = E.ink, weight = 800, gymName = 'Gym' }) {
  return h('span', {
    style: { fontFamily: F.display, fontSize: size, fontWeight: weight, letterSpacing: -0.4, color, lineHeight: 1 },
  }, escHtml(gymName));
}

function eBtn({ children, tone = 'teal', size = 'lg', wide = false, icon = null, href = appDeepLink('home') }) {
  // Accent tones compute their fg from the (possibly gym-adapted) bg so text
  // stays legible whatever the brand color is. Neutral tones are explicit.
  const tones = {
    teal: { bg: E.teal, fg: onColor(E.teal), bd: E.teal },
    tealDk: { bg: E.tealDk, fg: onColor(E.tealDk), bd: E.tealDk },
    dark: { bg: E.ink, fg: E.cream, bd: E.ink },
    hot: { bg: E.hot, fg: onColor(E.hot), bd: E.hot },
    cream: { bg: E.cream, fg: E.ink, bd: E.line },
    paper: { bg: E.paper, fg: E.ink, bd: E.line },
    gold: { bg: E.gold, fg: onColor(E.gold), bd: E.gold },
    ghost: { bg: 'transparent', fg: E.ink, bd: E.lineStrong },
    ghostInv: { bg: 'transparent', fg: '#fff', bd: 'rgba(255,255,255,0.3)' },
  };
  const c = tones[tone] || tones.teal;
  const sizes = {
    sm: { padding: '10px 18px', fontSize: 13 },
    md: { padding: '13px 22px', fontSize: 14 },
    lg: { padding: '16px 28px', fontSize: 15 },
  };
  const labelStyle = { display: 'inline-block', verticalAlign: 'middle' };
  const inner = icon
    ? [
        h('span', { style: labelStyle }, children),
        h('span', { style: { display: 'inline-block', width: 8, fontSize: 0, lineHeight: 0 } }, ' '),
        h('span', { style: { display: 'inline-block', verticalAlign: 'middle' } }, eIco(icon, { size: 16, stroke: 2.4, color: c.fg })),
      ]
    : h('span', { style: labelStyle }, children);
  if (wide) {
    return tRow([{
      align: 'center', valign: 'middle',
      style: {
        background: c.bg, borderRadius: 999, border: `1.5px solid ${c.bd}`,
        textAlign: 'center',
      },
      children: h('a', {
        href: escHtml(href),
        style: {
          color: c.fg, fontFamily: F.display, fontWeight: 700, letterSpacing: -0.2,
          textDecoration: 'none', textAlign: 'center',
          display: 'block', ...sizes[size],
        },
      }, inner),
    }], { width: '100%', tableStyle: { width: '100%' } });
  }
  return h('a', {
    href: escHtml(href),
    style: {
      display: 'inline-block', textAlign: 'center',
      borderRadius: 999, background: c.bg, color: c.fg, border: `1.5px solid ${c.bd}`,
      fontFamily: F.display, fontWeight: 700, letterSpacing: -0.2, textDecoration: 'none',
      ...sizes[size],
    },
  }, inner);
}

function ePill({ children, tone = 'neutral', extra = {} }) {
  const tones = {
    neutral: { bg: 'rgba(15,20,25,0.06)', fg: E.sub },
    teal: { bg: E.tealSoft, fg: E.tealInk },
    hot: { bg: E.hotSoft, fg: E.hotInk },
    gold: { bg: E.goldSoft, fg: E.goldInk },
    dark: { bg: E.ink, fg: '#fff' },
    invert: { bg: 'rgba(255,255,255,0.12)', fg: '#fff' },
    outline: { bg: 'transparent', fg: E.sub },
  };
  const c = tones[tone] || tones.neutral;
  return h('span', {
    style: {
      display: 'inline-block', verticalAlign: 'middle', padding: '4px 10px', borderRadius: 999,
      background: c.bg, color: c.fg, fontFamily: F.display, fontWeight: 700, fontSize: 10.5,
      letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 1.4,
      ...(c.bg === 'transparent' ? { border: `1px solid ${E.line}` } : {}),
      ...extra,
    },
  }, children);
}

function ePhoto({ w = '100%', height = 220, label = 'photo', tone = 'warm', radius = 0 }) {
  const tones = {
    warm: ['#e8d9c2', '#d3bda1'], cool: ['#cfd9d6', '#a8b8b3'],
    night: ['#262d34', '#0f1418'], teal: ['#bde6e2', '#8acac4'],
  };
  const [a, b] = tones[tone] || tones.warm;
  const dark = tone === 'night';
  return h('table', {
    role: 'presentation', cellpadding: '0', cellspacing: '0', border: '0', width: typeof w === 'string' ? w : String(w),
    style: {
      width: w, borderCollapse: 'collapse', borderRadius: radius, overflow: 'hidden',
      background: `repeating-linear-gradient(135deg, ${a} 0 14px, ${b} 14px 28px)`,
    },
  }, h('tr', null, h('td', {
    align: 'center', valign: 'middle', height: String(height),
    style: { height, textAlign: 'center', verticalAlign: 'middle', color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(15,20,25,0.55)' },
  }, h('span', {
    style: {
      display: 'inline-block', fontFamily: F.mono, fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
      padding: '5px 10px', borderRadius: 4, background: dark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.75)',
    },
  }, escHtml(label)))));
}

function eFooter({ gymName = 'Gym', logoUrl = '', lang = 'es' }) {
  const es = lang === 'es';
  const yr = new Date().getFullYear();
  const links = es ? ['Cancelar suscripción', 'Preferencias', 'Política'] : ['Unsubscribe', 'Preferences', 'Policy'];
  const logoRow = tRow([
    { children: eLogo({ size: 18, gymName, logoUrl }), valign: 'middle', style: { paddingRight: 8 } },
    { children: eWordmark({ size: 12, color: E.sub, weight: 700, gymName }), valign: 'middle' },
  ]);
  const linkRow = links.map((l, i) => [
    i > 0 ? h('span', { style: { display: 'inline-block', width: 14, fontSize: 0, lineHeight: 0 } }, ' ') : '',
    h('a', { href: '#', style: { color: E.sub, textDecoration: 'underline', textUnderlineOffset: 2, display: 'inline-block' } }, escHtml(l)),
  ]).flat();
  return h('div', {
    style: {
      background: E.cream, padding: '24px 36px 32px', borderTop: `1px solid ${E.line}`,
      fontFamily: F.body, fontSize: 11.5, color: E.mute, lineHeight: 1.6, textAlign: 'center',
    },
  }, [
    tRow([{ align: 'center', valign: 'middle', children: logoRow, style: { textAlign: 'center', paddingBottom: 10 } }], { width: '100%', tableStyle: { width: '100%' } }),
    h('div', { style: { marginTop: 8, textAlign: 'center' } }, linkRow),
    h('div', { style: { marginTop: 14, fontSize: 10, letterSpacing: 0.5, opacity: 0.7 } }, `© ${yr} ${escHtml(gymName)}`),
  ]);
}

// ── Document wrapper (with Outlook/MSO bulletproofing) ─────────────
function emailDoc({ preview, bodyBg = E.paper, content, gymName, logoUrl, lang }) {
  const preheader = preview
    ? h('div', { style: { display: 'none', maxHeight: 0, overflow: 'hidden', opacity: 0, color: 'transparent' } }, escHtml(preview))
    : '';
  const card =
    h('table', { role: 'presentation', width: '640', cellpadding: '0', cellspacing: '0', border: '0', align: 'center', style: { maxWidth: 640, width: '100%', background: bodyBg, borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 18px 48px rgba(0,0,0,0.08)' } },
      h('tr', null, h('td', { style: { padding: 0 } }, [
        h('div', { style: { background: bodyBg } }, content),
        eFooter({ gymName, logoUrl, lang }),
      ])));
  return [
    '<!doctype html>',
    `<html lang="${lang === 'es' ? 'es' : 'en'}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<meta name="color-scheme" content="light"/>',
    '<meta name="supported-color-schemes" content="light"/>',
    // Tell Outlook to render at 96dpi and use its own table metrics.
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->',
    FONTS_LINK,
    `<style>body{margin:0;padding:0;background:${E.cream};}*{box-sizing:border-box;}a{color:inherit;}img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}table,td{mso-table-lspace:0;mso-table-rspace:0;}@keyframes epulse{0%,100%{opacity:1}50%{opacity:0.3}}@media only screen and (max-width:640px){.dz-pad{padding-left:22px!important;padding-right:22px!important;}}</style>`,
    // Outlook can't load web fonts — force a clean sans fallback there.
    '<!--[if mso]><style>*{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->',
    '</head>',
    `<body style='margin:0;padding:0;background:${E.cream};font-family:${F.body};color:${E.ink};'>`,
    preheader,
    `<center style='width:100%;background:${E.cream};'>`,
    h('table', { role: 'presentation', width: '100%', cellpadding: '0', cellspacing: '0', border: '0', style: { background: E.cream } },
      h('tr', null, h('td', { align: 'center', style: { padding: '24px 12px' } }, [
        '<!--[if mso]><table role="presentation" align="center" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
        card,
        '<!--[if mso]></td></tr></table><![endif]-->',
      ]))),
    '</center>',
    '</body></html>',
  ].join('');
}

// ── i18n + vars helpers ────────────────────────────────────────────
const tx = (lang, es, en) => (lang === 'es' ? es : en);

// Sample values shown in previews. At send time the Outreach pipeline replaces
// the literal tokens (see renderDesignerEmail send-mode) per recipient.
const VAR_DEFAULTS = { streak_count: '14', workout_count: '187', days_inactive: '23' };

// ═══════════════════════════════════════════════════════════════════
//  WELCOME
// ═══════════════════════════════════════════════════════════════════

function welcomeEditorial({ lang, name, gymName, logoUrl, coachName }) {
  const subject = tx(lang, `Bienvenido a ${gymName}, ${name}`, `Welcome to ${gymName}, ${name}`);
  const preview = tx(lang, 'Tu primera semana está armada. Esto es lo que viene.', 'Your first week is set. Here’s what’s coming.');
  const rows = lang === 'es'
    ? [
        { n: '01', t: 'Tu plan de la semana', d: '4 sesiones armadas alrededor de tu disponibilidad.' },
        { n: '02', t: 'Tu entrenador asignado', d: `${coachName} te escribe mañana a las 9am.` },
        { n: '03', t: 'Acceso al gym', d: 'Tu QR ya está activo. Camina y entra.' },
      ]
    : [
        { n: '01', t: 'Your plan for the week', d: '4 sessions built around your availability.' },
        { n: '02', t: 'Your assigned coach', d: `${coachName} will message you tomorrow at 9am.` },
        { n: '03', t: 'Gym access', d: 'Your QR is already active. Just walk in.' },
      ];
  const headerLogo = tRow([
    { children: eLogo({ size: 32, gymName, logoUrl }), valign: 'middle', style: { paddingRight: 10 } },
    { children: eWordmark({ size: 15, gymName }), valign: 'middle' },
  ]);
  const content = h('div', { style: { background: E.cream } }, [
    h('div', { class: 'dz-pad', style: { padding: '28px 36px 18px', borderBottom: `1px solid ${E.line}` } },
      tRow([
        { children: headerLogo, valign: 'middle', align: 'left' },
        { children: h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.mute, letterSpacing: 1.2, textTransform: 'uppercase' } }, tx(lang, 'Vol. 01 · Núm. 01', 'Vol. 01 · No. 01')), valign: 'middle', align: 'right' },
      ], { width: '100%', tableStyle: { width: '100%' } })),
    h('div', { class: 'dz-pad', style: { padding: '40px 36px 24px' } }, [
      h('div', { style: { fontFamily: F.mono, fontSize: 11, color: E.hot, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 18 } }, tx(lang, '— Bienvenida', '— Welcome')),
      h('h1', { style: { fontFamily: F.serif, fontSize: 56, fontWeight: 400, color: E.ink, lineHeight: 0.98, letterSpacing: -1.5, margin: 0 } },
        tx(lang, ['Empezamos.', h('br'), h('em', { style: { fontStyle: 'italic', color: E.tealInk } }, 'Esto es tuyo.')],
                 ['We start now.', h('br'), h('em', { style: { fontStyle: 'italic', color: E.tealInk } }, 'This is yours.')])),
      h('p', { style: { marginTop: 22, fontSize: 16, lineHeight: 1.55, color: E.ink2, maxWidth: 480 } },
        tx(lang,
          `${name}, gracias por unirte. En ${gymName} no hay programas genéricos. Cada semana se ajusta a cómo te sentiste la anterior — eso ya lo tienes activado.`,
          `${name}, thanks for joining. At ${gymName} there are no generic programs. Every week adapts to how the last one felt — and that’s already turned on for you.`)),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '0 36px' } }, ePhoto({ height: 240, label: tx(lang, 'gym · hora dorada', 'gym · golden hour'), tone: 'warm', radius: 4 })),
    h('div', { class: 'dz-pad', style: { padding: '32px 36px 12px' } }, [
      h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, paddingBottom: 12, borderBottom: `1px solid ${E.line}` } }, tx(lang, 'Lo que ya está listo', 'What’s already set up')),
      ...rows.map((r, i) => tRow([
        { valign: 'top', width: 50, style: { width: 50, paddingRight: 18, paddingTop: 18, paddingBottom: 18, fontFamily: F.serif, fontSize: 22, color: E.hot, fontWeight: 400, fontStyle: 'italic' }, children: r.n },
        { valign: 'top', style: { padding: '18px 0' }, children: [
          h('div', { style: { fontFamily: F.display, fontSize: 16, fontWeight: 700, color: E.ink, marginBottom: 4 } }, escHtml(r.t)),
          h('div', { style: { fontSize: 13.5, color: E.sub, lineHeight: 1.5 } }, escHtml(r.d)),
        ] },
      ], { width: '100%', tableStyle: { width: '100%', borderBottom: i < 2 ? `1px solid ${E.line}` : 'none' } })),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '32px 36px 44px', textAlign: 'center' } }, [
      eBtn({ href: appDeepLink('workout'), tone: 'dark', size: 'lg', wide: true, icon: EI.arrow, children: tx(lang, 'Abrir mi plan', 'Open my plan') }),
      h('div', { style: { marginTop: 14, fontSize: 12, color: E.mute } }, tx(lang, `o responde este correo — ${coachName} lo lee todo`, `or reply to this email — ${coachName} reads them all`)),
    ]),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.cream, content, gymName, logoUrl, lang }) };
}

function welcomePoster({ lang, name, gymName, logoUrl, coachName }) {
  const subject = tx(lang, 'Bienvenido. Esto es fuerza local.', 'Welcome. This is your crew now.');
  const preview = tx(lang, `${name} — bienvenido. 47,283 levantando contigo.`, `${name} — welcome. 47,283 lifting alongside you.`);
  const days = lang === 'es'
    ? [['LUN', 'Empuje + Core', '45 min'], ['MIÉ', 'Tracción + Cardio Z2', '50 min'], ['VIE', 'Piernas (suave)', '40 min'], ['SÁB', 'Movilidad + Clase', '60 min']]
    : [['MON', 'Push + Core', '45 min'], ['WED', 'Pull + Cardio Z2', '50 min'], ['FRI', 'Legs (easy)', '40 min'], ['SAT', 'Mobility + Class', '60 min']];
  const stats = lang === 'es'
    ? [['47,284', 'Miembros'], ['12', 'Sedes'], ['24/7', 'Acceso']]
    : [['47,284', 'Members'], ['12', 'Locations'], ['24/7', 'Access']];
  const statsRow = tRow(stats.map((s) => ({
    valign: 'top', width: '33.33%', style: { width: '33.33%', paddingRight: 6, paddingLeft: 6 }, children: [
      h('div', { style: { fontFamily: F.display, fontSize: 26, fontWeight: 900, letterSpacing: -1, lineHeight: 1 } }, escHtml(s[0])),
      h('div', { style: { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.85, marginTop: 4 } }, escHtml(s[1])),
    ],
  })), { width: '100%', tableStyle: { width: '100%' } });
  const content = [
    h('div', { class: 'dz-pad', style: { background: E.hot, padding: '40px 32px 44px', color: '#fff' } }, [
      tRow([
        { children: eLogo({ size: 36, gymName, logoUrl }), valign: 'middle', align: 'left' },
        { children: ePill({ tone: 'invert', children: tx(lang, 'Miembro #47,284', 'Member #47,284') }), valign: 'middle', align: 'right' },
      ], { width: '100%', tableStyle: { width: '100%', marginBottom: 32 } }),
      h('div', { style: { marginTop: 32, fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.85, marginBottom: 14 } }, tx(lang, `BIENVENIDO, ${name.toUpperCase()}`, `WELCOME, ${name.toUpperCase()}`)),
      h('h1', { style: { fontFamily: F.display, fontSize: 72, fontWeight: 900, color: '#fff', lineHeight: 0.9, letterSpacing: -3.5, margin: 0, textTransform: 'uppercase' } },
        tx(lang, ['Fuerza', h('br'), 'local.'], ['Stronger', h('br'), 'together.'])),
      h('div', { style: { marginTop: 28, paddingTop: 22, borderTop: '1px solid rgba(255,255,255,0.25)' } }, statsRow),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '32px 32px 28px' } }, [
      h('p', { style: { fontSize: 16, lineHeight: 1.55, color: E.ink, margin: 0 } },
        tx(lang, ['No te enviamos planes copiados de internet. Tu entrenador ', h('strong', null, escHtml(coachName)), ' revisó tu cuestionario anoche y armó esto:'],
                 ['We don’t send plans copied off the internet. Your coach ', h('strong', null, escHtml(coachName)), ' reviewed your intake last night and built this:'])),
      h('div', { style: { marginTop: 22, border: `2px solid ${E.ink}`, borderRadius: 4, overflow: 'hidden' } }, [
        h('div', { style: { background: E.ink, color: E.gold, padding: '10px 16px', fontFamily: F.mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, 'Plan de arranque · 14 días', 'Starter plan · 14 days')),
        h('div', { style: { padding: 16 } },
          days.map((r, i) => tRow([
            { valign: 'middle', width: 46, style: { width: 46, paddingRight: 14, fontFamily: F.mono, fontSize: 11, fontWeight: 700, color: E.hot, letterSpacing: 0.5 }, children: r[0] },
            { valign: 'middle', style: { paddingRight: 14, fontFamily: F.display, fontSize: 14, fontWeight: 700, color: E.ink }, children: escHtml(r[1]) },
            { valign: 'middle', align: 'right', style: { fontFamily: F.mono, fontSize: 11, color: E.sub, textAlign: 'right' }, children: r[2] },
          ], { width: '100%', tableStyle: { width: '100%', borderBottom: i < 3 ? `1px dashed ${E.line}` : 'none', paddingBottom: 10, marginBottom: i < 3 ? 10 : 0 } }))),
      ]),
      h('div', { style: { marginTop: 28 } }, eBtn({ href: appDeepLink('workout'), tone: 'dark', wide: true, icon: EI.arrow, children: tx(lang, 'Ver mi plan completo', 'See my full plan') })),
      h('div', { style: { marginTop: 10 } }, eBtn({ href: appDeepLink('messages'), tone: 'ghost', size: 'md', wide: true, children: tx(lang, `Saludar a ${coachName}`, `Say hi to ${coachName}`) })),
    ]),
  ];
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

// ═══════════════════════════════════════════════════════════════════
//  WEEKLY RECAP
// ═══════════════════════════════════════════════════════════════════

function recapMagazine({ lang, name, gymName, logoUrl, coachName, v }) {
  const subject = tx(lang, 'Tu Semana · Edición 47', 'Your Week · Issue 47');
  const preview = tx(lang, '6/7 días en movimiento. PR en sentadilla. Racha viva.', '6/7 active days. Squat PR. Streak alive.');
  const days = [3, 4, 2, 5, 0, 3, 4];
  const labels = lang === 'es' ? ['L', 'M', 'M', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const stats = lang === 'es'
    ? [{ k: '4', l: 'Sesiones', d: '+1 vs semana pasada' }, { k: v.streak_count, l: 'Días de racha', d: 'mejor del mes' }, { k: '12,4k', l: 'Pasos / día', d: 'promedio' }, { k: '+5kg', l: 'En sentadilla', d: 'PR nuevo' }]
    : [{ k: '4', l: 'Sessions', d: '+1 vs last week' }, { k: v.streak_count, l: 'Streak days', d: 'best this month' }, { k: '12.4k', l: 'Steps / day', d: 'average' }, { k: '+5kg', l: 'On squat', d: 'new PR' }];
  const legendItem = (color, label) => h('span', { style: { display: 'inline-block', marginRight: 14, fontSize: 11, color: E.sub, fontFamily: F.mono } },
    [
      h('span', { style: { display: 'inline-block', width: 8, height: 8, background: color, borderRadius: 2, verticalAlign: 'middle', marginRight: 6 } }),
      h('span', { style: { verticalAlign: 'middle' } }, label),
    ]);
  const barsRow = tRow(days.map((d, i) => {
    const isRest = d === 0;
    return {
      valign: 'bottom', align: 'center',
      style: { width: `${100 / days.length}%`, paddingLeft: 4, paddingRight: 4, textAlign: 'center', verticalAlign: 'bottom' },
      children: [
        h('div', { style: { width: '100%', height: isRest ? 6 : 16 + d * 14, background: isRest ? E.line : (i === 3 ? E.hot : E.teal), borderRadius: 3 } }),
        h('div', { style: { marginTop: 8, fontFamily: F.mono, fontSize: 11, color: E.sub, fontWeight: 600 } }, labels[i]),
      ],
    };
  }), { width: '100%', tableStyle: { width: '100%' } });
  const statsGrid = tGrid([
    [
      { valign: 'top', width: '50%', style: { width: '50%', padding: '24px 32px', borderRight: `1px solid ${E.line}`, borderBottom: `1px solid ${E.line}` }, children: [
        h('div', { style: { fontFamily: F.display, fontSize: 42, fontWeight: 900, color: E.ink, letterSpacing: -2, lineHeight: 1 } }, escHtml(stats[0].k)),
        h('div', { style: { marginTop: 6, fontFamily: F.display, fontSize: 12, fontWeight: 700, color: E.ink, textTransform: 'uppercase', letterSpacing: 0.8 } }, escHtml(stats[0].l)),
        h('div', { style: { marginTop: 2, fontSize: 11.5, color: E.sub } }, escHtml(stats[0].d)),
      ] },
      { valign: 'top', width: '50%', style: { width: '50%', padding: '24px 32px', borderBottom: `1px solid ${E.line}` }, children: [
        h('div', { style: { fontFamily: F.display, fontSize: 42, fontWeight: 900, color: E.ink, letterSpacing: -2, lineHeight: 1 } }, escHtml(stats[1].k)),
        h('div', { style: { marginTop: 6, fontFamily: F.display, fontSize: 12, fontWeight: 700, color: E.ink, textTransform: 'uppercase', letterSpacing: 0.8 } }, escHtml(stats[1].l)),
        h('div', { style: { marginTop: 2, fontSize: 11.5, color: E.sub } }, escHtml(stats[1].d)),
      ] },
    ],
    [
      { valign: 'top', width: '50%', style: { width: '50%', padding: '24px 32px', borderRight: `1px solid ${E.line}` }, children: [
        h('div', { style: { fontFamily: F.display, fontSize: 42, fontWeight: 900, color: E.ink, letterSpacing: -2, lineHeight: 1 } }, escHtml(stats[2].k)),
        h('div', { style: { marginTop: 6, fontFamily: F.display, fontSize: 12, fontWeight: 700, color: E.ink, textTransform: 'uppercase', letterSpacing: 0.8 } }, escHtml(stats[2].l)),
        h('div', { style: { marginTop: 2, fontSize: 11.5, color: E.sub } }, escHtml(stats[2].d)),
      ] },
      { valign: 'top', width: '50%', style: { width: '50%', padding: '24px 32px' }, children: [
        h('div', { style: { fontFamily: F.display, fontSize: 42, fontWeight: 900, color: E.ink, letterSpacing: -2, lineHeight: 1 } }, escHtml(stats[3].k)),
        h('div', { style: { marginTop: 6, fontFamily: F.display, fontSize: 12, fontWeight: 700, color: E.ink, textTransform: 'uppercase', letterSpacing: 0.8 } }, escHtml(stats[3].l)),
        h('div', { style: { marginTop: 2, fontSize: 11.5, color: E.sub } }, escHtml(stats[3].d)),
      ] },
    ],
  ], { width: '100%', tableStyle: { width: '100%' } });
  const content = h('div', { style: { background: E.cream } }, [
    h('div', { class: 'dz-pad', style: { background: E.ink, color: E.cream, padding: '10px 32px', fontFamily: F.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' } },
      tRow([
        { align: 'left', valign: 'middle', children: tx(lang, 'Tu Semana', 'Your Week') },
        { align: 'center', valign: 'middle', style: { color: E.gold, textAlign: 'center' }, children: tx(lang, 'Edición 47', 'Issue 47') },
        { align: 'right', valign: 'middle', children: tx(lang, 'Mayo 19–25, 2026', 'May 19–25, 2026') },
      ], { width: '100%', tableStyle: { width: '100%' } })),
    h('div', { class: 'dz-pad', style: { padding: '32px 32px 24px', borderBottom: `1px solid ${E.line}` } }, [
      h('div', { style: { fontFamily: F.mono, fontSize: 11, color: E.sub, letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 16 } }, tx(lang, `— Resumen semanal · ${name}`, `— Weekly recap · ${name}`)),
      h('h1', { style: { fontFamily: F.serif, fontSize: 96, fontWeight: 400, color: E.ink, lineHeight: 0.88, letterSpacing: -4, margin: 0 } }, [
        h('span', { style: { color: E.hot } }, '6'),
        h('span', { style: { fontFamily: F.serif, fontStyle: 'italic', fontWeight: 300, color: E.sub } }, '/7'),
      ]),
      h('div', { style: { marginTop: 8, fontFamily: F.serif, fontSize: 22, fontStyle: 'italic', color: E.ink2, fontWeight: 300, letterSpacing: -0.5 } }, tx(lang, 'días que apareciste.', 'days you showed up.')),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '28px 32px 28px', borderBottom: `1px solid ${E.line}` } }, [
      h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.mute, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 } }, tx(lang, 'Tu semana en columnas', 'Your week in columns')),
      barsRow,
      h('div', { style: { marginTop: 14 } }, [
        legendItem(E.teal, tx(lang, 'movimiento', 'movement')),
        legendItem(E.hot, tx(lang, 'PR jueves', 'PR Thu')),
        legendItem(E.line, tx(lang, 'descanso', 'rest')),
      ]),
    ]),
    statsGrid,
    h('div', { class: 'dz-pad', style: { padding: '36px 32px 32px', borderTop: `1px solid ${E.line}` } }, [
      h('div', { style: { fontFamily: F.serif, fontSize: 60, color: E.hot, lineHeight: 0, marginBottom: -6, fontStyle: 'italic' } }, '“'),
      h('div', { style: { fontFamily: F.serif, fontSize: 24, fontWeight: 300, color: E.ink, lineHeight: 1.3, letterSpacing: -0.5, fontStyle: 'italic' } }, tx(lang, 'La consistencia se compone. Cada sesión que registras está construyendo algo.', 'Consistency compounds. Every session you log is building something.')),
      h('div', { style: { marginTop: 16, fontFamily: F.mono, fontSize: 10.5, color: E.sub, letterSpacing: 1.5, textTransform: 'uppercase' } }, tx(lang, `— ${coachName}, tu entrenador`, `— ${coachName}, your coach`)),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '8px 32px 40px' } }, eBtn({ href: appDeepLink('progress'), tone: 'dark', wide: true, icon: EI.arrow, children: tx(lang, 'Ver semana completa', 'See full week') })),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.cream, content, gymName, logoUrl, lang }) };
}

function recapReceipt({ lang, name, gymName, logoUrl, coachName, v }) {
  const subject = tx(lang, '// recap: semana 21', '// recap: week 21');
  const preview = tx(lang, '4 sesiones · 1 PR · racha intacta', '4 sessions · 1 PR · streak intact');
  const rows = lang === 'es'
    ? [['LUN 19', 'Empuje superior', '47 min', '4 ejer.', '+'], ['MAR 20', '— descanso —', '', '', ''], ['MIÉ 21', 'Tracción + core', '52 min', '5 ejer.', '+'], ['JUE 22', 'Piernas · PR', '63 min', '6 ejer.', '★'], ['VIE 23', '— descanso —', '', '', ''], ['SÁB 24', 'Movilidad', '28 min', '8 ejer.', '+'], ['DOM 25', 'Cardio Z2', '42 min', '1 ejer.', '+']]
    : [['MON 19', 'Upper push', '47 min', '4 exc.', '+'], ['TUE 20', '— rest —', '', '', ''], ['WED 21', 'Pull + core', '52 min', '5 exc.', '+'], ['THU 22', 'Legs · PR', '63 min', '6 exc.', '★'], ['FRI 23', '— rest —', '', '', ''], ['SAT 24', 'Mobility', '28 min', '8 exc.', '+'], ['SUN 25', 'Cardio Z2', '42 min', '1 exc.', '+']];
  const totals = lang === 'es'
    ? [['Sesiones', '4'], ['Tiempo total', '3h 12m'], ['Volumen total', '24 ejercicios'], ['PR nuevos', '1 · sentadilla +5kg'], ['Racha', `${v.streak_count} días ✓`]]
    : [['Sessions', '4'], ['Total time', '3h 12m'], ['Total volume', '24 exercises'], ['New PRs', '1 · squat +5kg'], ['Streak', `${v.streak_count} days ✓`]];
  const restWord = lang === 'es' ? 'descanso' : 'rest';
  const tableHeader = tRow([
    { width: 70, valign: 'middle', style: { width: 70, paddingBottom: 8, fontSize: 10, color: E.sub, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }, children: tx(lang, 'Día', 'Day') },
    { valign: 'middle', style: { paddingBottom: 8, fontSize: 10, color: E.sub, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }, children: tx(lang, 'Sesión', 'Session') },
    { width: 60, valign: 'middle', align: 'right', style: { width: 60, paddingBottom: 8, fontSize: 10, color: E.sub, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, textAlign: 'right' }, children: tx(lang, 'Tiempo', 'Time') },
    { width: 60, valign: 'middle', align: 'right', style: { width: 60, paddingBottom: 8, fontSize: 10, color: E.sub, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, textAlign: 'right' }, children: 'Vol' },
    { width: 20, valign: 'middle', style: { width: 20, paddingBottom: 8 }, children: ' ' },
  ], { width: '100%', tableStyle: { width: '100%' } });
  const tableRows = rows.map((r, i) => tRow([
    { width: 70, valign: 'middle', style: { width: 70, padding: '8px 0', fontSize: 12, fontWeight: 700, color: r[1].includes(restWord) ? E.mute : E.ink, borderTop: i > 0 ? `1px dotted ${E.line}` : 'none' }, children: r[0] },
    { valign: 'middle', style: { padding: '8px 0', fontSize: 12, color: r[1].includes(restWord) ? E.mute : E.ink, borderTop: i > 0 ? `1px dotted ${E.line}` : 'none' }, children: escHtml(r[1]) },
    { width: 60, valign: 'middle', align: 'right', style: { width: 60, padding: '8px 0', fontSize: 12, color: r[1].includes(restWord) ? E.mute : E.ink, textAlign: 'right', borderTop: i > 0 ? `1px dotted ${E.line}` : 'none' }, children: r[2] },
    { width: 60, valign: 'middle', align: 'right', style: { width: 60, padding: '8px 0', fontSize: 12, color: r[1].includes(restWord) ? E.mute : E.ink, textAlign: 'right', borderTop: i > 0 ? `1px dotted ${E.line}` : 'none' }, children: r[3] },
    { width: 20, valign: 'middle', align: 'center', style: { width: 20, padding: '8px 0', fontSize: 12, textAlign: 'center', color: r[4] === '★' ? E.hot : E.teal, fontWeight: 700, borderTop: i > 0 ? `1px dotted ${E.line}` : 'none' }, children: r[4] },
  ], { width: '100%', tableStyle: { width: '100%' } }));
  const totalsBlock = totals.map((r, i) => tRow([
    { valign: 'middle', align: 'left', style: { fontSize: 12, color: E.sub, padding: '5px 0', borderBottom: i < 4 ? `1px dotted ${E.line}` : 'none' }, children: escHtml(r[0]) },
    { valign: 'middle', align: 'right', style: { fontSize: 12, fontWeight: 700, color: E.ink, padding: '5px 0', textAlign: 'right', borderBottom: i < 4 ? `1px dotted ${E.line}` : 'none' }, children: escHtml(r[1]) },
  ], { width: '100%', tableStyle: { width: '100%' } }));
  const content = h('div', { class: 'dz-pad', style: { background: E.paper, padding: '40px 36px 36px', fontFamily: F.mono, color: E.ink } }, [
    tRow([
      { valign: 'top', align: 'left', children: [
        h('div', { style: { fontSize: 11, color: E.sub, letterSpacing: 1.5, textTransform: 'uppercase' } }, `${escHtml(gymName)} · Log`),
        h('div', { style: { fontFamily: F.display, fontSize: 28, fontWeight: 900, letterSpacing: -1, marginTop: 6 } }, tx(lang, 'Semana 21', 'Week 21')),
        h('div', { style: { fontSize: 11, color: E.sub, marginTop: 4 } }, tx(lang, '19 mayo — 25 mayo · 2026', 'May 19 — May 25 · 2026')),
      ] },
      { valign: 'top', align: 'right', children: eLogo({ size: 36, gymName, logoUrl }) },
    ], { width: '100%', tableStyle: { width: '100%', marginBottom: 28 } }),
    h('div', { style: { borderTop: `1px dashed ${E.lineStrong}`, marginBottom: 4 } }),
    h('div', { style: { borderTop: `1px dashed ${E.lineStrong}`, marginBottom: 16, paddingTop: 4 } }),
    h('div', { style: { fontSize: 12, color: E.ink, marginBottom: 16 } }, [
      h('span', { style: { color: E.sub } }, tx(lang, 'Cliente: ', 'Client: ')), escHtml(name.toUpperCase()), h('br'),
      h('span', { style: { color: E.sub } }, 'ID: '), 'TGP-047284', h('br'),
      h('span', { style: { color: E.sub } }, 'Coach: '), escHtml(coachName.toUpperCase()),
    ]),
    h('div', { style: { borderTop: `1px solid ${E.ink}`, borderBottom: `1px solid ${E.ink}`, padding: '12px 0', marginBottom: 16 } }, [
      tableHeader,
      ...tableRows,
    ]),
    h('div', null, totalsBlock),
    h('div', { style: { marginTop: 28, padding: '24px 0', borderTop: `1px solid ${E.ink}`, borderBottom: `1px solid ${E.ink}`, textAlign: 'center' } }, [
      h('div', { style: { fontSize: 10, color: E.sub, letterSpacing: 2, textTransform: 'uppercase' } }, tx(lang, 'Sesiones · YTD', 'Sessions · YTD')),
      h('div', { style: { fontFamily: F.display, fontSize: 72, fontWeight: 900, color: E.ink, letterSpacing: -3, lineHeight: 1, marginTop: 4 } }, escHtml(v.workout_count)),
      h('div', { style: { fontSize: 11, color: E.hot, marginTop: 6, fontWeight: 700 } }, '↑ 23% vs 2025'),
    ]),
    h('div', { style: { marginTop: 28, textAlign: 'center' } },
      h('div', { style: { display: 'inline-block', transform: 'rotate(-6deg)', border: `2.5px solid ${E.hot}`, color: E.hot, padding: '8px 18px', borderRadius: 4, fontFamily: F.display, fontWeight: 900, fontSize: 18, letterSpacing: 1, textTransform: 'uppercase' } }, tx(lang, 'Buena semana ✓', 'Good week ✓'))),
    h('div', { style: { marginTop: 32 } }, eBtn({ href: appDeepLink('log'), tone: 'ghost', wide: true, size: 'md', icon: EI.arrow, children: tx(lang, 'Ver log completo', 'See full log') })),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

function recapDark({ lang, name, gymName, logoUrl, coachName, v }) {
  const subject = tx(lang, '6 de 7. Buena semana.', '6 of 7. Good week.');
  const preview = tx(lang, 'Sentadilla +5kg. 14 días de racha. Esto es lo que pasó.', 'Squat +5kg. 14-day streak. Here’s what happened.');
  const metrics = lang === 'es'
    ? [{ k: '6/7', l: 'días activos', c: E.teal }, { k: '+5kg', l: 'PR sentadilla', c: E.gold }, { k: v.streak_count, l: 'días racha', c: E.hot }]
    : [{ k: '6/7', l: 'active days', c: E.teal }, { k: '+5kg', l: 'squat PR', c: E.gold }, { k: v.streak_count, l: 'streak days', c: E.hot }];
  const highlights = lang === 'es'
    ? [{ ico: EI.trophy, c: E.hot, t: 'Nuevo PR — Sentadilla', d: 'Jueves · 95kg × 5 reps · +5kg desde abril' }, { ico: EI.flame, c: E.gold, t: `${v.streak_count} días seguidos`, d: 'Tu mejor racha de 2026.' }, { ico: EI.heart, c: E.teal, t: 'Frecuencia cardíaca', d: 'Promedio en reposo: 58 bpm (↓3)' }]
    : [{ ico: EI.trophy, c: E.hot, t: 'New PR — Squat', d: 'Thursday · 95kg × 5 reps · +5kg since April' }, { ico: EI.flame, c: E.gold, t: `${v.streak_count} days in a row`, d: 'Your best streak of 2026.' }, { ico: EI.heart, c: E.teal, t: 'Heart rate', d: 'Resting average: 58 bpm (↓3)' }];
  const metricsRow = tRow(metrics.map((s, i) => ({
    valign: 'top', width: '33.33%',
    style: { width: '33.33%', borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none', paddingLeft: i > 0 ? 12 : 0, paddingRight: i < metrics.length - 1 ? 12 : 0 },
    children: [
      h('div', { style: { fontFamily: F.display, fontSize: 28, fontWeight: 900, color: s.c, letterSpacing: -1, lineHeight: 1 } }, escHtml(s.k)),
      h('div', { style: { fontSize: 10.5, color: 'rgba(245,242,236,0.65)', marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 } }, escHtml(s.l)),
    ],
  })), { width: '100%', tableStyle: { width: '100%' } });
  const highlightCards = highlights.map((hl) => h('div', { style: { padding: 14, background: E.creamElev, borderRadius: 12, border: `1px solid ${E.line}`, marginBottom: 10 } },
    tRow([
      { width: 40, valign: 'middle', align: 'center', style: { width: 40, paddingRight: 14 },
        children: h('div', { style: { width: 40, height: 40, borderRadius: 10, background: hl.c, textAlign: 'center', lineHeight: '40px', color: onColor(hl.c) } }, eIco(hl.ico, { size: 18, color: onColor(hl.c), stroke: 2.2 })),
      },
      { valign: 'middle', children: [
        h('div', { style: { fontFamily: F.display, fontSize: 14, fontWeight: 700, color: E.ink } }, escHtml(hl.t)),
        h('div', { style: { fontSize: 12, color: E.sub, marginTop: 2 } }, escHtml(hl.d)),
      ] },
    ], { width: '100%', tableStyle: { width: '100%' } })));
  const content = [
    h('div', { class: 'dz-pad', style: { background: E.dark, color: E.cream, padding: '36px 32px 32px' } }, [
      tRow([
        { valign: 'middle', align: 'left', children: eLogo({ size: 32, gymName, logoUrl }) },
        { valign: 'middle', align: 'right', style: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: 'rgba(245,242,236,0.5)' }, children: tx(lang, '19—25 MAY · 2026', 'MAY 19—25 · 2026') },
      ], { width: '100%', tableStyle: { width: '100%', marginBottom: 28 } }),
      h('div', { style: { fontFamily: F.display, fontSize: 11, color: E.teal, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 } }, tx(lang, 'Tu semana', 'Your week')),
      h('h1', { style: { fontFamily: F.display, fontSize: 64, fontWeight: 900, color: E.cream, lineHeight: 0.95, letterSpacing: -2.5, margin: 0 } },
        tx(lang, ['Buena', h('br'), h('span', { style: { color: E.teal } }, 'semana,'), ` ${name}.`],
                 ['Good', h('br'), h('span', { style: { color: E.teal } }, 'week,'), ` ${name}.`])),
      h('div', { style: { marginTop: 32, padding: 20, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' } }, metricsRow),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '32px 32px 36px' } }, [
      h('div', { style: { fontFamily: F.display, fontSize: 11, color: E.mute, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 16 } }, tx(lang, 'Lo destacado', 'Highlights')),
      h('div', { style: { marginBottom: 18 } }, highlightCards),
      h('div', { style: { padding: 20, borderRadius: 12, background: E.tealSoft, marginBottom: 24 } }, [
        h('div', { style: { fontFamily: F.display, fontSize: 11, color: E.tealInk, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 } }, tx(lang, 'Esta semana', 'This week')),
        h('div', { style: { fontFamily: F.display, fontSize: 18, fontWeight: 800, color: E.ink, letterSpacing: -0.5 } }, tx(lang, 'Bajamos volumen en piernas. Subimos empuje.', 'Lower leg volume. More push.')),
        h('div', { style: { fontSize: 13, color: E.tealInk, marginTop: 4, lineHeight: 1.5 } }, tx(lang, `${coachName} ajustó el plan basado en cómo te recuperaste.`, `${coachName} adjusted the plan based on how you recovered.`)),
      ]),
      eBtn({ tone: 'dark', wide: true, icon: EI.arrow, children: tx(lang, 'Ver dashboard', 'Open dashboard') }),
    ]),
  ];
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

// ═══════════════════════════════════════════════════════════════════
//  WINBACK
// ═══════════════════════════════════════════════════════════════════

function winbackQuiet({ lang, name, gymName, logoUrl, coachName, v }) {
  const subject = tx(lang, `Te echamos de menos, ${name}`, `We miss you, ${name}`);
  const preview = tx(lang, `Hace ${v.days_inactive} días que no nos vemos. ¿Todo bien?`, `It’s been ${v.days_inactive} days. Everything okay?`);
  const content = h('div', { class: 'dz-pad', style: { background: E.cream, padding: '60px 36px 32px' } }, [
    h('div', { style: { textAlign: 'center', marginBottom: 48 } }, eLogo({ size: 36, gymName, logoUrl })),
    h('div', { style: { textAlign: 'center' } }, [
      h('div', { style: { fontFamily: F.serif, fontSize: 140, fontWeight: 300, color: E.hot, lineHeight: 0.85, letterSpacing: -7, fontStyle: 'italic' } }, escHtml(v.days_inactive)),
      h('div', { style: { marginTop: 4, fontFamily: F.mono, fontSize: 11, color: E.sub, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, 'Días sin vernos', 'Days since we saw you')),
    ]),
    h('div', { style: { height: 1, background: E.line, margin: '40px auto', width: 60 } }),
    h('h1', { style: { fontFamily: F.serif, fontSize: 38, fontWeight: 400, color: E.ink, lineHeight: 1.05, letterSpacing: -1, margin: 0, textAlign: 'center' } }, tx(lang, '¿Todo bien?', 'Everything okay?')),
    h('p', { style: { marginTop: 24, fontSize: 15.5, lineHeight: 1.65, color: E.ink2, textAlign: 'center', maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' } },
      tx(lang, 'No es para meterte presión. A veces la vida se mete, y lo entendemos. Solo queríamos saber si quieres que ajustemos algo — el horario, el plan, la entrenadora.',
               'No pressure at all. Life gets in the way sometimes, and we get it. We just wanted to know if you’d like us to adjust something — the schedule, the plan, the coach.')),
    h('div', { style: { marginTop: 36 } }, eBtn({ href: appDeepLink('workout'), tone: 'dark', wide: true, icon: EI.arrow, children: tx(lang, 'Volver despacio', 'Ease back in') })),
    h('div', { style: { marginTop: 10 } }, eBtn({ href: appDeepLink('profile'), tone: 'ghost', size: 'md', wide: true, children: tx(lang, 'Pausar mi membresía', 'Pause my membership') })),
    h('div', { style: { marginTop: 48, textAlign: 'center' } }, [
      h('div', { style: { fontFamily: F.serif, fontSize: 22, fontStyle: 'italic', color: E.ink, fontWeight: 400 } }, `— ${escHtml(coachName)}`),
      h('div', { style: { marginTop: 4, fontSize: 11.5, color: E.sub, letterSpacing: 0.4 } }, tx(lang, 'Tu entrenador · responde este correo cuando puedas', 'Your coach · reply when you can')),
    ]),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.cream, content, gymName, logoUrl, lang }) };
}

function winbackData({ lang, name, gymName, logoUrl, coachName, v }) {
  const subject = tx(lang, `Lo que has dejado sobre la mesa, ${name}`, `What you’ve left on the table, ${name}`);
  const preview = tx(lang, 'Tu plan se sigue ajustando. Tus compañeros están al día. Vuelve.', 'Your plan keeps adapting. Your crew is on track. Come back.');
  const rows = lang === 'es'
    ? [{ n: '08', m: 'sesiones', d: 'perdidas según tu plan personalizado', tone: E.hot }, { n: '12', m: 'días', d: `rompió tu racha de ${v.streak_count} (la más larga del año)`, tone: E.ink }, { n: '6', m: 'PR nuevos', d: 'reportados por tus compañeros del gym', tone: E.teal }, { n: '1', m: 'plan', d: `reajustado por ${coachName} — más suave`, tone: E.gold }]
    : [{ n: '08', m: 'sessions', d: 'missed against your personalized plan', tone: E.hot }, { n: '12', m: 'days', d: `broke your ${v.streak_count}-day streak (your longest this year)`, tone: E.ink }, { n: '6', m: 'new PRs', d: 'logged by your gym crew', tone: E.teal }, { n: '1', m: 'plan', d: `reworked by ${coachName} — gentler`, tone: E.gold }];
  const content = [
    h('div', { class: 'dz-pad', style: { padding: '32px 32px 12px', borderBottom: `1px solid ${E.line}` } }, [
      tRow([
        { valign: 'middle', align: 'left', children: eLogo({ size: 32, gymName, logoUrl }) },
        { valign: 'middle', align: 'right', children: ePill({ tone: 'hot', children: tx(lang, `— ${v.days_inactive} días`, `— ${v.days_inactive} days`) }) },
      ], { width: '100%', tableStyle: { width: '100%', marginBottom: 24 } }),
      h('div', { style: { fontFamily: F.mono, fontSize: 11, color: E.hot, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 } }, tx(lang, 'Reporte de ausencia', 'Absence report')),
      h('h1', { style: { fontFamily: F.display, fontSize: 38, fontWeight: 900, color: E.ink, letterSpacing: -1.5, lineHeight: 1.05, margin: 0 } }, tx(lang, 'Mientras no estabas:', 'While you were away:')),
    ]),
    h('div', null, rows.map((r) => h('div', { class: 'dz-pad', style: { padding: '24px 32px', borderBottom: `1px solid ${E.line}` } },
      tRow([
        { width: 90, valign: 'middle', style: { width: 90, paddingRight: 20, fontFamily: F.display, fontSize: 56, fontWeight: 900, color: r.tone, letterSpacing: -2.5, lineHeight: 1 }, children: r.n },
        { valign: 'middle', children: [
          h('div', { style: { fontFamily: F.display, fontSize: 16, fontWeight: 800, color: E.ink, letterSpacing: -0.3 } }, escHtml(r.m)),
          h('div', { style: { fontSize: 13, color: E.sub, marginTop: 3, lineHeight: 1.5 } }, escHtml(r.d)),
        ] },
      ], { width: '100%', tableStyle: { width: '100%' } })))),
    h('div', { class: 'dz-pad', style: { padding: '28px 32px', background: E.creamElev } }, [
      h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.tealInk, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 } }, tx(lang, 'Lo bueno', 'The good news')),
      h('p', { style: { fontSize: 15, color: E.ink, lineHeight: 1.55, margin: 0 } },
        tx(lang, [`${coachName} revisó tu historial y armó un `, h('strong', null, 'plan de regreso de 14 días'), ' — volumen bajo, sin culpa. El primer entreno son 22 minutos.'],
                 [`${coachName} reviewed your history and built a `, h('strong', null, '14-day comeback plan'), ' — low volume, no guilt. The first workout is 22 minutes.'])),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '24px 32px 36px' } }, [
      eBtn({ href: appDeepLink('workout'), tone: 'hot', wide: true, icon: EI.arrow, children: tx(lang, 'Empezar el regreso · 22 min', 'Start the comeback · 22 min') }),
      h('div', { style: { marginTop: 10 } }, eBtn({ href: appDeepLink('messages'), tone: 'ghost', size: 'md', wide: true, children: tx(lang, 'Cambiar de entrenador', 'Switch coach') })),
    ]),
  ];
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

function winbackText({ lang, name, gymName, logoUrl, coachName }) {
  const subject = tx(lang, `${coachName} te escribió`, `${coachName} messaged you`);
  const preview = tx(lang, 'oye, ¿todo bien? te tenía esto guardado', 'hey, all good? I saved this for you');
  const initial = escHtml((coachName || 'C').trim().charAt(0).toUpperCase() || 'C');
  const bubble = (text) => h('div', { style: { marginBottom: 10 } }, tRow([
    { valign: 'top', width: '78%', style: { width: '78%' },
      children: h('div', { style: { background: E.creamElev, padding: '12px 16px', borderRadius: '18px 18px 18px 4px', fontSize: 14.5, color: E.ink, lineHeight: 1.45, border: `1px solid ${E.line}` } }, text),
    },
    { valign: 'top', width: '22%', style: { width: '22%' }, children: ' ' },
  ], { width: '100%', tableStyle: { width: '100%' } }));
  const msgs = lang === 'es'
    ? [`oye ${name} 👋 vi que no has venido en un tiempo`, 'no es regaño — solo chequeando si todo está bien', 'te dejé un plan suavecito de 22 min por si quieres arrancar mañana 👇']
    : [`hey ${name} 👋 noticed you haven’t been in for a bit`, 'not a lecture — just checking in on you', 'left you an easy 22-min plan in case you want to start tomorrow 👇'];
  const avatar = h('div', {
    style: { width: 52, height: 52, borderRadius: 999, background: `linear-gradient(135deg, ${lighten(E.teal, 0.35)}, ${E.teal})`, color: onColor(E.teal), fontFamily: F.display, fontWeight: 900, fontSize: 22, textAlign: 'center', lineHeight: '52px' },
  }, initial);
  const content = h('div', { class: 'dz-pad', style: { background: E.paper, padding: '28px 24px 8px' } }, [
    h('div', { style: { paddingBottom: 16, borderBottom: `1px solid ${E.line}` } }, tRow([
      { valign: 'middle', width: 52, style: { width: 52, paddingRight: 12 }, children: avatar },
      { valign: 'middle', children: [
        h('div', { style: { fontFamily: F.display, fontSize: 16, fontWeight: 800, color: E.ink, letterSpacing: -0.3 } }, escHtml(coachName)),
        h('div', { style: { fontSize: 12, color: E.sub } }, tx(lang, 'Tu entrenador · activo ahora', 'Your coach · active now')),
      ] },
      { valign: 'middle', width: 14, align: 'right', style: { width: 14, textAlign: 'right' },
        children: h('div', { style: { display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: E.good, boxShadow: `0 0 0 4px ${E.good}25` } }),
      },
    ], { width: '100%', tableStyle: { width: '100%' } })),
    h('div', { style: { padding: '24px 0 12px' } }, [
      h('div', { style: { fontSize: 10.5, color: E.mute, textAlign: 'center', letterSpacing: 0.4, marginBottom: 6 } }, tx(lang, 'Hoy · 9:42 am', 'Today · 9:42 am')),
      ...msgs.map((m) => bubble(escHtml(m))),
      h('div', { style: { marginBottom: 10 } }, tRow([
        { valign: 'top', width: '88%', style: { width: '88%' },
          children: h('div', { style: { background: E.ink, color: E.cream, padding: 16, borderRadius: '18px 18px 18px 4px' } }, [
            h('div', { style: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: E.gold, fontWeight: 700, marginBottom: 8 } }, tx(lang, 'Plan suave · regreso', 'Easy plan · comeback')),
            h('div', { style: { fontFamily: F.display, fontSize: 22, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.1 } }, tx(lang, 'Movimiento general', 'General movement')),
            h('div', { style: { marginTop: 10, fontSize: 13, color: 'rgba(245,242,236,0.75)', lineHeight: 1.5 } },
              tx(lang, ['22 min · 4 ejercicios · sin pesa máxima', h('br'), 'Mañana 6:30am · Sede Hato Rey'],
                       ['22 min · 4 exercises · no max lifts', h('br'), 'Tomorrow 6:30am · Hato Rey'])),
            h('div', { style: { marginTop: 14 } }, eBtn({ href: appDeepLink('records'), tone: 'gold', size: 'sm', children: tx(lang, 'Confirmar y verlo →', 'Confirm & view →') })),
          ]),
        },
        { valign: 'top', width: '12%', style: { width: '12%' }, children: ' ' },
      ], { width: '100%', tableStyle: { width: '100%' } })),
      bubble(escHtml(tx(lang, 'cualquier cosa me escribes ✌🏽', 'message me anytime ✌🏽'))),
    ]),
    h('div', { style: { marginTop: 16, marginBottom: 8, background: E.creamElev, borderRadius: 14, padding: '12px 16px', border: `1px solid ${E.line}` } },
      tRow([
        { width: 24, valign: 'middle', align: 'center', style: { width: 24, paddingRight: 10 }, children: eIco(EI.mail, { size: 16, color: E.mute, stroke: 2 }) },
        { valign: 'middle', style: { fontSize: 13, color: E.sub }, children: tx(lang, `Responde aquí — ${coachName} ve tus mensajes`, `Reply here — ${coachName} sees your messages`) },
      ], { width: '100%', tableStyle: { width: '100%' } })),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

// ═══════════════════════════════════════════════════════════════════
//  STREAK AT RISK
// ═══════════════════════════════════════════════════════════════════

function streakPoster({ lang, gymName, logoUrl, v }) {
  const subject = tx(lang, `🔥 Tu racha de ${v.streak_count} días termina en 4 horas`, `🔥 Your ${v.streak_count}-day streak ends in 4 hours`);
  const preview = tx(lang, 'Una sesión de 20 min mañana y la salvas.', 'A 20-min session tomorrow and you save it.');
  const opts = lang === 'es'
    ? [{ t: '18 min · Movilidad rápida', s: 'En casa · sin equipo', tag: 'Más rápido', tone: E.hot }, { t: '25 min · Empuje superior', s: 'Sede Hato Rey · check-in 5min', tag: 'Recomendado', tone: E.teal }, { t: '32 min · Cardio Z2', s: 'En casa · solo trotar', tag: null }]
    : [{ t: '18 min · Quick mobility', s: 'At home · no equipment', tag: 'Fastest', tone: E.hot }, { t: '25 min · Upper push', s: 'Hato Rey · 5-min check-in', tag: 'Recommended', tone: E.teal }, { t: '32 min · Cardio Z2', s: 'At home · just jog', tag: null }];
  const livePill = h('span', { style: { display: 'inline-block', padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,0.2)', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' } }, [
    h('span', { style: { display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: '#fff', verticalAlign: 'middle', marginRight: 8 } }),
    h('span', { style: { verticalAlign: 'middle' } }, tx(lang, 'En vivo · 4h restantes', 'Live · 4h left')),
  ]);
  const optionRows = opts.map((o) => h('div', { style: { padding: 14, background: E.paper, borderRadius: 12, border: `1px solid ${E.line}`, marginBottom: 8 } },
    tRow([
      { valign: 'middle', children: [
        h('div', null, [
          h('span', { style: { fontFamily: F.display, fontSize: 14, fontWeight: 800, color: E.ink, letterSpacing: -0.3, verticalAlign: 'middle' } }, escHtml(o.t)),
          o.tag ? h('span', { style: { display: 'inline-block', width: 8, fontSize: 0, lineHeight: 0 } }, ' ') : '',
          o.tag ? ePill({ tone: o.tone === E.hot ? 'hot' : 'teal', children: escHtml(o.tag), extra: { fontSize: 9 } }) : '',
        ]),
        h('div', { style: { fontSize: 12, color: E.sub, marginTop: 2 } }, escHtml(o.s)),
      ] },
      { valign: 'middle', align: 'right', width: 24, style: { width: 24, textAlign: 'right' }, children: eIco(EI.arrow, { size: 18, color: E.ink, stroke: 2.4 }) },
    ], { width: '100%', tableStyle: { width: '100%' } })));
  const content = [
    h('div', { class: 'dz-pad', style: { background: E.hot, color: '#fff', padding: '32px 28px 32px' } }, [
      tRow([
        { valign: 'middle', align: 'left', children: eLogo({ size: 32, gymName, logoUrl }) },
        { valign: 'middle', align: 'right', children: livePill },
      ], { width: '100%', tableStyle: { width: '100%', marginBottom: 36 } }),
      h('div', { style: { textAlign: 'left' } }, [
        h('div', { style: { fontFamily: F.display, fontSize: 13, fontWeight: 800, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 10 } }, tx(lang, 'Tu racha actual', 'Your current streak')),
        h('div', { style: { fontFamily: F.display, fontSize: 220, fontWeight: 900, color: '#fff', lineHeight: 0.82, letterSpacing: -12, margin: 0 } }, escHtml(v.streak_count)),
        h('div', { style: { marginTop: -4, fontFamily: F.display, fontSize: 38, fontWeight: 900, letterSpacing: -1, lineHeight: 1 } }, tx(lang, 'días seguidos.', 'days in a row.')),
      ]),
      h('div', { style: { marginTop: 36 } }, [
        tRow([
          { valign: 'middle', align: 'left', style: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }, children: tx(lang, 'medianoche', 'midnight') },
          { valign: 'middle', align: 'right', style: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, textAlign: 'right' }, children: '03:58:42' },
        ], { width: '100%', tableStyle: { width: '100%', marginBottom: 8 } }),
        h('div', { style: { height: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 999, overflow: 'hidden' } }, h('div', { style: { width: '17%', height: 6, background: '#fff' } })),
      ]),
    ]),
    h('div', { class: 'dz-pad', style: { background: E.cream, padding: '32px 28px 36px' } }, [
      h('div', { style: { fontFamily: F.display, fontSize: 26, fontWeight: 900, color: E.ink, letterSpacing: -1, lineHeight: 1.15, marginBottom: 14 } }, tx(lang, 'Una sesión más y la salvas.', 'One more session and you save it.')),
      h('p', { style: { fontSize: 14.5, color: E.ink2, lineHeight: 1.55, margin: 0 } }, tx(lang, 'Te armamos 3 opciones cortas. La más rápida son 18 minutos. Camina al gym o hazla en casa.', 'We lined up 3 short options. The fastest is 18 minutes. Walk to the gym or do it at home.')),
      h('div', { style: { marginTop: 22 } }, optionRows),
      h('div', { style: { marginTop: 22 } }, eBtn({ href: appDeepLink('checkin'), tone: 'dark', wide: true, icon: EI.bolt, children: tx(lang, 'Salvar mi racha', 'Save my streak') })),
      h('div', { style: { marginTop: 14, fontSize: 12, color: E.mute, textAlign: 'center' } },
        tx(lang, ['¿Hoy no puedes? ', h('a', { href: '#', style: { color: E.ink, textDecoration: 'underline' } }, 'Congelar racha por enfermedad')],
                 ['Can’t today? ', h('a', { href: '#', style: { color: E.ink, textDecoration: 'underline' } }, 'Freeze streak for illness')])),
    ]),
  ];
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.hot, content, gymName, logoUrl, lang }) };
}

function streakCalm({ lang, gymName, logoUrl, v }) {
  const subject = tx(lang, 'Recordatorio amable: tu racha', 'Gentle reminder: your streak');
  const preview = tx(lang, `${v.streak_count} días. La cierras hoy con 20 min.`, `${v.streak_count} days. Close it today with 20 min.`);
  const totalBars = 15;
  const barsCells = Array.from({ length: 14 }).map((_, i) => ({
    valign: 'bottom', width: `${100 / totalBars}%`, align: 'center',
    style: { width: `${100 / totalBars}%`, paddingLeft: 2, paddingRight: 2, textAlign: 'center' },
    children: h('div', { style: { width: '100%', height: 32, background: E.teal, borderRadius: 3, opacity: 0.3 + (i / 14) * 0.7 } }),
  }));
  barsCells.push({
    valign: 'bottom', width: `${100 / totalBars}%`, align: 'center',
    style: { width: `${100 / totalBars}%`, paddingLeft: 2, paddingRight: 2, textAlign: 'center' },
    children: h('div', { style: { width: '100%', height: 32, border: `2px dashed ${E.hot}`, borderRadius: 3, background: 'transparent' } }),
  });
  const barsRow = tRow(barsCells, { width: '100%', tableStyle: { width: '100%' } });
  const content = h('div', { class: 'dz-pad', style: { padding: '40px 36px 32px' } }, [
    h('div', { style: { textAlign: 'center', marginBottom: 36 } }, eLogo({ size: 36, gymName, logoUrl })),
    h('div', { style: { marginBottom: 32 } }, [
      h('div', { style: { marginBottom: 10 } }, barsRow),
      tRow([
        { valign: 'middle', align: 'left', style: { fontFamily: F.mono, fontSize: 9.5, color: E.mute, letterSpacing: 0.6, textTransform: 'uppercase' }, children: tx(lang, '12 may', 'May 12') },
        { valign: 'middle', align: 'right', style: { fontFamily: F.mono, fontSize: 9.5, color: E.hot, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, textAlign: 'right' }, children: tx(lang, 'hoy', 'today') },
      ], { width: '100%', tableStyle: { width: '100%' } }),
    ]),
    h('h1', { style: { fontFamily: F.serif, fontSize: 40, fontWeight: 400, color: E.ink, lineHeight: 1.05, letterSpacing: -1.2, margin: 0 } },
      tx(lang, [`${v.streak_count} días.`, h('br'), h('em', { style: { fontStyle: 'italic', color: E.hot } }, 'Hoy se decide.')],
               [`${v.streak_count} days.`, h('br'), h('em', { style: { fontStyle: 'italic', color: E.hot } }, 'Today decides it.')])),
    h('p', { style: { marginTop: 22, fontSize: 15, color: E.ink2, lineHeight: 1.6 } },
      tx(lang, 'La data dice algo claro: las rachas que rompen el día 14 caen al 8% de tasa de regreso en 30 días. Las que pasan de 14 suben al 73%. No te lo digo para presionar — te lo digo porque vale.',
               'The data is clear: streaks that break on day 14 drop to an 8% return rate within 30 days. Those that pass 14 jump to 73%. Not to pressure you — just because it matters.')),
    h('div', { style: { marginTop: 24, padding: 20, borderRadius: 14, background: E.tealSoft } }, tRow([
      { valign: 'middle', width: 110, style: { width: 110, paddingRight: 16, fontFamily: F.display, fontSize: 52, fontWeight: 900, color: E.tealInk, letterSpacing: -2, lineHeight: 1 }, children: ['20', h('span', { style: { fontSize: 22 } }, 'min')] },
      { valign: 'middle', children: [
        h('div', { style: { fontFamily: F.display, fontSize: 14, fontWeight: 800, color: E.tealInk } }, tx(lang, 'Mínimo para contar', 'Minimum that counts')),
        h('div', { style: { fontSize: 12.5, color: E.tealInk, opacity: 0.8, marginTop: 2 } }, tx(lang, 'Cualquier sesión registrada de 20+ min mantiene la racha viva.', 'Any logged session of 20+ min keeps the streak alive.')),
      ] },
    ], { width: '100%', tableStyle: { width: '100%' } })),
    h('div', { style: { marginTop: 28 } }, eBtn({ href: appDeepLink('workout'), tone: 'dark', wide: true, icon: EI.arrow, children: tx(lang, 'Abrir mi plan de hoy', 'Open today’s plan') })),
    h('div', { style: { marginTop: 10 } }, eBtn({ href: appDeepLink('checkin'), tone: 'ghost', size: 'md', wide: true, children: tx(lang, 'Usar día de gracia (1 disponible)', 'Use grace day (1 available)') })),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

// ═══════════════════════════════════════════════════════════════════
//  NEW PR / MILESTONE
// ═══════════════════════════════════════════════════════════════════

function prCertificate({ lang, name, gymName, logoUrl, coachName }) {
  const subject = tx(lang, '🏆 Récord personal · Sentadilla 95kg', '🏆 Personal record · Squat 95kg');
  const preview = tx(lang, 'Lo que firmaste ayer en el gym.', 'What you signed for at the gym yesterday.');
  const corner = (c) => h('div', { style: {
    position: 'absolute', width: 24, height: 24,
    ...(c.includes('t') ? { top: -3 } : { bottom: -3 }),
    ...(c.includes('l') ? { left: -3 } : { right: -3 }),
    borderTop: c.includes('t') ? `3px solid ${E.hot}` : 'none',
    borderBottom: c.includes('b') ? `3px solid ${E.hot}` : 'none',
    borderLeft: c.includes('l') ? `3px solid ${E.hot}` : 'none',
    borderRight: c.includes('r') ? `3px solid ${E.hot}` : 'none',
    background: E.cream,
  } });
  const content = h('div', { class: 'dz-pad', style: { background: E.cream, padding: '40px 28px 36px' } }, [
    h('div', { style: { border: `3px double ${E.ink}`, padding: '32px 24px 28px', position: 'relative' } }, [
      ...['tl', 'tr', 'bl', 'br'].map(corner),
      h('div', { style: { textAlign: 'center' } }, eLogo({ size: 42, gymName, logoUrl })),
      h('div', { style: { marginTop: 16, textAlign: 'center', fontFamily: F.mono, fontSize: 11, color: E.goldInk, letterSpacing: 4, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, '— Récord personal —', '— Personal record —')),
      h('div', { style: { textAlign: 'center', marginTop: 24 } }, [
        h('div', { style: { fontFamily: F.serif, fontSize: 19, fontWeight: 300, color: E.sub, fontStyle: 'italic', letterSpacing: -0.3 } }, tx(lang, 'otorgado a', 'awarded to')),
        h('h1', { style: { fontFamily: F.serif, fontSize: 44, fontWeight: 400, color: E.ink, letterSpacing: -1.5, lineHeight: 1, margin: '8px 0 0' } }, escHtml(name)),
      ]),
      h('div', { style: { height: 1, background: E.lineStrong, margin: '24px 36px' } }),
      h('div', { style: { textAlign: 'center' } }, [
        h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, 'Por levantar', 'For lifting')),
        h('div', { style: { fontFamily: F.display, fontSize: 88, fontWeight: 900, color: E.hot, letterSpacing: -4, lineHeight: 0.9, marginTop: 8 } }, ['95', h('span', { style: { fontSize: 32, fontWeight: 700, color: E.ink, letterSpacing: 0 } }, 'kg')]),
        h('div', { style: { marginTop: 8, fontFamily: F.display, fontSize: 18, fontWeight: 700, color: E.ink, letterSpacing: -0.3 } }, tx(lang, 'en sentadilla trasera × 5 reps', 'in back squat × 5 reps')),
        h('div', { style: { marginTop: 4, fontSize: 12, color: E.sub } }, tx(lang, '+5kg desde tu récord anterior (90kg, 12 abril)', '+5kg from your previous record (90kg, Apr 12)')),
      ]),
      h('div', { style: { height: 1, background: E.lineStrong, margin: '24px 36px' } }),
      h('div', { style: { padding: '0 8px' } }, tRow([
        { valign: 'top', align: 'left', children: [
          h('div', { style: { fontFamily: F.serif, fontSize: 22, fontStyle: 'italic', color: E.ink } }, escHtml(coachName)),
          h('div', { style: { fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 } }, tx(lang, 'Entrenador', 'Coach')),
        ] },
        { valign: 'top', align: 'right', style: { textAlign: 'right' }, children: [
          h('div', { style: { fontFamily: F.mono, fontSize: 11, color: E.ink, fontWeight: 700 } }, '24 · 05 · 2026'),
          h('div', { style: { fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 } }, tx(lang, 'Sede Hato Rey', 'Hato Rey')),
        ] },
      ], { width: '100%', tableStyle: { width: '100%' } })),
    ]),
    h('div', { style: { padding: '28px 12px 0', textAlign: 'center' } }, [
      h('p', { style: { fontSize: 14, color: E.ink2, lineHeight: 1.6, margin: 0 } }, tx(lang, 'Compártelo. Ponlo de fondo. Imprímelo y pégalo en la pared. Lo levantaste tú.', 'Share it. Set it as your wallpaper. Print it and stick it on the wall. You lifted it.')),
      h('div', { style: { marginTop: 22, textAlign: 'center' } }, [
        eBtn({ href: appDeepLink('social'), tone: 'dark', icon: EI.send, children: tx(lang, 'Compartir', 'Share') }),
        h('span', { style: { display: 'inline-block', width: 10, fontSize: 0, lineHeight: 0 } }, ' '),
        eBtn({ tone: 'ghost', children: tx(lang, 'Descargar', 'Download') }),
      ]),
    ]),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.cream, content, gymName, logoUrl, lang }) };
}

function prBigNumber({ lang, name, gymName, logoUrl, coachName }) {
  const subject = tx(lang, `${name} — 95kg. Confirmado.`, `${name} — 95kg. Confirmed.`);
  const preview = tx(lang, 'Tu nuevo PR en sentadilla. Aquí está la historia.', 'Your new squat PR. Here’s the story.');
  const months = lang === 'es'
    ? [['Ene', 70, 0.74], ['Feb', 75, 0.79], ['Mar', 82, 0.86], ['Abr', 90, 0.95], ['May', 95, 1.0, true]]
    : [['Jan', 70, 0.74], ['Feb', 75, 0.79], ['Mar', 82, 0.86], ['Apr', 90, 0.95], ['May', 95, 1.0, true]];
  const deltas = lang === 'es'
    ? [{ k: '+5kg', l: 'vs abril' }, { k: '+25kg', l: 'vs enero' }, { k: '5', l: 'reps' }]
    : [{ k: '+5kg', l: 'vs April' }, { k: '+25kg', l: 'vs January' }, { k: '5', l: 'reps' }];
  const monthRows = months.map((r) => tRow([
    { valign: 'middle', width: 30, style: { width: 30, paddingRight: 12, fontFamily: F.mono, fontSize: 11, color: 'rgba(245,242,236,0.55)' }, children: r[0] },
    { valign: 'middle', style: { paddingRight: 12 }, children: h('div', { style: { width: '100%', height: 18, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' } }, h('div', { style: { width: `${r[2] * 100}%`, height: 18, background: r[3] ? E.gold : 'rgba(255,255,255,0.4)', borderRadius: 3 } })) },
    { valign: 'middle', width: 50, align: 'right', style: { width: 50, textAlign: 'right', fontFamily: F.display, fontSize: 14, fontWeight: 800, color: r[3] ? E.gold : E.cream }, children: `${r[1]}kg` },
  ], { width: '100%', tableStyle: { width: '100%', marginBottom: 4, marginTop: 4 } }));
  const deltasRow = tRow(deltas.map((s, i) => ({
    valign: 'top', width: '33.33%',
    style: { width: '33.33%', paddingRight: i < deltas.length - 1 ? 6 : 0, paddingLeft: i > 0 ? 6 : 0 },
    children: h('div', { style: { padding: 14, background: E.creamElev, borderRadius: 12, border: `1px solid ${E.line}` } }, [
      h('div', { style: { fontFamily: F.display, fontSize: 24, fontWeight: 900, color: E.ink, letterSpacing: -1, lineHeight: 1 } }, escHtml(s.k)),
      h('div', { style: { fontSize: 10.5, color: E.sub, marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 } }, escHtml(s.l)),
    ]),
  })), { width: '100%', tableStyle: { width: '100%' } });
  const content = [
    h('div', { class: 'dz-pad', style: { background: E.ink, color: E.cream, padding: '36px 28px 40px' } }, [
      tRow([
        { valign: 'middle', align: 'left', children: eLogo({ size: 32, gymName, logoUrl }) },
        { valign: 'middle', align: 'right', children: ePill({ tone: 'invert', children: tx(lang, 'PR · 24 may', 'PR · May 24') }) },
      ], { width: '100%', tableStyle: { width: '100%', marginBottom: 36 } }),
      h('div', { style: { fontFamily: F.display, fontSize: 11, color: E.gold, letterSpacing: 3, textTransform: 'uppercase', fontWeight: 800, marginBottom: 14 } }, tx(lang, 'Nuevo récord personal', 'New personal record')),
      h('h1', { style: { fontFamily: F.display, fontSize: 56, fontWeight: 900, color: E.cream, lineHeight: 0.95, letterSpacing: -2, margin: 0 } },
        tx(lang, ['Levantaste', h('br'), h('span', { style: { color: E.gold } }, 'noventa y cinco')],
                 ['You lifted', h('br'), h('span', { style: { color: E.gold } }, 'ninety-five')])),
      h('div', { style: { fontFamily: F.display, fontSize: 200, fontWeight: 900, color: E.gold, lineHeight: 0.85, letterSpacing: -10, marginTop: 12 } }, ['95', h('span', { style: { fontSize: 56, color: E.cream } }, 'kg')]),
      h('div', { style: { marginTop: 28, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.12)' } }, [
        h('div', { style: { fontFamily: F.mono, fontSize: 10, color: 'rgba(245,242,236,0.5)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 } }, tx(lang, 'Tu progresión · Sentadilla', 'Your progression · Squat')),
        ...monthRows,
      ]),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '32px 28px 32px' } }, [
      h('div', { style: { marginBottom: 28 } }, deltasRow),
      h('div', { style: { padding: 18, borderLeft: `3px solid ${E.hot}`, background: E.creamElev, borderRadius: '0 8px 8px 0' } }, [
        h('div', { style: { fontFamily: F.serif, fontSize: 17, fontStyle: 'italic', color: E.ink, lineHeight: 1.45 } }, tx(lang, '"Lo vi venir desde la sesión del lunes. Te aguantaste las ganas de saltar y eso valió. Vamos por 100 antes de julio."', '"I saw it coming since Monday’s session. You held back from rushing and it paid off. Let’s go for 100 before July."')),
        h('div', { style: { marginTop: 12, fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, `— ${coachName}, coach`, `— ${coachName}, coach`)),
      ]),
      h('div', { style: { marginTop: 24 } }, eBtn({ href: appDeepLink('social'), tone: 'dark', wide: true, icon: EI.send, children: tx(lang, 'Compartir con el feed', 'Share to the feed') })),
      h('div', { style: { marginTop: 10 } }, eBtn({ href: appDeepLink('progress'), tone: 'ghost', size: 'md', wide: true, children: tx(lang, 'Ver historial completo', 'See full history') })),
    ]),
  ];
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

// ═══════════════════════════════════════════════════════════════════
//  CLASS REMINDER
// ═══════════════════════════════════════════════════════════════════

function classTicket({ lang, gymName, logoUrl, coachName }) {
  const subject = tx(lang, `Mañana 6:30am · Funcional con ${coachName}`, `Tomorrow 6:30am · Functional with ${coachName}`);
  const preview = tx(lang, 'Tu boleto. Llega 5 min antes.', 'Your ticket. Arrive 5 min early.');
  const meta = lang === 'es'
    ? [{ l: 'Hora', v: '6:30', s: 'am' }, { l: 'Duración', v: '45', s: 'min' }, { l: 'Cupos', v: '4/12', s: 'libres' }]
    : [{ l: 'Time', v: '6:30', s: 'am' }, { l: 'Duration', v: '45', s: 'min' }, { l: 'Spots', v: '4/12', s: 'open' }];
  const qrCells = Array.from({ length: 81 }).map((_, i) => {
    const isFinder = [0, 1, 7, 8, 9, 16, 17, 72, 73, 80].includes(i);
    const on = isFinder || (i * 17 + 3) % 7 < 3;
    return { valign: 'middle', width: 8, style: { width: 8, height: 8, background: on ? E.ink : 'transparent', padding: 0 }, children: ' ' };
  });
  const qrRows = [];
  for (let r = 0; r < 9; r++) qrRows.push(qrCells.slice(r * 9, r * 9 + 9));
  const qr = h('div', { style: { width: 90, height: 90, padding: 6, background: E.paper, border: `1.5px solid ${E.ink}`, borderRadius: 4 } },
    tGrid(qrRows, { width: 78, tableStyle: { width: 78, height: 78, borderCollapse: 'collapse' } }));
  const metaRow = tRow(meta.map((m) => ({
    valign: 'top', width: '33.33%', style: { width: '33.33%', paddingRight: 6 },
    children: [
      h('div', { style: { fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 } }, escHtml(m.l)),
      h('div', { style: { fontFamily: F.display, fontSize: 22, fontWeight: 900, color: E.ink, letterSpacing: -0.8, lineHeight: 1 } }, [escHtml(m.v), h('span', { style: { fontSize: 11, color: E.sub, fontWeight: 600, marginLeft: 3 } }, escHtml(m.s))]),
    ],
  })), { width: '100%', tableStyle: { width: '100%' } });
  const content = h('div', { class: 'dz-pad', style: { background: E.cream, padding: '36px 28px 28px' } }, [
    h('div', { style: { textAlign: 'center', marginBottom: 24 } }, h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.sub, letterSpacing: 2.5, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, 'Confirmación · Clase', 'Confirmation · Class'))),
    h('div', { style: { background: E.paper, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08)', border: `1px solid ${E.line}` } }, [
      h('div', { style: { padding: '22px 22px 24px', borderBottom: `2px dashed ${E.lineStrong}`, position: 'relative' } }, [
        tRow([
          { valign: 'top', align: 'left', children: [
            h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.hot, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 } }, tx(lang, 'Mañana · martes', 'Tomorrow · Tuesday')),
            h('div', { style: { fontFamily: F.display, fontSize: 32, fontWeight: 900, color: E.ink, letterSpacing: -1.2, marginTop: 8, lineHeight: 1 } }, tx(lang, ['Funcional', h('br'), 'de mañana'], ['Morning', h('br'), 'functional'])),
          ] },
          { valign: 'top', align: 'right', children: eLogo({ size: 36, gymName, logoUrl }) },
        ], { width: '100%', tableStyle: { width: '100%' } }),
        h('div', { style: { marginTop: 24 } }, metaRow),
        h('div', { style: { position: 'absolute', bottom: -10, left: -10, width: 20, height: 20, borderRadius: 999, background: E.cream } }),
        h('div', { style: { position: 'absolute', bottom: -10, right: -10, width: 20, height: 20, borderRadius: 999, background: E.cream } }),
      ]),
      h('div', { style: { padding: '22px 22px 24px' } }, tRow([
        { valign: 'middle', style: { paddingRight: 16 }, children: [
          h('div', { style: { fontFamily: F.mono, fontSize: 9, color: E.mute, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 } }, tx(lang, 'Sede', 'Location')),
          h('div', { style: { fontFamily: F.display, fontSize: 16, fontWeight: 800, color: E.ink, letterSpacing: -0.3 } }, tx(lang, 'Hato Rey · Salón 2', 'Hato Rey · Studio 2')),
          h('div', { style: { fontSize: 12, color: E.sub, marginTop: 3 } }, tx(lang, ['Av. Ponce de León 1234', h('br'), 'San Juan, PR 00907'], ['1234 Ponce de León Ave', h('br'), 'San Juan, PR 00907'])),
          h('div', { style: { marginTop: 12 } }, ePill({ tone: 'teal', children: tx(lang, `Coach: ${coachName}`, `Coach: ${coachName}`) })),
        ] },
        { valign: 'middle', width: 90, align: 'right', style: { width: 90, textAlign: 'right' }, children: qr },
      ], { width: '100%', tableStyle: { width: '100%' } })),
    ]),
    h('div', { style: { marginTop: 24, padding: '16px 18px', background: E.paper, borderRadius: 10, border: `1px solid ${E.line}` } },
      tRow([
        { valign: 'top', width: 26, style: { width: 26, paddingRight: 10, paddingTop: 1 }, children: eIco(EI.bolt, { size: 16, color: E.hot, stroke: 2.2 }) },
        { valign: 'top', children: [
          h('div', { style: { fontFamily: F.display, fontSize: 13, fontWeight: 800, color: E.ink, marginBottom: 2 } }, tx(lang, 'Llega 5 min antes', 'Arrive 5 min early')),
          h('div', { style: { fontSize: 12.5, color: E.sub, lineHeight: 1.5 } }, tx(lang, 'Trae botella de agua. Calentamos juntos.', 'Bring a water bottle. We warm up together.')),
        ] },
      ], { width: '100%', tableStyle: { width: '100%' } })),
    h('div', { style: { marginTop: 18 } }, tRow([
      { valign: 'middle', style: { paddingRight: 10 }, children: eBtn({ href: appDeepLink('classes'), tone: 'dark', wide: true, size: 'md', children: tx(lang, 'Añadir a calendario', 'Add to calendar') }) },
      { valign: 'middle', align: 'right', width: 110, style: { width: 110, textAlign: 'right' }, children: eBtn({ href: appDeepLink('classes'), tone: 'ghost', size: 'md', children: tx(lang, 'Cancelar', 'Cancel') }) },
    ], { width: '100%', tableStyle: { width: '100%' } })),
  ]);
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.cream, content, gymName, logoUrl, lang }) };
}

function classClean({ lang, gymName, logoUrl, coachName }) {
  const subject = tx(lang, 'Recordatorio · Funcional mañana 6:30am', 'Reminder · Functional tomorrow 6:30am');
  const preview = tx(lang, `${coachName} te espera.`, `${coachName} is expecting you.`);
  const inlineMeta = (icon, text) => h('span', { style: { display: 'inline-block', marginRight: 14, fontSize: 12, color: E.sub } }, [
    h('span', { style: { display: 'inline-block', verticalAlign: 'middle', marginRight: 5 } }, eIco(icon, { size: 13, color: E.sub, stroke: 2 })),
    h('span', { style: { verticalAlign: 'middle' } }, text),
  ]);
  const headerLogo = tRow([
    { valign: 'middle', children: eLogo({ size: 28, gymName, logoUrl }), style: { paddingRight: 10 } },
    { valign: 'middle', children: eWordmark({ size: 13, gymName }) },
  ]);
  const dateChip = h('div', { style: { width: 64, padding: '10px 0', textAlign: 'center', background: E.ink, color: E.cream, borderRadius: 10 } }, [
    h('div', { style: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5, opacity: 0.7, textTransform: 'uppercase' } }, tx(lang, 'MAR', 'TUE')),
    h('div', { style: { fontFamily: F.display, fontSize: 26, fontWeight: 900, letterSpacing: -1, lineHeight: 1, marginTop: 2 } }, '26'),
    h('div', { style: { fontFamily: F.mono, fontSize: 9, color: E.gold, letterSpacing: 1, marginTop: 2 } }, 'MAY'),
  ]);
  const content = [
    h('div', { class: 'dz-pad', style: { padding: '28px 32px 0' } }, [
      h('div', { style: { marginBottom: 28 } }, headerLogo),
      h('div', { style: { fontFamily: F.mono, fontSize: 11, color: E.tealInk, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 } }, tx(lang, 'Recordatorio', 'Reminder')),
      h('h1', { style: { fontFamily: F.display, fontSize: 36, fontWeight: 900, color: E.ink, lineHeight: 1.05, letterSpacing: -1.5, margin: 0 } }, tx(lang, 'Mañana a las 6:30am.', 'Tomorrow at 6:30am.')),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '24px 32px 0' } },
      h('div', { style: { background: E.creamElev, border: `1px solid ${E.line}`, borderRadius: 14, overflow: 'hidden' } }, [
        h('div', { style: { padding: 18, borderBottom: `1px solid ${E.line}` } }, tRow([
          { valign: 'middle', width: 64, style: { width: 64, paddingRight: 16 }, children: dateChip },
          { valign: 'middle', children: [
            h('div', { style: { fontFamily: F.display, fontSize: 20, fontWeight: 800, color: E.ink, letterSpacing: -0.5 } }, tx(lang, 'Funcional de mañana', 'Morning functional')),
            h('div', { style: { marginTop: 6 } }, [
              inlineMeta(EI.clock, ' 6:30 — 7:15am'),
              inlineMeta(EI.user, ` ${escHtml(coachName)}`),
            ]),
          ] },
        ], { width: '100%', tableStyle: { width: '100%' } })),
        h('div', { style: { padding: 18 } }, tRow([
          { valign: 'top', width: 26, style: { width: 26, paddingRight: 12, paddingTop: 2 }, children: eIco(EI.pin, { size: 16, color: E.sub, stroke: 2 }) },
          { valign: 'top', children: [
            h('div', { style: { fontFamily: F.display, fontSize: 14, fontWeight: 700, color: E.ink } }, tx(lang, 'Sede Hato Rey · Salón 2', 'Hato Rey · Studio 2')),
            h('div', { style: { fontSize: 12, color: E.sub, marginTop: 2 } }, tx(lang, 'Av. Ponce de León 1234, San Juan', '1234 Ponce de León Ave, San Juan')),
          ] },
          { valign: 'top', align: 'right', width: 90, style: { width: 90, textAlign: 'right' },
            children: h('a', { href: '#', style: { fontFamily: F.display, fontSize: 12, color: E.tealInk, fontWeight: 700, textDecoration: 'underline' } }, tx(lang, 'Cómo llegar', 'Directions')),
          },
        ], { width: '100%', tableStyle: { width: '100%' } })),
      ])),
    h('div', { class: 'dz-pad', style: { padding: '20px 32px 0' } }, [
      h('div', { style: { fontFamily: F.mono, fontSize: 10, color: E.mute, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 } }, tx(lang, 'Lo de hoy', 'Today’s focus')),
      h('p', { style: { fontSize: 14, color: E.ink2, lineHeight: 1.55, margin: 0 } }, tx(lang, 'Trabajamos cadera y core. Trae botella de agua y zapatos de gimnasio (no de correr — necesitamos suela plana).', 'We work hips and core. Bring a water bottle and gym shoes (not running shoes — we need flat soles).')),
    ]),
    h('div', { class: 'dz-pad', style: { padding: '28px 32px 36px' } }, tRow([
      { valign: 'middle', width: '50%', style: { width: '50%', paddingRight: 5 }, children: eBtn({ href: appDeepLink('classes'), tone: 'teal', size: 'md', wide: true, icon: EI.cal, children: tx(lang, 'Calendario', 'Calendar') }) },
      { valign: 'middle', width: '50%', style: { width: '50%', paddingLeft: 5 }, children: eBtn({ href: appDeepLink('classes'), tone: 'ghost', size: 'md', wide: true, children: tx(lang, 'Cancelar', 'Cancel') }) },
    ], { width: '100%', tableStyle: { width: '100%' } })),
  ];
  return { subject, preview, html: emailDoc({ preview, bodyBg: E.paper, content, gymName, logoUrl, lang }) };
}

// ═══════════════════════════════════════════════════════════════════
//  Catalog + public API
// ═══════════════════════════════════════════════════════════════════

export const DESIGNER_CAMPAIGNS = [
  {
    id: 'welcome', type: 'welcome', icon: '\u{1F44B}',
    title: { es: 'Bienvenida', en: 'Welcome' },
    items: [
      { id: 'welcome-editorial', label: { es: 'Editorial cálido', en: 'Warm editorial' }, render: welcomeEditorial },
      { id: 'welcome-poster', label: { es: 'Poster Borinquen', en: 'Bold poster' }, render: welcomePoster },
    ],
  },
  {
    id: 'recap', type: 'digest', icon: '\u{1F4CA}',
    title: { es: 'Recap semanal', en: 'Weekly recap' },
    items: [
      { id: 'recap-magazine', label: { es: 'Revista', en: 'Magazine' }, render: recapMagazine },
      { id: 'recap-receipt', label: { es: 'Log de gym', en: 'Gym log' }, render: recapReceipt },
      { id: 'recap-dark', label: { es: 'Dark premium', en: 'Dark premium' }, render: recapDark },
    ],
  },
  {
    id: 'winback', type: 'winback', icon: '\u{1F4AA}',
    title: { es: 'Winback', en: 'Win-back' },
    items: [
      { id: 'winback-quiet', label: { es: 'Voz tranquila', en: 'Quiet voice' }, render: winbackQuiet },
      { id: 'winback-data', label: { es: 'Reporte de ausencia', en: 'Absence report' }, render: winbackData },
      { id: 'winback-text', label: { es: 'Mensaje de coach', en: 'Coach message' }, render: winbackText },
    ],
  },
  {
    id: 'streak', type: 'custom', icon: '\u{1F525}',
    title: { es: 'Racha en peligro', en: 'Streak at risk' },
    items: [
      { id: 'streak-poster', label: { es: 'Poster urgente', en: 'Urgent poster' }, render: streakPoster },
      { id: 'streak-calm', label: { es: 'Recordatorio amable', en: 'Gentle reminder' }, render: streakCalm },
    ],
  },
  {
    id: 'pr', type: 'custom', icon: '\u{1F3C6}',
    title: { es: 'Récord personal', en: 'New PR' },
    items: [
      { id: 'pr-certificate', label: { es: 'Certificado', en: 'Certificate' }, render: prCertificate },
      { id: 'pr-bignumber', label: { es: 'Big number', en: 'Big number' }, render: prBigNumber },
    ],
  },
  {
    id: 'class', type: 'classReminder', icon: '\u{1F514}',
    title: { es: 'Recordatorio de clase', en: 'Class reminder' },
    items: [
      { id: 'class-ticket', label: { es: 'Boleto', en: 'Boarding pass' }, render: classTicket },
      { id: 'class-clean', label: { es: 'Tarjeta limpia', en: 'Clean card' }, render: classClean },
    ],
  },
];

const RENDER_BY_ID = Object.fromEntries(
  DESIGNER_CAMPAIGNS.flatMap((c) => c.items.map((it) => [it.id, it])),
);

/** The per-recipient merge tokens these templates can carry. */
export const DESIGNER_MERGE_TOKENS = ['first_name', 'streak_count', 'workout_count', 'days_inactive'];

/**
 * Render one designer template to send-safe HTML.
 *
 * @param {string} id  catalog id (e.g. 'recap-magazine')
 * @param {object} ctx
 * @param {'es'|'en'} ctx.lang
 * @param {string} ctx.gymName
 * @param {string} ctx.logoUrl     gym logo (https) — else a monogram
 * @param {string} ctx.primaryColor   gym brand primary (#hex) — drives the palette
 * @param {string} ctx.secondaryColor gym brand secondary (#hex)
 * @param {string} ctx.coachName   defaults to gymName (constant per send)
 * @param {string} ctx.name        recipient first name. Pass '{{first_name}}'
 *                                 to keep the token for per-recipient send.
 * @param {object} ctx.vars        per-recipient stat values. Pass numbers for a
 *                                 populated preview, or '{{streak_count}}' etc.
 *                                 to keep tokens for send-time substitution.
 * @returns {{subject:string, preview:string, html:string}|null}
 */
export function renderDesignerEmail(id, ctx = {}) {
  const entry = RENDER_BY_ID[id];
  if (!entry) return null;
  const lang = ctx.lang === 'en' ? 'en' : 'es';
  const gymName = ctx.gymName || 'TuGymPR';
  const logoUrl = ctx.logoUrl && /^https:\/\//i.test(ctx.logoUrl) ? ctx.logoUrl : '';
  const fullCtx = {
    lang, gymName, logoUrl,
    name: ctx.name || (lang === 'es' ? 'José' : 'Alex'),
    coachName: ctx.coachName || gymName,
    v: { ...VAR_DEFAULTS, ...(ctx.vars || {}) },
  };
  const prev = E;
  E = buildPalette(ctx.primaryColor, ctx.secondaryColor);
  try {
    return entry.render(fullCtx);
  } finally {
    E = prev;
  }
}

/** Flat list of catalog ids. */
export function listDesignerTemplateIds() {
  return Object.keys(RENDER_BY_ID);
}
