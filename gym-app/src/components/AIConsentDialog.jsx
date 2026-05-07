// AIConsentDialog.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Apple App Store guideline 5.1.2 compliance: explicit consent before sharing
// user photos with a named third-party AI processor (OpenAI). Center-aligned
// modal — never bottom-sheet — matching the AdminModal wrapper structure.
//
// Props:
//   open         boolean — controls visibility
//   onAgree      () => void — fired when user accepts
//   onCancel     () => void — fired when user dismisses (close, cancel, escape, backdrop)
//   featureName  'body-analysis' | 'food-analysis' | 'menu-analysis' — drives copy
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, ShieldCheck } from 'lucide-react';

const FEATURE_KEY_MAP = {
  'body-analysis': 'body',
  'food-analysis': 'food',
  'menu-analysis': 'menu',
};

export default function AIConsentDialog({ open, onAgree, onCancel, featureName }) {
  const { t } = useTranslation('pages');
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
        previouslyFocusedRef.current = null;
      }
    };
  }, [open, onCancel]);

  if (!open) return null;

  const flavor = FEATURE_KEY_MAP[featureName] || 'body';

  // Per-feature subject of the photos (used inside the body bullet)
  const subjectKey = `aiConsent.subject.${flavor}`;
  const subjectFallback =
    flavor === 'body'
      ? 'progress photos of your body'
      : flavor === 'food'
        ? 'photos of your food'
        : 'photos of restaurant menus';

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-consent-title"
        className="rounded-[14px] w-full max-w-md overflow-hidden max-h-[85vh] flex flex-col"
        style={{
          backgroundColor: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}
            >
              <ShieldCheck size={15} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <p
                id="ai-consent-title"
                className="text-[15px] font-bold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('aiConsent.title', 'AI Photo Analysis')}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {t('aiConsent.subtitle', 'Required disclosure')}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label={t('aiConsent.close', 'Close dialog')}
            className="transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg focus:ring-2 focus:outline-none"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto overflow-x-hidden flex-1">
          <p
            className="text-[13px] leading-relaxed mb-3"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {t(
              'aiConsent.intro',
              'To use this feature we need to share {{subject}} with a third-party AI provider for analysis. Please review and confirm before continuing.',
              { subject: t(subjectKey, subjectFallback) }
            )}
          </p>

          <ul className="space-y-2.5 mb-4">
            <li className="flex gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
              <span style={{ color: 'var(--color-accent)' }}>•</span>
              <span>
                {t(
                  'aiConsent.bullet.processor',
                  'Photos are processed by OpenAI, a third-party AI provider in the United States.'
                )}
              </span>
            </li>
            <li className="flex gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
              <span style={{ color: 'var(--color-accent)' }}>•</span>
              <span>
                {t(
                  'aiConsent.bullet.exif',
                  'Location and EXIF metadata is stripped from each photo before transmission.'
                )}
              </span>
            </li>
            <li className="flex gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
              <span style={{ color: 'var(--color-accent)' }}>•</span>
              <span>
                {t(
                  'aiConsent.bullet.retention',
                  'Photos are sent only for this analysis and are not stored on our servers afterward. OpenAI does not use API submissions to train its models.'
                )}
              </span>
            </li>
            <li className="flex gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
              <span style={{ color: 'var(--color-accent)' }}>•</span>
              <span>
                {t(
                  'aiConsent.bullet.advertising',
                  'Your photos and the AI estimates are not shared with advertisers or sold.'
                )}
              </span>
            </li>
          </ul>

          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t(
              'aiConsent.policyNote',
              'For more details, see our '
            )}
            <a
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: 'var(--color-accent)' }}
            >
              {t('aiConsent.policyLink', 'Privacy Policy')}
            </a>
            .
          </p>

          <p
            className="text-[11.5px] leading-relaxed mt-3"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {t(
              'aiConsent.revokeNotice',
              'You can withdraw this consent anytime in Settings → Privacy.'
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 flex gap-3 flex-shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-hover, var(--color-surface-hover))',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            {t('aiConsent.cancel', 'Cancel')}
          </button>
          <button
            onClick={onAgree}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: '#001512',
            }}
          >
            {t('aiConsent.agree', 'I Agree')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
