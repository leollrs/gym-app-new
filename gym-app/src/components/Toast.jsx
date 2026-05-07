import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../contexts/ToastContext';

const icons = {
  success: <CheckCircle size={18} className="text-[var(--color-success)] flex-shrink-0" />,
  error:   <XCircle    size={18} className="text-[var(--color-danger)] flex-shrink-0" />,
  info:    <Info        size={18} className="text-[var(--color-accent)] flex-shrink-0" />,
};

const accents = {
  success: 'border-[var(--color-success)]/20',
  error:   'border-[var(--color-danger)]/20',
  info:    'border-[var(--color-accent)]/20',
};

const Toast = () => {
  const { toasts, dismissToast } = useToast();
  const { t } = useTranslation('pages');

  return (
    <div aria-live="polite" className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-[9999] flex flex-col-reverse gap-2 items-end max-sm:left-4 max-sm:right-4 max-sm:items-stretch">
      <AnimatePresence mode="popLayout">
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`
              flex items-center gap-3 px-4 py-3 rounded-xl
              backdrop-blur-2xl
              border ${accents[toast.type]}
              shadow-lg shadow-black/30
              min-w-[280px] max-w-[400px] max-sm:max-w-full
            `}
            style={{ background: 'color-mix(in srgb, var(--color-bg-card) 80%, transparent)' }}
          >
            {icons[toast.type]}
            <p className="text-[13px] flex-1 leading-snug" style={{ color: 'var(--color-text-primary)' }}>{toast.message}</p>
            {toast.action && (
              <button
                onClick={() => { try { toast.action.onClick?.(); } finally { dismissToast(toast.id); } }}
                className="px-3 min-h-[36px] rounded-lg text-[12px] font-bold transition-colors flex-shrink-0"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
                  color: 'var(--color-accent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(toast.id)}
              aria-label={t('achievementToast.dismiss', { defaultValue: 'Dismiss' })}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors flex-shrink-0 focus:ring-2 focus:ring-[#D4AF37] focus:outline-none rounded-lg"
              style={{ color: 'var(--color-text-subtle)' }}
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default Toast;
