/**
 * Shared avatar component for admin pages.
 * Shows initials with optional photo and ring color.
 */

const SIZES = {
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-9 h-9 text-[13px]',
  lg: 'w-11 h-11 text-[15px]',
};

export default function Avatar({ name, size = 'md', src, ring, variant = 'neutral' }) {
  const sizeClass = SIZES[size] || SIZES.md;
  const initial = (name || '?')[0].toUpperCase();

  const variantStyles = {
    neutral: 'bg-[#1E293B] text-[#9CA3AF]',
    accent:  'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25',
  };

  if (src) {
    return (
      <img
        src={src}
        alt={name || 'Avatar'}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
        style={ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center flex-shrink-0 font-bold ${variantStyles[variant] || variantStyles.neutral}`}
      style={ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined}
    >
      {initial}
    </div>
  );
}
