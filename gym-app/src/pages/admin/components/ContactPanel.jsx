import { useState, useEffect } from 'react';
import { MessageSquare, Mail, Phone, CheckCircle, Send, Gift, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase, authHeader } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import i18n from 'i18next';
import logger from '../../../lib/logger';
import { useToast } from '../../../contexts/ToastContext';
import { AdminModal, Avatar, SectionLabel, PhoneInput } from '../../../components/admin';
import { RiskBadge, ScoreBar } from '../../../components/admin/StatusBadge';
import { logAdminAction } from '../../../lib/adminAudit';
import { getEmailTemplates, getSmsTemplates } from '../../../lib/adminMessageTemplates';

export default function ContactPanel({
  member, gymId, adminId,
  isContacted, contactedAt,
  onMarkContacted, onUnmarkContacted,
  onClose,
  defaultChannel = null,
}) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [notifMsg, setNotifMsg] = useState('');
  const [notifSending, setNotifSending] = useState(false);
  const [notifSent, setNotifSent] = useState(false);
  const [email, setEmail] = useState(null);

  // Single source of truth for which inline channel is open. Mutually exclusive.
  // `defaultChannel` lets callers (e.g. the "Message" quick-action) open
  // directly to a specific channel without an extra click.
  const [activeChannel, setActiveChannel] = useState(defaultChannel); // 'message' | 'email' | 'sms' | null
  const openChannel = (ch) => setActiveChannel(prev => (prev === ch ? null : ch));
  const messageMode = activeChannel === 'message';
  const emailMode = activeChannel === 'email';
  const smsMode = activeChannel === 'sms';

  // SMS state
  const [smsBody, setSmsBody] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [smsUsage, setSmsUsage] = useState(null); // { used, limit }
  // Mutable recipient — defaults to the member's stored phone, but the
  // admin can override (parity with the email-override path).
  const [smsTo, setSmsTo] = useState('');

  // Email state (must be before useEffect that references setEmailTo)
  const [emailTo, setEmailTo] = useState(email || '');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [rewardType, setRewardType] = useState('none');

  // Pulled from `gym_rewards` so admins only see rewards this gym actually
  // offers (not a hardcoded global list). Each entry: { id, reward_type, label }
  // where label is locale-aware (name_es when app is in Spanish, name otherwise).
  const [gymRewards, setGymRewards] = useState([]);

  const memberPhone = member.phone_number || null;

  // Seed the SMS recipient from the member's stored phone whenever the
  // member changes. The admin can still edit it before sending.
  useEffect(() => {
    setSmsTo(memberPhone || '');
  }, [memberPhone]);

  useEffect(() => {
    supabase.rpc('admin_get_member_email', { p_member_id: member.id })
      .then(({ data }) => { if (data) { setEmail(data); setEmailTo(data); } });
  }, [member.id]);

  useEffect(() => {
    if (!gymId) return;
    const isSpanish = i18n.language?.startsWith('es');
    supabase
      .from('gym_rewards')
      .select('id, name, name_es, reward_type, emoji_icon, is_active')
      .eq('gym_id', gymId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (error) { logger.warn('ContactPanel: gym_rewards fetch failed', error); return; }
        const mapped = (data || []).map(r => ({
          id: r.id,
          reward_type: r.reward_type,
          label: (isSpanish && r.name_es) ? r.name_es : r.name,
          emoji: r.emoji_icon || '🎁',
        }));
        setGymRewards(mapped);
      });
  }, [gymId]);

  // Contact history (date · channel · what was sent) for this member, newest
  // first. Optimistically prepended on each successful send so the admin sees
  // exactly what they sent and when — and the member reads as contacted.
  const [history, setHistory] = useState([]);
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('admin_contact_log')
      .select('id, method, note, created_at')
      .eq('member_id', member.id)
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => { if (!cancelled && Array.isArray(data)) setHistory(data); });
    return () => { cancelled = true; };
  }, [member.id, gymId]);
  const recordLocal = (method, note) =>
    setHistory(prev => [{ id: `local-${Date.now()}`, method, note: note || null, created_at: new Date().toISOString() }, ...prev]);
  const methodLabel = (m) => ({
    message: t('admin.churn.contactMessage', 'Message'),
    sms: t('admin.churn.contactSms', 'SMS'),
    email: t('admin.churn.contactEmail', 'Email'),
    manual: t('admin.churn.contactManual', 'Marked contacted'),
  }[m] || m);

  const riskTier = member.churnScore >= 80 ? 'critical' : member.churnScore >= 55 ? 'high' : 'medium';

  const handleSendMessage = async () => {
    if (!notifMsg.trim()) return;
    setNotifSending(true);
    try {
      // Create or get DM conversation with member
      const { data: convoId, error: convoErr } = await supabase.rpc('get_or_create_conversation', { p_other_user: member.id });
      if (convoErr) throw convoErr;

      // Get encryption seed
      const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
      const seed = convo?.encryption_seed || convoId;

      // Encrypt and send as DM
      const encrypted = await encryptMessage(notifMsg.trim(), convoId, seed);
      await supabase.from('direct_messages').insert({
        conversation_id: convoId,
        sender_id: adminId,
        body: encrypted,
      });
      await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);

      // Also fire a push so the member's phone buzzes. AWAIT it and surface the
      // outcome — a silent miss (no device, push off, quiet hours, 20/hr rate
      // limit, auth) was being swallowed, so it looked like "push doesn't work".
      // Let supabase-js attach the auth header automatically (matches Messages.jsx).
      try {
        const { data: pushRes, error: pushErr } = await supabase.functions.invoke('send-push-user', {
          body: {
            profile_id: member.id,
            gym_id: gymId,
            title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }),
            body: notifMsg.trim().substring(0, 100),
            data: { type: 'direct_message', conversation_id: convoId },
          },
        });
        if (pushErr) {
          logger.warn('ContactPanel: push invoke failed:', pushErr);
          showToast(t('admin.churn.pushFailed', 'Message sent, but the push could not be delivered'), 'info');
        } else if (pushRes && (pushRes.sent ?? 0) === 0) {
          logger.warn('ContactPanel: push not delivered:', pushRes);
          showToast(t('admin.churn.pushNotDelivered', { reason: pushRes.suppressed || pushRes.message || 'no device', defaultValue: 'Message sent — push not delivered ({{reason}})' }), 'info');
        }
      } catch (err) {
        logger.warn('ContactPanel: push failed:', err);
      }

      logAdminAction('send_message', 'member', member.id);
      setNotifSent(true);
      onMarkContacted(member.id, 'message', notifMsg);
      recordLocal('message', notifMsg.trim());
      setTimeout(() => { setNotifSent(false); setActiveChannel(null); }, 1500);
      setNotifMsg('');
      showToast(t('admin.churn.messageSent', 'Message sent!'), 'success');
    } catch (err) {
      logger.error('ContactPanel: message failed:', err);
      showToast(t('admin.churn.messageFailed', 'Failed to send message'), 'error');
    } finally {
      setNotifSending(false);
    }
  };

  const isValidPhone = (p) => /^\+?[0-9\s().-]{7,20}$/.test(p);

  const handleSendSms = async () => {
    if (!smsBody.trim()) return;
    if (smsTo && !isValidPhone(smsTo.trim())) {
      showToast(t('admin.churn.invalidPhone', 'Please enter a valid phone number'), 'error');
      return;
    }
    setSmsSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');
      const smsPayload = { memberId: member.id, body: smsBody.trim(), source: 'manual' };
      // Only set overridePhone if the admin actually changed it (parity with email override).
      const norm = (s) => (s || '').replace(/[\s().-]/g, '');
      if (smsTo && norm(smsTo) !== norm(memberPhone)) {
        smsPayload.overridePhone = smsTo.trim();
      }
      const { data, error: fnError } = await supabase.functions.invoke('send-sms', {
        body: smsPayload,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (fnError) throw fnError;
      if (data?.error) {
        showToast(data.error, 'error');
        return;
      }
      logAdminAction('send_sms', 'member', member.id);
      setSmsSent(true);
      if (data?.usage) setSmsUsage(data.usage);
      showToast(t('admin.churn.smsSent', 'SMS sent!'), 'success');
      onMarkContacted(member.id, 'sms', smsBody.trim());
      recordLocal('sms', smsBody.trim());
      setTimeout(() => { setSmsSent(false); setActiveChannel(null); setSmsBody(''); }, 1500);
    } catch (err) {
      logger.error('ContactPanel: send SMS failed:', err);
      showToast(t('admin.churn.smsSendFailed', 'Failed to send SMS. Please try again.'), 'error');
    } finally {
      setSmsSending(false);
    }
  };

  const smsSegments = smsBody.length <= 160 ? 1 : 2;

  // "none" stays at the top; the rest come from this gym's gym_rewards
  // catalog so admins can only attach rewards their gym actually offers.
  const rewardOptions = [
    { value: 'none', label: t('admin.churn.noReward', 'No reward') },
    ...gymRewards.map(r => ({
      value: r.id, // pass the gym_rewards.id so the backend can look up the canonical record
      reward_type: r.reward_type,
      label: `${r.emoji} ${r.label}`,
    })),
  ];

  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSendEmail = async () => {
    if (!emailTo?.trim() || !isValidEmail(emailTo.trim())) {
      showToast(t('admin.churn.invalidEmail', 'Please enter a valid email address'), 'error');
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      showToast(t('admin.churn.emailFieldsRequired', 'Subject and body are required'), 'error');
      return;
    }
    setEmailSending(true);
    try {
      const reqBody = { memberId: member.id, subject: emailSubject.trim(), body: emailBody.trim(), lang: i18n.language?.startsWith('es') ? 'es' : 'en' };
      // Only flag as override when the admin actually changed the
      // recipient. Compare on trimmed lowercase so cosmetic-only
      // differences don't trigger the spoofing-protection branch
      // (which 400s without `emailOverrideAcknowledged: true` and
      // 403s without an ALLOWED_OVERRIDE_DOMAINS env allowlist).
      const norm = (s) => (s || '').trim().toLowerCase();
      if (emailTo && norm(emailTo) !== norm(email)) {
        reqBody.overrideEmail = emailTo.trim();
        reqBody.emailOverrideAcknowledged = true;
      }
      if (rewardType && rewardType !== 'none') {
        const selected = rewardOptions.find(o => o.value === rewardType);
        // Send the canonical gym_rewards row id + its reward_type bucket.
        // Backend will look up name/cost from the row, so the email shows
        // exactly what this gym configured.
        reqBody.rewardId = rewardType;
        reqBody.rewardType = selected?.reward_type || 'custom';
        reqBody.rewardLabel = selected?.label || rewardType;
      }
      const { data, error: fnError } = await supabase.functions.invoke('send-admin-email', { headers: await authHeader(), body: reqBody });
      // supabase.functions.invoke surfaces 4xx/5xx as `data` with the error
      // payload AND sets `error`. Inspect the data for the upstream detail.
      if (fnError || (data && data.error)) {
        const upstreamStatus = data?.upstreamStatus;
        const upstreamMessage = data?.upstreamMessage;
        const baseMsg = t('admin.churn.emailSendFailed', 'Failed to send email. Please try again.');
        const detail = upstreamMessage
          ? `${baseMsg} (${upstreamStatus || ''} ${upstreamMessage})`
          : (data?.error || fnError?.message || baseMsg);
        logger.error('ContactPanel: send email failed:', { fnError, data });
        showToast(detail, 'error');
        return;
      }
      logAdminAction('send_email', 'member', member.id);
      setEmailSent(true);
      showToast(t('admin.churn.emailSentSuccess', 'Email sent successfully'), 'success');
      onMarkContacted(member.id, 'email', `${emailSubject.trim()}\n---\n${emailBody.trim()}`);
      recordLocal('email', `${emailSubject.trim()}\n---\n${emailBody.trim()}`);
      setTimeout(() => { setEmailSent(false); setActiveChannel(null); setEmailSubject(''); setEmailBody(''); setRewardType('none'); }, 1500);
    } catch (err) {
      logger.error('ContactPanel: send email failed:', err);
      showToast(t('admin.churn.emailSendFailed', 'Failed to send email. Please try again.'), 'error');
    } finally {
      setEmailSending(false);
    }
  };

  // "Contacted" = explicit prop OR any logged contact (incl. one just sent).
  const effectiveContacted = isContacted || history.length > 0;
  const effectiveContactedAt = contactedAt || history[0]?.created_at || null;
  const contactedLabel = effectiveContactedAt
    ? t('admin.churn.contactedOn', { date: new Date(effectiveContactedAt).toLocaleDateString(i18n.language?.startsWith('es') ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' }), defaultValue: 'Contacted {{date}}' })
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.churn.contactMember', 'Contact Member')} titleIcon={Phone} subtitle={member.full_name} size="sm">
      <div className="space-y-5">
        {/* Member header */}
        <div className="flex items-center gap-3">
          <Avatar name={member.full_name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-[14px] font-bold text-[var(--color-admin-text)] truncate">{member.full_name}</p>
              {typeof member.churnScore === 'number' && <RiskBadge tier={riskTier} />}
            </div>
            {/* Churn header only applies to members. For staff (e.g. trainers, no churn
                score) show the handle instead, so the panel doubles as a generic contact tool. */}
            {typeof member.churnScore === 'number'
              ? <ScoreBar score={member.churnScore} />
              : (member.username ? <p className="text-[12px] truncate" style={{ color: 'var(--color-admin-text-muted)' }}>@{member.username}</p> : null)}
          </div>
        </div>

        {/* Contact methods */}
        <div>
          <SectionLabel className="mb-2.5">{t('admin.churn.contactMethods', 'Contact Methods')}</SectionLabel>
          <div className="grid grid-cols-3 gap-2.5">
            {/* In-App Message (also pushes to app) */}
            <button onClick={() => openChannel('message')}
              className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[var(--color-bg-subtle)] border rounded-xl transition-all group ${messageMode ? 'border-[#D4AF37]/40 bg-[#D4AF37]/5' : 'border-[var(--color-admin-border)] hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/5'}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center group-hover:bg-[#D4AF37]/20 transition-colors">
                <MessageSquare size={18} className="text-[#D4AF37]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[var(--color-admin-text)]">{t('admin.churn.contactMessage', 'Message')}</p>
                <p className="text-[10px] text-[var(--color-admin-text-muted)] truncate">{t('admin.churn.contactInAppPush', 'In-app + push')}</p>
              </div>
            </button>

            {/* Email */}
            <button onClick={() => openChannel('email')} disabled={!email}
              className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[var(--color-bg-subtle)] border rounded-xl transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[var(--color-admin-border)] disabled:hover:bg-[var(--color-bg-subtle)] ${emailMode ? 'border-[#60A5FA]/40 bg-[#60A5FA]/5' : 'border-[var(--color-admin-border)] hover:border-[#60A5FA]/30 hover:bg-[#60A5FA]/5'}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#60A5FA]/10 flex items-center justify-center group-hover:bg-[#60A5FA]/20 transition-colors">
                <Mail size={18} className="text-[#60A5FA]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[var(--color-admin-text)]">{t('admin.churn.contactEmail', 'Email')}</p>
                <p className="text-[10px] text-[var(--color-admin-text-muted)] truncate">{email || t('admin.churn.notOnFile', 'Not on file')}</p>
              </div>
            </button>

            {/* SMS — always enabled; admin can type any number if none on file */}
            <button onClick={() => openChannel('sms')}
              className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[var(--color-bg-subtle)] border rounded-xl transition-all group ${smsMode ? 'border-[#F59E0B]/40 bg-[#F59E0B]/5' : 'border-[var(--color-admin-border)] hover:border-[#F59E0B]/30 hover:bg-[#F59E0B]/5'}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#F59E0B]/10 flex items-center justify-center group-hover:bg-[#F59E0B]/20 transition-colors">
                <Smartphone size={18} className="text-[#F59E0B]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[var(--color-admin-text)]">{t('admin.churn.contactSms', 'SMS')}</p>
                <p className="text-[10px] text-[var(--color-admin-text-muted)] truncate">{memberPhone || t('admin.churn.noPhone', 'No phone')}</p>
              </div>
            </button>

          </div>
        </div>

        {/* Email compose */}
        {emailMode && email && (
          <div>
            <SectionLabel icon={Mail} className="mb-2">{t('admin.churn.composeEmail', 'Send Email')}</SectionLabel>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] text-[var(--color-admin-text-muted)] flex-shrink-0">{t('admin.churn.sendingTo', 'To:')}</span>
              <input
                type="email"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                aria-label={t('admin.churn.emailTo', 'Email recipient')}
                className={`flex-1 bg-[var(--color-bg-subtle)] border rounded-lg px-2 py-1 text-[12px] text-[var(--color-admin-text)] outline-none transition-colors ${emailTo && !isValidEmail(emailTo) ? 'border-[#EF4444]/50 focus:border-[#EF4444]/70' : 'border-[var(--color-admin-border)] focus:border-[#60A5FA]/40'}`}
              />
              {emailTo && !isValidEmail(emailTo) && (
                <span className="text-[10px] text-[#EF4444] flex-shrink-0">{t('admin.churn.invalidEmail', 'Invalid email')}</span>
              )}
            </div>

            {/* Quick template suggestions */}
            {!emailSubject && !emailBody && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider mb-1.5">{t('admin.churn.quickTemplates', 'Quick templates')}</p>
                <div className="flex flex-col gap-1.5">
                  {getEmailTemplates(t, member.full_name.split(' ')[0]).map((tpl) => (
                    <button key={tpl.key} onClick={() => { setEmailSubject(tpl.subject); setEmailBody(tpl.body); }}
                      className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-lg text-left hover:border-[#60A5FA]/30 hover:bg-[#60A5FA]/5 transition-all">
                      <Mail size={12} className="text-[#60A5FA] flex-shrink-0" />
                      <span className="text-[12px] font-medium text-[var(--color-admin-text)]">{tpl.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <input
                type="text"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                placeholder={t('admin.churn.emailSubjectPlaceholder', 'Subject...')}
                aria-label={t('admin.churn.emailSubject', 'Email subject')}
                className="w-full bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder-[#4B5563] outline-none focus:border-[#60A5FA]/40 transition-colors"
              />
              <textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                rows={5}
                placeholder={t('admin.churn.emailBodyPlaceholder', { name: member.full_name.split(' ')[0], defaultValue: `Hi ${member.full_name.split(' ')[0]}, we noticed you haven't visited in a while...` })}
                className="w-full bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder-[#4B5563] outline-none focus:border-[#60A5FA]/40 transition-colors resize-none"
              />
              {/* Reward selector */}
              <div className="flex items-center gap-2 px-1">
                <Gift size={14} className="text-[#D4AF37] flex-shrink-0" />
                <span className="text-[11px] font-semibold text-[var(--color-admin-text-sub)] flex-shrink-0">{t('admin.churn.attachReward', 'Attach Reward')}</span>
                <select
                  value={rewardType}
                  onChange={e => setRewardType(e.target.value)}
                  className="flex-1 bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-admin-text)] outline-none focus:border-[#D4AF37]/40 transition-colors appearance-none cursor-pointer"
                >
                  {rewardOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={handleSendEmail} disabled={emailSending || !emailSubject.trim() || !emailBody.trim() || emailSent}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
                  style={{ background: emailSent ? 'var(--color-success-soft)' : 'var(--color-info-soft)', color: emailSent ? 'var(--color-success)' : 'var(--color-info)', border: `1px solid ${emailSent ? 'var(--color-success-soft)' : 'var(--color-info-soft)'}` }}>
                  {emailSent ? <><CheckCircle size={14} /> {t('admin.churn.emailSent', 'Sent!')}</> : emailSending ? '...' : <><Send size={14} /> {t('admin.churn.sendEmail', 'Send Email')}</>}
                </button>
                <button onClick={() => { setActiveChannel(null); setEmailSubject(''); setEmailBody(''); setRewardType('none'); }}
                  className="px-3 py-2.5 rounded-xl text-[12px] font-medium text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] transition-colors">
                  {t('common:cancel', 'Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SMS compose */}
        {smsMode && (
          <div>
            <SectionLabel icon={Smartphone} className="mb-2">{t('admin.churn.composeSms', 'Send SMS')}</SectionLabel>
            <div className="mb-2.5">
              <span className="text-[10px] block mb-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.churn.sendingTo', 'To:')}</span>
              {/* Dial code (+1) stays fixed aside; admin just types area code + number. */}
              <PhoneInput
                value={smsTo}
                onChange={setSmsTo}
                placeholder="787 555 1234"
                ariaLabel={t('admin.churn.smsTo', 'SMS recipient')}
              />
              {smsTo && !isValidPhone(smsTo) && (
                <span className="text-[10px] mt-1 block" style={{ color: 'var(--color-danger)' }}>{t('admin.churn.invalidPhone', 'Invalid')}</span>
              )}
            </div>

            {/* Quick SMS templates */}
            {!smsBody && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-[var(--color-admin-text-faint)] uppercase tracking-wider mb-1.5">{t('admin.churn.quickTemplates', 'Quick templates')}</p>
                <div className="flex flex-col gap-1.5">
                  {getSmsTemplates(t, member.full_name.split(' ')[0]).map((tpl) => (
                    <button key={tpl.key} onClick={() => setSmsBody(tpl.body)}
                      className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-lg text-left hover:border-[#F59E0B]/30 hover:bg-[#F59E0B]/5 transition-all">
                      <Smartphone size={12} className="text-[#F59E0B] flex-shrink-0" />
                      <span className="text-[12px] font-medium text-[var(--color-admin-text)]">{tpl.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="relative">
                <textarea
                  value={smsBody}
                  onChange={e => { if (e.target.value.length <= 320) setSmsBody(e.target.value); }}
                  rows={3}
                  placeholder={t('admin.churn.smsBodyPlaceholder', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we miss you at the gym...` })}
                  className="w-full bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder-[#4B5563] outline-none focus:border-[#F59E0B]/40 transition-colors resize-none"
                />
                <div className="flex items-center justify-between mt-1 px-1">
                  <span className={`text-[10px] ${smsBody.length > 160 ? 'text-[#F59E0B]' : 'text-[var(--color-admin-text-faint)]'}`}>
                    {smsSegments === 1
                      ? t('admin.churn.smsOneSegment', '1 segment')
                      : t('admin.churn.smsTwoSegments', '2 segments')}
                  </span>
                  <span className={`text-[10px] ${smsBody.length > 300 ? 'text-[#EF4444]' : 'text-[var(--color-admin-text-faint)]'}`}>
                    {smsBody.length}/320
                  </span>
                </div>
              </div>

              {smsUsage && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-[var(--color-admin-text-muted)]">
                    {t('admin.churn.smsUsage', { used: smsUsage.used, limit: smsUsage.limit, defaultValue: '{{used}}/{{limit}} SMS this month' })}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button onClick={handleSendSms} disabled={smsSending || !smsBody.trim() || smsSent}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
                  style={{ background: smsSent ? 'var(--color-success-soft)' : 'var(--color-warning-soft)', color: smsSent ? 'var(--color-success)' : 'var(--color-warning)', border: `1px solid ${smsSent ? 'var(--color-success-soft)' : 'var(--color-warning-soft)'}` }}>
                  {smsSent ? <><CheckCircle size={14} /> {t('admin.churn.smsSent', 'Sent!')}</> : smsSending ? '...' : <><Send size={14} /> {t('admin.churn.sendSms', 'Send SMS')}</>}
                </button>
                <button onClick={() => { setActiveChannel(null); setSmsBody(''); }}
                  className="px-3 py-2.5 rounded-xl text-[12px] font-medium text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] transition-colors">
                  {t('common:cancel', 'Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Contacted status toggle */}
        <div className="flex items-center justify-between gap-3 p-3 bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-xl overflow-hidden">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-[var(--color-admin-text)] truncate">
              {effectiveContacted ? t('admin.churn.markedContacted', 'Marked as Contacted') : t('admin.churn.notYetContacted', 'Not yet contacted')}
            </p>
            {contactedLabel && (
              <p className="text-[10px] text-[var(--color-admin-text-muted)] mt-0.5">{contactedLabel}</p>
            )}
          </div>
          <button
            onClick={() => {
              if (effectiveContacted) { onUnmarkContacted(member.id); setHistory([]); }
              else { onMarkContacted(member.id, 'manual'); recordLocal('manual', null); }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors flex-shrink-0 whitespace-nowrap ${
              effectiveContacted
                ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20 hover:bg-[#EF4444]/10 hover:text-[#EF4444] hover:border-[#EF4444]/20'
                : 'bg-[var(--color-bg-subtle)] text-[var(--color-admin-text-sub)] border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)]'
            }`}>
            {effectiveContacted ? (
              <>
                <CheckCircle size={12} />
                <span>{t('admin.churn.contacted', 'Contacted')}</span>
              </>
            ) : (
              <>
                <Phone size={12} /> {t('admin.churn.markContacted', 'Mark Contacted')}
              </>
            )}
          </button>
        </div>

        {/* Contact history — what was sent, when, and via which channel */}
        {history.length > 0 && (
          <div>
            <SectionLabel className="mb-2">{t('admin.churn.contactHistory', 'Contact history')}</SectionLabel>
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {history.map((h) => (
                <div key={h.id} className="px-3 py-2 bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-lg">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--color-admin-text)]">{methodLabel(h.method)}</span>
                    <span className="text-[10px] text-[var(--color-admin-text-muted)] flex-shrink-0">
                      {new Date(h.created_at).toLocaleString(i18n.language?.startsWith('es') ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  {h.note && <p className="text-[11px] text-[var(--color-admin-text-sub)] mt-1 whitespace-pre-wrap line-clamp-3">{h.note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick message compose (in-app + push) */}
        {messageMode && (
          <div>
            <SectionLabel icon={MessageSquare} className="mb-2">{t('admin.churn.quickMessage', 'Send Message')}</SectionLabel>
            <div className="flex gap-2">
              <input id="notif-input" type="text" value={notifMsg} onChange={e => setNotifMsg(e.target.value)}
                placeholder={t('admin.churn.msgPlaceholder', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we miss you!` })}
                aria-label={t('admin.churn.quickMessage', 'Send Message')}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] rounded-xl px-3 py-2.5 text-[13px] text-[var(--color-admin-text)] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
              <button onClick={handleSendMessage} disabled={notifSending || !notifMsg.trim() || notifSent}
                className="px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-40"
                style={{
                  background: notifSent ? 'var(--color-success-soft)' : 'color-mix(in srgb, var(--color-accent) 20%, transparent)',
                  color: notifSent ? 'var(--color-success)' : 'var(--color-accent)',
                  border: `1px solid ${notifSent ? 'var(--color-success-soft)' : 'color-mix(in srgb, var(--color-accent) 20%, transparent)'}`,
                }}>
                {notifSent ? <CheckCircle size={14} /> : notifSending ? '...' : <Send size={14} />}
              </button>
              <button onClick={() => { setActiveChannel(null); setNotifMsg(''); }}
                className="px-3 py-2.5 rounded-xl text-[12px] font-medium text-[var(--color-admin-text-muted)] hover:text-[var(--color-admin-text)] bg-[var(--color-bg-subtle)] border border-[var(--color-admin-border)] transition-colors">
                {t('common:cancel', 'Cancel')}
              </button>
            </div>
            <p className="text-[10px] text-[var(--color-admin-text-faint)] mt-1.5 px-1">{t('admin.churn.msgNote', "Shows in member's Messages page + sends push notification")}</p>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
