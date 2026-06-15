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
  const trackRef = useRef(null);
  const touchRef = useRef({ startX: 0, startY: 0, currentX: 0, startTime: 0, dragging: false, locked: null });
  // Ref-based timeout trackers so we don't leak timers across gestures / renders
  const settleTimerRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  // Track which panels should be visible (active + neighbors during animation)
  const [visiblePanels, setVisiblePanels] = useState(new Set([0]));
  const count = React.Children.count(children);

  // Centralised helper: clear any pending settle timer and hard-reset interaction flags.
  // This is the critical fix: guarantees pointer-events / touch-action / drag locks
  // are never left in a "half-swiped" state that would block subsequent button taps.
  const clearInteractionLocks = useCallback(() => {
    touchRef.current.dragging = false;
    touchRef.current.locked = null;
    const track = trackRef.current;
    if (track) {
      // Defensively clear any inline styles that might have been set during drag
      track.style.pointerEvents = '';
      track.style.touchAction = '';
    }
  }, []);

  const scheduleSettle = useCallback((finalIndex) => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      setTransitioning(false);
      setVisiblePanels(new Set([finalIndex]));
      clearInteractionLocks();
    }, 320);
  }, [clearInteractionLocks]);

  // Reset offset when activeIndex changes externally (e.g. tab button tap)
  useEffect(() => {
    setOffset(0);
    setTransitioning(true);
    // Show current and adjacent panels during transition
    const panels = new Set([activeIndex]);
    if (activeIndex > 0) panels.add(activeIndex - 1);
    if (activeIndex < count - 1) panels.add(activeIndex + 1);
    setVisiblePanels(panels);
    scheduleSettle(activeIndex);
    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [activeIndex, count, scheduleSettle]);

  const onTouchStart = useCallback((e) => {
    const { target } = e;
    // Bail for form controls + explicit opt-outs (a tap/drag there must pass
    // through). NOT buttons/cards — bailing on those killed swiping across dense
    // list UIs (e.g. trainer Planes); a plain tap still works because it never
    // locks 'h', so the click fires on touchend.
    if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"], [data-swipe-ignore]')) {
      touchRef.current.dragging = false;
      touchRef.current.locked = null;
      return;
    }
    // Bail when the touch begins inside a horizontally-scrollable region so the
    // user can scroll those rows (template/day/filter chips) instead of paging
    // tabs. This is what the old blanket button-bail was really protecting.
    let el = target;
    while (el && el !== containerRef.current && el.nodeType === 1) {
      if (el.scrollWidth > el.clientWidth + 4) {
        const ox = window.getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') {
          touchRef.current.dragging = false;
          touchRef.current.locked = null;
          return;
        }
      }
      el = el.parentElement;
    }

    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      currentX: e.touches[0].clientX,
      startTime: Date.now(),
      dragging: true,
      locked: null,
    };
    // NOTE: don't mount neighbor panels yet — wait until we've confirmed
    // a horizontal drag. That way a plain tap never triggers a heavy re-render
    // of sibling tabs, which is what was racing with click dispatch.
  }, []);

  const onTouchMove = useCallback((e) => {
    const t = touchRef.current;
    if (!t.dragging) return;

    const dx = e.touches[0].clientX - t.startX;
    const dy = e.touches[0].clientY - t.startY;

    // Lock direction on first significant move. Require dx > dy AND dx > 8px
    // for horizontal lock — otherwise prefer vertical so page scroll is smooth.
    if (t.locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
        t.locked = 'h';
        // Only now — once we KNOW it's a horizontal swipe — mount neighbors
        const panels = new Set([activeIndex]);
        if (activeIndex > 0) panels.add(activeIndex - 1);
        if (activeIndex < count - 1) panels.add(activeIndex + 1);
        setVisiblePanels(panels);
        setTransitioning(false);
      } else {
        t.locked = 'v';
      }
    }

    if (t.locked !== 'h') return;

    // Horizontal swipe confirmed — prevent vertical scroll jitter
    // (React 17+ listeners are passive, so preventDefault is a no-op there;
    // that's fine — touchAction:pan-y on the container is what actually blocks it).
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();

    t.currentX = e.touches[0].clientX;

    // Apply resistance at edges
    let raw = dx;
    if ((activeIndex === 0 && raw > 0) || (activeIndex === count - 1 && raw < 0)) {
      raw *= 0.25; // rubber band
    }

    setOffset(raw);
  }, [activeIndex, count]);

  const onTouchEnd = useCallback(() => {
    const t = touchRef.current;
    const wasHorizontal = t.locked === 'h';
    t.dragging = false;

    if (!wasHorizontal) {
      // Pure tap or vertical scroll — make sure nothing is stuck
      setOffset(0);
      setVisiblePanels(new Set([activeIndex]));
      clearInteractionLocks();
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

    if (newIndex !== activeIndex) {
      // Commit the change; the parent will feed the new activeIndex back in
      // and the useEffect will schedule the final settle. Meanwhile we still
      // fall through to scheduleSettle below as a safety net so flags can
      // never get stuck if the parent ignores the callback.
      onChangeIndex(newIndex);
    }

    // Always schedule a settle — works for swipe-back (newIndex === activeIndex)
    // AND as a belt-and-suspenders for the commit path.
    scheduleSettle(newIndex);
  }, [activeIndex, count, onChangeIndex, scheduleSettle, clearInteractionLocks]);

  const onTouchCancel = useCallback(() => {
    // OS can cancel a touch (e.g. phone call, notification). Never leave the
    // track mid-drag — always snap back and release all locks.
    setOffset(0);
    setTransitioning(true);
    scheduleSettle(activeIndex);
  }, [activeIndex, scheduleSettle]);

  const translateX = -activeIndex * 100 + (offset / (containerRef.current?.offsetWidth || 375)) * 100;

  return (
    <div
      ref={containerRef}
      className="overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div
        ref={trackRef}
        className="flex"
        style={{
          transform: `translateX(${translateX}%)`,
          transition: transitioning ? 'transform 0.3s cubic-bezier(0.22, 0.68, 0.35, 1.0)' : 'none',
          willChange: 'transform',
        }}
      >
        {React.Children.map(children, (child, i) => {
          const isVisible = visiblePanels.has(i);
          const isActive = i === activeIndex;
          return (
            <div
              key={i}
              role="tabpanel"
              id={tabKeys?.[i] ? `tabpanel-${tabKeys[i]}` : undefined}
              aria-labelledby={tabKeys?.[i] ? `tab-${tabKeys[i]}` : undefined}
              aria-hidden={!isActive}
              className="w-full shrink-0"
              style={
                isVisible
                  ? {
                      minHeight: 1,
                      // Inactive but visible (neighbor during swipe) must not steal clicks
                      pointerEvents: isActive ? 'auto' : 'none',
                    }
                  : { height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }
              }
            >
              {child}
            </div>
          );
        })}
      </div>
    </div>
  );
}
