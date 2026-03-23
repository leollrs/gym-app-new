import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Mail, Bell, Phone, CheckCircle, X, Send, Smartphone } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notifications';
import logger from '../../../lib/logger';
import { AdminModal, Avatar, SectionLabel } from '../../../components/admin';
import { RiskBadge, ScoreBar } from '../../../components/admin/StatusBadge';

export default function ContactPanel({
  member, gymId, adminId,
  isContacted, contactedAt,
  onMarkContacted, onUnmarkContacted,
  onOpenMessage, onClose,
}) {
  const navigate = useNavigate();
  const [notifMsg, setNotifMsg] = useState('');
  const [notifSending, setNotifSending] = useState(false);
  const [notifSent, setNotifSent] = useState(false);

  const riskTier = member.churnScore >= 80 ? 'critical' : member.churnScore >= 55 ? 'high' : 'medium';
  const email = member.email || null;

  const handleSendNotification = async () => {
    if (!notifMsg.trim()) return;
    setNotifSending(true);
    try {
      await createNotification({
        profileId: member.id, gymId, type: 'admin_message',
        title: 'Message from your gym', body: notifMsg,
        data: { source: 'churn_contact_panel' },
      });
      setNotifSent(true);
      onMarkContacted(member.id);
      setTimeout(() => setNotifSent(false), 2000);
      setNotifMsg('');
    } catch (err) {
      logger.error('ContactPanel: notification failed:', err);
    } finally {
      setNotifSending(false);
    }
  };

  const handleEmail = () => {
    if (email) {
      window.open(`mailto:${email}`, '_blank');
      onMarkContacted(member.id);
    }
  };

  const handleCall = () => {
    if (email) {
      // No phone field yet — use email as fallback contact
    }
  };

  const handleMessageClick = () => {
    onMarkContacted(member.id);
    onOpenMessage();
  };

  const contactedLabel = contactedAt
    ? `Contacted ${new Date(contactedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title="Contact Member" titleIcon={Phone} subtitle={member.full_name} size="sm">
      <div className="space-y-5">
        {/* Member header */}
        <div className="flex items-center gap-3">
          <Avatar name={member.full_name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[14px] font-bold text-[#E5E7EB] truncate">{member.full_name}</p>
              <RiskBadge tier={riskTier} />
            </div>
            <ScoreBar score={member.churnScore} />
          </div>
        </div>

        {/* Contact methods */}
        <div>
          <SectionLabel className="mb-2.5">Contact Methods</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5">
            {/* In-App Message */}
            <button onClick={handleMessageClick}
              className="flex flex-col items-center gap-2 p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/5 transition-all group">
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center group-hover:bg-[#D4AF37]/20 transition-colors">
                <MessageSquare size={18} className="text-[#D4AF37]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">Message</p>
                <p className="text-[10px] text-[#6B7280]">In-app message</p>
              </div>
            </button>

            {/* Email */}
            <button onClick={handleEmail} disabled={!email}
              className="flex flex-col items-center gap-2 p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#60A5FA]/30 hover:bg-[#60A5FA]/5 transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/6 disabled:hover:bg-[#111827]">
              <div className="w-10 h-10 rounded-xl bg-[#60A5FA]/10 flex items-center justify-center group-hover:bg-[#60A5FA]/20 transition-colors">
                <Mail size={18} className="text-[#60A5FA]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">Email</p>
                <p className="text-[10px] text-[#6B7280] truncate max-w-[120px]">{email || 'Not on file'}</p>
              </div>
            </button>

            {/* Push Notification */}
            <button onClick={() => document.getElementById('notif-input')?.focus()}
              className="flex flex-col items-center gap-2 p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#10B981]/30 hover:bg-[#10B981]/5 transition-all group">
              <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center group-hover:bg-[#10B981]/20 transition-colors">
                <Bell size={18} className="text-[#10B981]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">Notification</p>
                <p className="text-[10px] text-[#6B7280]">Push to app</p>
              </div>
            </button>

            {/* SMS / Messages */}
            <button onClick={() => { onMarkContacted(member.id); onClose(); navigate(`/admin/messages?member=${member.id}`); }}
              className="flex flex-col items-center gap-2 p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#F59E0B]/30 hover:bg-[#F59E0B]/5 transition-all group">
              <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/10 flex items-center justify-center group-hover:bg-[#F59E0B]/20 transition-colors">
                <Smartphone size={18} className="text-[#F59E0B]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">SMS</p>
                <p className="text-[10px] text-[#6B7280]">Open conversation</p>
              </div>
            </button>
          </div>
        </div>

        {/* Quick notification compose */}
        <div>
          <SectionLabel icon={Bell} className="mb-2">Quick Notification</SectionLabel>
          <div className="flex gap-2">
            <input id="notif-input" type="text" value={notifMsg} onChange={e => setNotifMsg(e.target.value)}
              placeholder={`Hey ${member.full_name.split(' ')[0]}, we miss you!`}
              onKeyDown={e => e.key === 'Enter' && handleSendNotification()}
              className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
            <button onClick={handleSendNotification} disabled={notifSending || !notifMsg.trim() || notifSent}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-40"
              style={{
                background: notifSent ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.10)',
                color: notifSent ? '#10B981' : '#10B981',
                border: `1px solid ${notifSent ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)'}`,
              }}>
              {notifSent ? <CheckCircle size={14} /> : notifSending ? '...' : <Send size={14} />}
            </button>
          </div>
        </div>

        {/* Contacted status toggle */}
        <div className="flex items-center justify-between p-3 bg-[#111827] border border-white/6 rounded-xl">
          <div>
            <p className="text-[12px] font-semibold text-[#E5E7EB]">
              {isContacted ? 'Marked as Contacted' : 'Not yet contacted'}
            </p>
            {contactedLabel && (
              <p className="text-[10px] text-[#6B7280] mt-0.5">{contactedLabel}</p>
            )}
          </div>
          <button
            onClick={() => isContacted ? onUnmarkContacted(member.id) : onMarkContacted(member.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
              isContacted
                ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20 hover:bg-[#EF4444]/10 hover:text-[#EF4444] hover:border-[#EF4444]/20'
                : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB]'
            }`}>
            {isContacted ? (
              <>
                <CheckCircle size={12} />
                <span className="group-hover:hidden">Contacted</span>
              </>
            ) : (
              <>
                <Phone size={12} /> Mark Contacted
              </>
            )}
          </button>
        </div>
      </div>
    </AdminModal>
  );
}
