import { useState } from 'react';
import { MessageSquare, Send, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import posthog from 'posthog-js';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { useToast } from '../../../contexts/ToastContext';
import { AdminModal } from '../../../components/admin';

/**
 * Bulk in-app message + win-back attempt logger for a selection of members.
 *
 * Three writes per send (notifications, win_back_attempts, admin_contact_log)
 * — failures are tracked individually and surfaced as a partial-success toast
 * rather than a hard error, so the admin still sees that some members got
 * the message even if one table errored.
 */
export default function BulkMessageModal({ members, gymId, adminId, onClose, onSent }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [msg, setMsg] = useState(t('admin.churn.bulkDefaultMessage'));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    let failures = [];
    try {
      const notifications = members.map(m => ({
        profile_id: m.id, gym_id: gymId, type: 'admin_message',
        title: t('admin.churn.messageFromGym'), body: msg, data: { source: 'bulk_churn_intel' },
      }));
      const { error: notifError } = await supabase.from('notifications').insert(notifications);
      if (notifError) {
        failures.push('notifications');
        logger.error('Bulk message: notifications insert failed', notifError);
      }

      const winBackLogs = members.map(m => ({
        user_id: m.id, gym_id: gymId, admin_id: adminId,
        message: msg, offer: null, outcome: 'pending', created_at: new Date().toISOString(),
      }));
      const { error: winBackError } = await supabase.from('win_back_attempts').insert(winBackLogs);
      if (winBackError) {
        failures.push('win_back_attempts');
        logger.error('Bulk message: win_back_attempts insert failed', winBackError);
      }

      const contactEntries = members.map(m => ({
        admin_id: adminId, member_id: m.id, gym_id: gymId,
        method: 'in_app_message', note: 'Bulk message from churn intelligence',
      }));
      const { error: contactError } = await supabase.from('admin_contact_log').insert(contactEntries);
      if (contactError) {
        failures.push('admin_contact_log');
        logger.error('Bulk message: admin_contact_log insert failed', contactError);
      }

      if (failures.length === 0) {
        posthog?.capture('admin_winback_sent', { method: 'bulk_message', count: members.length });
        showToast(t('admin.churn.bulkMessageSent', { count: members.length, defaultValue: 'Message sent to {{count}} members' }), 'success');
        setSent(true);
        setTimeout(() => { onSent?.(); onClose(); }, 1200);
      } else if (failures.includes('notifications')) {
        // Core notification delivery failed — don't claim success or close the modal.
        showToast(t('admin.churn.bulkAllFailed', { defaultValue: 'All operations failed. Please try again.' }), 'error');
      } else {
        // Only the logging tables failed — messages were delivered.
        showToast(t('admin.churn.bulkPartialFailure', { failed: failures.length, total: 3, defaultValue: '{{failed}} of 3 operations failed. Messages may be partially saved.' }), 'warning');
        setSent(true);
        setTimeout(() => { onSent?.(); onClose(); }, 1200);
      }
    } catch (err) {
      logger.error('Bulk message failed', err);
      showToast(t('admin.churn.bulkSendError', { defaultValue: 'Failed to send bulk message' }), 'error');
    } finally { setSending(false); }
  };

  return (
    <AdminModal
      isOpen={true}
      onClose={onClose}
      title={t('admin.churn.bulkMessageTitle')}
      titleIcon={MessageSquare}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
            style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}>
            {t('admin.churn.bulkCancel')}
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={sent
              ? { backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }
              : { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)' }
            }>
            {sent ? <><CheckCircle size={14} /> {t('admin.churn.bulkSent')}</> : sending ? t('admin.churn.bulkSending') : <><Send size={13} /> {t('admin.churn.bulkSendAll', { count: members.length })}</>}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('admin.churn.bulkSendingTo', { count: members.length })}</p>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
          className="w-full rounded-xl px-3.5 py-3 text-[13px] outline-none resize-none"
          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
        <p className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{t('admin.churn.bulkHint')}</p>
      </div>
    </AdminModal>
  );
}
