import { motion } from 'framer-motion';
import { TT, TFont } from './designTokens';

/**
 * Trainer empty state with optional action and Lucide icon.
 * Mirrors src/components/EmptyState.jsx but uses motion + a slightly tighter spec
 * tuned for the trainer pages (which often live in a tab-content context).
 *
 * Props:
 *   icon         — Lucide icon
 *   title        — heading
 *   description  — optional supporting text
 *   actionLabel  — optional CTA label
 *   onAction     — handler for CTA
 *   actionIcon   — optional CTA icon
 *   compact      — reduces vertical padding
 *   accent       — accent color (defaults to brand accent)
 */
export default function TrainerEmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
  compact = false,
  accent,
}) {
  const accentColor = accent || TT.accent;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`flex flex-col items-center text-center ${compact ? 'py-10 px-4' : 'py-16 px-6'}`}
    >
      {Icon && (
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{
            background: `color-mix(in srgb, ${accentColor} 12%, ${TT.surface})`,
            border: `1px solid ${TT.border}`,
          }}
        >
          <Icon size={28} strokeWidth={1.5} style={{ color: accentColor }} />
        </div>
      )}
      {title && (
        <h3
          className="text-[16px] font-bold leading-snug"
          style={{ color: TT.text, fontFamily: TFont.display, letterSpacing: -0.3 }}
        >
          {title}
        </h3>
      )}
      {description && (
        <p
          className="text-[13px] mt-1.5 max-w-[300px] leading-relaxed"
          style={{ color: TT.textMute }}
        >
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold active:scale-95 transition-transform focus:outline-none"
          style={{ background: TT.accent, color: '#06363B', fontFamily: TFont.display }}
        >
          {ActionIcon && <ActionIcon size={14} strokeWidth={2.4} />}
          {actionLabel}
        </button>
      )}
    </motion.div>
  );
}
