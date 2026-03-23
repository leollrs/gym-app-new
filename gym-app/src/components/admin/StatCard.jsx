/**
 * KPI stat card with animated count-up.
 * Supports "hero" size for primary metrics (2x width, larger text).
 */
import FadeIn from './FadeIn';
import useCountUp from '../../hooks/useCountUp';

export default function StatCard({
  label,
  value,
  sub,
  borderColor,
  icon: Icon,
  delay = 0,
  size = 'default',
}) {
  const isPercent = typeof value === 'string' && value.endsWith('%');
  const numericVal = isPercent
    ? parseInt(value)
    : typeof value === 'number'
      ? value
      : parseInt(value) || 0;
  const animated = useCountUp(numericVal, 900);
  const displayVal = isPercent ? `${animated}%` : animated.toLocaleString();

  const isHero = size === 'hero';

  return (
    <FadeIn delay={delay} className={isHero ? 'col-span-2' : ''}>
      <div
        className={`bg-[#0F172A] border border-white/6 rounded-[14px] border-l-2 hover:border-white/10 hover:bg-[#111827] transition-all duration-300 group ${
          isHero ? 'p-5' : 'p-4'
        }`}
        style={{ borderLeftColor: borderColor }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p
              className={`font-bold text-[#E5E7EB] leading-none tabular-nums tracking-tight ${
                isHero ? 'text-[32px]' : 'text-[24px]'
              }`}
            >
              {displayVal}
            </p>
            <p
              className={`text-[#9CA3AF] group-hover:text-[#D1D5DB] transition-colors ${
                isHero ? 'text-[13px] mt-1.5' : 'text-[12px] mt-1'
              }`}
            >
              {label}
            </p>
            {sub && <p className="text-[11px] text-[#4B5563] mt-0.5">{sub}</p>}
          </div>
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-white/[0.03] flex items-center justify-center flex-shrink-0">
              <Icon size={16} className="text-[#6B7280]" />
            </div>
          )}
        </div>
      </div>
    </FadeIn>
  );
}
