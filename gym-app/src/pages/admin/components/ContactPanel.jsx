import { useState, useEffect } from 'react';
import { MessageSquare, Mail, Bell, Phone, CheckCircle, X, Send, Gift, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import i18n from 'i18next';
import logger from '../../../lib/logger';
import { useToast } from '../../../contexts/ToastContext';
import { AdminModal, Avatar, SectionLabel } from '../../../components/admin';
import { RiskBadge, ScoreBar } from '../../../components/admin/StatusBadge';
import { logAdminAction } from '../../../lib/adminAudit';

export default function ContactPanel({
  member, gymId, adminId,
  isContacted, contactedAt,
  onMarkContacted, onUnmarkContacted,
  onOpenMessage, onClose,
}) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const [notifMsg, setNotifMsg] = useState('');
  const [notifSending, setNotifSending] = useState(false);
  const [notifSent, setNotifSent] = useState(false);
  const [email, setEmail] = useState(null);

  // SMS state
  const [smsMode, setSmsMode] = useState(false);
  const [smsBody, setSmsBody] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [smsUsage, setSmsUsage] = useState(null); // { used, limit }

  // Email state (must be before useEffect that references setEmailTo)
  const [emailMode, setEmailMode] = useState(false);
  const [emailTo, setEmailTo] = useState(email || '');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [rewardType, setRewardType] = useState('none');

  const memberPhone = member.phone_number || null;

  useEffect(() => {
    supabase.rpc('admin_get_member_email', { p_member_id: member.id })
      .then(({ data }) => { if (data) { setEmail(data); setEmailTo(data); } });
  }, [member.id]);

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

      // Also send push notification so phone buzzes
      const { data: { session } } = await supabase.auth.getSession();
      supabase.functions.invoke('send-push-user', {
        body: {
          profile_id: member.id,
          gym_id: gymId,
          title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }),
          body: notifMsg.trim().substring(0, 100),
          data: { type: 'direct_message', conversation_id: convoId },
        },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      }).catch(err => logger.warn('ContactPanel: push failed:', err));

      logAdminAction('send_message', 'member', member.id);
      setNotifSent(true);
      onMarkContacted(member.id, 'message', notifMsg);
      setTimeout(() => setNotifSent(false), 2000);
      setNotifMsg('');
      showToast(t('admin.churn.messageSent', 'Message sent!'), 'success');
    } catch (err) {
      logger.error('ContactPanel: message failed:', err);
      showToast(t('admin.churn.messageFailed', 'Failed to send message'), 'error');
    } finally {
      setNotifSending(false);
    }
  };

  const handleSendSms = async () => {
    if (!smsBody.trim()) return;
    setSmsSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('No active session');
      const { data, error: fnError } = await supabase.functions.invoke('send-sms', {
        body: { memberId: member.id, body: smsBody.trim(), source: 'manual' },
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
      setTimeout(() => { setSmsSent(false); setSmsMode(false); setSmsBody(''); }, 1500);
    } catch (err) {
      logger.error('ContactPanel: send SMS failed:', err);
      showToast(t('admin.churn.smsSendFailed', 'Failed to send SMS. Please try again.'), 'error');
    } finally {
      setSmsSending(false);
    }
  };

  const smsSegments = smsBody.length <= 160 ? 1 : 2;

  const rewardOptions = [
    { value: 'none', label: t('admin.churn.noReward', 'No reward') },
    { value: 'pt_session', label: t('admin.churn.winBackOffers.pt_session', 'Free PT session') },
    { value: 'discount', label: t('admin.churn.winBackOffers.discount', '1 month discount') },
    { value: 'class_pass', label: t('admin.churn.winBackOffers.class_pass', 'Free class pass') },
    { value: 'bring_partner', label: t('admin.churn.winBackOffers.bring_partner', 'Bring a partner') },
    { value: 'custom', label: t('admin.churn.winBackOffers.custom', 'Custom\u2026') },
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
      if (emailTo && emailTo !== email) reqBody.overrideEmail = emailTo.trim();
      if (rewardType && rewardType !== 'none') {
        const selected = rewardOptions.find(o => o.value === rewardType);
        reqBody.rewardType = rewardType;
        reqBody.rewardLabel = selected?.label || rewardType;
      }
      const { data, error: fnError } = await supabase.functions.invoke('send-admin-email', { body: reqBody });
      if (fnError) throw fnError;
      logAdminAction('send_email', 'member', member.id);
      setEmailSent(true);
      showToast(t('admin.churn.emailSentSuccess', 'Email sent successfully'), 'success');
      onMarkContacted(member.id, 'email', `${emailSubject.trim()}\n---\n${emailBody.trim()}`);
      setTimeout(() => { setEmailSent(false); setEmailMode(false); setEmailSubject(''); setEmailBody(''); setRewardType('none'); }, 1500);
    } catch (err) {
      logger.error('ContactPanel: send email failed:', err);
      showToast(t('admin.churn.emailSendFailed', 'Failed to send email. Please try again.'), 'error');
    } finally {
      setEmailSending(false);
    }
  };

  const handleMessageClick = () => {
    onMarkContacted(member.id, 'in_app_message');
    onOpenMessage();
  };

  const contactedLabel = contactedAt
    ? t('admin.churn.contactedOn', { date: new Date(contactedAt).toLocaleDateString(i18n.language?.startsWith('es') ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' }), defaultValue: 'Contacted {{date}}' })
    : null;

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.churn.contactMember', 'Contact Member')} titleIcon={Phone} subtitle={member.full_name} size="sm">
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
          <SectionLabel className="mb-2.5">{t('admin.churn.contactMethods', 'Contact Methods')}</SectionLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* In-App Message */}
            <button onClick={handleMessageClick}
              className="flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/5 transition-all group">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center group-hover:bg-[#D4AF37]/20 transition-colors">
                <MessageSquare size={18} className="text-[#D4AF37]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactMessage', 'Message')}</p>
                <p className="text-[10px] text-[#6B7280] truncate">{t('admin.churn.contactInApp', 'In-app message')}</p>
              </div>
            </button>

            {/* Email */}
            <button onClick={() => setEmailMode(true)} disabled={!email}
              className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[#111827] border rounded-xl transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/6 disabled:hover:bg-[#111827] ${emailMode ? 'border-[#60A5FA]/40 bg-[#60A5FA]/5' : 'border-white/6 hover:border-[#60A5FA]/30 hover:bg-[#60A5FA]/5'}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#60A5FA]/10 flex items-center justify-center group-hover:bg-[#60A5FA]/20 transition-colors">
                <Mail size={18} className="text-[#60A5FA]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactEmail', 'Email')}</p>
                <p className="text-[10px] text-[#6B7280] truncate">{email || t('admin.churn.notOnFile', 'Not on file')}</p>
              </div>
            </button>

            {/* Push Notification */}
            <button onClick={() => document.getElementById('notif-input')?.focus()}
              className="flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#10B981]/30 hover:bg-[#10B981]/5 transition-all group">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center group-hover:bg-[#10B981]/20 transition-colors">
                <Bell size={18} className="text-[#10B981]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactNotification', 'Notification')}</p>
                <p className="text-[10px] text-[#6B7280] truncate">{t('admin.churn.contactPushToApp', 'Push to app')}</p>
              </div>
            </button>

            {/* SMS */}
            <button onClick={() => setSmsMode(true)} disabled={!memberPhone}
              className={`flex flex-col items-center gap-1.5 p-3 sm:p-4 bg-[#111827] border rounded-xl transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/6 disabled:hover:bg-[#111827] ${smsMode ? 'border-[#F59E0B]/40 bg-[#F59E0B]/5' : 'border-white/6 hover:border-[#F59E0B]/30 hover:bg-[#F59E0B]/5'}`}>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#F59E0B]/10 flex items-center justify-center group-hover:bg-[#F59E0B]/20 transition-colors">
                <Smartphone size={18} className="text-[#F59E0B]" />
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="text-[11px] sm:text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactSms', 'SMS')}</p>
                <p className="text-[10px] text-[#6B7280] truncate">{memberPhone || t('admin.churn.noPhone', 'No phone')}</p>
              </div>
            </button>

          </div>
        </div>

        {/* Email compose */}
        {emailMode && email && (
          <div>
            <SectionLabel icon={Mail} className="mb-2">{t('admin.churn.composeEmail', 'Send Email')}</SectionLabel>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] text-[#6B7280] flex-shrink-0">{t('admin.churn.sendingTo', 'To:')}</span>
              <input
                type="email"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                aria-label={t('admin.churn.emailTo', 'Email recipient')}
                className={`flex-1 bg-[#111827] border rounded-lg px-2 py-1 text-[12px] text-[#E5E7EB] outline-none transition-colors ${emailTo && !isValidEmail(emailTo) ? 'border-[#EF4444]/50 focus:border-[#EF4444]/70' : 'border-white/6 focus:border-[#60A5FA]/40'}`}
              />
              {emailTo && !isValidEmail(emailTo) && (
                <span className="text-[10px] text-[#EF4444] flex-shrink-0">{t('admin.churn.invalidEmail', 'Invalid email')}</span>
              )}
            </div>

            {/* Quick template suggestions */}
            {!emailSubject && !emailBody && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1.5">{t('admin.churn.quickTemplates', 'Quick templates')}</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    {
                      label: t('admin.churn.tplMissYou', 'We miss you'),
                      subject: t('admin.churn.tplMissYouSubject', { name: member.full_name.split(' ')[0], defaultValue: `${member.full_name.split(' ')[0]}, we miss you!` }),
                      body: t('admin.churn.tplMissYouBody', { name: member.full_name.split(' ')[0], defaultValue: `We noticed you haven't been in for a while and we genuinely miss seeing you.\n\nWhatever got in the way — busy schedule, motivation dip, or just life — we get it. But your progress matters, and we'd love to help you pick up where you left off.\n\nCome back anytime, we're here for you.` }),
                    },
                    {
                      label: t('admin.churn.tplCheckIn', 'Quick check-in'),
                      subject: t('admin.churn.tplCheckInSubject', { defaultValue: 'How are you doing?' }),
                      body: t('admin.churn.tplCheckInBody', { name: member.full_name.split(' ')[0], defaultValue: `Just wanted to check in and see how things are going.\n\nIf anything is keeping you away — schedule issues, needing a new program, questions about your goals — let us know. We're happy to adjust things to make it work for you.\n\nHope to see you soon!` }),
                    },
                    {
                      label: t('admin.churn.tplNewClasses', 'New classes/programs'),
                      subject: t('admin.churn.tplNewClassesSubject', { defaultValue: 'New things happening at the gym' }),
                      body: t('admin.churn.tplNewClassesBody', { name: member.full_name.split(' ')[0], defaultValue: `We've been adding some exciting new classes and programs that we think you'd enjoy.\n\nWhether you're looking to try something different or get back into a routine, there's something here for you.\n\nCome check it out — your first class back is on us!` }),
                    },
                  ].map((tpl, i) => (
                    <button key={i} onClick={() => { setEmailSubject(tpl.subject); setEmailBody(tpl.body); }}
                      className="flex items-center gap-2 px-3 py-2 bg-[#111827] border border-white/6 rounded-lg text-left hover:border-[#60A5FA]/30 hover:bg-[#60A5FA]/5 transition-all">
                      <Mail size={12} className="text-[#60A5FA] flex-shrink-0" />
                      <span className="text-[12px] font-medium text-[#E5E7EB]">{tpl.label}</span>
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
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#60A5FA]/40 transition-colors"
              />
              <textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                rows={5}
                placeholder={t('admin.churn.emailBodyPlaceholder', { name: member.full_name.split(' ')[0], defaultValue: `Hi ${member.full_name.split(' ')[0]}, we noticed you haven't visited in a while...` })}
                className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#60A5FA]/40 transition-colors resize-none"
              />
              {/* Reward selector */}
              <div className="flex items-center gap-2 px-1">
                <Gift size={14} className="text-[#D4AF37] flex-shrink-0" />
                <span className="text-[11px] font-semibold text-[#9CA3AF] flex-shrink-0">{t('admin.churn.attachReward', 'Attach Reward')}</span>
                <select
                  value={rewardType}
                  onChange={e => setRewardType(e.target.value)}
                  className="flex-1 bg-[#111827] border border-white/6 rounded-lg px-2 py-1.5 text-[12px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 transition-colors appearance-none cursor-pointer"
                >
                  {rewardOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={handleSendEmail} disabled={emailSending || !emailSubject.trim() || !emailBody.trim() || emailSent}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
                  style={{ background: emailSent ? 'rgba(16,185,129,0.12)' : 'rgba(96,165,250,0.12)', color: emailSent ? '#10B981' : '#60A5FA', border: `1px solid ${emailSent ? 'rgba(16,185,129,0.25)' : 'rgba(96,165,250,0.25)'}` }}>
                  {emailSent ? <><CheckCircle size={14} /> {t('admin.churn.emailSent', 'Sent!')}</> : emailSending ? '...' : <><Send size={14} /> {t('admin.churn.sendEmail', 'Send Email')}</>}
                </button>
                <button onClick={() => { setEmailMode(false); setEmailSubject(''); setEmailBody(''); setRewardType('none'); }}
                  className="px-3 py-2.5 rounded-xl text-[12px] font-medium text-[#6B7280] hover:text-[#E5E7EB] bg-white/4 border border-white/6 transition-colors">
                  {t('common:cancel', 'Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SMS compose */}
        {smsMode && memberPhone && (
          <div>
            <SectionLabel icon={Smartphone} className="mb-2">{t('admin.churn.composeSms', 'Send SMS')}</SectionLabel>
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] text-[#6B7280] flex-shrink-0">{t('admin.churn.sendingTo', 'To:')}</span>
              <span className="text-[12px] text-[#E5E7EB] font-mono">{memberPhone}</span>
            </div>

            {/* Quick SMS templates */}
            {!smsBody && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-[#4B5563] uppercase tracking-wider mb-1.5">{t('admin.churn.quickTemplates', 'Quick templates')}</p>
                <div className="flex flex-col gap-1.5">
                  {[
                    {
                      label: t('admin.churn.tplMissYou', 'We miss you'),
                      body: t('admin.churn.smsTplMissYou', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we miss you at the gym! Come in this week, your spot is waiting.` }),
                    },
                    {
                      label: t('admin.churn.tplCheckIn', 'Quick check-in'),
                      body: t('admin.churn.smsTplCheckIn', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, just checking in. Need a new routine or schedule change? Let us know!` }),
                    },
                    {
                      label: t('admin.churn.tplNewClasses', 'New classes/programs'),
                      body: t('admin.churn.smsTplNewClasses', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we've added new classes you'd love. Come check them out!` }),
                    },
                  ].map((tpl, i) => (
                    <button key={i} onClick={() => setSmsBody(tpl.body)}
                      className="flex items-center gap-2 px-3 py-2 bg-[#111827] border border-white/6 rounded-lg text-left hover:border-[#F59E0B]/30 hover:bg-[#F59E0B]/5 transition-all">
                      <Smartphone size={12} className="text-[#F59E0B] flex-shrink-0" />
                      <span className="text-[12px] font-medium text-[#E5E7EB]">{tpl.label}</span>
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
                  className="w-full bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#F59E0B]/40 transition-colors resize-none"
                />
                <div className="flex items-center justify-between mt-1 px-1">
                  <span className={`text-[10px] ${smsBody.length > 160 ? 'text-[#F59E0B]' : 'text-[#4B5563]'}`}>
                    {smsSegments === 1
                      ? t('admin.churn.smsOneSegment', '1 segment')
                      : t('admin.churn.smsTwoSegments', '2 segments')}
                  </span>
                  <span className={`text-[10px] ${smsBody.length > 300 ? 'text-[#EF4444]' : 'text-[#4B5563]'}`}>
                    {smsBody.length}/320
                  </span>
                </div>
              </div>

              {smsUsage && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[10px] text-[#6B7280]">
                    {t('admin.churn.smsUsage', { used: smsUsage.used, limit: smsUsage.limit, defaultValue: '{{used}}/{{limit}} SMS this month' })}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button onClick={handleSendSms} disabled={smsSending || !smsBody.trim() || smsSent}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
                  style={{ background: smsSent ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)', color: smsSent ? '#10B981' : '#F59E0B', border: `1px solid ${smsSent ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
                  {smsSent ? <><CheckCircle size={14} /> {t('admin.churn.smsSent', 'Sent!')}</> : smsSending ? '...' : <><Send size={14} /> {t('admin.churn.sendSms', 'Send SMS')}</>}
                </button>
                <button onClick={() => { setSmsMode(false); setSmsBody(''); }}
                  className="px-3 py-2.5 rounded-xl text-[12px] font-medium text-[#6B7280] hover:text-[#E5E7EB] bg-white/4 border border-white/6 transition-colors">
                  {t('common:cancel', 'Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Contacted status toggle */}
        <div className="flex items-center justify-between gap-3 p-3 bg-[#111827] border border-white/6 rounded-xl overflow-hidden">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-[#E5E7EB] truncate">
              {isContacted ? t('admin.churn.markedContacted', 'Marked as Contacted') : t('admin.churn.notYetContacted', 'Not yet contacted')}
            </p>
            {contactedLabel && (
              <p className="text-[10px] text-[#6B7280] mt-0.5">{contactedLabel}</p>
            )}
          </div>
          <button
            onClick={() => isContacted ? onUnmarkContacted(member.id) : onMarkContacted(member.id, 'manual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors flex-shrink-0 whitespace-nowrap ${
              isContacted
                ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20 hover:bg-[#EF4444]/10 hover:text-[#EF4444] hover:border-[#EF4444]/20'
                : 'bg-white/4 text-[#9CA3AF] border-white/8 hover:text-[#E5E7EB]'
            }`}>
            {isContacted ? (
              <>
                <CheckCircle size={12} />
                <span className="group-hover:hidden">{t('admin.churn.contacted', 'Contacted')}</span>
              </>
            ) : (
              <>
                <Phone size={12} /> {t('admin.churn.markContacted', 'Mark Contacted')}
              </>
            )}
          </button>
        </div>

        {/* Quick message compose */}
        <div>
          <SectionLabel icon={MessageSquare} className="mb-2">{t('admin.churn.quickMessage', 'Send Message')}</SectionLabel>
          <div className="flex gap-2">
            <input id="notif-input" type="text" value={notifMsg} onChange={e => setNotifMsg(e.target.value)}
              placeholder={t('admin.churn.msgPlaceholder', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we miss you!` })}
              aria-label={t('admin.churn.quickMessage', 'Send Message')}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
            <button onClick={handleSendMessage} disabled={notifSending || !notifMsg.trim() || notifSent}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-40"
              style={{
                background: notifSent ? 'rgba(16,185,129,0.12)' : 'rgba(212,175,55,0.10)',
                color: notifSent ? 'var(--color-success)' : '#D4AF37',
                border: `1px solid ${notifSent ? 'rgba(16,185,129,0.3)' : 'rgba(212,175,55,0.2)'}`,
              }}>
              {notifSent ? <CheckCircle size={14} /> : notifSending ? '...' : <Send size={14} />}
            </button>
          </div>
          <p className="text-[10px] text-[#4B5563] mt-1.5 px-1">{t('admin.churn.msgNote', 'Shows in member\'s Messages page + sends push notification')}</p>
        </div>
      </div>
    </AdminModal>
  );
}
