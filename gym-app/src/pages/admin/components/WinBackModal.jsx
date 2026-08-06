import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, CheckCircle, FlaskConical, Bell, Mail, Smartphone, Gift } from 'lucide-react';
import { supabase, authHeader } from '../../../lib/supabase';
import { encryptMessage } from '../../../lib/messageEncryption';
import { RewardSymbol } from '../../../lib/rewardSymbols';
import i18n from 'i18next';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';
import { useToast } from '../../../contexts/ToastContext';
import { logAdminAction } from '../../../lib/adminAudit';
import posthog from 'posthog-js';

export default function WinBackModal({ member, gymId, adminId, activeCampaign, onClose, onSent, memberEmail: emailProp, memberPhone }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
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
  // Recuerda la redención ya concedida para que un reintento no regale otra.
  const giftedRef = useRef(null);
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
      //
      // SE REGALA UNA SOLA VEZ POR APERTURA DEL MODAL.
      //
      // El regalo tiene que ir ANTES del envío porque su QR y su enlace van
      // DENTRO del mensaje. Pero el envío puede fallar o resolverse en
      // `opted_out`, y entonces el admin cambia de canal y le da otra vez —
      // que es lo normal, porque `opted_out` es determinista. Sin este guardado
      // cada reintento creaba una redención pendiente MÁS con su propio QR, y
      // el miembro acumulaba regalos que nadie concedió.
      //
      // No hay RPC para revocar una redención, así que reusar la anterior es
      // la única forma correcta sin una migración nueva.
      if (selectedReward && !giftedRef.current) {
        const { data: giftResult, error: giftErr } = await supabase.rpc('admin_gift_reward', {
          p_member_id: member.id,
          p_gym_id: gymId,
          p_reward_id: String(selectedReward.id),
          p_reward_name: selectedReward.name,
        });
        if (giftErr) logger.error('Win-back gift reward failed:', giftErr);
        else giftedRef.current = { rewardId: String(selectedReward.id), redemptionId: giftResult?.redemption_id };
      }
      // Si cambió de recompensa entre reintentos, la anterior ya no aplica.
      const redemptionId = giftedRef.current?.rewardId === String(selectedReward?.id ?? '')
        ? giftedRef.current.redemptionId
        : null;

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

      // One fresh auth header for whichever edge function this channel hits —
      // send-push-user / send-admin-email / send-sms are all verify_jwt=on, so a
      // header-less request is bounced by the gateway before the function runs.
      // Throws SESSION_EXPIRED (caught below) when the session can't be refreshed.
      const reqHeaders = await authHeader();

      // Send via selected channel
      if (channel === 'push') {
        // Send as DM so it shows in Messages page
        const { data: convoId, error: convoErr } = await supabase.rpc('get_or_create_conversation', { p_other_user: member.id });
        if (convoErr) throw convoErr;

        const { data: convo } = await supabase.from('conversations').select('encryption_seed').eq('id', convoId).single();
        const seed = convo?.encryption_seed || convoId;

        const encrypted = await encryptMessage(fullMsg, convoId, seed);
        // Sin este chequeo, un DM que no se escribía seguía adelante hasta
        // grabar win_back_attempts con outcome:'no_response' — o sea, un envío
        // fallido quedaba registrado como win-back ENTREGADO que el miembro
        // ignoró, envenenando las analíticas de retención.
        const { error: dmErr } = await supabase.from('direct_messages').insert({
          conversation_id: convoId,
          sender_id: adminId,
          body: encrypted,
        });
        if (dmErr) throw dmErr;
        await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convoId);

        // Send push notification so phone buzzes
        const pushTitle = t('admin.churn.weWantYouBack', 'We want you back!');
        supabase.functions.invoke('send-push-user', {
          body: {
            profile_id: member.id,
            gym_id: gymId,
            title: pushTitle,
            body: fullMsg.substring(0, 150),
            data: { type: 'direct_message', conversation_id: convoId },
          },
          headers: reqHeaders,
        }).catch(err => logger.warn('WinBack: push failed:', err));
      } else if (channel === 'email') {
        const { data: emailData, error: emailErr } = await supabase.functions.invoke('send-admin-email', {
          headers: reqHeaders,
          body: {
            memberId: member.id,
            subject: t('admin.churn.weWantYouBack', 'We want you back!'),
            body: fullMsg,
            lang,
            // Esto es contenido COMERCIAL: le escribe a alguien que ya se fue
            // para que vuelva. Sin `scope`, la función lo trataba como
            // transaccional y saltaba ENTERO el aparato de consentimiento de
            // 0685 — interruptor maestro, lista de supresión y enlace de baja.
            // O sea: el único correo que un ex-miembro tiene motivos para no
            // querer era justo el que ignoraba que se hubiera dado de baja, y
            // salía sin forma de volver a darse. Desde noreply@tugympr.com,
            // que comparte toda la plataforma.
            //
            // 'marketing' y NO 'winback' a propósito. `email_allowed_for`
            // (0685:220) exige para el scope 'winback' la columna
            // notif_email_winback, que es opt-in con DEFAULT FALSE porque está
            // pensada para el cron desatendido. Ponerla aquí bloquearía
            // prácticamente todos los envíos de este botón — y peor, la función
            // devuelve `{sent:false, reason:'opted_out'}` con HTTP 200, así que
            // el admin vería "enviado" sin que saliera nada. Un scope
            // desconocido comprueba interruptor maestro + supresión + emite la
            // baja, que es lo que corresponde a un envío puntual que un humano
            // decide, uno a uno. Mismo criterio que Outreach.
            scope: 'marketing',
          },
        });
        if (emailErr) throw emailErr;
        // El envío puede resolverse con 200 y NO haber salido. Decirlo.
        if (emailData?.sent === false) {
          showToast(
            emailData.reason === 'opted_out'
              ? t('admin.churn.emailOptedOut', 'That member unsubscribed from emails — try another channel.')
              : t('admin.churn.emailNotSent', 'The email was not sent.'),
            'error',
          );
          return; // el `finally` de abajo suelta `sending`
        }
      } else if (channel === 'sms') {
        const smsText = fullMsg.length > 320 ? fullMsg.slice(0, 317) + '...' : fullMsg;
        const smsPayload = { memberId: member.id, body: smsText, source: 'win_back' };
        if (qrImageUrl) smsPayload.mediaUrl = qrImageUrl;
        const { data: smsData, error: smsErr } = await supabase.functions.invoke('send-sms', {
          body: smsPayload,
          headers: reqHeaders,
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
        const { error: attemptErr } = await supabase.from('win_back_attempts').insert(attemptRow);
        if (attemptErr) logger.error('win_back_attempts insert failed:', attemptErr);
      } catch (e) { logger.error('win_back_attempts failed:', e); }

      // Log contact
      try {
        const channelLabel = channel === 'push' ? 'push' : channel === 'email' ? 'email' : 'sms';
        const note = activeCampaign
          ? `Win-back via ${channelLabel} [${activeCampaign.name} — Variant ${assignedVariant}]${rewardName ? `: ${rewardName}` : ''}`
          : (rewardName ? `Win-back via ${channelLabel} with offer: ${rewardName}` : `Win-back via ${channelLabel}`);
        const { error: logErr } = await supabase.from('admin_contact_log').insert({
          admin_id: adminId, member_id: member.id, gym_id: gymId,
          method: 'win_back', note,
        });
        if (logErr) logger.error('admin_contact_log insert failed:', logErr);
      } catch (e) { logger.error('contact log failed:', e); }

      logAdminAction('send_winback', 'member', member.id, { channel, offer: rewardName });
      posthog?.capture('admin_winback_sent', { method: channel });
      setSent(true);
      showToast(t('admin.churn.winBackSentToast', { defaultValue: 'Win-back message sent' }), 'success');
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Failed to send win-back', err);
      showToast(err?.message || t('admin.churn.winBackSendFailed', { defaultValue: "Couldn't send — try again" }), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose} title={t('admin.churn.winBackCampaign', 'Win-Back Campaign')} subtitle={t('admin.churn.reengage', { name: member.full_name, defaultValue: 'Re-engage {{name}}' })} size="md"
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-[var(--color-bg-subtle)] text-[var(--color-admin-text-muted)] border border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)] transition-colors whitespace-nowrap">
            {t('admin.members.cancel')}
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            style={{ background: sent ? 'var(--color-success-soft)' : 'var(--color-danger-soft)', color: sent ? 'var(--color-success)' : 'var(--color-danger)', border: `1px solid ${sent ? 'var(--color-success-soft)' : 'var(--color-danger-soft)'}` }}>
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
              { key: 'push', icon: Bell, label: t('admin.churn.channelPush', 'Push'), color: 'var(--color-success)', available: true },
              { key: 'email', icon: Mail, label: t('admin.churn.channelEmail', 'Email'), color: 'var(--color-info)', available: !!memberEmail },
              { key: 'sms', icon: Smartphone, label: t('admin.churn.channelSms', 'SMS'), color: 'var(--color-warning)', available: !!memberPhone },
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
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors whitespace-nowrap ${!selectedRewardId ? 'bg-[var(--color-bg-hover)] text-[var(--color-admin-text)] border-[var(--color-admin-border)]' : 'bg-[var(--color-bg-subtle)] text-[var(--color-admin-text-muted)] border-[var(--color-admin-border)] hover:text-[var(--color-admin-text-sub)]'}`}>
                {t('admin.churn.noOffer', 'No reward')}
              </button>
              {gymRewards.map(r => {
                const name = lang === 'es' && r.name_es ? r.name_es : r.name;
                return (
                  <button key={r.id} onClick={() => setSelectedRewardId(r.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors whitespace-nowrap ${selectedRewardId === r.id ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30' : 'bg-[var(--color-bg-subtle)] text-[var(--color-admin-text-muted)] border-[var(--color-admin-border)] hover:text-[var(--color-admin-text)]'}`}>
                    <span style={{ display: 'inline-flex' }}><RewardSymbol value={r.emoji_icon} size={15} /></span>
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
            <span className="text-[20px]" style={{ color: 'var(--color-accent)' }}><RewardSymbol value={selectedReward.emoji_icon} size={20} color="var(--color-accent)" /></span>
            <div>
              <p className="text-[11px] text-[#D4AF37] font-semibold">{t('admin.churn.rewardAttached', 'Reward will be gifted to member')}</p>
              <p className="text-[12px] text-[var(--color-admin-text)]">{rewardName}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">{t('admin.churn.rewardClaimNote', 'Member will see a QR in their Rewards page to claim at the gym')}</p>
            </div>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
