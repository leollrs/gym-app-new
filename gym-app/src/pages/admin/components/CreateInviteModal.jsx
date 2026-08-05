import { useState, useCallback, useEffect, useRef } from 'react';
import SafeImg from '../../../components/SafeImg';
import { UserPlus, Copy, Check, Loader2, Share2, ScanLine, X, Mail, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { supabase, authHeader, readFunctionError } from '../../../lib/supabase';
import { inviteUrl as buildInviteUrl } from '../../../lib/appUrls';
import AdminModal from '../../../components/admin/AdminModal';
import PhoneInput from '../../../components/admin/PhoneInput';
import NameFields from './NameFields';
import { composeFullName, areNamePartsValid, splitFullName } from '../../../lib/admin/memberName';
import logger from '../../../lib/logger';
import { logAdminAction } from '../../../lib/adminAudit';
import { useToast } from '../../../contexts/ToastContext';
import posthog from 'posthog-js';
import useScanClaim from '../../../hooks/useScanClaim';
import { parseQRContent } from '../../../lib/scanRouter';
import { formatReferralCode, looksLikeReferralCode } from '../../../lib/referralCode';

/**
 * CreateInviteModal — "Add Member" (Agregar Miembro)
 * Directly creates a member profile + generates a link code, then delivers that
 * access code through `send-invite` — the same branded invite (gym logo, the
 * code in its own chip, a real CTA button) the Invite modal already sent.
 */
/**
 * `initialValues` prefills the form when the modal is opened as the second half
 * of another flow — today that's converting a prospect (mig 0681), which also
 * carries the referrer through so whoever brought them gets credited.
 * Shape: `{ fullName, email, phone, referrer: { id, full_name, avatar_url } }`.
 */
export default function CreateInviteModal({ gymId, onClose, onCreated, initialValues = null }) {
  const { t, i18n } = useTranslation('pages');
  const { showToast } = useToast();
  const k = (key) => t(`admin.createInvite.${key}`);

  const [phase, setPhase] = useState('form'); // 'form' | 'result'
  const [nameParts, setNameParts] = useState(() =>
    initialValues?.fullName
      ? { first: '', middle: '', last: '', second: '', ...splitFullName(initialValues.fullName) }
      : { first: '', middle: '', last: '', second: '' });
  const [email, setEmail] = useState(initialValues?.email || '');
  const [phone, setPhone] = useState(initialValues?.phone || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { profileId, code, name }
  const [copiedCode, setCopiedCode] = useState(false);

  // Referral linking
  const [referrerInfo, setReferrerInfo] = useState(() =>
    initialValues?.referrer
      ? {
          id: initialValues.referrer.id,
          name: initialValues.referrer.full_name,
          avatarUrl: initialValues.referrer.avatar_url || null,
          // No codeId: the prospect flow resolves the referrer by profile, not
          // by code (a member who has never opened the Referrals page has no
          // code row). Attribution runs through admin_attribute_referral, which
          // takes profile ids and looks the code up itself if one exists.
          codeId: null,
        }
      : null); // { id, name, avatarUrl, codeId }
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
  const [deliveryErrors, setDeliveryErrors] = useState([]); // why the others didn't

  // Live "is this address free" check. `admin_create_member` rejects a taken
  // email, but only once the whole form is filled and Add is pressed — the same
  // late failure the member onboarding was already fixed for. The collision is
  // on auth.users, which the browser cannot read under any role, so this asks
  // `admin_email_available` (mig 0678) instead.
  const [emailTaken, setEmailTaken] = useState(false);
  const emailCheckTimer = useRef(null);
  const emailCheckSeq = useRef(0);
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  useEffect(() => {
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    setEmailTaken(false);
    if (!emailValid) return undefined;
    const seq = ++emailCheckSeq.current;
    emailCheckTimer.current = setTimeout(async () => {
      const { data, error: rpcErr } = await supabase.rpc('admin_email_available', { p_email: email.trim().toLowerCase() });
      // Ignore a stale response — the admin may have typed on since.
      if (seq !== emailCheckSeq.current) return;
      // Fail OPEN. Until 0678 is applied the RPC does not exist, and blocking
      // the button on a missing function would take Add Member down entirely.
      // `admin_create_member` still refuses a duplicate, so the worst case is
      // the old behaviour: the error arrives on submit instead of before it.
      if (rpcErr) { logger.warn('admin_email_available unavailable:', rpcErr); return; }
      setEmailTaken(data === false);
    }, 450);
    return () => { if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current); };
  }, [email, emailValid]);

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

  // Typing a referral code by hand. The field used to take raw keystrokes and
  // only look anything up when you pressed Enter — so the admin had to type the
  // dashes themselves AND know that Enter was the trigger, with nothing on
  // screen saying so. Now the dashes appear as you type and a complete code
  // resolves on its own.
  const referralTimer = useRef(null);
  const handleReferralType = (raw) => {
    const formatted = formatReferralCode(raw);
    setReferralCode(formatted);
    setReferralError(null);
    if (referralTimer.current) clearTimeout(referralTimer.current);
    if (!looksLikeReferralCode(formatted)) return;
    referralTimer.current = setTimeout(() => handleReferralScan(formatted), 500);
  };
  useEffect(() => () => {
    if (referralTimer.current) clearTimeout(referralTimer.current);
  }, []);

  // Deliver the access code through `send-invite` — the SAME function the
  // Invite modal uses.
  //
  // WHY THE SWITCH: this flow used to hand-roll its own delivery — three lines
  // of plain text through send-admin-email's generic wrapper, and a sentence
  // through send-sms. That wrapper renders every line as an identical grey
  // paragraph, so the access code arrived as body text in a mail whose only
  // branding was the gym's colours. Meanwhile `send-invite` already builds the
  // real thing for the other invite path: the gym's logo, the code in its own
  // bordered chip, a proper CTA button, a "powered by" footer. There was never
  // a reason for Add Member to have the lesser one.
  //
  // It also addresses the message by `to` rather than looking the member up, so
  // the shadow-auth-user trap (admin_create_member parks the real address in
  // pending_email / gym_invites.email, mig 0467:126) can't bite this path at
  // all — that is what "Member has no email on file" was.
  const deliverAccess = async (memberId, code, recipientEmail) => {
    const channels = sendMethod === 'both' ? ['email', 'sms'] : [sendMethod];
    const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
    const firstName = (nameParts.first || '').trim();
    const inviteUrl = buildInviteUrl(code);
    const toPhone = phone.trim();
    const succeeded = [];
    // Surfaced verbatim on the result screen. "Couldn't send automatically" told
    // the admin nothing they could act on — a Resend domain that isn't verified
    // and a member who typo'd their address read identically.
    const failures = [];
    setDelivering(true);

    // `functions.invoke` reports a non-2xx as the useless
    // "Edge Function returned a non-2xx status code" and leaves the real reason
    // unread in `error.context`. Every 400 in send-invite says exactly what is
    // wrong ("Valid `to` email is required", "Invalid phone number format",
    // "This gym does not have an SMS phone number configured") — none of which
    // reached anyone. readFunctionError pulls it out.
    const reasonOf = async (fnErr, data) =>
      data?.error || (await readFunctionError(fnErr)) || fnErr?.message || 'failed';

    try {
      for (const ch of channels) {
        const to = ch === 'email' ? (recipientEmail || '').trim() : toPhone;
        if (!to) {
          logger.error(`deliverAccess: no ${ch} recipient, skipping`);
          failures.push(`${ch}: no recipient on file`);
          continue;
        }
        try {
          // send-invite is verify_jwt=on — a header-less request is bounced by
          // the gateway. authHeader() attaches a freshly-refreshed token; a dead
          // session throws SESSION_EXPIRED, caught per-channel below so the UI
          // falls back to the "share the code manually" path.
          const authHeaders = await authHeader();
          const { data, error: fnErr } = await supabase.functions.invoke('send-invite', {
            headers: authHeaders,
            body: { channel: ch, to, memberName: fullName, inviteCode: code, inviteUrl, lang },
          });
          if (fnErr || data?.error) throw new Error(await reasonOf(fnErr, data));
          succeeded.push(ch);
        } catch (err) {
          // FALL BACK to the path this replaced. `send-invite` builds the nicer
          // message, but it is stricter about its inputs and it is a different
          // deploy — if it refuses, the member still needs their code today.
          // The real reason is logged either way, so a failure here is
          // diagnosable instead of silent.
          logger.error(`deliverAccess: send-invite ${ch} refused — ${err?.message}. Falling back.`);
          try {
            const authHeaders = await authHeader();
            if (ch === 'email') {
              // Just the sentence. The code and the link are passed as STRUCTURE
              // (accessCode / ctaUrl) so the template can set them as a code chip
              // and a real button — sending them as body lines is what made the
              // access code render as one more grey paragraph among three.
              const body = t('admin.createInvite.accessGreeting', { name: firstName, defaultValue: 'Hi {{name}}, your account is ready.' });
              const { data, error: fnErr } = await supabase.functions.invoke('send-admin-email', {
                headers: authHeaders,
                body: {
                  memberId, subject: k('accessEmailSubject') || 'Your gym access code', body, lang,
                  overrideEmail: to, emailOverrideAcknowledged: true,
                  accessCode: code,
                  ctaUrl: inviteUrl,
                  ctaLabel: t('admin.createInvite.accessCta', 'Set your password'),
                },
              });
              if (fnErr || data?.error) throw new Error(await reasonOf(fnErr, data));
            } else {
              const body = t('admin.createInvite.accessSmsBody', { code, url: inviteUrl, defaultValue: 'Your account is ready! Access code: {{code}}. Set your password: {{url}}' });
              const { data, error: fnErr } = await supabase.functions.invoke('send-sms', {
                headers: authHeaders,
                body: { memberId, body, source: 'member_add', overridePhone: to },
              });
              if (fnErr || data?.error) throw new Error(await reasonOf(fnErr, data));
            }
            succeeded.push(ch);
          } catch (fallbackErr) {
            logger.error(`deliverAccess ${ch} failed on both paths:`, fallbackErr?.message);
            failures.push(`${ch}: ${fallbackErr?.message || 'failed'}`);
          }
        }
      }
    } finally {
      setDelivering(false);
    }
    setSentVia(succeeded);
    setDeliveryErrors(failures);
    if (succeeded.length === channels.length) {
      showToast(k('accessSent') || 'Access code sent', 'success');
    } else if (succeeded.length > 0) {
      showToast(k('accessSentPartial') || 'Sent on some channels — share the rest manually.', 'warning');
    } else {
      showToast(k('accessSendFailed') || "Couldn't send automatically — copy or share the code.", 'error');
    }
  };

  const handleCreate = async () => {
    if (!fullName || !namesOk || !email.trim() || !phone.trim() || emailTaken) return;
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
      // Pass the new id up — the prospect-conversion flow needs it to attribute
      // the referral and mark the prospect converted.
      // Se devuelve el referidor FINAL del formulario, no el que llegó en
      // initialValues. El admin puede quitarlo o escanear el código de otra
      // persona, y sin esto quien convierte un prospecto acreditaba igual al
      // referidor original — y `referrals` tiene UNIQUE(referred_id, gym_id),
      // así que ese crédito equivocado es PERMANENTE (mig 0681).
      if (onCreated) onCreated(newMemberId, referrerInfo?.id ?? null);

      // 4. Auto-deliver the access code via our providers (best-effort).
      deliverAccess(newMemberId, linkCode, email.trim().toLowerCase());
    } catch (err) {
      logger.error('CreateInviteModal: create failed:', err);
      setError(err.message || k('somethingWentWrong'));
      showToast(t('admin.createInvite.createFailed', { error: err.message, defaultValue: "Couldn't add member — {{error}}" }), 'error');
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
    // The link goes INSIDE the text, not in a separate `url` field.
    //
    // Sharing only "…usa el código: UND7NE" left the member a code and no door —
    // they had to be told separately where to type it. The obvious fix is to
    // pass `url` alongside `text`, but the share sheet's Copy action serializes
    // the activity items, so the two either arrive duplicated or the text is
    // dropped and only the URL survives. One string is the only shape that
    // reliably carries BOTH through Copy, Messages, Mail and Notes alike — and
    // iOS still auto-detects and previews a URL sitting inside message text.
    const shareText = `${k('shareText')} ${result.code}\n${buildInviteUrl(result.code)}`;
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
    setEmailTaken(false);
    setExternalId('');
    setMembershipStartedAt('');
    setSentVia([]);
    setDeliveryErrors([]);
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
              aria-invalid={emailTaken || undefined}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
              style={emailTaken
                ? { ...inputStyle, border: '1px solid var(--color-danger)' }
                : inputStyle}
            />
            {/* On the field, not down by the button. Finding out at submit time
                that the address is taken means re-reading a form you already
                finished to work out which line was the problem. */}
            {emailTaken && (
              <p className="text-[11px] mt-1.5 font-semibold" style={{ color: 'var(--color-danger)' }}>
                {t('admin.createInvite.emailTaken', 'That email already has an account. Search for them in Members instead.')}
              </p>
            )}
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
                  <SafeImg src={referrerInfo.avatarUrl} alt={referrerInfo.name || 'Referrer avatar'} className="w-8 h-8 rounded-full object-cover" />
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
                  onChange={(e) => handleReferralType(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && referralCode.trim()) { e.preventDefault(); handleReferralScan(referralCode); } }}
                  placeholder="REF-XXXX-XXXXXXXX"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  aria-label={t('admin.createInvite.referralPlaceholder', 'Scan QR or type referral code')}
                  className="w-full rounded-xl px-3 py-2.5 pr-10 text-[13px] outline-none transition-colors"
                  style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.04em' }}
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
            disabled={!fullName || !namesOk || !email.trim() || !phone.trim() || loading || emailTaken}
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

          {/* The reason, verbatim from the provider. "Couldn't send" is the
              same sentence whether the sending domain is unverified, the key is
              dead, or the member typed their address wrong — and only one of
              those is the admin's to fix. */}
          {!delivering && deliveryErrors.length > 0 && (
            <div className="rounded-xl px-3 py-2.5 text-[11px] leading-relaxed"
              style={{ background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)', color: 'var(--color-text-muted)' }}>
              {deliveryErrors.map((line) => (
                <p key={line} className="break-words">{line}</p>
              ))}
            </div>
          )}

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
