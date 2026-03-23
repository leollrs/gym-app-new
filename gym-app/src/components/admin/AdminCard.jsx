/**
 * Shared card container for admin pages.
 * Follows the .interface-design/system.md token system.
 */

export default function AdminCard({
  children,
  className = '',
  padding = 'p-4',
  hover = false,
  borderLeft,
  onClick,
}) {
  return (
    <div
      className={`bg-[#0F172A] border border-white/6 rounded-[14px] ${padding} ${
        hover ? 'hover:border-white/10 hover:bg-[#111827] transition-all duration-300' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={borderLeft ? { borderLeftWidth: 2, borderLeftColor: borderLeft } : undefined}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
