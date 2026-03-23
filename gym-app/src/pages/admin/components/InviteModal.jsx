import { useEffect, useState } from 'react';
import { Link, Mail, Send } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { AdminModal, SectionLabel } from '../../../components/admin';

export default function InviteModal({ gymId, onClose }) {
  const [gym, setGym] = useState(null);
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  useEffect(() => {
    supabase.from('gyms').select('slug, name').eq('id', gymId).single()
      .then(({ data }) => setGym(data ?? null));
  }, [gymId]);

  const inviteLink = gym?.slug
    ? `${window.location.origin}/signup?gym=${gym.slug}`
    : null;

  const handleCopy = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleEmailInvite = () => {
    if (!inviteLink || !emailInput.trim()) return;
    const gymName = gym?.name ?? 'your gym';
    const subject = encodeURIComponent(`You're invited to join ${gymName}`);
    const body = encodeURIComponent(
      `Hey!\n\nYou've been invited to join ${gymName} on our gym tracking app.\n\nClick the link below to create your account and get started:\n\n${inviteLink}\n\nSee you in the gym!`
    );
    window.open(`mailto:${emailInput.trim()}?subject=${subject}&body=${body}`, '_blank');
  };

  return (
    <AdminModal isOpen onClose={onClose} title="Invite Member" titleIcon={Link} size="sm">
      <div className="space-y-5">
        <div>
          <SectionLabel className="mb-2">Invite Link</SectionLabel>
          {inviteLink ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 overflow-hidden">
                <p className="text-[12px] text-[#9CA3AF] truncate select-all">{inviteLink}</p>
              </div>
              <button onClick={handleCopy}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors flex-shrink-0 ${
                  copied
                    ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20'
                    : 'bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20'
                }`}>
                <Link size={12} />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          ) : (
            <div className="h-10 bg-[#111827] border border-white/6 rounded-xl animate-pulse" />
          )}
          <p className="text-[11px] text-[#6B7280] mt-2">
            Share this link with new members to join your gym. Members who click it will have the gym code pre-filled.
          </p>
        </div>

        <div>
          <SectionLabel icon={Mail} className="mb-2">Email Invite</SectionLabel>
          <div className="flex items-center gap-2">
            <input type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
              placeholder="member@example.com"
              className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
            <button onClick={handleEmailInvite} disabled={!emailInput.trim() || !inviteLink}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
              <Send size={12} /> Send
            </button>
          </div>
          <p className="text-[11px] text-[#4B5563] mt-1.5">Opens your email client with a pre-written invite message.</p>
        </div>
      </div>
    </AdminModal>
  );
}
