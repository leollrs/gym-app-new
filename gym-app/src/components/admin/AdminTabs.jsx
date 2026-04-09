import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Responsive admin tab bar.
 */
export default function AdminTabs({ tabs, active, onChange, className = '', idPrefix = 'admin-tab', equalWidth = true }) {
  const containerRef = useRef(null);
  const tabRefs = useRef([]);
  const activeIndex = tabs.findIndex(t => t.key === active);

  useEffect(() => {
    const el = tabRefs.current[activeIndex];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeIndex]);

  const handleKeyDown = (e, i) => {
    let next = i;
    if (e.key === 'ArrowRight') { e.preventDefault(); next = (i + 1) % tabs.length; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); next = (i - 1 + tabs.length) % tabs.length; }
    else if (e.key === 'Home') { e.preventDefault(); next = 0; }
    else if (e.key === 'End') { e.preventDefault(); next = tabs.length - 1; }
    else return;
    onChange(tabs[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={equalWidth ? 'grid gap-2' : 'flex overflow-x-auto scrollbar-hide -mx-4 px-4 gap-4'}
        style={equalWidth ? { gridTemplateColumns: `repeat(${tabs.length}, 1fr)` } : undefined}
        role="tablist"
      >
        {tabs.map((tab, i) => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={el => tabRefs.current[i] = el}
              id={`${idPrefix}-${tab.key}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`${idPrefix}-panel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className={`flex flex-col items-center justify-center gap-0 py-2.5 font-semibold border-b-2 transition-colors ${
                equalWidth ? 'text-[13px] text-center leading-snug' : 'flex-row whitespace-nowrap shrink-0 px-3 text-[13px] gap-1.5'
              } ${
                isActive ? 'border-[#D4AF37] text-[#D4AF37]' : 'border-transparent text-[#6B7280] hover:text-[#E5E7EB]'
              }`}
            >
              {Icon && <Icon size={14} className="hidden md:block" />}
              {equalWidth && tab.label.includes(' ') ? (
                tab.label.split(' ').map((word, wi) => <span key={wi}>{word}</span>)
              ) : tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/8 text-[#6B7280]'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="h-[1px] bg-white/[0.06]" />
    </div>
  );
}

/**
 * Swipeable tab content container.
 * Renders all panels side-by-side and slides between them on swipe.
 * Shows the page sliding in real-time as you drag.
 *
 * Usage:
 *   <SwipeableTabContent tabs={TABS} active={activeTab} onChange={setActiveTab}>
 *     {(tab) => {
 *       if (tab === 'schedule') return <ScheduleView ... />;
 *       if (tab === 'classes')  return <ClassesView ... />;
 *       ...
 *     }}
 *   </SwipeableTabContent>
 *
 * Or with children array:
 *   <SwipeableTabContent tabs={TABS} active={activeTab} onChange={setActiveTab}>
 *     <ScheduleView />
 *     <ClassesView />
 *     <BookingsView />
 *   </SwipeableTabContent>
 */
export function SwipeableTabContent({ tabs, active, onChange, children, className = '' }) {
  const containerRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const isHorizontal = useRef(false);
  const decided = useRef(false);

  const activeIndex = tabs.findIndex(t => t.key === active);
  const tabCount = tabs.length;

  const onTouchStart = useCallback((e) => {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
    isHorizontal.current = false;
    decided.current = false;
    setIsDragging(true);
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!touchStartX.current) return;
    const currentX = e.targetTouches[0].clientX;
    const currentY = e.targetTouches[0].clientY;
    const dx = currentX - touchStartX.current;
    const dy = currentY - touchStartY.current;

    // Decide direction on first significant movement
    if (!decided.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      decided.current = true;
      isHorizontal.current = Math.abs(dx) > Math.abs(dy);
    }

    if (!isHorizontal.current) return;

    // Prevent vertical scroll while swiping horizontally
    e.preventDefault();

    // Clamp drag at edges with rubber-band effect
    const aIdx = tabs.findIndex(t => t.key === active);
    let offset = dx;
    if ((aIdx === 0 && dx > 0) || (aIdx === tabCount - 1 && dx < 0)) {
      offset = dx * 0.3; // rubber band
    }
    setDragOffset(offset);
  }, [active, tabs, tabCount]);

  const onTouchEnd = useCallback(() => {
    if (!isHorizontal.current || !touchStartX.current) {
      setIsDragging(false);
      setDragOffset(0);
      touchStartX.current = null;
      return;
    }

    const aIdx = tabs.findIndex(t => t.key === active);
    const threshold = 50;

    if (dragOffset < -threshold && aIdx < tabCount - 1) {
      onChange(tabs[aIdx + 1].key);
    } else if (dragOffset > threshold && aIdx > 0) {
      onChange(tabs[aIdx - 1].key);
    }

    setIsDragging(false);
    setDragOffset(0);
    touchStartX.current = null;
    touchStartY.current = null;
  }, [dragOffset, tabs, active, onChange, tabCount]);

  // Determine which panels to show: active + adjacent during drag
  const adjacentIndex = isDragging
    ? (dragOffset < 0 ? activeIndex + 1 : dragOffset > 0 ? activeIndex - 1 : -1)
    : -1;

  const renderPanel = (tab, i) => {
    const isActive = i === activeIndex;
    const isAdjacent = i === adjacentIndex;
    const shouldRender = isActive || isAdjacent;

    const content = typeof children === 'function'
      ? children(tab.key)
      : (Array.isArray(children) ? children : [children])[i] || null;

    return (
      <div
        key={tab.key}
        className="w-full shrink-0"
        style={{
          // Only the active panel takes up height; others collapse
          ...(isActive ? {} : { height: 0, overflow: 'hidden' }),
        }}
      >
        {shouldRender ? content : null}
      </div>
    );
  };

  const translateX = -(activeIndex * 100) + (isDragging ? (dragOffset / (containerRef.current?.offsetWidth || 375)) * 100 : 0);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden min-h-[50vh] ${className}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="flex items-start"
        style={{
          transform: `translateX(${translateX}%)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          willChange: 'transform',
        }}
      >
        {tabs.map((tab, i) => renderPanel(tab, i))}
      </div>
    </div>
  );
}

/** @deprecated Use SwipeableTabContent instead */
export function useSwipeTabs(tabs, active, onChange) {
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const touchEndX = useRef(null);
  const swiping = useRef(false);

  const onTouchStart = useCallback((e) => {
    touchEndX.current = null;
    swiping.current = false;
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!touchStartX.current) return;
    touchEndX.current = e.targetTouches[0].clientX;
    const dx = Math.abs(touchEndX.current - touchStartX.current);
    const dy = Math.abs(e.targetTouches[0].clientY - (touchStartY.current || 0));
    if (dx > dy && dx > 15) swiping.current = true;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!touchStartX.current || !touchEndX.current || !swiping.current) {
      touchStartX.current = null; touchEndX.current = null; return;
    }
    const distance = touchStartX.current - touchEndX.current;
    const activeIndex = tabs.findIndex(t => t.key === active);
    if (Math.abs(distance) >= 40) {
      if (distance > 0 && activeIndex < tabs.length - 1) onChange(tabs[activeIndex + 1].key);
      else if (distance < 0 && activeIndex > 0) onChange(tabs[activeIndex - 1].key);
    }
    touchStartX.current = null; touchEndX.current = null; swiping.current = false;
  }, [tabs, active, onChange]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
