/**
 * Shared responsive page shell for admin screens.
 * Provides consistent desktop spacing and max-width behavior.
 */

const SIZE_CLASS = {
  narrow: 'max-w-6xl',
  default: 'max-w-[1600px]',
  wide: 'max-w-[1760px]',
};

export default function AdminPageShell({
  children,
  size = 'default',
  className = '',
}) {
  const sizeClass = SIZE_CLASS[size] || SIZE_CLASS.default;
  return (
    <div className={`w-full ${sizeClass} mx-auto px-4 md:px-6 xl:px-8 py-6 pb-28 md:pb-12 ${className}`}>
      {children}
    </div>
  );
}

