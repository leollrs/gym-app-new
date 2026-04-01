/**
 * Format large numbers for stat displays to prevent overflow.
 *
 * - Numbers >= 1,000,000 become "1.2M"
 * - Numbers >= 10,000   become "12.3k"
 * - Numbers < 10,000    are returned as-is (with locale formatting)
 *
 * @param {number|string} value - The numeric value to format
 * @param {object} [opts]
 * @param {number} [opts.kThreshold=10000] - Threshold for "k" formatting (default 10000)
 * @returns {string} Formatted string
 */
export function formatStatNumber(value) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (n == null || isNaN(n)) return '—';

  if (Math.abs(n) >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (Math.abs(n) >= 10_000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }

  return n.toLocaleString();
}

/**
 * Returns a Tailwind font-size class that shrinks for longer strings.
 *
 * @param {string|number} displayValue - The already-formatted display string (or raw number)
 * @param {string} [baseSize='text-[22px]'] - Default size for short values
 * @returns {string} Tailwind class like "text-[22px]", "text-[18px]", or "text-[15px]"
 */
export function statFontSize(displayValue, baseSize = 'text-[22px]') {
  const len = String(displayValue ?? '').length;
  if (len >= 7) return 'text-[15px]';
  if (len >= 5) return 'text-[18px]';
  return baseSize;
}
