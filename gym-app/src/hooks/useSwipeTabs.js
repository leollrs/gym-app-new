import { useRef, useCallback } from 'react';

/**
 * Lightweight horizontal-swipe hook for tab navigation.
 * Returns { onTouchStart, onTouchEnd } handlers to spread on the content container.
 *
 * @param {string[]} tabs     – ordered list of tab keys
 * @param {string}   current  – currently active tab key
 * @param {function} onChange  – called with the new tab key on swipe
 * @param {object}   [opts]
 * @param {number}   [opts.threshold=50] – minimum px distance to count as swipe
 */
export default function useSwipeTabs(tabs, current, onChange, opts = {}) {
  const threshold = opts.threshold ?? 50;
  const startX = useRef(0);
  const startY = useRef(0);

  const onTouchStart = useCallback((e) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e) => {
    const dx = e.changedTouches[0].clientX - startX.current;
    const dy = e.changedTouches[0].clientY - startY.current;

    // Only trigger if horizontal swipe is dominant
    if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return;

    const idx = tabs.indexOf(current);
    if (idx === -1) return;

    if (dx < 0 && idx < tabs.length - 1) {
      onChange(tabs[idx + 1]);
    } else if (dx > 0 && idx > 0) {
      onChange(tabs[idx - 1]);
    }
  }, [tabs, current, onChange, threshold]);

  return { onTouchStart, onTouchEnd };
}
