import { AdminModal } from '../../../components/admin';

/**
 * Simple confirmation modal for deleting a class. The `className` prop
 * is destructured as `classItem` because `className` collides with the
 * React DOM prop name.
 */
export default function DeleteConfirmModal({ className: classItem, onConfirm, onCancel, deleting, t, tc }) {
  return (
    <AdminModal isOpen onClose={onCancel} title={t('admin.classes.deleteClass')} size="sm">
      <p className="text-[13px] mb-5" style={{ color: 'var(--color-text-muted)' }}>
        {t('admin.classes.deleteConfirm', { name: classItem?.name })}
      </p>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-hover)' }}>
          {tc('cancel')}
        </button>
        <button onClick={onConfirm} disabled={deleting}
          className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-red-500 text-white disabled:opacity-50 transition-opacity">
          {deleting ? '...' : tc('delete')}
        </button>
      </div>
    </AdminModal>
  );
}
