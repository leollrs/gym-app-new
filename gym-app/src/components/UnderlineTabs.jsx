import React, { useRef, useEffect, useState } from 'react';

/**
 * Strava-style underline tab bar.
 * Labels separated visually, active tab gets a sliding gold underline.
 *
 * Props:
 *   tabs        – array of { key, label } or just strings
 *   activeIndex – current active tab index
 *   onChange    – called with new index
 */
export default function UnderlineTabs({ tabs, activeIndex, onChange, scrollable = false }) {
  const containerRef = useRef(null);
  const tabRefs = useRef([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const normalized = tabs.map(t => (typeof t === 'string' ? { key: t, label: t } : t));

  useEffect(() => {
    const el = tabRefs.current[activeIndex];
    if (el) {
      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const tabRect = el.getBoundingClientRect();
      setIndicator({
        left: tabRect.left - containerRect.left + container.scrollLeft,
        width: tabRect.width,
      });
      // Scroll active tab into view on mobile
      if (scrollable) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeIndex, normalized.length, scrollable]);

  const handleKeyDown = (e, i) => {
    let newIndex = i;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      newIndex = (i + 1) % normalized.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      newIndex = (i - 1 + normalized.length) % normalized.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      newIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      newIndex = normalized.length - 1;
    } else {
      return;
    }
    onChange(newIndex);
    tabRefs.current[newIndex]?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${scrollable ? 'overflow-x-auto scrollbar-hide' : ''}`}>
      <div className={`flex ${scrollable ? 'w-max min-w-full' : ''}`} role="tablist">
        {normalized.map((tab, i) => (
          <button
            key={tab.key}
            ref={el => tabRefs.current[i] = el}
            role="tab"
            aria-selected={i === activeIndex}
            aria-controls={`tabpanel-${tab.key}`}
            id={`tab-${tab.key}`}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => onChange(i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`${scrollable ? 'shrink-0 px-4' : 'flex-1'} py-2.5 min-h-[44px] text-[13px] font-semibold text-center transition-colors relative whitespace-nowrap ${
              i === activeIndex
                ? 'text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)]'
            }`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                i === activeIndex ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Bottom border */}
      <div className="h-[1px]" style={{ background: 'var(--color-border-subtle)' }} />
      {/* Sliding underline */}
      <div
        className="absolute bottom-0 h-[2px] rounded-full transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width, background: 'var(--color-accent)' }}
      />
    </div>
  );
}
