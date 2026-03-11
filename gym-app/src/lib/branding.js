/**
 * Applies gym branding colors to the app at runtime.
 *
 * Two layers:
 *  1. CSS custom properties on :root  → picked up by var(--accent-gold) usages
 *  2. Injected <style> tag           → overrides hardcoded Tailwind arbitrary-value classes
 */

const DEFAULT_PRIMARY = '#D4AF37';

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

export function applyBranding(primaryColor = DEFAULT_PRIMARY) {
  const p = primaryColor || DEFAULT_PRIMARY;
  const root = document.documentElement;

  // 1. CSS custom properties
  root.style.setProperty('--accent-gold', p);
  root.style.setProperty('--accent-gold-soft', lighten(p, 0.15));
  root.style.setProperty('--accent-gold-dark', darken(p, 0.20));
  root.style.setProperty('--accent-gold-glow', hexToRgba(p, 0.20));
  root.style.setProperty('--accent-primary', p);

  // 2. Inject stylesheet to override hardcoded Tailwind arbitrary classes
  let el = document.getElementById('gym-branding-overrides');
  if (!el) {
    el = document.createElement('style');
    el.id = 'gym-branding-overrides';
    document.head.appendChild(el);
  }

  const hover = darken(p, 0.08);

  // CSS selector escaping: . [ # ] / → \. \[ \# \] \/
  el.textContent = `
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
    .hover\\:bg-\\[\\#C4A030\\]:hover { background-color: ${hover} !important; }

    /* form accent (radio/checkbox) */
    .accent-\\[\\#D4AF37\\] { accent-color: ${p} !important; }

    /* gradient stops */
    .from-\\[\\#D4AF37\\] { --tw-gradient-from: ${p} !important; }
    .via-\\[\\#D4AF37\\]  { --tw-gradient-via: ${p} !important; }
    .to-\\[\\#D4AF37\\]   { --tw-gradient-to: ${p} !important; }
  `;
}
