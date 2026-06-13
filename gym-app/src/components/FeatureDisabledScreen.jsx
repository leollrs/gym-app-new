/**
 * FeatureDisabledScreen — full-page member-styled state shown when a platform
 * feature kill switch (Operations → platform_config feature_<name>, read via
 * usePlatformFlags) has a feature turned off. Sibling of MaintenanceGate but
 * in-flow (the rest of the app stays navigable) and with a way back.
 *
 * Pass `embedded` when rendered inside a tab of another page (Community /
 * Progress) so it sizes down and hides the back button — the host page's own
 * navigation stays in charge.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PauseCircle, ArrowLeft } from 'lucide-react';

export default function FeatureDisabledScreen({ embedded = false }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <div
      className="w-full flex flex-col items-center justify-center px-6 text-center animate-fade-in"
      style={{ minHeight: embedded ? '40vh' : '65vh' }}
      role="status"
      aria-label={t('featureDisabled.title', 'Temporarily unavailable')}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{
          background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 26%, transparent)',
        }}
      >
        <PauseCircle size={28} style={{ color: 'var(--color-accent, #D4AF37)' }} strokeWidth={1.8} />
      </div>
      <h1
        className="text-[20px] mb-2"
        style={{
          color: 'var(--color-text-primary)',
          fontFamily: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
          fontWeight: 800,
          letterSpacing: '-0.3px',
        }}
      >
        {t('featureDisabled.title', 'Temporarily unavailable')}
      </h1>
      <p className="text-[14px] leading-relaxed max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
        {t('featureDisabled.body', 'This feature is paused for maintenance. Check back soon.')}
      </p>
      {!embedded && (
        <button
          type="button"
          onClick={goBack}
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[13px] font-bold active:scale-95 transition-transform focus:outline-none focus:ring-2 min-h-[44px]"
          style={{
            background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 28%, transparent)',
            color: 'var(--color-accent, #D4AF37)',
            '--tw-ring-color': 'var(--color-accent, #D4AF37)',
          }}
        >
          <ArrowLeft size={15} />
          {t('featureDisabled.back', 'Go back')}
        </button>
      )}
    </div>
  );
}
