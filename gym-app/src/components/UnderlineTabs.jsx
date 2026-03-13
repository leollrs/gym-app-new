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
export default function UnderlineTabs({ tabs, activeIndex, onChange }) {
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
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      });
    }
  }, [activeIndex, normalized.length]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex">
        {normalized.map((tab, i) => (
          <button
            key={tab.key}
            ref={el => tabRefs.current[i] = el}
            onClick={() => onChange(i)}
            className={`flex-1 py-2.5 text-[13px] font-semibold text-center transition-colors relative ${
              i === activeIndex
                ? 'text-[#E5E7EB]'
                : 'text-[#6B7280]'
            }`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                i === activeIndex ? 'bg-[#D4AF37]/20 text-[#D4AF37]' : 'bg-white/[0.06] text-[#6B7280]'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Bottom border */}
      <div className="h-[1px] bg-white/[0.06]" />
      {/* Sliding underline */}
      <div
        className="absolute bottom-0 h-[2px] rounded-full bg-[#D4AF37] transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  );
}
