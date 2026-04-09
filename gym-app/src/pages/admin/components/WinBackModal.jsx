import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, CheckCircle, FlaskConical, Bell, Mail, Smartphone, Gift } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import i18n from 'i18next';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';
import { logAdminAction } from '../../../lib/adminAudit';

export default function WinBackModal({ member, gymId, adminId, activeCampaign, onClose, onSent, memberEmail: emailProp, memberPhone }) {
  const { t } = useTranslation('pages');
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';
  const defaultMsg = t('admin.churn.winBackDefaultMsg', { name: member.full_name.split(' ')[0], defaultValue: `Hey ${member.full_name.split(' ')[0]}! We miss you at the gym. We'd love to have you back \u2014 come in this week and let's pick up where you left off. Your spot is waiting!` });

  // Fetch member email if not provided
  const [memberEmail, setMemberEmail] = useState(emailProp || null);
  useEffect(() => {
    if (!emailProp) {
      supabase.rpc('admin_get_member_email', { p_member_id: member.id })
        .then(({ data }) => { if (data) setMemberEmail(data); });
    }
  }, [member.id, emailProp]);

  // Load gym rewards for offer selection
  const [gymRewards, setGymRewards] = useState([]);
  useEffect(() => {
    if (!gymId) return;
    supabase.from('gym_rewards')
      .select('id, name, name_es, emoji_icon, reward_type, cost_points')
      .eq('gym_id', gymId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setGymRewards(data || []));
  }, [gymId]);

  // If there's an active campaign, randomly assign a variant
  const [assignedVariant] = useState(() => {
    if (!activeCampaign) return null;
    return Math.random() < 0.5 ? 'A' : 'B';
  });

  const campaignVariant = activeCampaign && assignedVariant
    ? (assignedVariant === 'A' ? activeCampaign.variant_a : activeCampaign.variant_b)
    : null;

  const [msg, setMsg] = useState(campaignVariant?.message || defaultMsg);
  const [selectedRewardId, setSelectedRewardId] = useState(null); // gym_rewards.id
  const [channel, setChannel] = useState('push'); // push, email, sms
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // When campaign variant is assigned, pre-fill the offer
  useEffect(() => {
    if (campaignVariant) {
      if (campaignVariant.message) setMsg(campaignVariant.message);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedReward = gymRewards.find(r => r.id === selectedRewardId);
  const rewardName = selectedReward
    ? (lang === 'es' && selectedReward.name_es ? selectedReward.name_es : selectedReward.name)
    : null;

  const handleSend = async () => {
    setSending(true);
    try {
      // If a reward is selected, gift it to the member (creates pending redemption with QR)
      let redemptionId = null;
      if (selectedReward) {
        const { data: giftResult, error: giftErr } = await supabase.rpc('admin_gift_reward', {
          p_member_id: member.id,
          p_gym_id: gymId,
          p_reward_id: String(selectedReward.id),
          p_reward_name: selectedReward.name,
        });
        if (giftErr) logger.error('Win-back gift reward failed:', giftErr);
        else redemptionId = giftResult?.redemption_id;
      }

      // Build message with offer
      const offerLine = rewardName
        ? `\n\n🎁 ${t('admin.churn.specialOfferPrefix', 'Special offer for you')}: ${rewardName}`
        : '';
      const claimLine = redemptionId
        ? `\n${t('admin.churn.showQrToClaim', 'Show the QR code above to staff at the gym to claim!')}`
        : '';
      const fullMsg = msg + offerLine + claimLine;

      // Build MMS image URL for QR code
      const qrImageUrl = redemptionId
        ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reward-qr?id=${redemptionId}&format=png`
        : null;

      // Send via selected channel
      if (channel === 'push') {
        // Send as DM so it shows in Messages page
        const { data: convoId, error: convoErr } = await supabase.rpc('get_or_create_conversation', { p_other_user: member.id });
        if (convoErr) throw convoErr;

        const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
        const seed = convo?.encryption_seed || convoId;

        const encrypted = await encryptMessage(fullMsg, convoId, seed);
        await supabase.from('direct_messages').insert({
          conversation_id: convoId,
          sender_id: adminId,
          body: encrypted,
        });
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);

        // Send push notification so phone buzzes
        const pushTitle = t('admin.churn.weWantYouBack', 'We want you back!');
        const { data: { session: pushSession } } = await supabase.auth.getSession();
        supabase.functions.invoke('send-push-user', {
          body: {
            profile_id: member.id,
            gym_id: gymId,
            title: pushTitle,
            body: fullMsg.substring(0, 150),
            data: { type: 'direct_message', conversation_id: convoId },
          },
          headers: pushSession?.access_token ? { Authorization: `Bearer ${pushSession.access_token}` } : {},
        }).catch(err => logger.warn('WinBack: push failed:', err));
      } else if (channel === 'email') {
        const { error: emailErr } = await supabase.functions.invoke('send-admin-email', {
          body: {
            memberId: member.id,
            subject: t('admin.churn.weWantYouBack', 'We want you back!'),
            body: fullMsg,
            lang,
          },
        });
        if (emailErr) throw emailErr;
      } else if (channel === 'sms') {
        const smsText = fullMsg.length > 600 ? fullMsg.slice(0, 597) + '...' : fullMsg;
        const { data: { session: smsSession } } = await supabase.auth.getSession();
        if (!smsSession?.access_token) throw new Error('No active session');
        const smsPayload = { memberId: member.id, body: smsText, source: 'win_back' };
        if (qrImageUrl) smsPayload.mediaUrl = qrImageUrl;
        const { data: smsData, error: smsErr } = await supabase.functions.invoke('send-sms', {
          body: smsPayload,
          headers: { Authorization: `Bearer ${smsSession.access_token}` },
        });
        if (smsErr) throw smsErr;
        if (smsData?.error) throw new Error(smsData.error);
      }

      // Track win-back attempt
      try {
        const attemptRow = {
          user_id: member.id, gym_id: gymId, admin_id: adminId,
          message: fullMsg, offer: rewardName || null,
          outcome: 'no_response', created_at: new Date().toISOString(),
        };
        if (activeCampaign && assignedVariant) {
          attemptRow.variant = assignedVariant;
          attemptRow.message_template = activeCampaign.id;
        }
        await supabase.from('win_back_attempts').insert(attemptRow);
      } catch (_) {}

      // Log contact
      try {
        const channelLabel = channel === 'push' ? 'push' : channel === 'email' ? 'email' : 'sms';
        const note = activeCampaign
          ? `Win-back via ${channelLabel} [${activeCampaign.name} — Variant ${assignedVariant}]${rewardName ? `: ${rewardName}` : ''}`
          : (rewardName ? `Win-back via ${channelLabel} with offer: ${rewardName}` : `Win-back via ${channelLabel}`);
        await supabase.from('admin_contact_log').insert({
          admin_id: adminId, member_id: member.id, gym_id: gymId,
          method: 'win_back', note,
        });
      } catch (_) {}

      logAdminAction('send_winback', 'member', member.id, { channel, offer: rewardName });
      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Failed to send win-back', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.churn.winBackCampaign', 'Win-Back Campaign')} subtitle={t('admin.churn.reengage', { name: member.full_name, defaultValue: 'Re-engage {{name}}' })} size="md"
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
            {t('admin.members.cancel')}
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)', color: sent ? 'var(--color-success)' : 'var(--color-danger)', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
            {sent ? <><CheckCircle size={14} /> {t('admin.churn.sent', 'Sent!')}</> : sending ? t('admin.churn.sendingMsg', 'Sending\u2026') : <><RotateCcw size={13} /> {t('admin.churn.sendWinBack', 'Send Win-Back')}</>}
          </button>
        </>
      }>
      <div className="space-y-4">
        {/* Channel selector */}
        <div>
          <SectionLabel className="mb-2">{t('admin.churn.channelLabel', 'Send via')}</SectionLabel>
          <div className="flex gap-2">
            {[
              { key: 'push', icon: Bell, label: t('admin.churn.channelPush', 'Push'), color: '#10B981', available: true },
              { key: 'email', icon: Mail, label: t('admin.churn.channelEmail', 'Email'), color: '#60A5FA', available: !!memberEmail },
              { key: 'sms', icon: Smartphone, label: t('admin.churn.channelSms', 'SMS'), color: '#F59E0B', available: !!memberPhone },
            ].map(ch => (
              <button key={ch.key} onClick={() => setChannel(ch.key)} disabled={!ch.available}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                  channel === ch.key
                    ? `border-[${ch.color}]/40 text-[${ch.color}]`
                    : 'border-white/6 text-[#6B7280] hover:text-[#9CA3AF]'
                }`}
                style={channel === ch.key ? { background: `${ch.color}15`, borderColor: `${ch.color}66`, color: ch.color } : {}}>
                <ch.icon size={13} />
                {ch.label}
              </button>
            ))}
          </div>
          {channel === 'sms' && (
            <p className="text-[10px] text-[#F59E0B] mt-1.5">{t('admin.churn.smsLimitWarning', 'Counts toward 200/mo SMS limit · Message will be truncated to 320 chars')}</p>
          )}
        </div>

        {/* Active campaign banner */}
        {activeCampaign && assignedVariant && (
          <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/20 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
            <FlaskConical size={14} className="text-[#D4AF37] flex-shrink-0" />
            <div>
              <p className="text-[11px] text-[#D4AF37] font-semibold">
                {t('admin.churn.ab.assignedBanner', { campaign: activeCampaign.name, variant: assignedVariant, defaultValue: `A/B Test: {{campaign}} — Variant {{variant}}` })}
              </p>
              <p className="text-[10px] text-[#9CA3AF]">
                {t('admin.churn.ab.assignedDesc', 'Message and offer pre-filled from campaign variant. You can still edit before sending.')}
              </p>
            </div>
          </div>
        )}

        <div>
          <SectionLabel className="mb-2">{t('admin.churn.messageLabel', 'Message')}</SectionLabel>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
        </div>
        <div>
          <SectionLabel className="mb-2">{t('admin.churn.offerOptional', 'Attach a reward (optional)')}</SectionLabel>
          {gymRewards.length === 0 ? (
            <p className="text-[11px] text-[#6B7280]">{t('admin.churn.noRewardsConfigured', 'No rewards configured. Add rewards in the Rewards page.')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelectedRewardId(null)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors whitespace-nowrap ${!selectedRewardId ? 'bg-white/8 text-[#E5E7EB] border-white/15' : 'bg-white/4 text-[#6B7280] border-white/6 hover:text-[#9CA3AF]'}`}>
                {t('admin.churn.noOffer', 'No reward')}
              </button>
              {gymRewards.map(r => {
                const name = lang === 'es' && r.name_es ? r.name_es : r.name;
                return (
                  <button key={r.id} onClick={() => setSelectedRewardId(r.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors whitespace-nowrap ${selectedRewardId === r.id ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30' : 'bg-white/4 text-[#9CA3AF] border-white/6 hover:text-[#E5E7EB]'}`}>
                    <span>{r.emoji_icon || '🎁'}</span>
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Campaign variant details */}
        {campaignVariant && (campaignVariant.discount_pct || campaignVariant.free_days) && (
          <div className="bg-[#111827] border border-white/6 rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-[#6B7280] font-semibold mb-1">{t('admin.churn.ab.campaignExtras', 'Campaign variant extras')}</p>
            <div className="flex gap-3">
              {campaignVariant.discount_pct && (
                <span className="text-[12px] text-[#D4AF37] font-medium">{campaignVariant.discount_pct}% {t('admin.churn.ab.discount', 'discount')}</span>
              )}
              {campaignVariant.free_days && (
                <span className="text-[12px] text-[#10B981] font-medium">{campaignVariant.free_days} {t('admin.churn.ab.freeDays', 'free days')}</span>
              )}
            </div>
          </div>
        )}

        {selectedReward && (
          <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/15 rounded-xl px-3.5 py-2.5 flex items-center gap-2.5">
            <span className="text-[20px]">{selectedReward.emoji_icon || '🎁'}</span>
            <div>
              <p className="text-[11px] text-[#D4AF37] font-semibold">{t('admin.churn.rewardAttached', 'Reward will be gifted to member')}</p>
              <p className="text-[12px] text-[#E5E7EB]">{rewardName}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{t('admin.churn.rewardClaimNote', 'Member will see a QR in their Rewards page to claim at the gym')}</p>
            </div>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
