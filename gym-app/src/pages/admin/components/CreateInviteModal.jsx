import { useState, useCallback } from 'react';
import { UserPlus, Copy, Check, Loader2, Share2, ScanLine, X, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import useScanClaim from '../../../hooks/useScanClaim';
import { parseQRContent } from '../../../lib/scanRouter';

/**
 * CreateInviteModal — "Add Member" (Agregar Miembro)
 * Directly creates a member profile + generates a link code
 * so the member can set their password on first app open.
 */
export default function CreateInviteModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const k = (key) => t(`admin.createInvite.${key}`);

  const [phase, setPhase] = useState('form'); // 'form' | 'result'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { profileId, code, name }
  const [copiedCode, setCopiedCode] = useState(false);

  // Referral linking
  const [referrerInfo, setReferrerInfo] = useState(null); // { id, name, avatarUrl, codeId }
  const [referralCode, setReferralCode] = useState('');
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralError, setReferralError] = useState(null);

  // Generate a random 6-char alphanumeric code (excludes ambiguous chars)
  const generateCode = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    const array = new Uint8Array(6);
    crypto.getRandomValues(array);
    for (let i = 0; i < 6; i++) {
      code += chars[array[i] % chars.length];
    }
    return code;
  };

  // Handle scan input from physical scanner (claimed while modal is open)
  const handleReferralScan = useCallback(async (rawText) => {
    if (phase !== 'form') return;
    setReferralError(null);
    setReferralLoading(true);

    try {
      const trimmed = rawText.trim();
      const parsed = parseQRContent(trimmed);

      let referrerProfileId = null;
      let referralCodeId = null;

      if (parsed?.type === 'referral') {
        referrerProfileId = parsed.referrerId;
        const { data: codeRow } = await supabase
          .from('referral_codes')
          .select('id')
          .eq('profile_id', parsed.referrerId)
          .eq('gym_id', gymId)
          .single();
        referralCodeId = codeRow?.id;
      } else {
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
    if (!name.trim() || !email.trim() || !phone.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Create profile directly
      const { data: newProfile, error: profileError } = await supabase
        .from('profiles')
        .insert({
          gym_id: gymId,
          full_name: name.trim(),
          email: email.trim().toLowerCase(),
          role: 'member',
          membership_status: 'active',
          is_onboarded: false,
        })
        .select('id')
        .single();

      if (profileError) throw profileError;

      // 2. Generate a link code and insert into gym_invites (marked as claimed)
      const linkCode = generateCode();

      const { data: { user } } = await supabase.auth.getUser();

      const { error: inviteError } = await supabase
        .from('gym_invites')
        .insert({
          gym_id: gymId,
          created_by: user.id,
          invite_code: linkCode,
          member_name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          role: 'member',
          used_by: newProfile.id,
          used_at: new Date().toISOString(),
          referral_code_id: referrerInfo?.codeId || null,
        });

      if (inviteError) throw inviteError;

      // 3. Log admin action
      logAdminAction('add_member', 'member', newProfile.id, {
        name: name.trim(),
        email: email.trim(),
        has_referral: !!referrerInfo,
      });

      setResult({ profileId: newProfile.id, code: linkCode, name: name.trim() });
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

  const handleShare = async () => {
    if (!result?.code) return;
    const shareText = `${k('shareText')} ${result.code}`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: k('shareTitle'),
          text: shareText,
          dialogTitle: k('shareTitle'),
        });
      } else {
        if (navigator.share) {
          await navigator.share({
            title: k('shareTitle'),
            text: shareText,
          });
        } else {
          handleCopyCode();
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
    setEmail('');
    setPhone('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setReferrerInfo(null);
    setReferralCode('');
    setReferralError(null);
  };

  return (
    <AdminModal isOpen onClose={onClose} title={k('addMemberTitle') || k('title')} titleIcon={UserPlus} size="sm">
      {phase === 'form' ? (
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('memberName')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={k('memberNamePlaceholder')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Email (required) */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('email')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={k('emailPlaceholder')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('phone')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={k('phonePlaceholder')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
              }}
            />
          </div>

          {/* Referral — scan or type */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.createInvite.referral', 'Referred by')}
            </label>
            {referrerInfo ? (
              <div
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={{
                  background: 'color-mix(in srgb, var(--color-success) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
                }}
              >
                {referrerInfo.avatarUrl ? (
                  <img src={referrerInfo.avatarUrl} alt={referrerInfo.name || 'Referrer avatar'} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: 'color-mix(in srgb, var(--color-success) 20%, transparent)' }}
                  >
                    <span className="text-[12px] font-bold" style={{ color: 'var(--color-success)' }}>
                      {referrerInfo.name?.[0]?.toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-success)' }}>{referrerInfo.name}</p>
                  <p className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>
                    {t('admin.createInvite.referralLinked', 'Referral will be linked')}
                  </p>
                </div>
                <button
                  onClick={() => { setReferrerInfo(null); setReferralCode(''); setReferralError(null); }}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
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
                  aria-label={t('admin.createInvite.referralPlaceholder', 'Scan QR or type referral code')}
                  className="w-full rounded-xl px-3 py-2.5 pr-10 text-[13px] outline-none transition-colors"
                  style={{
                    background: 'var(--color-bg-input, var(--color-bg-elevated))',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {referralLoading ? (
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                  ) : (
                    <ScanLine size={14} style={{ color: 'var(--color-text-subtle)' }} />
                  )}
                </div>
              </div>
            )}
            {referralError && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{referralError}</p>}
            {!referrerInfo && !referralError && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.createInvite.referralHint', "Scan a member's referral QR to link the referral automatically")}
              </p>
            )}
          </div>

          {error && <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!name.trim() || !email.trim() || !phone.trim() || loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {k('creating')}
              </>
            ) : (
              <>
                <UserPlus size={14} />
                {k('addMember') || k('createInvite')}
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Success heading */}
          <div className="text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: 'color-mix(in srgb, var(--color-success) 12%, transparent)' }}
            >
              <Check size={24} style={{ color: 'var(--color-success)' }} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--color-success)' }}>
              {k('memberCreated') || k('inviteCreated')}
            </p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {result?.name}
            </p>
          </div>

          {/* Prominent code display */}
          <div
            className="rounded-xl py-5 px-4 text-center overflow-hidden"
            style={{
              background: 'var(--color-bg-input, var(--color-bg-elevated))',
              border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
            }}
          >
            <p
              className="text-[32px] font-bold tracking-[0.25em] font-mono select-all"
              style={{ color: 'var(--color-accent)' }}
            >
              {result?.code}
            </p>
            <p className="text-[11px] mt-2" style={{ color: 'var(--color-text-subtle)' }}>
              {k('linkCodeDescription') || t('admin.createInvite.linkCodeDescription', 'The member can use this code to set their password and access the app')}
            </p>
          </div>

          {/* Action buttons row */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopyCode}
              className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold transition-colors"
              style={copiedCode ? {
                background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                color: 'var(--color-success)',
                border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)',
              } : {
                background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-muted)',
              }}
            >
              {copiedCode ? <Check size={14} /> : <Copy size={14} />}
              {copiedCode ? k('copied') : k('copyCode')}
            </button>
            <button
              onClick={handleShare}
              className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl text-[11px] font-semibold transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              }}
            >
              <Share2 size={14} />
              {k('share')}
            </button>
          </div>

          {/* Bottom actions */}
          <div className="flex gap-3">
            <button
              onClick={handleAddAnother}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{
                background: 'var(--color-bg-input, var(--color-bg-elevated))',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {k('addAnother')}
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
              }}
            >
              {k('done')}
            </button>
          </div>
        </div>
      )}
    </AdminModal>
  );
}
