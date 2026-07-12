import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import logger from '../../../lib/logger';

/**
 * Delete-account confirmation modal for AdminProfile. Owns its own input,
 * deleting-state, and body-scroll-lock effect so the parent doesn't have to
 * thread them through. Guards against the last admin deleting themselves by
 * counting remaining admins in the gym before calling `delete_user_account`.
 */
export default function DeleteAccountModal({ isOpen, onClose, gymId, signOut }) {
  const { t, i18n } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const { showToast } = useToast();

  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Lock body scroll while delete-account confirm modal is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    onClose();
    setDeleteInput('');
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // Guard: prevent last admin from deleting their account.
      // Fail CLOSED — if the count query errors or returns null, abort
      // rather than risk leaving the gym with zero admins.
      const { count, error: countErr } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('gym_id', gymId)
        .eq('role', 'admin');
      if (countErr || count == null) {
        logger.error('Last-admin guard failed', countErr);
        showToast(tc('error', 'Error'), 'error');
        setDeleting(false);
        return;
      }
      if (count <= 1) {
        showToast(tc('lastAdminCannotDelete'), 'error');
        setDeleting(false);
        return;
      }
      // delete_user_account() erases the CALLER's own account + all their data
      // (operates on auth.uid(), role-agnostic) — the same working RPC the
      // member flow uses. The previous `delete_own_account` RPC never existed,
      // so admin self-deletion silently failed (an Apple/Google store requirement).
      const { error: delErr } = await supabase.rpc('delete_user_account');
      if (delErr) throw delErr;
      await signOut();
    } catch (err) {
      logger.error('Account deletion failed', err);
      showToast(err.message || tc('error', 'Error'), 'error');
      setDeleting(false);
    }
  };

  const isDisabled = (() => {
    const v = deleteInput.toLowerCase();
    return (v !== 'eliminar' && v !== 'delete') || deleting;
  })();

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={handleClose}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-subtle)' }}
        onClick={e => e.stopPropagation()}>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} style={{ color: 'var(--color-danger)' }} />
            <h3 className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.profile.deleteAccount', 'Delete Account')}</h3>
          </div>
          <p className="text-[13px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.profile.deleteWarning', 'This action is permanent. All your data will be deleted and cannot be undone.')}
          </p>
          <p className="text-[12px] font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.profile.deleteTypeConfirm', {
              word: t('admin.profile.deleteTypeConfirmWord', i18n.language === 'es' ? 'ELIMINAR' : 'DELETE'),
              defaultValue: 'Type {{word}} to confirm:',
            })}
          </p>
          <input
            type="text"
            value={deleteInput}
            onChange={e => setDeleteInput(e.target.value)}
            placeholder={t('admin.profile.deleteTypeConfirmWord', i18n.language === 'es' ? 'ELIMINAR' : 'DELETE')}
            className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none mb-4"
            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
          />
          <div className="flex gap-3">
            <button onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
              style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
              {t('admin.profile.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={isDisabled}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-danger)', color: '#fff' }}>
              {deleting ? t('admin.profile.deleting', 'Deleting...') : t('admin.profile.deleteConfirmBtn', 'Delete Account')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
