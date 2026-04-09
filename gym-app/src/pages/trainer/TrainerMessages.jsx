import { useEffect, useState } from 'react';
import { Radio, X, Send, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { encryptMessage } from '../../lib/messageEncryption';
import { useTranslation } from 'react-i18next';
import logger from '../../lib/logger';
import useFocusTrap from '../../hooks/useFocusTrap';
import Messages from '../Messages';

// ── Broadcast Modal ──────────────────────────────────────────────────────
function BroadcastModal({ trainerId, onClose }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const focusTrapRef = useFocusTrap(true, onClose);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });

  const handleSend = async () => {
    const text = message.trim();
    if (!text) return;
    setSending(true);

    try {
      // Fetch all active clients for this trainer
      const { data: tcRows, error: tcErr } = await supabase
        .from('trainer_clients')
        .select('client_id')
        .eq('trainer_id', trainerId)
        .eq('is_active', true);
      if (tcErr) throw tcErr;

      const clientIds = (tcRows || []).map(r => r.client_id);
      if (clientIds.length === 0) {
        showToast(t('trainerMessages.noClients', 'No clients to message'), 'error');
        setSending(false);
        return;
      }

      const total = clientIds.length;
      setProgress({ sent: 0, total });
      let successCount = 0;
      let failCount = 0;
      const BATCH_SIZE = 5;

      for (let i = 0; i < clientIds.length; i += BATCH_SIZE) {
        const batch = clientIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (clientId) => {
            try {
              const { data: convId } = await supabase.rpc('get_or_create_conversation', { p_other_user: clientId });
              if (!convId) return false;
              const { data: conv } = await supabase
                .from('conversations')
                .select('encryption_seed')
                .eq('id', convId)
                .single();
              const encrypted = await encryptMessage(text, convId, conv?.encryption_seed);
              await supabase.from('direct_messages').insert({
                conversation_id: convId,
                sender_id: trainerId,
                body: encrypted,
              });
              return true;
            } catch (err) {
              logger.error('Broadcast: failed for client', clientId, err);
              return false;
            }
          })
        );
        const batchSuccess = results.filter(Boolean).length;
        successCount += batchSuccess;
        failCount += results.length - batchSuccess;
        setProgress({ sent: Math.min(i + BATCH_SIZE, total), total });
      }

      if (failCount > 0) {
        showToast(
          t('trainerMessages.broadcastPartial', '{{success}} sent, {{failed}} failed', { success: successCount, failed: failCount }),
          'warning'
        );
      } else {
        showToast(
          t('trainerMessages.broadcastSent', 'Broadcast sent to {{count}} clients', { count: successCount }),
          'success'
        );
      }
      onClose();
    } catch (err) {
      logger.error('Broadcast: error', err);
      showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-bg-card)] border border-[var(--color-border-default)] rounded-2xl w-full max-w-sm overflow-hidden mx-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-[var(--color-accent)]" />
            <h2 className="text-[16px] font-bold text-[var(--color-text-primary)]">
              {t('trainerMessages.broadcast', 'Broadcast')}
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pb-2">
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {t('trainerMessages.broadcastDesc', 'Send a message to all your clients at once.')}
          </p>
        </div>
        <div className="px-5 pb-3">
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={t('trainerMessages.typeMessage', 'Type your message...')}
            autoFocus
            rows={4}
            className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
          />
        </div>
        <div className="px-5 pb-5">
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="w-full py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-bold rounded-xl text-[14px] transition-colors min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {progress.total > 0 && (
                  <span className="text-[13px]">
                    {t('trainerMessages.sendingProgress', 'Sending {{sent}}/{{total}}...', { sent: progress.sent, total: progress.total })}
                  </span>
                )}
              </>
            ) : (
              <>
                <Send size={16} />
                {t('trainerMessages.sendToAllClients', 'Send to all clients')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function TrainerMessages() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const [clientIds, setClientIds] = useState(new Set());
  const [showBroadcast, setShowBroadcast] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from('trainer_clients')
      .select('client_id')
      .eq('trainer_id', profile.id)
      .eq('is_active', true)
      .then(({ data }) => setClientIds(new Set((data || []).map(r => r.client_id))));
  }, [profile?.id]);

  const broadcastBtn = (
    <button
      onClick={() => setShowBroadcast(true)}
      className="flex items-center gap-1.5 px-3 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] text-[var(--color-text-on-accent)] font-semibold rounded-xl text-[13px] transition-colors min-h-[44px]"
    >
      <Radio size={14} />
      {t('trainerMessages.broadcast', 'Broadcast')}
    </button>
  );

  return (
    <div>
      <Messages trainerClientIds={clientIds} hideBackButton headerExtra={broadcastBtn} />

      {showBroadcast && (
        <BroadcastModal
          trainerId={profile.id}
          onClose={() => setShowBroadcast(false)}
        />
      )}
    </div>
  );
}
