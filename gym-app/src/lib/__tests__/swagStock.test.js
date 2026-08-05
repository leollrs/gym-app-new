import { describe, it, expect } from 'vitest';
import {
  committedToPackedBoxes, availableToPack, boxTotals, formatCents,
} from '../platform/swagStock';

const BULTO = 'item-bulto';
const VASO  = 'item-vaso';

const packed  = (items) => ({ status: 'packed',  items });
const shipped = (items) => ({ status: 'shipped', items });

describe('committedToPackedBoxes', () => {
  it('sums only the matching item, across boxes', () => {
    const boxes = [
      packed([{ item_id: BULTO, qty: 3 }, { item_id: VASO, qty: 10 }]),
      packed([{ item_id: BULTO, qty: 2 }]),
    ];
    expect(committedToPackedBoxes(BULTO, boxes)).toBe(5);
    expect(committedToPackedBoxes(VASO, boxes)).toBe(10);
  });

  // THE ONE THAT MATTERS. platform_swag_stock() already deducts shipped boxes;
  // counting them here too would double-subtract and make stock read low.
  it('ignores shipped boxes — the server already deducted those', () => {
    const boxes = [packed([{ item_id: BULTO, qty: 3 }]), shipped([{ item_id: BULTO, qty: 40 }])];
    expect(committedToPackedBoxes(BULTO, boxes)).toBe(3);
  });

  it('survives junk rows without poisoning the sum', () => {
    const boxes = [
      packed([{ item_id: BULTO, qty: '4' }, { item_id: BULTO, qty: null }, { item_id: BULTO, qty: -2 }]),
      null,
      packed(undefined),
    ];
    expect(committedToPackedBoxes(BULTO, boxes)).toBe(4);
    expect(committedToPackedBoxes(BULTO, [])).toBe(0);
    expect(committedToPackedBoxes(BULTO)).toBe(0);
  });
});

describe('availableToPack', () => {
  it('is on-hand minus what is already sitting in packed boxes', () => {
    const boxes = [packed([{ item_id: BULTO, qty: 10 }])];
    expect(availableToPack(BULTO, 100, boxes)).toBe(90);
  });

  it('does not deduct a shipped box twice', () => {
    // 100 bought, 40 shipped → server says on_hand 60. A packed box holds 10.
    const boxes = [shipped([{ item_id: BULTO, qty: 40 }]), packed([{ item_id: BULTO, qty: 10 }])];
    expect(availableToPack(BULTO, 60, boxes)).toBe(50);
  });

  // Over-packing is a real state (packed before the purchase was recorded).
  // It must read as "nothing available", never as a negative allowance that a
  // quantity input would happily accept.
  it('floors at zero instead of going negative', () => {
    const boxes = [packed([{ item_id: BULTO, qty: 25 }])];
    expect(availableToPack(BULTO, 10, boxes)).toBe(0);
  });

  it('treats unknown stock as zero, not as unlimited', () => {
    expect(availableToPack(BULTO, undefined, [])).toBe(0);
    expect(availableToPack(BULTO, null, [])).toBe(0);
    expect(availableToPack(BULTO, 'many', [])).toBe(0);
  });
});

describe('boxTotals', () => {
  const cost = (id) => ({ [BULTO]: 1200, [VASO]: 300 }[id]);

  it('adds up units and cost', () => {
    expect(boxTotals([{ item_id: BULTO, qty: 2 }, { item_id: VASO, qty: 5 }], cost))
      .toEqual({ units: 7, costCents: 2 * 1200 + 5 * 300 });
  });

  it('skips an unpriced item rather than returning NaN', () => {
    expect(boxTotals([{ item_id: 'unknown', qty: 3 }], cost)).toEqual({ units: 3, costCents: 0 });
  });

  it('is zero for an empty box', () => {
    expect(boxTotals([], cost)).toEqual({ units: 0, costCents: 0 });
    expect(boxTotals(undefined, cost)).toEqual({ units: 0, costCents: 0 });
  });
});

describe('formatCents', () => {
  it('formats whole and fractional dollars', () => {
    expect(formatCents(1200)).toBe('$12.00');
    expect(formatCents(1250)).toBe('$12.50');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('never renders NaN at the founder', () => {
    expect(formatCents(undefined)).toBe('$0.00');
    expect(formatCents(null)).toBe('$0.00');
    expect(formatCents('abc')).toBe('$0.00');
  });
});
