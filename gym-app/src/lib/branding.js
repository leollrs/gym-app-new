/**
 * Applies gym branding colors to the app at runtime.
 *
 * Two layers:
 *  1. CSS custom properties on :root  → picked up by var(--accent-gold) usages
 *  2. Injected <style> tag           → overrides hardcoded Tailwind arbitrary-value classes
 */

const DEFAULT_PRIMARY   = '#D4AF37';
const DEFAULT_SECONDARY = '#10B981';

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darken(hex, amount) {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function lighten(hex, amount) {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function applyBranding({
  primaryColor = DEFAULT_PRIMARY,
  secondaryColor = DEFAULT_SECONDARY,
} = {}) {
  const p = primaryColor || DEFAULT_PRIMARY;
  const s = secondaryColor || DEFAULT_SECONDARY;
  const root = document.documentElement;

  // 1. CSS custom properties — primary (gold)
  root.style.setProperty('--accent-gold', p);
  root.style.setProperty('--accent-gold-soft', lighten(p, 0.15));
  root.style.setProperty('--accent-gold-dark', darken(p, 0.20));
  root.style.setProperty('--accent-gold-glow', hexToRgba(p, 0.20));
  root.style.setProperty('--accent-primary', p);

  // CSS custom properties — secondary / emerald
  root.style.setProperty('--accent-secondary', s);
  root.style.setProperty('--accent-emerald', s);
  root.style.setProperty('--color-success', s);

  // 2. Inject stylesheet to override hardcoded Tailwind arbitrary classes
  let el = document.getElementById('gym-branding-overrides');
  if (!el) {
    el = document.createElement('style');
    el.id = 'gym-branding-overrides';
    document.head.appendChild(el);
  }

  const hoverP = darken(p, 0.08);
  const hoverS = darken(s, 0.08);

  // CSS selector escaping: . [ # ] / → \. \[ \# \] \/
  el.textContent = `
    /* ═══ PRIMARY (gold) ═══════════════════════════════════════════════ */

    /* backgrounds */
    .bg-\\[\\#D4AF37\\]      { background-color: ${p} !important; }
    .bg-\\[\\#D4AF37\\]\\/3  { background-color: ${hexToRgba(p, 0.03)} !important; }
    .bg-\\[\\#D4AF37\\]\\/5  { background-color: ${hexToRgba(p, 0.05)} !important; }
    .bg-\\[\\#D4AF37\\]\\/10 { background-color: ${hexToRgba(p, 0.10)} !important; }
    .bg-\\[\\#D4AF37\\]\\/15 { background-color: ${hexToRgba(p, 0.15)} !important; }
    .bg-\\[\\#D4AF37\\]\\/20 { background-color: ${hexToRgba(p, 0.20)} !important; }
    .bg-\\[\\#D4AF37\\]\\/30 { background-color: ${hexToRgba(p, 0.30)} !important; }

    /* text */
    .text-\\[\\#D4AF37\\] { color: ${p} !important; }

    /* borders */
    .border-\\[\\#D4AF37\\]      { border-color: ${p} !important; }
    .border-\\[\\#D4AF37\\]\\/30 { border-color: ${hexToRgba(p, 0.30)} !important; }
    .border-\\[\\#D4AF37\\]\\/40 { border-color: ${hexToRgba(p, 0.40)} !important; }
    .border-\\[\\#D4AF37\\]\\/50 { border-color: ${hexToRgba(p, 0.50)} !important; }
    .border-t-\\[\\#D4AF37\\]   { border-top-color: ${p} !important; }

    /* hover states (derived color) */
    .hover\\:bg-\\[\\#C4A030\\]:hover { background-color: ${hoverP} !important; }

    /* form accent (radio/checkbox) */
    .accent-\\[\\#D4AF37\\] { accent-color: ${p} !important; }

    /* gradient stops */
    .from-\\[\\#D4AF37\\] { --tw-gradient-from: ${p} !important; }
    .via-\\[\\#D4AF37\\]  { --tw-gradient-via: ${p} !important; }
    .to-\\[\\#D4AF37\\]   { --tw-gradient-to: ${p} !important; }

    /* ═══ SECONDARY (emerald) ══════════════════════════════════════════ */

    /* backgrounds */
    .bg-\\[\\#10B981\\]      { background-color: ${s} !important; }
    .bg-\\[\\#10B981\\]\\/5  { background-color: ${hexToRgba(s, 0.05)} !important; }
    .bg-\\[\\#10B981\\]\\/10 { background-color: ${hexToRgba(s, 0.10)} !important; }
    .bg-\\[\\#10B981\\]\\/15 { background-color: ${hexToRgba(s, 0.15)} !important; }
    .bg-\\[\\#10B981\\]\\/20 { background-color: ${hexToRgba(s, 0.20)} !important; }
    .bg-\\[\\#10B981\\]\\/30 { background-color: ${hexToRgba(s, 0.30)} !important; }
    .bg-\\[\\#10B981\\]\\/50 { background-color: ${hexToRgba(s, 0.50)} !important; }

    /* text */
    .text-\\[\\#10B981\\] { color: ${s} !important; }

    /* borders */
    .border-\\[\\#10B981\\]      { border-color: ${s} !important; }
    .border-\\[\\#10B981\\]\\/30 { border-color: ${hexToRgba(s, 0.30)} !important; }
    .border-\\[\\#10B981\\]\\/40 { border-color: ${hexToRgba(s, 0.40)} !important; }
    .border-\\[\\#10B981\\]\\/50 { border-color: ${hexToRgba(s, 0.50)} !important; }

    /* hover states (derived color) */
    .hover\\:bg-\\[\\#0EA572\\]:hover { background-color: ${hoverS} !important; }

    /* gradient stops */
    .from-\\[\\#10B981\\] { --tw-gradient-from: ${s} !important; }
    .via-\\[\\#10B981\\]  { --tw-gradient-via: ${s} !important; }
    .to-\\[\\#10B981\\]   { --tw-gradient-to: ${s} !important; }
  `;
}
