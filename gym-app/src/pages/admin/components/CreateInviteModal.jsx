import { useState, useCallback } from 'react';
import { UserPlus, Copy, Check, Loader2, Share2, Link, ScanLine, X, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import logger from '../../../lib/logger';
import useScanClaim from '../../../hooks/useScanClaim';
import { parseQRContent } from '../../../lib/scanRouter';

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

  // Referral linking
  const [referrerInfo, setReferrerInfo] = useState(null); // { id, name, avatarUrl, codeId }
  const [referralCode, setReferralCode] = useState('');
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralError, setReferralError] = useState(null);

  const inviteUrl = result?.code ? `https://tugympr.app/invite/${result.code}` : '';

  // Handle scan input from physical scanner (claimed while modal is open)
  const handleReferralScan = useCallback(async (rawText) => {
    if (phase !== 'form') return;
    setReferralError(null);
    setReferralLoading(true);

    try {
      const trimmed = rawText.trim();

      // Try parsing as structured QR (gym-referral:gymId:referrerId:code)
      const parsed = parseQRContent(trimmed);

      let referrerProfileId = null;
      let referralCodeId = null;

      if (parsed?.type === 'referral') {
        referrerProfileId = parsed.referrerId;
        // Look up the referral code record
        const { data: codeRow } = await supabase
          .from('referral_codes')
          .select('id')
          .eq('profile_id', parsed.referrerId)
          .eq('gym_id', gymId)
          .single();
        referralCodeId = codeRow?.id;
      } else {
        // Try as a plain referral code string
        const { data: codeRow } = await supabase
          .from('referral_codes')
          .select('id, profile_id')
          .eq('code', trimmed.toUpperCase())
          .eq('gym_id', gymId)
          .single();
        if (codeRow) {
          referrerProfileId = codeRow.profile_id;
          referralCodeId = codeRow.id;
        }
      }

      if (!referrerProfileId || !referralCodeId) {
        setReferralError(t('admin.createInvite.referralNotFound', 'Referral code not found'));
        setReferralLoading(false);
        return;
      }

      // Get referrer info
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('id', referrerProfileId)
        .single();

      if (!profile) {
        setReferralError(t('admin.createInvite.referrerNotFound', 'Referrer not found'));
        setReferralLoading(false);
        return;
      }

      setReferrerInfo({ id: profile.id, name: profile.full_name, avatarUrl: profile.avatar_url, codeId: referralCodeId });
      setReferralCode(trimmed);
    } catch (err) {
      logger.error('Referral scan error:', err);
      setReferralError(err.message);
    } finally {
      setReferralLoading(false);
    }
  }, [phase, gymId, t]);

  // Claim scanner while form phase is active
  useScanClaim(handleReferralScan, phase === 'form');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_create_invite_code', {
        p_gym_id: gymId,
        p_member_name: name.trim(),
        p_phone: phone.trim() || null,
        p_email: email.trim() || null,
        p_referral_code_id: referrerInfo?.codeId || null,
      });
      if (rpcError) throw rpcError;
      setResult(data);
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
    setReferrerInfo(null);
    setReferralCode('');
    setReferralError(null);
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

          {/* Referral — scan or type */}
          <div>
            <label className="block text-[12px] font-semibold text-[#9CA3AF] mb-1.5">
              {t('admin.createInvite.referral', 'Referred by')}
            </label>
            {referrerInfo ? (
              <div className="flex items-center gap-2.5 bg-[#10B981]/8 border border-[#10B981]/20 rounded-xl px-3 py-2.5">
                {referrerInfo.avatarUrl ? (
                  <img src={referrerInfo.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#10B981]/20 flex items-center justify-center">
                    <span className="text-[12px] font-bold text-[#10B981]">{referrerInfo.name?.[0]?.toUpperCase()}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-[#10B981] truncate">{referrerInfo.name}</p>
                  <p className="text-[10px] text-[#6B7280]">{t('admin.createInvite.referralLinked', 'Referral will be linked')}</p>
                </div>
                <button onClick={() => { setReferrerInfo(null); setReferralCode(''); setReferralError(null); }}
                  className="p-1.5 rounded-lg text-[#6B7280] hover:text-[#EF4444] transition-colors">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && referralCode.trim()) { e.preventDefault(); handleReferralScan(referralCode); } }}
                  placeholder={t('admin.createInvite.referralPlaceholder', 'Scan QR or type referral code')}
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 pr-10 text-[13px] text-[#E5E7EB] placeholder-[#9CA3AF] outline-none focus:border-[#D4AF37]/40 transition-colors"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {referralLoading ? (
                    <Loader2 size={14} className="animate-spin text-[#D4AF37]" />
                  ) : (
                    <ScanLine size={14} className="text-[#4B5563]" />
                  )}
                </div>
              </div>
            )}
            {referralError && <p className="text-[11px] text-[#EF4444] mt-1">{referralError}</p>}
            {!referrerInfo && !referralError && (
              <p className="text-[10px] text-[#4B5563] mt-1">{t('admin.createInvite.referralHint', 'Scan a member\'s referral QR to link the referral automatically')}</p>
            )}
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
