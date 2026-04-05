import { useState } from 'react';
import { Link, Copy, Check, Loader2, Share2, Mail, QrCode } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import logger from '../../../lib/logger';

/**
 * InviteModal — lightweight invite link generator for sharing.
 * Generates a code + provides QR, copy link, share, and email options.
 * For full member enrollment with referral scanning, use CreateInviteModal.
 */
export default function InviteModal({ gymId, onClose }) {
  const { t } = useTranslation('pages');
  const k = (key) => t(`admin.inviteModal.${key}`);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const inviteUrl = result?.code ? `https://tugympr.app/invite/${result.code}` : '';

  const handleGenerate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_invite_code', {
        p_gym_id: gymId,
        p_member_name: name.trim(),
        p_email: email.trim() || null,
      });
      if (rpcError) throw rpcError;
      setResult(data);
    } catch (err) {
      logger.error('InviteModal: generate failed:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {}
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
  };

  const handleShare = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title: k('shareTitle'), text: `${k('shareText')} ${result.code}`, url: inviteUrl });
      } else if (navigator.share) {
        await navigator.share({ title: k('shareTitle'), text: `${k('shareText')} ${result.code}`, url: inviteUrl });
      } else {
        handleCopyLink();
      }
    } catch (err) {
      if (err.name !== 'AbortError') logger.error('Share failed:', err);
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(k('emailSubject') || 'You\'re invited to join the gym!');
    const body = encodeURIComponent(`${k('emailBody') || 'Use this code to join'}: ${result.code}\n\n${inviteUrl}`);
    const mailto = email ? `mailto:${email}?subject=${subject}&body=${body}` : `mailto:?subject=${subject}&body=${body}`;
    window.open(mailto, '_blank');
  };

  const handleAnother = () => {
    setName('');
    setEmail('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setCopiedLink(false);
  };

  return (
    <AdminModal isOpen onClose={onClose} title={k('inviteTitle') || k('title')} titleIcon={Link} size="sm">
      {!result ? (
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('memberName')} <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={k('memberNamePlaceholder') || k('memberName')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={k('emailPlaceholder') || k('email')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors"
            />
          </div>

          {error && <p className="text-[12px] text-[#EF4444]">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={!name.trim() || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold bg-[#D4AF37] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ color: '#000' }}
          >
            {loading ? <><Loader2 size={14} className="animate-spin" /> {k('generating')}</> : <><Link size={14} /> {k('generateLink') || k('generateCode')}</>}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Code */}
          <div className="bg-[#111827] border border-[#D4AF37]/20 rounded-xl py-4 px-4 text-center">
            <p className="text-[28px] font-bold tracking-[0.25em] text-[#D4AF37] font-mono select-all">{result.code}</p>
            <p className="text-[11px] text-[#6B7280] mt-1">{name}</p>
          </div>

          {/* QR Code */}
          {inviteUrl && (
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-xl">
                <QRCodeSVG value={inviteUrl} size={140} level="H" includeMargin={false} />
              </div>
            </div>
          )}

          {/* Share actions */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleCopyCode}
              className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors ${copiedCode ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20' : 'bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'}`}>
              {copiedCode ? <Check size={13} /> : <Copy size={13} />}
              {copiedCode ? k('copied') : k('copyCode')}
            </button>
            <button onClick={handleCopyLink}
              className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors ${copiedLink ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20' : 'bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB]'}`}>
              {copiedLink ? <Check size={13} /> : <Link size={13} />}
              {copiedLink ? k('copied') : (k('copyLink') || 'Copy Link')}
            </button>
            <button onClick={handleShare}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors">
              <Share2 size={13} />
              {k('share') || 'Share'}
            </button>
            <button onClick={handleEmail}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] font-semibold bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] transition-colors">
              <Mail size={13} />
              {t('admin.inviteModal.sendEmail', 'Email')}
            </button>
          </div>

          {/* Bottom actions */}
          <div className="flex gap-3">
            <button onClick={handleAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#111827] text-[#9CA3AF] border border-white/6 hover:bg-[#1a2235] transition-colors">
              {k('addAnother')}
            </button>
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors">
              {k('done')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
