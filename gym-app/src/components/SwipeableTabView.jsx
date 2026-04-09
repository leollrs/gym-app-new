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
  const touchRef = useRef({ startX: 0, startY: 0, currentX: 0, startTime: 0, dragging: false, locked: null });
  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  // Track which panels should be visible (active + neighbors during animation)
  const [visiblePanels, setVisiblePanels] = useState(new Set([0]));
  const count = React.Children.count(children);

  // Reset offset when activeIndex changes externally (e.g. tab button tap)
  useEffect(() => {
    setOffset(0);
    setTransitioning(true);
    // Show current and adjacent panels during transition
    const panels = new Set([activeIndex]);
    if (activeIndex > 0) panels.add(activeIndex - 1);
    if (activeIndex < count - 1) panels.add(activeIndex + 1);
    setVisiblePanels(panels);
    const t = setTimeout(() => {
      setTransitioning(false);
      // After transition, only keep active panel visible
      setVisiblePanels(new Set([activeIndex]));
    }, 320);
    return () => clearTimeout(t);
  }, [activeIndex, count]);

  const onTouchStart = useCallback((e) => {
    // Show adjacent panels so they're visible during drag
    const panels = new Set([activeIndex]);
    if (activeIndex > 0) panels.add(activeIndex - 1);
    if (activeIndex < count - 1) panels.add(activeIndex + 1);
    setVisiblePanels(panels);

    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      currentX: e.touches[0].clientX,
      startTime: Date.now(),
      dragging: true,
      locked: null,
    };
    setTransitioning(false);
  }, [activeIndex, count]);

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
      // Stop propagation so parent swipe handlers don't fire
      e.stopPropagation();
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
      // Collapse back to just active panel
      setVisiblePanels(new Set([activeIndex]));
      return;
    }

    const dx = t.currentX - t.startX;
    const elapsed = Date.now() - t.startTime;
    const velocity = Math.abs(dx) / Math.max(elapsed, 1); // px/ms
    const containerWidth = containerRef.current?.offsetWidth || 375;

    // Use either distance threshold (20%) or velocity threshold (fast flick)
    const distanceThreshold = containerWidth * 0.2;
    const isQuickFlick = velocity > 0.4 && Math.abs(dx) > 30;

    let newIndex = activeIndex;
    if ((dx < -distanceThreshold || (isQuickFlick && dx < 0)) && activeIndex < count - 1) {
      newIndex = activeIndex + 1;
    } else if ((dx > distanceThreshold || (isQuickFlick && dx > 0)) && activeIndex > 0) {
      newIndex = activeIndex - 1;
    }

    setOffset(0);
    setTransitioning(true);
    setTimeout(() => {
      setTransitioning(false);
      setVisiblePanels(new Set([newIndex]));
    }, 320);

    if (newIndex !== activeIndex) {
      onChangeIndex(newIndex);
    }
  }, [activeIndex, count, onChangeIndex]);

  const translateX = -activeIndex * 100 + (offset / (containerRef.current?.offsetWidth || 375)) * 100;

  return (
    <div
      ref={containerRef}
      className="overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex"
        style={{
          transform: `translateX(${translateX}%)`,
          transition: transitioning ? 'transform 0.3s cubic-bezier(0.22, 0.68, 0.35, 1.0)' : 'none',
          willChange: 'transform',
        }}
      >
        {React.Children.map(children, (child, i) => {
          const isVisible = visiblePanels.has(i);
          return (
            <div
              key={i}
              role="tabpanel"
              id={tabKeys?.[i] ? `tabpanel-${tabKeys[i]}` : undefined}
              aria-labelledby={tabKeys?.[i] ? `tab-${tabKeys[i]}` : undefined}
              aria-hidden={i !== activeIndex}
              className="w-full shrink-0"
              style={isVisible ? { minHeight: 1 } : { height: 0, overflow: 'hidden', visibility: 'hidden' }}
            >
              {child}
            </div>
          );
        })}
      </div>
    </div>
  );
}
