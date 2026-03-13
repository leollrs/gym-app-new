import React, { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Instagram/Kindle-style swipeable tab container.
 * Renders all children side-by-side and slides between them with touch drag.
 *
 * Props:
 *   activeIndex  – current tab index (controlled)
 *   onChangeIndex – called with new index on swipe complete
 *   children     – one element per tab panel
 *   tabKeys      – optional array of tab keys for aria-labelledby linkage
 */
export default function SwipeableTabView({ activeIndex, onChangeIndex, children, tabKeys }) {
  const containerRef = useRef(null);
  const touchRef = useRef({ startX: 0, startY: 0, currentX: 0, dragging: false, locked: null });
  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const count = React.Children.count(children);

  // Reset offset when activeIndex changes externally (e.g. tab button tap)
  useEffect(() => {
    setOffset(0);
    setTransitioning(true);
    const t = setTimeout(() => setTransitioning(false), 300);
    return () => clearTimeout(t);
  }, [activeIndex]);

  const onTouchStart = useCallback((e) => {
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      currentX: e.touches[0].clientX,
      dragging: true,
      locked: null,
    };
    setTransitioning(false);
  }, []);

  const onTouchMove = useCallback((e) => {
    const t = touchRef.current;
    if (!t.dragging) return;

    const dx = e.touches[0].clientX - t.startX;
    const dy = e.touches[0].clientY - t.startY;

    // Lock direction on first significant move
    if (t.locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      t.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }

    if (t.locked === 'v') return;
    if (t.locked === 'h') {
      // Prevent vertical scroll while swiping horizontally
      e.preventDefault();
    }

    t.currentX = e.touches[0].clientX;

    // Apply resistance at edges
    let raw = dx;
    if ((activeIndex === 0 && raw > 0) || (activeIndex === count - 1 && raw < 0)) {
      raw = raw * 0.25; // rubber band
    }

    setOffset(raw);
  }, [activeIndex, count]);

  const onTouchEnd = useCallback(() => {
    const t = touchRef.current;
    t.dragging = false;

    if (t.locked !== 'h') {
      setOffset(0);
      return;
    }

    const dx = t.currentX - t.startX;
    const containerWidth = containerRef.current?.offsetWidth || 375;
    const threshold = containerWidth * 0.2; // 20% of width to trigger

    let newIndex = activeIndex;
    if (dx < -threshold && activeIndex < count - 1) {
      newIndex = activeIndex + 1;
    } else if (dx > threshold && activeIndex > 0) {
      newIndex = activeIndex - 1;
    }

    setOffset(0);
    setTransitioning(true);
    setTimeout(() => setTransitioning(false), 300);

    if (newIndex !== activeIndex) {
      onChangeIndex(newIndex);
    }
  }, [activeIndex, count, onChangeIndex]);

  const translateX = -activeIndex * 100 + (offset / (containerRef.current?.offsetWidth || 375)) * 100;

  return (
    <div
      ref={containerRef}
      className="overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex"
        style={{
          transform: `translateX(${translateX}%)`,
          transition: transitioning ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
          willChange: 'transform',
        }}
      >
        {React.Children.map(children, (child, i) => (
          <div
            key={i}
            role="tabpanel"
            id={tabKeys?.[i] ? `tabpanel-${tabKeys[i]}` : undefined}
            aria-labelledby={tabKeys?.[i] ? `tab-${tabKeys[i]}` : undefined}
            aria-hidden={i !== activeIndex}
            className="w-full shrink-0"
            style={{ minHeight: i === activeIndex ? 'auto' : 0 }}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
