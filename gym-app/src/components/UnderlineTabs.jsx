import React, { useRef, useEffect } from 'react';

/**
 * Plain-text underline tab bar.
 * Active tab: fontWeight 800, accent underline. Inactive: fontWeight 600, transparent border.
 *
 * Props:
 *   tabs        – array of { key, label } or just strings
 *   activeIndex – current active tab index
 *   onChange    – called with new index
 */
export default function UnderlineTabs({ tabs, activeIndex, onChange, scrollable = false }) {
  const containerRef = useRef(null);
  const tabRefs = useRef([]);

  const normalized = tabs.map(t => (typeof t === 'string' ? { key: t, label: t } : t));

  useEffect(() => {
    if (scrollable) {
      const el = tabRefs.current[activeIndex];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeIndex, scrollable]);

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
    <div ref={containerRef} className={`relative ${scrollable ? 'overflow-x-auto scrollbar-hide' : ''}`} style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(0,0,0,0.06))' }}>
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
            className="text-[14px] transition-colors relative"
            style={{
              flex: scrollable ? undefined : 1,
              textAlign: 'center',
              padding: '14px 0 12px',
              fontWeight: i === activeIndex ? 800 : 600,
              color: i === activeIndex ? 'var(--color-text-primary)' : 'var(--color-text-sub, var(--color-text-muted))',
              background: 'none',
              borderBottom: i === activeIndex ? '2px solid var(--color-accent, #2EC4C4)' : '2px solid transparent',
              whiteSpace: scrollable ? 'nowrap' : undefined,
            }}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold" style={{ color: i === activeIndex ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
