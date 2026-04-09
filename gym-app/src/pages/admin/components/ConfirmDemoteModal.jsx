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
      title={t('admin.trainers.removeTrainerTitle', 'Quitar Entrenador')}
      titleIcon={AlertTriangle}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
            style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
          >
            {t('admin.trainers.cancel', 'Cancelar')}
          </button>
          <button
            onClick={() => onConfirm(trainer.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{ backgroundColor: '#EF4444', color: '#fff' }}
          >
            <Trash2 size={14} />
            {t('admin.trainers.removeTrainerConfirm', 'Quitar Entrenador')}
          </button>
        </>
      }
    >
      <div className="text-center">
        <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.trainers.demoteDesc', 'Esto degradará a')} <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{trainer.name}</span> {t('admin.trainers.demoteDescEnd', 'a miembro regular.')}
        </p>
        {clientCount > 0 && (
          <p className="text-[12px] mt-3 rounded-lg px-3 py-2 inline-block" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#F59E0B' }}>
            {clientCount} {clientCount !== 1 ? t('admin.trainers.clientsWillUnassign', 'clientes serán desasignados') : t('admin.trainers.clientWillUnassign', 'cliente será desasignado')}
          </p>
        )}
      </div>
    </AdminModal>
  );
}
