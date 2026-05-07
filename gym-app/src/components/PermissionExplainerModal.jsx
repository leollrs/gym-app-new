// PermissionExplainerModal.jsx
// Center-aligned modal that explains why we're requesting a given device
// permission BEFORE the OS prompt appears. Required by App Store guideline
// 5.1.1 — "use of personal data must be clear and visible to the user."

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Camera as CameraIcon, MapPin, Heart, X } from 'lucide-react';

const ICON_BY_TYPE = {
  notifications: Bell,
  camera: CameraIcon,
  location: MapPin,
  health: Heart,
};

export default function PermissionExplainerModal({ open, type, onAgree, onCancel }) {
  const { t } = useTranslation('pages');
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement;
    const handleKeyDown = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      try { previouslyFocusedRef.current?.focus?.(); } catch {}
    };
  }, [open, onCancel]);

  if (!open || !type) return null;

  const Icon = ICON_BY_TYPE[type] || Bell;
  const title = t(`permissionExplainer.${type}.title`);
  const body = t(`permissionExplainer.${type}.body`);

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
      role="presentation">
      <div ref={dialogRef} role="dialog" aria-modal="true"
        className="relative w-full max-w-[360px] rounded-[24px] p-6"
        style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <button type="button" onClick={onCancel}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'var(--color-bg-elevated, var(--color-surface-hover))' }}
          aria-label={t('common.close', 'Close')}>
          <X size={14} style={{ color: 'var(--color-text-muted)' }} />
        </button>

        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
          <Icon size={22} style={{ color: 'var(--color-accent)' }} />
        </div>

        <h3 className="text-[18px] font-bold mb-2" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
          {title}
        </h3>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--color-text-muted)' }}>
          {body}
        </p>

        <div className="flex flex-col gap-2">
          <button type="button" onClick={onAgree}
            className="w-full py-3 rounded-[14px] text-[14px] font-bold"
            style={{ background: 'var(--color-accent)', color: 'var(--color-bg-primary)' }}>
            {t('permissionExplainer.continue', 'Continue')}
          </button>
          <button type="button" onClick={onCancel}
            className="w-full py-2.5 rounded-[14px] text-[13px] font-semibold"
            style={{ background: 'transparent', color: 'var(--color-text-muted)' }}>
            {t('permissionExplainer.notNow', 'Not now')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
