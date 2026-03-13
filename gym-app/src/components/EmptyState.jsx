import React from 'react';

/**
 * Reusable empty state component for list views and data pages.
 *
 * Props:
 *   icon         — Lucide icon component (rendered at 48px, muted)
 *   title        — heading text (e.g. "No routines yet")
 *   description  — supporting text (optional)
 *   actionLabel  — CTA button label (optional)
 *   onAction     — CTA click handler (optional, required if actionLabel set)
 *   actionTo     — alternative: render as a Link (import handled externally)
 *   className    — additional wrapper classes
 *   compact      — if true, reduces vertical padding
 */

const EmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
  compact = false,
}) => {
  return (
    <div
      className={`flex flex-col items-center text-center ${
        compact ? 'py-10 px-4' : 'py-20 px-6'
      } ${className}`}
    >
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-[#111827] border border-white/[0.06] flex items-center justify-center mb-4">
          <Icon size={28} className="text-[#4B5563]" strokeWidth={1.5} />
        </div>
      )}

      {title && (
        <h3 className="text-[16px] font-semibold text-[#E5E7EB] leading-snug">
          {title}
        </h3>
      )}

      {description && (
        <p className="text-[13px] text-[#6B7280] mt-1.5 max-w-[280px] leading-relaxed">
          {description}
        </p>
      )}

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold bg-[#D4AF37] text-black active:scale-95 transition-transform hover:opacity-90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
