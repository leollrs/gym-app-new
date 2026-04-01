/**
 * Shared card container for admin pages.
 * clipContent=false for cards with absolute dropdowns (default overflow-hidden would clip them).
 */

export default function AdminCard({
  children,
  className = '',
  padding = 'p-4',
  hover = false,
  borderLeft,
  onClick,
  clipContent = true,
}) {
  const overflowClass = clipContent ? 'overflow-hidden' : 'overflow-visible';
  return (
    <div
      className={`bg-[#0F172A] border border-white/6 rounded-[14px] ${overflowClass} ${padding} ${
        hover ? 'hover:border-white/10 hover:bg-[#111827] transition-all duration-300' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={borderLeft ? { borderLeftWidth: 2, borderLeftColor: borderLeft } : undefined}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
