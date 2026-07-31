// brandAccent.js
// -----------------------------------------------------------------------------
// The gym's brand colour, for anything rendered into a share card.
//
// Every share template took `accent` as a prop with a hardcoded default, and
// every caller passed a hardcoded hex: #D4AF37 for PRs, #FF5A2E for streaks and
// the poster layout, #2EC4C4 for body-comp and the monthly recap. So a member of
// any gym shared a card in TuGymPR's colours — on a white-label product, on the
// single most public surface it has.
//
// The gym's real colour is already on the page. applyBranding() writes
// `--accent-primary` (and the legacy `--accent-gold`) from
// gym_branding.primary_color on every boot. Nothing was reading it.
//
// Returns a resolved HEX, never a `var(...)`: these cards get serialised by
// rasterizeNode into an <svg><foreignObject>, and a custom property that
// resolves against :root at paint time is not guaranteed to survive that trip.
// Resolving here means the card carries a literal colour into the PNG.
// -----------------------------------------------------------------------------

// Only used when there is no branding at all — a logged-out surface, or a gym
// that never set a colour. Matches the app's own default accent.
const FALLBACK = '#2EC4C4';

// Share templates paint the gym's colour as TEXT, not only as a fill: the poster
// puts it on a near-black stat card over a cream page, the PR sticker puts it on
// a dark frosted panel. Those layouts were designed around fixed mid-luminance
// brand colours (#FF5A2E, #D4AF37) that read on both. Feed them a gym whose
// primary is navy or near-black and the label vanishes into the card.
//
// So: nudge the colour AWAY from whatever it sits on until WCAG contrast clears,
// keeping the hue. A gym with a dark brand still gets its own colour, just a
// legible tint of it — better than silently falling back to a generic accent,
// which would defeat the point of white-labelling in the first place.
const hex2rgb = (h) => {
  const s = String(h || '').replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  const n = parseInt(f, 16);
  return Number.isNaN(n) ? null : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgb2hex = ({ r, g, b }) =>
  '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
const lum = (rgb) => {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * @param color  the gym's accent hex
 * @param bg     the hex it will be drawn on
 * @param min    target WCAG contrast (4.5 = normal text; these are large/bold,
 *               but cards get resized and recompressed, so aim high)
 */
export function readableOn(color, bg, min = 4.5) {
  const c = hex2rgb(color);
  const b = hex2rgb(bg);
  if (!c || !b) return color;
  if (ratio(c, b) >= min) return color;
  // Move toward white on a dark background, toward black on a light one.
  const target = lum(b) < 0.18 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  let best = c;
  for (let t = 0.08; t <= 1; t += 0.08) {
    const mixed = {
      r: c.r + (target.r - c.r) * t,
      g: c.g + (target.g - c.g) * t,
      b: c.b + (target.b - c.b) * t,
    };
    best = mixed;
    if (ratio(mixed, b) >= min) break;
  }
  return rgb2hex(best);
}

export function gymAccent(fallback = FALLBACK) {
  if (typeof window === 'undefined' || !document?.documentElement) return fallback;
  try {
    const cs = getComputedStyle(document.documentElement);
    // --accent-primary is the canonical one; --accent-gold is the legacy alias
    // applyBranding still sets, kept as a second look-up so a partially applied
    // theme doesn't silently fall through to the generic teal.
    const v = (cs.getPropertyValue('--accent-primary') || cs.getPropertyValue('--accent-gold') || '').trim();
    // Guard against an unresolved var or an empty custom property.
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
