import { useState } from 'react';
import { UserPlus, Copy, Check, Loader2, Share2, Link } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import logger from '../../../lib/logger';

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'TGP-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function CreateInviteModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const k = (key) => t(`admin.createInvite.${key}`);

  const [phase, setPhase] = useState('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const inviteUrl = result?.code ? `https://tugympr.app/invite/${result.code}` : '';

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      // Try RPC first, fall back to client-side generation
      let code;
      let expiresAt;
      try {
        const { data, error: rpcError } = await supabase.rpc('generate_invite_code', {
          p_gym_id: gymId,
        });
        if (rpcError) throw rpcError;
        code = data;
      } catch {
        code = generateInviteCode();
      }

      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { data: insertData, error: insertError } = await supabase
        .from('member_invites')
        .insert({
          gym_id: gymId,
          invite_code: code,
          member_name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        })
        .select('id, invite_code, expires_at, status')
        .single();

      if (insertError) {
        // If member_invites table doesn't exist, try gym_invites (existing table)
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('gym_invites')
          .insert({
            gym_id: gymId,
            invite_code: code,
            member_name: name.trim(),
            phone: phone.trim() || null,
            email: email.trim() || null,
            expires_at: expiresAt.toISOString(),
          })
          .select('id, invite_code, expires_at')
          .single();

        if (fallbackError) throw fallbackError;
        setResult({ code: fallbackData.invite_code, expires_at: fallbackData.expires_at });
      } else {
        setResult({ code: insertData.invite_code, expires_at: insertData.expires_at });
      }

      setPhase('result');
      if (onCreated) onCreated();
    } catch (err) {
      logger.error('CreateInviteModal: create failed:', err);
      setError(err.message || k('somethingWentWrong'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!result?.code) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      logger.error('Failed to copy code:', err);
    }
  };

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      logger.error('Failed to copy link:', err);
    }
  };

  const handleShare = async () => {
    if (!inviteUrl) return;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: k('shareTitle'),
          text: `${k('shareText')} ${result.code}`,
          url: inviteUrl,
          dialogTitle: k('shareTitle'),
        });
      } else {
        if (navigator.share) {
          await navigator.share({
            title: k('shareTitle'),
            text: `${k('shareText')} ${result.code}`,
            url: inviteUrl,
          });
        } else {
          handleCopyLink();
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error('Share failed:', err);
      }
    }
  };

  const handleAddAnother = () => {
    setPhase('form');
    setName('');
    setPhone('');
    setEmail('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setCopiedLink(false);
  };

  const expiryDate = result?.expires_at
    ? new Date(result.expires_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title={k('title')} titleIcon={UserPlus} size="sm">
      {phase === 'form' ? (
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('memberName')} <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={k('memberNamePlaceholder')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] transition-colors"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('phone')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={k('phonePlaceholder')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {k('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={k('emailPlaceholder')}
              className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 focus:ring-2 focus:ring-[#D4AF37] transition-colors"
            />
          </div>

          {error && <p className="text-[12px] text-[#EF4444]">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold bg-[#D4AF37] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            style={{ color: '#000' }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {k('creating')}
              </>
            ) : (
              <>
                <UserPlus size={14} />
                {k('createInvite')}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Success heading */}
          <p className="text-center text-[14px] font-semibold text-[#10B981]">
            {k('inviteCreated')}
          </p>

          {/* Prominent code display */}
          <div className="bg-[#111827] border border-[#D4AF37]/20 rounded-xl py-5 px-4 text-center overflow-hidden">
            <p className="text-[32px] font-bold tracking-[0.25em] text-[#D4AF37] font-mono select-all">
              {result?.code}
            </p>
            <p className="text-[11px] text-[#6B7280] mt-2">{name}</p>
          </div>

          {/* QR Code */}
          {inviteUrl && (
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-xl">
                <QRCodeSVG
                  value={inviteUrl}
                  size={160}
                  level="H"
                  includeMargin={false}
                />
              </div>
            </div>
          )}

          {/* Invite URL */}
          <div className="bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-center">
            <p className="text-[11px] text-[#6B7280] mb-1">{k('inviteLink')}</p>
            <p className="text-[12px] text-[#D4AF37] font-mono break-all select-all">{inviteUrl}</p>
          </div>

          {/* Action buttons row */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleCopyCode}
              className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold transition-colors ${
                copiedCode
                  ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20'
                  : 'bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15'
              }`}
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />}
              {copiedCode ? k('copied') : k('copyCode')}
            </button>
            <button
              onClick={handleCopyLink}
              className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold transition-colors ${
                copiedLink
                  ? 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/20'
                  : 'bg-white/4 border border-white/6 text-[#9CA3AF] hover:text-[#E5E7EB] hover:border-white/15'
              }`}
            >
              {copiedLink ? <Check size={14} /> : <Link size={14} />}
              {copiedLink ? k('copied') : k('copyLink')}
            </button>
            <button
              onClick={handleShare}
              className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors"
            >
              <Share2 size={14} />
              {k('share')}
            </button>
          </div>

          {/* Expiry */}
          {expiryDate && (
            <p className="text-center text-[12px] text-[#6B7280]">
              {k('expires')} {expiryDate}
            </p>
          )}

          {/* Bottom actions */}
          <div className="flex gap-3">
            <button
              onClick={handleAddAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#111827] text-[#9CA3AF] border border-white/6 hover:bg-[#1a2235] transition-colors"
            >
              {k('addAnother')}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-[#D4AF37]/12 text-[#D4AF37] border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors"
            >
              {k('done')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
