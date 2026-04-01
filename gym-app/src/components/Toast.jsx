import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

const icons = {
  success: <CheckCircle size={18} className="text-[#10B981] flex-shrink-0" />,
  error:   <XCircle    size={18} className="text-[#EF4444] flex-shrink-0" />,
  info:    <Info        size={18} className="text-[#D4AF37] flex-shrink-0" />,
};

const accents = {
  success: 'border-[#10B981]/20',
  error:   'border-[#EF4444]/20',
  info:    'border-[#D4AF37]/20',
};

const Toast = () => {
  const { toasts, dismissToast } = useToast();

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
            <button
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
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
