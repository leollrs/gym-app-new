import { AlertTriangle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminModal } from '../../../components/admin';

export default function ConfirmDemoteModal({ isOpen, onClose, trainer, clientCount, onConfirm }) {
  const { t } = useTranslation('pages');
  if (!trainer) return null;

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('admin.trainers.removeTrainerTitle', 'Remove Trainer')}
      titleIcon={AlertTriangle}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
            style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
          >
            {t('admin.trainers.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => onConfirm(trainer.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}
          >
            <Trash2 size={14} />
            {t('admin.trainers.removeTrainerConfirm', 'Remove Trainer')}
          </button>
        </>
      }
    >
      <div className="text-center">
        <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.trainers.demoteDesc', 'This will demote')} <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{trainer.name}</span> {t('admin.trainers.demoteDescEnd', 'to a regular member.')}
        </p>
        {clientCount > 0 && (
          <p className="text-[12px] mt-3 rounded-lg px-3 py-2 inline-block" style={{ backgroundColor: 'var(--color-warning-soft)', color: 'var(--color-warning)' }}>
            {clientCount} {clientCount !== 1 ? t('admin.trainers.clientsWillUnassign', 'clients will be unassigned') : t('admin.trainers.clientWillUnassign', 'client will be unassigned')}
          </p>
        )}
      </div>
    </AdminModal>
  );
}
