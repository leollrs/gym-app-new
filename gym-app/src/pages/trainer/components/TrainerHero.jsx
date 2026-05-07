import { motion } from 'framer-motion';
import AnimatedCounter from '../../../components/AnimatedCounter';

/**
 * Member-style hero card adapted for trainer pages. Big gradient number,
 * accent label, optional sub-stats row, optional right-side CTA.
 *
 * Props:
 *   accentLabel  – small caps eyebrow (e.g. "THIS WEEK")
 *   title        – main title text (small)
 *   value        – big number (uses AnimatedCounter when number)
 *   suffix       – text after number
 *   prefix       – text before number
 *   subText      – text under number
 *   subStats     – array of { label, value } shown right of value
 *   icon         – Lucide icon for top-right
 *   action       – optional { label, onClick, icon } — renders a CTA pill
 *   children     – optional bottom slot (e.g. a horizontal stat row)
 *   compact      – AnimatedCounter compact mode
 */
export default function TrainerHero({
  accentLabel,
  title,
  value,
  suffix,
  prefix,
  subText,
  icon: Icon,
  action,
  children,
  compact = false,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative rounded-2xl overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 12%, var(--color-bg-card)) 0%, var(--color-bg-card) 60%)',
        border: '1px solid var(--color-border-subtle)',
        boxShadow: 'var(--shadow-card, 0 1px 2px rgba(15,20,25,0.04), 0 8px 24px rgba(15,20,25,0.05))',
      }}
    >
      {/* Decorative accent halo (uses brand) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 w-48 h-48 rounded-full opacity-50"
        style={{
          background:
            'radial-gradient(circle, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 65%)',
          filter: 'blur(2px)',
        }}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {accentLabel && (
              <p
                className="text-[10px] font-bold uppercase tracking-[0.2em] mb-1.5"
                style={{ color: 'var(--color-accent)' }}
              >
                {accentLabel}
              </p>
            )}
            {title && (
              <p
                className="text-[13px] font-semibold mb-2"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {title}
              </p>
            )}

            {(value !== undefined && value !== null) && (
              <p
                className="leading-none"
                style={{
                  fontFamily: '"Familjen Grotesk", "Archivo", system-ui',
                  fontWeight: 800,
                  letterSpacing: -1.2,
                  fontSize: 44,
                  fontVariantNumeric: 'tabular-nums',
                  background:
                    'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-soft) 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                {typeof value === 'number' ? (
                  <AnimatedCounter
                    value={value}
                    prefix={prefix}
                    suffix={suffix}
                    compact={compact}
                  />
                ) : (
                  <>
                    {prefix}
                    {value}
                    {suffix}
                  </>
                )}
              </p>
            )}

            {subText && (
              <p
                className="text-[12px] mt-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {subText}
              </p>
            )}
          </div>

          {Icon && (
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 22%, transparent)',
              }}
            >
              <Icon size={20} style={{ color: 'var(--color-accent)' }} strokeWidth={2.2} />
            </div>
          )}
        </div>

        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-on-accent)',
            }}
          >
            {action.icon ? <action.icon size={14} strokeWidth={2.4} /> : null}
            {action.label}
          </button>
        )}

        {children && <div className="mt-4">{children}</div>}
      </div>
    </motion.div>
  );
}
