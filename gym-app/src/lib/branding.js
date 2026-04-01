/**
 * Applies gym branding colors to the app at runtime.
 *
 * Three layers:
 *  1. Core accent + surface CSS variables on :root → via themeGenerator
 *  2. Legacy alias CSS properties on :root         → picked up by var(--accent-gold) usages
 *  3. Injected <style> tag                         → overrides hardcoded Tailwind arbitrary-value classes
 */

import {
  applyGymTheme,
  resetToDefault as resetTheme,
  generatePalette,
  textOnColor,
} from './themeGenerator';

// ── Defaults (Obsidian & Amber) ─────────────────────────────────────────────
const DEFAULT_PRIMARY   = '#F0A500';
const DEFAULT_SECONDARY = '#22D3A7';

// ── Color helpers ───────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Darken a hex color by mixing toward black.
 * @param {string} hex    – e.g. "#F0A500"
 * @param {number} amount – 0-1, fraction to darken
 * @returns {string} hex
 */
function darken(hex, amount) {
  const h = hex.replace('#', '');
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Lighten a hex color by mixing toward white.
 * @param {string} hex    – e.g. "#F0A500"
 * @param {number} amount – 0-1, fraction to lighten
 * @returns {string} hex
 */
function lighten(hex, amount) {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply full gym branding: accent palette, surface tinting, legacy aliases,
 * and Tailwind arbitrary-class overrides.
 *
 * @param {Object}  opts
 * @param {string}  [opts.primaryColor]   – gym's primary brand color
 * @param {string}  [opts.secondaryColor] – gym's secondary color (auto-derived if omitted)
 * @param {string}  [opts.surfaceColor]   – optional manual surface-tint override hex
 */
export function applyBranding({
  primaryColor = DEFAULT_PRIMARY,
  secondaryColor = DEFAULT_SECONDARY,
  surfaceColor = null,
} = {}) {
  const p = primaryColor || DEFAULT_PRIMARY;
  const s = secondaryColor || DEFAULT_SECONDARY;
  const root = document.documentElement;

  // 0. Core accent + surface palette via themeGenerator
  applyGymTheme({ primaryColor: p, secondaryColor: s });

  // 0b. If the gym specifies a manual surface color, override the auto-derived
  //     surfaces with tints derived from that color's hue instead.
  if (surfaceColor) {
    const surfPalette = generatePalette(surfaceColor, s);
    const isDark = root.classList.contains('dark');

    root.style.setProperty('--color-surface-base',     isDark ? surfPalette.surfaceBase     : surfPalette.lightSurfaceBase);
    root.style.setProperty('--color-surface-deep',     isDark ? surfPalette.surfaceDeep     : surfPalette.lightSurfaceBase);
    root.style.setProperty('--color-surface-card',     isDark ? surfPalette.surfaceCard     : surfPalette.lightSurfaceCard);
    root.style.setProperty('--color-surface-elevated', isDark ? surfPalette.surfaceElevated : surfPalette.lightSurfaceCard);
    root.style.setProperty('--color-surface-input',    isDark ? surfPalette.surfaceInput    : surfPalette.lightSurfaceSecondary);
    root.style.setProperty('--color-surface-nav',      isDark ? surfPalette.surfaceNav      : surfPalette.lightSurfaceBase);

    // Mirror to --color-bg-* aliases used by components after light-mode refactor
    root.style.setProperty('--color-bg-primary',   isDark ? surfPalette.surfaceBase     : surfPalette.lightSurfaceBase);
    root.style.setProperty('--color-bg-deep',      isDark ? surfPalette.surfaceDeep     : surfPalette.lightSurfaceBase);
    root.style.setProperty('--color-bg-card',      isDark ? surfPalette.surfaceCard     : surfPalette.lightSurfaceCard);
    root.style.setProperty('--color-bg-secondary', isDark ? surfPalette.surfaceCard     : surfPalette.lightSurfaceSecondary);
    root.style.setProperty('--color-bg-elevated',  isDark ? surfPalette.surfaceElevated : surfPalette.lightSurfaceCard);
    root.style.setProperty('--color-bg-input',     isDark ? surfPalette.surfaceInput    : surfPalette.lightSurfaceSecondary);
    root.style.setProperty('--color-bg-nav',       isDark ? surfPalette.surfaceNav      : surfPalette.lightSurfaceBase);
  }

  // 1. Legacy CSS custom properties — primary (gold)
  root.style.setProperty('--accent-gold',      p);
  root.style.setProperty('--accent-gold-soft',  lighten(p, 0.15));
  root.style.setProperty('--accent-gold-dark',  darken(p, 0.20));
  root.style.setProperty('--accent-gold-glow',  hexToRgba(p, 0.20));
  root.style.setProperty('--accent-primary',    p);

  // CSS custom properties — secondary / emerald
  root.style.setProperty('--accent-secondary', s);
  root.style.setProperty('--accent-emerald',   s);
  root.style.setProperty('--color-success',    s);

  // Text-on-primary for components that read it from a CSS var
  root.style.setProperty('--color-text-on-accent', textOnColor(p));

  // 2. Inject stylesheet to override hardcoded Tailwind arbitrary classes
  let el = document.getElementById('gym-branding-overrides');
  if (!el) {
    el = document.createElement('style');
    el.id = 'gym-branding-overrides';
    document.head.appendChild(el);
  }

  const hoverP = darken(p, 0.08);
  const hoverS = darken(s, 0.08);

  // Generate the full palette to grab surface values for CSS overrides
  const palette = generatePalette(p, s);

  // Old hardcoded hex values that may appear in Tailwind arbitrary classes
  const OLD_PRIMARY   = '#D4AF37';
  const OLD_SECONDARY = '#10B981';
  const OLD_HOVER_P   = '#C4A030';
  const OLD_HOVER_S   = '#0EA572';

  // Helper: escape a hex for use inside a Tailwind arbitrary-value CSS selector
  const esc = (hex) => hex.replace('#', '\\#');

  // CSS selector escaping: . [ # ] / → \. \[ \# \] \/
  el.textContent = `
    /* ═══ PRIMARY ═════════════════════════════════════════════════════════ */

    /* backgrounds */
    .bg-\\[${esc(OLD_PRIMARY)}\\]      { background-color: ${p} !important; }
    .bg-\\[${esc(OLD_PRIMARY)}\\]\\/3  { background-color: ${hexToRgba(p, 0.03)} !important; }
    .bg-\\[${esc(OLD_PRIMARY)}\\]\\/5  { background-color: ${hexToRgba(p, 0.05)} !important; }
    .bg-\\[${esc(OLD_PRIMARY)}\\]\\/10 { background-color: ${hexToRgba(p, 0.10)} !important; }
    .bg-\\[${esc(OLD_PRIMARY)}\\]\\/15 { background-color: ${hexToRgba(p, 0.15)} !important; }
    .bg-\\[${esc(OLD_PRIMARY)}\\]\\/20 { background-color: ${hexToRgba(p, 0.20)} !important; }
    .bg-\\[${esc(OLD_PRIMARY)}\\]\\/30 { background-color: ${hexToRgba(p, 0.30)} !important; }

    /* text */
    .text-\\[${esc(OLD_PRIMARY)}\\] { color: ${p} !important; }

    /* borders */
    .border-\\[${esc(OLD_PRIMARY)}\\]      { border-color: ${p} !important; }
    .border-\\[${esc(OLD_PRIMARY)}\\]\\/30 { border-color: ${hexToRgba(p, 0.30)} !important; }
    .border-\\[${esc(OLD_PRIMARY)}\\]\\/40 { border-color: ${hexToRgba(p, 0.40)} !important; }
    .border-\\[${esc(OLD_PRIMARY)}\\]\\/50 { border-color: ${hexToRgba(p, 0.50)} !important; }
    .border-t-\\[${esc(OLD_PRIMARY)}\\]    { border-top-color: ${p} !important; }

    /* hover states */
    .hover\\:bg-\\[${esc(OLD_HOVER_P)}\\]:hover { background-color: ${hoverP} !important; }

    /* form accent (radio/checkbox) */
    .accent-\\[${esc(OLD_PRIMARY)}\\] { accent-color: ${p} !important; }

    /* gradient stops */
    .from-\\[${esc(OLD_PRIMARY)}\\] { --tw-gradient-from: ${p} !important; }
    .via-\\[${esc(OLD_PRIMARY)}\\]  { --tw-gradient-via: ${p} !important; }
    .to-\\[${esc(OLD_PRIMARY)}\\]   { --tw-gradient-to: ${p} !important; }

    /* ═══ SECONDARY ═══════════════════════════════════════════════════════ */

    /* backgrounds */
    .bg-\\[${esc(OLD_SECONDARY)}\\]      { background-color: ${s} !important; }
    .bg-\\[${esc(OLD_SECONDARY)}\\]\\/5  { background-color: ${hexToRgba(s, 0.05)} !important; }
    .bg-\\[${esc(OLD_SECONDARY)}\\]\\/10 { background-color: ${hexToRgba(s, 0.10)} !important; }
    .bg-\\[${esc(OLD_SECONDARY)}\\]\\/15 { background-color: ${hexToRgba(s, 0.15)} !important; }
    .bg-\\[${esc(OLD_SECONDARY)}\\]\\/20 { background-color: ${hexToRgba(s, 0.20)} !important; }
    .bg-\\[${esc(OLD_SECONDARY)}\\]\\/30 { background-color: ${hexToRgba(s, 0.30)} !important; }
    .bg-\\[${esc(OLD_SECONDARY)}\\]\\/50 { background-color: ${hexToRgba(s, 0.50)} !important; }

    /* text */
    .text-\\[${esc(OLD_SECONDARY)}\\] { color: ${s} !important; }

    /* borders */
    .border-\\[${esc(OLD_SECONDARY)}\\]      { border-color: ${s} !important; }
    .border-\\[${esc(OLD_SECONDARY)}\\]\\/30 { border-color: ${hexToRgba(s, 0.30)} !important; }
    .border-\\[${esc(OLD_SECONDARY)}\\]\\/40 { border-color: ${hexToRgba(s, 0.40)} !important; }
    .border-\\[${esc(OLD_SECONDARY)}\\]\\/50 { border-color: ${hexToRgba(s, 0.50)} !important; }

    /* hover states */
    .hover\\:bg-\\[${esc(OLD_HOVER_S)}\\]:hover { background-color: ${hoverS} !important; }

    /* gradient stops */
    .from-\\[${esc(OLD_SECONDARY)}\\] { --tw-gradient-from: ${s} !important; }
    .via-\\[${esc(OLD_SECONDARY)}\\]  { --tw-gradient-via: ${s} !important; }
    .to-\\[${esc(OLD_SECONDARY)}\\]   { --tw-gradient-to: ${s} !important; }

    /* ═══ TEXT ON PRIMARY ═════════════════════════════════════════════════ */

    .text-on-primary { color: ${palette.textOnPrimary} !important; }

    /* ═══ SURFACE / BACKGROUND OVERRIDES (dark mode only) ═══════════════ */

    /* Only apply brand-tinted dark surfaces when in dark mode.
       In light mode, the :root CSS variables handle surfaces instead. */
    html.dark .bg-\\[\\#05070B\\]  { background-color: ${palette.surfaceDeep} !important; }
    html.dark .bg-\\[\\#0A0D14\\]  { background-color: ${palette.surfaceBase} !important; }
    html.dark .bg-\\[\\#0B0F1A\\]  { background-color: ${palette.surfaceBase} !important; }
    html.dark .bg-\\[\\#0F172A\\]  { background-color: ${palette.surfaceCard} !important; }
    html.dark .bg-\\[\\#111827\\]  { background-color: ${palette.surfaceElevated} !important; }

    /* Nav / overlay backgrounds with backdrop-blur (dark only) */
    html.dark .bg-\\[\\#05070B\\]\\/90 { background-color: ${palette.surfaceNav} !important; }
    html.dark .bg-\\[\\#0A0D14\\]\\/90 { background-color: ${palette.surfaceNav} !important; }
  `;
}

/**
 * Reset branding to the default Obsidian & Amber palette.
 */
export function resetToDefault() {
  // Reset the core theme variables
  resetTheme();

  const root = document.documentElement;

  // Reset legacy aliases
  root.style.setProperty('--accent-gold',      DEFAULT_PRIMARY);
  root.style.setProperty('--accent-gold-soft',  lighten(DEFAULT_PRIMARY, 0.15));
  root.style.setProperty('--accent-gold-dark',  darken(DEFAULT_PRIMARY, 0.20));
  root.style.setProperty('--accent-gold-glow',  hexToRgba(DEFAULT_PRIMARY, 0.20));
  root.style.setProperty('--accent-primary',    DEFAULT_PRIMARY);
  root.style.setProperty('--accent-secondary',  DEFAULT_SECONDARY);
  root.style.setProperty('--accent-emerald',    DEFAULT_SECONDARY);
  root.style.setProperty('--color-success',     DEFAULT_SECONDARY);
  root.style.setProperty('--color-text-on-accent', textOnColor(DEFAULT_PRIMARY));

  // Remove injected overrides so hardcoded Tailwind classes revert
  const el = document.getElementById('gym-branding-overrides');
  if (el) el.textContent = '';
}
