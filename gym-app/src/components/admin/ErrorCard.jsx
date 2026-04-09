/**
 * Inline error display for failed data sections.
 * Shows a subtle red-tinted card with retry button.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ErrorCard({ message, onRetry }) {
  const { t } = useTranslation('common');
  const displayMessage = message || t('failedToLoadData');
  return (
    <div className="bg-red-500/[0.04] border border-red-500/10 rounded-[14px] p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={15} className="text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-red-400 font-medium">{displayMessage}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#9CA3AF] bg-white/4 border border-white/6 hover:text-[#E5E7EB] hover:bg-white/6 transition-colors flex-shrink-0"
          >
            <RefreshCw size={12} />
            {t('retry')}
          </button>
        )}
      </div>
    </div>
  );
}
