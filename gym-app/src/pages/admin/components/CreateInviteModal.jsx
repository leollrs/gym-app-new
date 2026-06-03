import { useState, useCallback } from 'react';
import { UserPlus, Copy, Check, Loader2, Share2, ScanLine, X, Mail, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase } from '../../../lib/supabase';
import AdminModal from '../../../components/admin/AdminModal';
import PhoneInput from '../../../components/admin/PhoneInput';
import NameFields from './NameFields';
import { composeFullName, areNamePartsValid } from '../../../lib/admin/memberName';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import { useToast } from '../../../contexts/ToastContext';
import posthog from 'posthog-js';
import useScanClaim from '../../../hooks/useScanClaim';
import { parseQRContent } from '../../../lib/scanRouter';

/**
 * CreateInviteModal — "Add Member" (Agregar Miembro)
 * Directly creates a member profile + generates a link code, then delivers that
 * access code to the member via our own providers (Resend email / Twilio SMS)
 * through the existing send-admin-email / send-sms edge functions (memberId path).
 */
export default function CreateInviteModal({ gymId, onClose, onCreated }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const k = (key) => t(`admin.createInvite.${key}`);

  const [phase, setPhase] = useState('form'); // 'form' | 'result'
  const [nameParts, setNameParts] = useState({ first: '', middle: '', last: '', second: '' });
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

  // Gym membership ID (optional) — the code from the gym's existing system
  // (keypad / barcode). Promoted to a primary field; no longer mandatory.
  const [externalId, setExternalId] = useState('');

  // Optional admin override for the member's actual gym join date.
  // When set, the churn engine uses this for tenure calculations
  // instead of the app signup date — important for members who
  // pre-date the app, otherwise they get flagged as 90-day-risk.
  const [membershipStartedAt, setMembershipStartedAt] = useState('');

  // Credential delivery — which channel(s) to auto-send the access code on.
  const [sendMethod, setSendMethod] = useState('both'); // 'email' | 'sms' | 'both'
  const [delivering, setDelivering] = useState(false);
  const [sentVia, setSentVia] = useState([]); // channels that succeeded

  const fullName = composeFullName(nameParts);
  const namesOk = areNamePartsValid(nameParts);

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

  // Deliver the access code to the new member via our providers (Resend / Twilio)
  // through the member-aware edge functions (they resolve the stored email/phone
  // from the member record). Best-effort — failures fall back to manual share.
  const deliverAccess = async (memberId, code) => {
    const channels = sendMethod === 'both' ? ['email', 'sms'] : [sendMethod];
    const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
    const firstName = (nameParts.first || '').trim();
    const inviteUrl = `https://tugympr.app/invite/${code}`;
    const succeeded = [];
    setDelivering(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeaders = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
      for (const ch of channels) {
        try {
          if (ch === 'email') {
            const subject = k('accessEmailSubject') || 'Your gym access code';
            const body = [
              t('admin.createInvite.accessGreeting', { name: firstName, defaultValue: 'Hi {{name}}, your account is ready.' }),
              t('admin.createInvite.accessCodeLine', { code, defaultValue: 'Your access code: {{code}}' }),
              t('admin.createInvite.accessOpenLink', { url: inviteUrl, defaultValue: 'Tap to get started and set your password: {{url}}' }),
            ].join('\n');
            const { data, error: fnErr } = await supabase.functions.invoke('send-admin-email', {
              headers: authHeaders,
              body: { memberId, subject, body, lang },
            });
            if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'email_failed');
            succeeded.push('email');
          } else {
            const body = t('admin.createInvite.accessSmsBody', { code, url: inviteUrl, defaultValue: 'Your account is ready! Access code: {{code}}. Set your password: {{url}}' });
            const { data, error: fnErr } = await supabase.functions.invoke('send-sms', {
              headers: authHeaders,
              body: { memberId, body, source: 'member_add' },
            });
            if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'sms_failed');
            succeeded.push('sms');
          }
        } catch (err) {
          logger.warn(`deliverAccess ${ch} failed:`, err);
        }
      }
    } finally {
      setDelivering(false);
    }
    setSentVia(succeeded);
    if (succeeded.length === channels.length) {
      showToast(k('accessSent') || 'Access code sent', 'success');
    } else if (succeeded.length > 0) {
      showToast(k('accessSentPartial') || 'Sent on some channels — share the rest manually.', 'warning');
    } else {
      showToast(k('accessSendFailed') || "Couldn't send automatically — copy or share the code.", 'error');
    }
  };

  const handleCreate = async () => {
    if (!fullName || !namesOk || !email.trim() || !phone.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Create the member via RPC. A direct profiles insert can't work:
      //    profiles.id is an FK to auth.users with no default, and email is not
      //    a profiles column. The RPC provisions a real auth user + profile.
      const { data: created, error: rpcError } = await supabase.rpc('admin_create_member', {
        p_gym_id: gymId,
        p_full_name: fullName,
        p_email: email.trim().toLowerCase(),
        p_phone: phone.trim() || null,
        p_membership_started_at: membershipStartedAt || null,
        p_external_id: externalId.trim() || null,
        p_admin_note: null,
        p_age: null,
        p_sex: null,
        p_height_inches: null,
        p_weight_lbs: null,
        p_fitness_level: null,
        p_primary_goal: null,
        p_training_days: null,
      });

      if (rpcError) throw rpcError;
      const newMemberId = created?.id;
      if (!newMemberId) throw new Error(k('somethingWentWrong'));

      // 2. Generate a link code and insert into gym_invites (marked as claimed)
      const linkCode = generateCode();

      const { data: { user } } = await supabase.auth.getUser();

      const { error: inviteError } = await supabase
        .from('gym_invites')
        .insert({
          gym_id: gymId,
          created_by: user.id,
          invite_code: linkCode,
          member_name: fullName,
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          role: 'member',
          used_by: newMemberId,
          used_at: new Date().toISOString(),
          referral_code_id: referrerInfo?.codeId || null,
        });

      if (inviteError) throw inviteError;

      // 3. Log admin action
      logAdminAction('add_member', 'member', newMemberId, {
        name: fullName,
        email: email.trim(),
        has_referral: !!referrerInfo,
      });
      posthog?.capture('admin_member_invited', { method: 'direct_add' });

      setResult({ profileId: newMemberId, code: linkCode, name: fullName });
      setPhase('result');
      if (onCreated) onCreated();

      // 4. Auto-deliver the access code via our providers (best-effort).
      deliverAccess(newMemberId, linkCode);
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
    setNameParts({ first: '', middle: '', last: '', second: '' });
    setEmail('');
    setPhone('');
    setResult(null);
    setError(null);
    setCopiedCode(false);
    setReferrerInfo(null);
    setReferralCode('');
    setReferralError(null);
    setExternalId('');
    setMembershipStartedAt('');
    setSentVia([]);
    setDelivering(false);
  };

  const inputStyle = {
    background: 'var(--color-bg-input, var(--color-bg-elevated))',
    border: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-primary)',
  };

  const channelBtnStyle = (active, tone) => active
    ? { background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone, border: `1px solid color-mix(in srgb, ${tone} 32%, transparent)` }
    : { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' };

  return (
    <AdminModal isOpen onClose={onClose} title={k('addMemberTitle') || k('title')} titleIcon={UserPlus} size="sm">
      {phase === 'form' ? (
        <div className="space-y-4">
          {/* Name — structured (first / middle / last / second last) */}
          <NameFields value={nameParts} onChange={setNameParts} />

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
              style={inputStyle}
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('phone')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              placeholder={k('phonePlaceholder')}
              ariaLabel={k('phone')}
            />
          </div>

          {/* Gym membership ID — promoted primary field, optional. */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.createInvite.externalId', 'Gym membership ID (keypad / system code)')}
            </label>
            <input
              type="text"
              value={externalId}
              onChange={e => setExternalId(e.target.value)}
              placeholder={t('admin.createInvite.externalIdPlaceholder', 'e.g. 1234, A001')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={inputStyle}
            />
          </div>

          {/* Gym join date — overrides 90-day onboarding risk window so members
              who pre-date the app aren't flagged. */}
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {k('membershipStartedAt')}
            </label>
            <input
              type="date"
              value={membershipStartedAt}
              onChange={e => setMembershipStartedAt(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={inputStyle}
            />
            <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {k('membershipStartedAtHelp')}
            </p>
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
                  aria-label={t('admin.createInvite.clearReferrer', 'Clear referrer')}
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
                  style={inputStyle}
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

          {/* Credential delivery channel */}
          <div>
            <label className="block text-[12px] font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.createInvite.sendVia', 'Send access code via')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => setSendMethod('email')}
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={channelBtnStyle(sendMethod === 'email', 'var(--color-info)')}>
                <Mail size={13} /> {t('admin.createInvite.channelEmail', 'Email')}
              </button>
              <button type="button" onClick={() => setSendMethod('sms')}
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={channelBtnStyle(sendMethod === 'sms', 'var(--color-success)')}>
                <Smartphone size={13} /> {t('admin.createInvite.channelSms', 'SMS')}
              </button>
              <button type="button" onClick={() => setSendMethod('both')}
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-[12px] font-semibold transition-colors"
                style={channelBtnStyle(sendMethod === 'both', 'var(--color-accent)')}>
                {t('admin.createInvite.channelBoth', 'Both')}
              </button>
            </div>
          </div>

          {error && <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}

          <button
            onClick={handleCreate}
            disabled={!fullName || !namesOk || !email.trim() || !phone.trim() || loading}
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

          {/* Delivery status */}
          <div
            className="flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12px] font-medium"
            style={delivering
              ? { background: 'color-mix(in srgb, var(--color-text-primary) 4%, transparent)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }
              : sentVia.length > 0
                ? { background: 'color-mix(in srgb, var(--color-success) 10%, transparent)', color: 'var(--color-success)', border: '1px solid color-mix(in srgb, var(--color-success) 20%, transparent)' }
                : { background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', color: 'var(--color-warning)', border: '1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)' }}
          >
            {delivering ? (
              <><Loader2 size={13} className="animate-spin" /> {t('admin.createInvite.deliveringAccess', 'Sending access code…')}</>
            ) : sentVia.length > 0 ? (
              <><Check size={13} /> {sentVia.includes('email') && sentVia.includes('sms')
                ? t('admin.createInvite.accessSentBoth', 'Access code sent by email + SMS')
                : sentVia.includes('email')
                  ? t('admin.createInvite.accessSentEmail', 'Access code emailed')
                  : t('admin.createInvite.accessSentSms', 'Access code texted')}</>
            ) : (
              <>{t('admin.createInvite.accessSendFailed', "Couldn't send automatically — copy or share the code.")}</>
            )}
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
