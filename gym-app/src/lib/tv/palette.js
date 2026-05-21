/**
 * TV display palette derivation.
 *
 * The 4 TV display styles (stadium / brutal / boricua / telemetry) each use a
 * shared semantic palette: a "hot" primary accent, a "teal" secondary accent,
 * gold for silver-medal rank, success-green for positive deltas, plus
 * ink/cream for type-on-bg. The styles were originally hand-tuned with PR-
 * gym demo brand colors; this module derives all 8 semantic slots from the
 * gym's actual `primary_color` + `accent_color`, so each gym gets its own
 * branded TV without us hand-picking a palette per customer.
 *
 * Strategy:
 *   - `hot`  = gym.primary_color   (gym's strongest brand color)
 *   - `teal` = gym.accent_color    (gym's complementary/highlight color)
 *   - If accent is missing or too close in hue to primary, we synthesize a
 *     visually-distinct secondary by rotating the primary's hue ~150°.
 *   - `coach` / `good` / `ink` / `cream` stay functional (silver-medal gold,
 *     success green, near-black, paper cream) — they're roles, not brand.
 *   - `onHot` / `onTeal` text colors flip black/white based on luminance so
 *     "Lifter of the Month" pills stay readable on any primary color.
 */

const DEFAULT_HOT = '#FF5A2E';   // PR gym demo primary (orange)
const DEFAULT_TEAL = '#2EE0E0';  // PR gym demo accent (teal)

// ── color math ───────────────────────────────────────────────────────────
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const h = hex.replace('#', '').trim();
  if (h.length !== 6 && h.length !== 3) return null;
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r, g, b) {
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl({ r, g, b }) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  let h, s; const l = (max + min) / 2;
  if (max === min) { h = 0; s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
      case gg: h = (bb - rr) / d + 2; break;
      default: h = (rr - gg) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return rgbToHex(v, v, v);
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hueToRgb = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex(
    hueToRgb(hh + 1 / 3) * 255,
    hueToRgb(hh) * 255,
    hueToRgb(hh - 1 / 3) * 255,
  );
}

// Perceived luminance (sRGB → linear, weighted). 0 = black, 1 = white.
function luminance(rgb) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

function readableOn(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#000';
  return luminance(rgb) > 0.45 ? '#0B0F12' : '#FFFFFF';
}

// Hue distance (0–180). Used to detect when accent color is too close to
// primary to be visually distinct as a separate semantic slot.
function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

// Mix two hex colors. `amount` 0..1 — 0 = a, 1 = b.
export function mix(a, b, amount) {
  const A = hexToRgb(a), B = hexToRgb(b);
  if (!A || !B) return a;
  const t = clamp(amount, 0, 1);
  return rgbToHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t,
  );
}

// Shift saturation/lightness by additive deltas (percentage points).
export function adjust(hex, { s = 0, l = 0, h = 0 } = {}) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return hslToHex(hsl.h + h, hsl.s + s, hsl.l + l);
}

