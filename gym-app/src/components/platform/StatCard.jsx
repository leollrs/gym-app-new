import { useEffect, useState, useRef } from 'react';
import FadeIn from './FadeIn';

const useCountUp = (end, duration = 800) => {
  const [value, setValue] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const target = typeof end === 'number' ? end : parseInt(end) || 0;
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration]);
  return value;
};

/**
 * Unified StatCard for platform pages.
 *
 * Rich mode (GymsOverview): pass `borderColor`, optionally `suffix` and numeric `value`
 *   — animates with useCountUp.
 * Simple mode (PlatformAnalytics, GymHealth, FeatureAdoption): pass `color` and
 *   pre-formatted string `value` — renders as-is with an icon badge.
 *
 * Props:
 *   label       — card label text
 *   value       — number (animated) or string (rendered as-is)
 *   icon        — lucide-react icon component
 *   color       — left-border + icon tint colour (simple mode, default '#6366F1')
 *   borderColor — alias for color (rich mode)
 *   suffix      — optional suffix after animated number
 *   delay       — FadeIn animation delay in ms
 */
const StatCard = ({ label, value, icon: Icon, color, borderColor, suffix, delay = 0 }) => {
  const resolvedColor = borderColor || color || '#6366F1';
  const isAnimated = typeof value === 'number' && (borderColor || suffix !== undefined);
  const animated = useCountUp(isAnimated ? value : 0, 900);

  return (
    <FadeIn delay={delay}>
      <div
        className="bg-[#0F172A] border border-white/[0.06] rounded-xl p-4 border-l-2 hover:border-white/10 hover:bg-[#111827] transition-all duration-300 group overflow-hidden"
        style={{ borderLeftColor: resolvedColor }}
      >
        <div className="flex items-center justify-between mb-2">
          {borderColor ? (
            <Icon size={16} className="text-[#6B7280] group-hover:text-[#9CA3AF] transition-colors" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${resolvedColor}18` }}>
              <Icon className="w-4 h-4" style={{ color: resolvedColor }} />
            </div>
          )}
        </div>
        <p className="text-[24px] font-bold text-[#E5E7EB] leading-none tabular-nums tracking-tight truncate">
          {isAnimated
            ? <>{animated.toLocaleString()}{suffix && <span className="text-[14px] font-normal text-[#6B7280] ml-1">{suffix}</span>}</>
            : value
          }
        </p>
        <p className="text-[11px] text-[#9CA3AF] mt-1 group-hover:text-[#D1D5DB] transition-colors truncate">{label}</p>
      </div>
    </FadeIn>
  );
};

export default StatCard;
export { useCountUp };
