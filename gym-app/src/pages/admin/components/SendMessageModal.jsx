import { useState } from 'react';
import { MessageSquare, Send, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { supabase } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';
import { logAdminAction } from '../../../lib/adminAudit';

export default function SendMessageModal({ member, gymId, adminId, onClose, onSent }) {
  const { t } = useTranslation('pages');
  const defaultMsg = t('admin.churn.defaultMessage', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together.` });
  const [msg, setMsg] = useState(defaultMsg);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      // Create or get DM conversation
      const { data: convoId, error: convoErr } = await supabase.rpc('get_or_create_conversation', { p_other_user: member.id });
      if (convoErr) throw convoErr;

      // Get encryption seed
      const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
      const seed = convo?.encryption_seed || convoId;

      // Encrypt and send as DM
      const encrypted = await encryptMessage(msg.trim(), convoId, seed);
      await supabase.from('direct_messages').insert({
        conversation_id: convoId,
        sender_id: adminId,
        body: encrypted,
      });
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);

      // Send push notification so phone buzzes
      const { data: { session } } = await supabase.auth.getSession();
      supabase.functions.invoke('send-push-user', {
        body: {
          profile_id: member.id,
          gym_id: gymId,
          title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }),
          body: msg.trim().substring(0, 100),
          data: { type: 'direct_message', conversation_id: convoId },
        },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      }).catch(err => logger.warn('SendMessage: push failed:', err));

      // Log contact
      try {
        await supabase.from('admin_contact_log').insert({
          admin_id: adminId, member_id: member.id, gym_id: gymId,
          method: 'in_app_message', note: msg.substring(0, 200),
        });
      } catch (_) {}

      logAdminAction('send_message', 'member', member.id);
      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.churn.sendMessage', 'Send Message')} titleIcon={MessageSquare} subtitle={t('admin.churn.toMember', { name: member.full_name, defaultValue: 'to {{name}}' })}
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
            {t('admin.members.cancel')}
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: sent ? 'var(--color-success)' : 'var(--color-accent)', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'color-mix(in srgb, var(--color-accent) 25%, transparent)'}` }}>
            {sent ? <><CheckCircle size={14} /> {t('admin.churn.sent', 'Sent!')}</> : sending ? t('admin.churn.sendingMsg', 'Sending\u2026') : <><Send size={13} /> {t('admin.churn.sendMessage', 'Send Message')}</>}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <SectionLabel className="mb-2">{t('admin.churn.messageLabel', 'Message')}</SectionLabel>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
            placeholder={t('admin.churn.writeMessage', 'Write your message\u2026')} />
          <p className="text-[11px] text-[#4B5563] mt-1.5">{t('admin.churn.messageHint', 'Member will see this in their Messages page.')}</p>
        </div>
      </div>
    </AdminModal>
  );
}
