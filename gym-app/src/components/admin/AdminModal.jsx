/**
 * Shared modal component for admin pages.
 * Bottom-sheet on mobile, centered dialog on desktop.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`rounded-[14px] w-full ${maxWidths[size] || maxWidths.md} overflow-hidden max-h-[85vh] flex flex-col`}
        style={{ backgroundColor: 'var(--color-bg-card, #0F172A)', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))' }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))' }}>
          <div className="flex items-center gap-2.5">
            {TitleIcon && (
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent, #D4AF37) 12%, transparent)' }}>
                <TitleIcon size={15} style={{ color: 'var(--color-accent, #D4AF37)' }} />
              </div>
            )}
            <div>
              <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary, #E5E7EB)' }}>{title}</p>
              {subtitle && <p className="text-[11px]" style={{ color: 'var(--color-text-muted, #6B7280)' }}>{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus:ring-2 focus:outline-none"
            style={{ color: 'var(--color-text-muted, #6B7280)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto overflow-x-hidden flex-1">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-5 pb-5 flex gap-3 flex-shrink-0">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
