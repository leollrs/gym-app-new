import { motion } from 'framer-motion';
import AnimatedCounter from '../../../components/AnimatedCounter';
import { TT, TFont } from './designTokens';

/**
 * Trainer-side stat card. Mirrors the member-side stat row pattern:
 *   icon-in-colored-square + label + big animated number.
 *
 * Props:
 *   icon       — Lucide icon component
 *   label      — short label (e.g. "Active clients")
 *   value      — number for AnimatedCounter (count-up)
 *   suffix     — text after the value (e.g. "%", "/wk")
 *   prefix     — text before the value
 *   compact    — pass-through to AnimatedCounter (e.g. "1.2k")
 *   accent     — optional CSS color or var; default is accent
 *   delay      — Framer Motion stagger delay (seconds)
 *   sub        — optional sub-line under the value
 *   onClick    — optional click handler (turns card into a button)
 */
export default function TrainerStatCard({
  icon: Icon,
  label,
  value,
  suffix = '',
  prefix = '',
  compact = false,
  accent,
  delay = 0,
  sub,
  onClick,
}) {
  const accentColor = accent || TT.accent;
  const Container = onClick ? motion.button : motion.div;

  return (
    <Container
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      className="rounded-2xl p-4 text-left w-full focus:outline-none"
      style={{
        background: TT.surface,
        border: `1px solid ${TT.border}`,
        boxShadow: TT.shadow,
      }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        {Icon && (
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `color-mix(in srgb, ${accentColor} 14%, transparent)` }}
          >
            <Icon size={16} style={{ color: accentColor }} strokeWidth={2.2} />
          </div>
        )}
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.08em] truncate"
          style={{ color: TT.textMute }}
        >
          {label}
        </p>
      </div>

      <p
        className="leading-none"
        style={{
          fontFamily: TFont.display,
          fontWeight: 800,
          letterSpacing: -0.6,
          fontSize: 26,
          color: TT.text,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {typeof value === 'number' ? (
          <AnimatedCounter value={value} prefix={prefix} suffix={suffix} compact={compact} />
        ) : (
          <>
            {prefix}
            {value}
            {suffix}
          </>
        )}
      </p>

      {sub && (
        <p className="text-[11px] mt-1 truncate" style={{ color: TT.textMute }}>
          {sub}
        </p>
      )}
    </Container>
  );
}
