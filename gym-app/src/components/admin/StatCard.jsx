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
  onClick,
}) {
  const isPercent = typeof value === 'string' && value.endsWith('%');
  const isDecimal = typeof value === 'string' && !isPercent && /^-?\d+\.\d+$/.test(value);
  const numericVal = isPercent
    ? parseInt(value)
    : typeof value === 'number'
      ? value
      : isDecimal
        ? parseFloat(value)
        : parseInt(value) || 0;
  const animated = useCountUp(numericVal, 900);
  const displayVal = isPercent
    ? `${animated}%`
    : isDecimal
      ? animated.toFixed(1)
      : animated.toLocaleString();

  const isHero = size === 'hero';
  const clickable = typeof onClick === 'function';
  const Wrapper = clickable ? 'button' : 'div';

  return (
    <FadeIn delay={delay} className={isHero ? 'md:col-span-2 xl:col-span-3' : ''}>
      <Wrapper
        {...(clickable ? { type: 'button', onClick } : {})}
        className={`admin-stat-card border-l-2 group w-full text-left ${
          isHero ? 'p-5' : 'p-3 md:p-4'
        } ${clickable ? 'cursor-pointer transition-all hover:brightness-110 hover:-translate-y-px active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]' : ''}`}
        style={{ borderLeftColor: borderColor }}
      >
        <div className="flex items-start justify-between overflow-hidden">
          <div className="min-w-0 flex-1">
            <p
              className={`admin-kpi truncate ${
                isHero ? 'text-[26px] md:text-[32px]' : 'text-[20px] md:text-[26px]'
              }`}
            >
              {displayVal}
            </p>
            <p
              className={`font-medium group-hover:text-[color:var(--color-text-secondary)] transition-colors truncate ${
                isHero ? 'text-[11px] md:text-[13px] mt-2 text-[color:var(--color-text-muted)]' : 'text-[11px] md:text-[12px] mt-1.5 text-[color:var(--color-text-muted)]'
              }`}
            >
              {label}
            </p>
            {sub && <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{sub}</p>}
          </div>
          {Icon && (
            <div className={`rounded-xl flex items-center justify-center flex-shrink-0 ${isHero ? 'w-10 h-10' : 'w-9 h-9'}`}
              style={{ background: 'var(--color-bg-hover)' }}>
              <Icon size={isHero ? 18 : 16} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
          )}
        </div>
      </Wrapper>
    </FadeIn>
  );
}
