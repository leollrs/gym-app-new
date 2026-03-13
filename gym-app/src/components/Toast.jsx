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
    <div className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-[9999] flex flex-col-reverse gap-2 items-end max-sm:left-4 max-sm:right-4 max-sm:items-stretch">
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
              bg-[#0F172A]/80 backdrop-blur-2xl
              border ${accents[toast.type]}
              shadow-lg shadow-black/30
              min-w-[280px] max-w-[400px] max-sm:max-w-full
            `}
          >
            {icons[toast.type]}
            <p className="text-[13px] text-[#E5E7EB] flex-1 leading-snug">{toast.message}</p>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-[#6B7280] hover:text-[#9CA3AF] transition-colors flex-shrink-0"
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