// Append an opacity to a hex color via 8-digit hex. amount: 0..1.
export function alpha(hex, amount) {
  const a = clamp(Math.round(amount * 255), 0, 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * Derive the full TV semantic palette from a gym's branding inputs.
 * Both `primary` and `accent` are optional — falls back to demo defaults.
 */
export function derivePalette({ primary, accent } = {}) {
  const hot = (typeof primary === 'string' && primary.startsWith('#')) ? primary : DEFAULT_HOT;
  let teal = (typeof accent === 'string' && accent.startsWith('#')) ? accent : DEFAULT_TEAL;

  // If primary + accent are too similar (hue distance < 30°), synthesize a
  // visually-distinct teal by rotating primary's hue ~150° while preserving
  // similar saturation/lightness so the two colors share a "tonal family."
  const hotRgb = hexToRgb(hot);
  const tealRgb = hexToRgb(teal);
  if (hotRgb && tealRgb) {
    const hotHsl = rgbToHsl(hotRgb);
    const tealHsl = rgbToHsl(tealRgb);
    if (hueDistance(hotHsl.h, tealHsl.h) < 30) {
      teal = hslToHex(hotHsl.h + 150, Math.max(60, hotHsl.s), Math.max(50, hotHsl.l));
    }
  }

  return {
    // Brand-derived
    hot,                                       // primary highlight
    teal,                                      // secondary highlight
    hotSoft:   alpha(hot, 0.12),               // tinted backgrounds
    tealSoft:  alpha(teal, 0.12),
    hotGlow:   alpha(hot, 0.45),               // radial-gradient flares
    tealGlow:  alpha(teal, 0.4),
    onHot:     readableOn(hot),                // text-on-primary
    onTeal:    readableOn(teal),

    // Functional (medal / signal — kept consistent across gyms)
    coach: '#D4AF37',     // silver-medal gold
    good:  '#2FA66B',     // success / positive delta
    bad:   '#E04D4D',     // negative delta / warning
    amber: '#FFC447',     // attention / streak

    // Surface colors
    ink:   '#0B0F12',     // near-black
    ink2:  '#11161C',     // slightly lighter surface
    ink3:  '#1A2129',     // even lighter
    cream: '#F0EEE9',     // V2's paper background

    // Text on dark
    text:        '#FFFFFF',
    textDim:     'rgba(255,255,255,0.55)',
    textFaint:   'rgba(255,255,255,0.35)',
    textGhost:   'rgba(255,255,255,0.15)',
    // Text on cream
    textInk:       '#0B0F12',
    textInkDim:    'rgba(11,15,18,0.55)',
    textInkFaint:  'rgba(11,15,18,0.3)',
  };
}

/**
 * Adaptive font-size helper. Pick a Tailwind class set based on string
 * length so long labels ("MOST IMPROVED", "CONSISTENCY") don't overflow
 * the headline that "VOLUME" fits at full size. Member names with
 * surprising lengths (5 chars or 25 chars) also need this.
 *
 *   sizeForLabel('VOLUME', [
 *     { maxLen: 7,  classes: 'text-[140px]' },
 *     { maxLen: 11, classes: 'text-[110px]' },
 *     { maxLen: 99, classes: 'text-[84px]'  },
 *   ]) // → 'text-[140px]'
 *
 * First matching range wins; the last range acts as fallback for anything
 * longer than its maxLen.
 */
export function sizeForLabel(text, ranges) {
  const len = (text || '').length;
  for (const r of ranges) {
    if (len <= r.maxLen) return r.classes;
  }
  return ranges[ranges.length - 1]?.classes || '';
}

// Style metadata — used by AdminTVDisplay to render the picker.
export const TV_STYLES = [
  { id: 'stadium',   label: 'Dark Stadium',    description: 'Podium hero · big tabular numerals · ESPN/Crossfit energy' },
  { id: 'brutal',    label: 'Brutalist Board', description: 'Cream + ink editorial scoreboard · race-results feel' },
  { id: 'boricua',   label: 'Boricua Heat',    description: 'Tropical sunset palette · 3-column podium · hometown energy' },
  { id: 'telemetry', label: 'Live Telemetry',  description: 'Mission-control monospace · dense signal · ops dashboard' },
];

// Shared metric metadata (V1-V4 all show one of these per slide).
export const TV_METRIC_DEFS = [
  { key: 'volume',      label: 'Volume',        unit: 'LBS',      period: '30 DAYS' },
  { key: 'workouts',    label: 'Workouts',      unit: 'SESSIONS', period: '30 DAYS' },
  { key: 'prs',         label: 'Top PRs',       unit: '1RM',      period: 'ALL TIME' },
  { key: 'improved',    label: 'Most Improved', unit: '%',        period: 'THIS MONTH' },
  { key: 'consistency', label: 'Consistency',   unit: '%',        period: 'THIS MONTH' },
  { key: 'checkins',    label: 'Check-ins',     unit: 'VISITS',   period: '30 DAYS' },
];
