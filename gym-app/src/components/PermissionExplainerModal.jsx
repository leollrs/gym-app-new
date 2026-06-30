// PermissionExplainerModal.jsx
// Center-aligned modal that explains what a given device permission is for and
// why we request it. Shown EVERY time a permission row is tapped — even after
// the permission has already been granted or denied — so the purpose is always
// visible to the user (and to App Review). Required by App Store guideline
// 5.1.1 — "use of personal data must be clear and visible to the user."

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Camera as CameraIcon, MapPin, Heart, X, Check } from 'lucide-react';

const ICON_BY_TYPE = {
  notifications: Bell,
  camera: CameraIcon,
  location: MapPin,
  health: Heart,
};

export default function PermissionExplainerModal({ open, type, status, onAgree, onCancel }) {
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

  // Current OS status drives the status pill so the card reflects reality in
  // every state (Allowed / Denied / Tap to allow).
  const statusMeta = ({
    granted: { label: t('settings.permGranted', 'Allowed'), color: '#10B981' },
    denied: { label: t('settings.permDenied', 'Denied'), color: '#F97316' },
    unsupported: { label: t('settings.permUnsupported', 'N/A'), color: 'var(--color-text-subtle)' },
  })[status] || { label: t('settings.permPrompt', 'Tap to allow'), color: 'var(--color-text-subtle)' };

  // Once the OS has decided (granted/denied), there is no reliable way to
  // re-prompt or deep-link into Settings from the WebView — so instead of a
  // dead button we show a short hint telling the user where to change it.
  const isDecided = status === 'granted' || status === 'denied';

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

        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
            <Icon size={22} style={{ color: 'var(--color-accent)' }} />
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
            style={{ color: statusMeta.color, background: 'color-mix(in srgb, currentColor 12%, transparent)', letterSpacing: 0.4 }}>
            {statusMeta.label}
          </span>
        </div>

        <h3 className="text-[18px] font-bold mb-2" style={{ color: 'var(--color-text-primary)', letterSpacing: -0.2 }}>
          {title}
        </h3>
        <p className="text-[13px] leading-relaxed mb-5" style={{ color: 'var(--color-text-muted)' }}>
          {body}
        </p>

        {isDecided && (
          <p className="text-[12px] leading-relaxed mb-4 px-3 py-2.5 rounded-[12px]"
            style={{ color: 'var(--color-text-subtle)', background: 'var(--color-bg-elevated, var(--color-surface-hover))' }}>
            {t('permissionExplainer.changeInSettings', 'You can change this anytime in iOS Settings › TuGymPR.')}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {!isDecided && status !== 'unsupported' && (
            <button type="button" onClick={onAgree}
              className="w-full py-3 rounded-[14px] text-[14px] font-bold flex items-center justify-center gap-2"
              style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}>
              <Check size={16} />
              {t('permissionExplainer.allow', 'Allow')}
            </button>
          )}
          <button type="button" onClick={onCancel}
            className="w-full py-2.5 rounded-[14px] text-[13px] font-semibold"
            style={{ background: 'transparent', color: 'var(--color-text-muted)' }}>
            {isDecided || status === 'unsupported'
              ? t('permissionExplainer.close', 'Close')
              : t('permissionExplainer.notNow', 'Not now')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
