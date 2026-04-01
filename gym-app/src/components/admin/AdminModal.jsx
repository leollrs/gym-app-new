/**
 * Shared modal component for admin pages.
 * Bottom-sheet on mobile, centered dialog on desktop.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function AdminModal({
  isOpen,
  onClose,
  title,
  titleIcon: TitleIcon,
  subtitle,
  size = 'md',
  children,
  footer,
}) {
  const dialogRef = useRef(null);

  // Trap focus and handle Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidths = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-[#0F172A] border border-white/8 rounded-t-2xl md:rounded-[14px] w-full ${maxWidths[size] || maxWidths.md} overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/6 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            {TitleIcon && (
              <div className="w-8 h-8 rounded-xl bg-[#D4AF37]/12 flex items-center justify-center">
                <TitleIcon size={15} className="text-[#D4AF37]" />
              </div>
            )}
            <div>
              <p className="text-[15px] font-bold text-[#E5E7EB]">{title}</p>
              {subtitle && <p className="text-[11px] text-[#6B7280]">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-[#6B7280] hover:text-[#E5E7EB] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-5 pb-5 flex gap-3 flex-shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}
