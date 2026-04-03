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
      className={`admin-card ${overflowClass} ${padding} ${
        hover ? 'admin-card-hover' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={borderLeft ? { borderLeftWidth: 2, borderLeftColor: borderLeft } : undefined}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
