import { useState } from 'react';
import { MessageSquare, Send, CheckCircle } from 'lucide-react';
import i18n from 'i18next';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';

export default function SendMessageModal({ member, gymId, adminId, onClose, onSent }) {
  const defaultMsg = `Hey ${member.full_name.split(' ')[0]}, we noticed you haven't been in for a while. We miss you! Come back and let's get back on track together.`;
  const [msg, setMsg] = useState(defaultMsg);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await supabase.from('notifications').insert({
        profile_id: member.id, gym_id: gymId, type: 'admin_message',
        title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: msg, data: { source: 'churn_intel' },
        dedup_key: `admin_msg_${member.id}_${adminId}_${Date.now() / 60000 | 0}`,
      });
      try {
        await supabase.from('win_back_attempts').insert({
          user_id: member.id, gym_id: gymId, admin_id: adminId,
          message: msg, offer: null, outcome: 'pending', created_at: new Date().toISOString(),
        });
      } catch (_) {}
      // Log contact to admin_contact_log
      try {
        await supabase.from('admin_contact_log').insert({
          admin_id: adminId, member_id: member.id, gym_id: gymId,
          method: 'in_app_message', note: msg.substring(0, 200),
        });
      } catch (_) {}
      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Failed to send message', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose} title="Send Message" titleIcon={MessageSquare} subtitle={`to ${member.full_name}`}
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'color-mix(in srgb, var(--color-accent) 12%, transparent)', color: sent ? 'var(--color-success)' : 'var(--color-accent)', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'color-mix(in srgb, var(--color-accent) 25%, transparent)'}` }}>
            {sent ? <><CheckCircle size={14} /> Sent!</> : sending ? 'Sending…' : <><Send size={13} /> Send Message</>}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <SectionLabel className="mb-2">Message</SectionLabel>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors"
            placeholder="Write your message…" />
          <p className="text-[11px] text-[#4B5563] mt-1.5">Member will receive this as an in-app notification.</p>
        </div>
      </div>
    </AdminModal>
  );
}
