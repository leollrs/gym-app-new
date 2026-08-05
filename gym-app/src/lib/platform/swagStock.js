/**
 * Pure stock arithmetic for the swag inventory (mig 0682).
 *
 * The server RPCs answer "what do I own" and "what does each gym own". This
 * module answers the one question the packing UI needs and the server cannot:
 * how much is still free to put in a NEW box.
 *
 * The distinction is the whole point, and it is easy to get wrong:
 * `platform_swag_stock().on_hand` subtracts only SHIPPED boxes, because a
 * packed-but-unshipped box is still physically in the warehouse. But those
 * units are already spoken for — packing them twice is exactly the mistake this
 * feature exists to prevent.
 */

/**
 * Units of `itemId` already committed to boxes that are packed but not yet
 * shipped. Shipped boxes are excluded: the stock RPC has already deducted them.
 */
export function committedToPackedBoxes(itemId, boxes = []) {
  let total = 0;
  for (const box of boxes) {
    if (!box || box.status !== 'packed') continue;
    for (const line of box.items || []) {
      if (line?.item_id !== itemId) continue;
      const qty = Number(line.qty);
      if (Number.isFinite(qty) && qty > 0) total += qty;
    }
  }
  return total;
}

/**
 * How many units of `itemId` can still be packed into a new box.
 *
 * `onHand` comes straight from platform_swag_stock(). Never returns negative:
 * an over-packed state is real (someone packed before a purchase was recorded)
 * and the UI should read it as zero available, not as a negative allowance.
 */
export function availableToPack(itemId, onHand, boxes = []) {
  const hand = Number(onHand);
  if (!Number.isFinite(hand)) return 0;
  return Math.max(0, hand - committedToPackedBoxes(itemId, boxes));
}

/**
 * Roll up a box's contents for the label and the shipping confirmation.
 * `costOf(itemId)` returns unit cost in cents; missing items cost nothing
 * rather than poisoning the total with NaN.
 */
export function boxTotals(boxItems = [], costOf = () => 0) {
  let units = 0;
  let costCents = 0;
  for (const line of boxItems) {
    const qty = Number(line?.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    units += qty;
    const unit = Number(costOf(line.item_id));
    if (Number.isFinite(unit)) costCents += unit * qty;
  }
  return { units, costCents };
}

/** Cents → "$12.00". Kept here so the tests pin the rounding too. */
export function formatCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${(n / 100).toFixed(2)}`;
}
