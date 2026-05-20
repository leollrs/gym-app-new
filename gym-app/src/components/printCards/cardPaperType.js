/**
 * Tiny lookup separated from CardDispatcher so the dispatcher file can
 * stay components-only (satisfies react-refresh/only-export-components).
 *
 * Folded cards (tenure_365, milestone_500) print as outside + inside
 * spreads on a single US Letter landscape sheet; everything else is a
 * 4×6 portrait postcard.
 */
const FOLDED_OCCASIONS = new Set(['tenure_365', 'milestone_500']);

export function getCardPaperType(occasion) {
  return FOLDED_OCCASIONS.has(occasion) ? 'folded' : 'postcard';
}
