import { useRef, useEffect, useState } from 'react';

/**
 * Responsive admin tab bar.
 *
 * Mobile:  equal-width tabs (flex-1) with sliding gold underline — matches
 *          the member-side UnderlineTabs pattern for thumb-friendly access.
 * Desktop: keeps the same visual but inside a natural-width container so tabs
 *          don't stretch across wide screens.
 *
 * Props:
 *   tabs       – [{ key, label, icon?, count? }]
 *   active     – active tab key
 *   onChange   – called with tab key
 *   className  – optional extra classes on the outer wrapper
 */
export default function AdminTabs({ tabs, active, onChange, className = '' }) {
  const containerRef = useRef(null);
  const tabRefs = useRef([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const activeIndex = tabs.findIndex(t => t.key === active);

  useEffect(() => {
    const el = tabRefs.current[activeIndex];
    if (el && containerRef.current) {
      const cRect = containerRef.current.getBoundingClientRect();
      const tRect = el.getBoundingClientRect();
      setIndicator({ left: tRect.left - cRect.left, width: tRect.width });
    }
  }, [activeIndex, tabs.length]);

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
      {/* Tab buttons — flex-1 on mobile for equal widths, auto on desktop */}
      <div className="flex" role="tablist">
        {tabs.map((tab, i) => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={el => tabRefs.current[i] = el}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-1.5 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                isActive ? 'text-[#D4AF37]' : 'text-[#6B7280] hover:text-[#E5E7EB]'
              }`}
            >
              {Icon && <Icon size={14} className="hidden md:block" />}
              {tab.label}
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
      {/* Border */}
      <div className="h-[1px] bg-white/[0.06]" />
      {/* Sliding underline */}
      <div
        className="absolute bottom-0 h-[2px] rounded-full bg-[#D4AF37] transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  );
}
