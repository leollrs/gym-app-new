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
