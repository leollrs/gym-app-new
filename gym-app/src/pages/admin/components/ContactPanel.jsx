import { useState, useEffect } from 'react';
import { MessageSquare, Mail, Bell, Phone, CheckCircle, X, Send, Gift } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { createNotification } from '../../../lib/notifications';
import i18n from 'i18next';
import logger from '../../../lib/logger';
import { useToast } from '../../../contexts/ToastContext';
import { AdminModal, Avatar, SectionLabel } from '../../../components/admin';
import { RiskBadge, ScoreBar } from '../../../components/admin/StatusBadge';

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

  useEffect(() => {
    supabase.rpc('admin_get_member_email', { p_member_id: member.id })
      .then(({ data }) => { if (data) { setEmail(data); setEmailTo(data); } });
  }, [member.id]);

  const riskTier = member.churnScore >= 80 ? 'critical' : member.churnScore >= 55 ? 'high' : 'medium';

  const handleSendNotification = async () => {
    if (!notifMsg.trim()) return;
    setNotifSending(true);
    try {
      await createNotification({
        profileId: member.id, gymId, type: 'admin_message',
        title: i18n.t('notifications.messageFromGym', { ns: 'common', defaultValue: 'Message from your gym' }), body: notifMsg,
        data: { source: 'churn_contact_panel' },
      });
      setNotifSent(true);
      onMarkContacted(member.id, 'push', notifMsg);
      setTimeout(() => setNotifSent(false), 2000);
      setNotifMsg('');
    } catch (err) {
      logger.error('ContactPanel: notification failed:', err);
    } finally {
      setNotifSending(false);
    }
  };

  const [emailMode, setEmailMode] = useState(false);
  const [emailTo, setEmailTo] = useState(email || '');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [rewardType, setRewardType] = useState('none');

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
          <div className="grid grid-cols-3 gap-2.5">
            {/* In-App Message */}
            <button onClick={handleMessageClick}
              className="flex flex-col items-center gap-2 p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#D4AF37]/30 hover:bg-[#D4AF37]/5 transition-all group">
              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center group-hover:bg-[#D4AF37]/20 transition-colors">
                <MessageSquare size={18} className="text-[#D4AF37]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactMessage', 'Message')}</p>
                <p className="text-[10px] text-[#6B7280]">{t('admin.churn.contactInApp', 'In-app message')}</p>
              </div>
            </button>

            {/* Email */}
            <button onClick={() => setEmailMode(true)} disabled={!email}
              className={`flex flex-col items-center gap-2 p-4 bg-[#111827] border rounded-xl transition-all group disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-white/6 disabled:hover:bg-[#111827] ${emailMode ? 'border-[#60A5FA]/40 bg-[#60A5FA]/5' : 'border-white/6 hover:border-[#60A5FA]/30 hover:bg-[#60A5FA]/5'}`}>
              <div className="w-10 h-10 rounded-xl bg-[#60A5FA]/10 flex items-center justify-center group-hover:bg-[#60A5FA]/20 transition-colors">
                <Mail size={18} className="text-[#60A5FA]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactEmail', 'Email')}</p>
                <p className="text-[10px] text-[#6B7280] truncate max-w-[120px]">{email || t('admin.churn.notOnFile', 'Not on file')}</p>
              </div>
            </button>

            {/* Push Notification */}
            <button onClick={() => document.getElementById('notif-input')?.focus()}
              className="flex flex-col items-center gap-2 p-4 bg-[#111827] border border-white/6 rounded-xl hover:border-[#10B981]/30 hover:bg-[#10B981]/5 transition-all group">
              <div className="w-10 h-10 rounded-xl bg-[#10B981]/10 flex items-center justify-center group-hover:bg-[#10B981]/20 transition-colors">
                <Bell size={18} className="text-[#10B981]" />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-semibold text-[#E5E7EB]">{t('admin.churn.contactNotification', 'Notification')}</p>
                <p className="text-[10px] text-[#6B7280]">{t('admin.churn.contactPushToApp', 'Push to app')}</p>
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

        {/* Quick notification compose */}
        <div>
          <SectionLabel icon={Bell} className="mb-2">{t('admin.churn.quickNotification', 'Quick Notification')}</SectionLabel>
          <div className="flex gap-2">
            <input id="notif-input" type="text" value={notifMsg} onChange={e => setNotifMsg(e.target.value)}
              placeholder={t('admin.churn.notifPlaceholder', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}, we miss you!` })}
              onKeyDown={e => e.key === 'Enter' && handleSendNotification()}
              className="flex-1 bg-[#111827] border border-white/6 rounded-xl px-3 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
            <button onClick={handleSendNotification} disabled={notifSending || !notifMsg.trim() || notifSent}
              className="px-3 py-2.5 rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-40"
              style={{
                background: notifSent ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.10)',
                color: 'var(--color-success)',
                border: `1px solid ${notifSent ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)'}`,
              }}>
              {notifSent ? <CheckCircle size={14} /> : notifSending ? '...' : <Send size={14} />}
            </button>
          </div>
        </div>

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
      </div>
    </AdminModal>
  );
}
