import { useState } from 'react';
import { RotateCcw, CheckCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';

const OFFERS = [
  { value: '', label: 'No offer' },
  { value: 'Free PT session', label: 'Free PT session' },
  { value: '1 month discount', label: '1 month discount' },
  { value: 'Free class pass', label: 'Free class pass' },
  { value: 'Custom…', label: 'Custom…' },
];

export default function WinBackModal({ member, gymId, adminId, onClose, onSent }) {
  const defaultMsg = `Hey ${member.full_name.split(' ')[0]}! We miss you at the gym. We'd love to have you back — come in this week and let's pick up where you left off. Your spot is waiting!`;
  const [msg, setMsg] = useState(defaultMsg);
  const [offer, setOffer] = useState('');
  const [customOffer, setCustomOffer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const finalOffer = offer === 'Custom…' ? customOffer : offer;

  const handleSend = async () => {
    setSending(true);
    try {
      const fullMsg = finalOffer ? `${msg}\n\nSpecial offer for you: ${finalOffer}` : msg;
      await supabase.from('notifications').insert({
        profile_id: member.id, gym_id: gymId, type: 'win_back',
        title: 'We want you back!', body: fullMsg,
        data: { source: 'churn_win_back', offer: finalOffer || null },
      });
      try {
        await supabase.from('win_back_attempts').insert({
          user_id: member.id, gym_id: gymId, admin_id: adminId,
          message: fullMsg, offer: finalOffer || null,
          outcome: 'no_response', created_at: new Date().toISOString(),
        });
      } catch (_) {}
      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Failed to send win-back', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose} title="Win-Back Campaign" subtitle={`Re-engage ${member.full_name}`} size="md"
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)', color: sent ? '#10B981' : '#EF4444', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
            {sent ? <><CheckCircle size={14} /> Sent!</> : sending ? 'Sending…' : <><RotateCcw size={13} /> Send Win-Back</>}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <SectionLabel className="mb-2">Message</SectionLabel>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
        </div>
        <div>
          <SectionLabel className="mb-2">Offer (optional)</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {OFFERS.map(o => (
              <button key={o.value} onClick={() => setOffer(o.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${offer === o.value ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30' : 'bg-white/4 text-[#9CA3AF] border-white/6 hover:text-[#E5E7EB]'}`}>
                {o.label}
              </button>
            ))}
          </div>
          {offer === 'Custom…' && (
            <input type="text" value={customOffer} onChange={e => setCustomOffer(e.target.value)} placeholder="Describe your offer…"
              className="mt-2 w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
          )}
        </div>
        {finalOffer && (
          <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/15 rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-[#D4AF37] font-semibold mb-0.5">Offer included in message</p>
            <p className="text-[12px] text-[#9CA3AF]">{finalOffer}</p>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
