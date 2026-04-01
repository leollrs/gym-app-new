import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, CheckCircle, FlaskConical } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';

const OFFERS = [
  { value: '', key: 'none' },
  { value: 'Free PT session', key: 'pt_session' },
  { value: '1 month discount', key: 'discount' },
  { value: 'Free class pass', key: 'class_pass' },
  { value: 'Custom…', key: 'custom' },
];

export default function WinBackModal({ member, gymId, adminId, activeCampaign, onClose, onSent }) {
  const { t } = useTranslation('pages');
  const defaultMsg = `Hey ${member.full_name.split(' ')[0]}! We miss you at the gym. We'd love to have you back — come in this week and let's pick up where you left off. Your spot is waiting!`;

  // If there's an active campaign, randomly assign a variant
  const [assignedVariant] = useState(() => {
    if (!activeCampaign) return null;
    return Math.random() < 0.5 ? 'A' : 'B';
  });

  const campaignVariant = activeCampaign && assignedVariant
    ? (assignedVariant === 'A' ? activeCampaign.variant_a : activeCampaign.variant_b)
    : null;

  const [msg, setMsg] = useState(campaignVariant?.message || defaultMsg);
  const [offer, setOffer] = useState(campaignVariant?.offer_type || '');
  const [customOffer, setCustomOffer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // When campaign variant is assigned, pre-fill the offer
  useEffect(() => {
    if (campaignVariant) {
      if (campaignVariant.message) setMsg(campaignVariant.message);
      if (campaignVariant.offer_type) setOffer(campaignVariant.offer_type);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finalOffer = offer === 'Custom…' ? customOffer : offer;

  // Build offer description including discount/free days from campaign
  const buildOfferDesc = () => {
    let desc = finalOffer || '';
    if (campaignVariant) {
      if (campaignVariant.discount_pct) desc += desc ? ` (${campaignVariant.discount_pct}% off)` : `${campaignVariant.discount_pct}% discount`;
      if (campaignVariant.free_days) desc += desc ? ` + ${campaignVariant.free_days} free days` : `${campaignVariant.free_days} free days`;
    }
    return desc;
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const offerDesc = buildOfferDesc();
      const fullMsg = offerDesc ? `${msg}\n\nSpecial offer for you: ${offerDesc}` : msg;
      await supabase.from('notifications').insert({
        profile_id: member.id, gym_id: gymId, type: 'win_back',
        title: 'We want you back!', body: fullMsg,
        data: { source: 'churn_win_back', offer: offerDesc || null, campaign_id: activeCampaign?.id || null, variant: assignedVariant || null },
        dedup_key: `win_back_${member.id}_${adminId}_${Date.now() / 60000 | 0}`,
      });
      try {
        const attemptRow = {
          user_id: member.id, gym_id: gymId, admin_id: adminId,
          message: fullMsg, offer: offerDesc || null,
          outcome: 'no_response', created_at: new Date().toISOString(),
        };
        // Track A/B variant if campaign is active
        if (activeCampaign && assignedVariant) {
          attemptRow.variant = assignedVariant;
          attemptRow.message_template = activeCampaign.id;
        }
        await supabase.from('win_back_attempts').insert(attemptRow);
      } catch (_) {}
      // Log contact to admin_contact_log
      try {
        const note = activeCampaign
          ? `Win-back [${activeCampaign.name} — Variant ${assignedVariant}]${offerDesc ? `: ${offerDesc}` : ''}`
          : (offerDesc ? `Win-back with offer: ${offerDesc}` : 'Win-back message');
        await supabase.from('admin_contact_log').insert({
          admin_id: adminId, member_id: member.id, gym_id: gymId,
          method: 'win_back', note,
        });
      } catch (_) {}
      setSent(true);
      setTimeout(() => { onSent?.(); onClose(); }, 1200);
    } catch (err) {
      logger.error('Failed to send win-back', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose} title="Win-Back Campaign" subtitle={`Re-engage ${member.full_name}`} size="md"
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
            Cancel
          </button>
          <button onClick={handleSend} disabled={sending || !msg.trim() || sent}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            style={{ background: sent ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)', color: sent ? 'var(--color-success)' : 'var(--color-danger)', border: `1px solid ${sent ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
            {sent ? <><CheckCircle size={14} /> Sent!</> : sending ? 'Sending…' : <><RotateCcw size={13} /> Send Win-Back</>}
          </button>
        </>
      }>
      <div className="space-y-4">
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
          <SectionLabel className="mb-2">Message</SectionLabel>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={4}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-3 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
        </div>
        <div>
          <SectionLabel className="mb-2">Offer (optional)</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {OFFERS.map(o => (
              <button key={o.value} onClick={() => setOffer(o.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors whitespace-nowrap ${offer === o.value ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30' : 'bg-white/4 text-[#9CA3AF] border-white/6 hover:text-[#E5E7EB]'}`}>
                {t(`admin.winBackOffers.${o.key}`)}
              </button>
            ))}
          </div>
          {offer === 'Custom…' && (
            <input type="text" value={customOffer} onChange={e => setCustomOffer(e.target.value)} placeholder="Describe your offer…"
              className="mt-2 w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
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

        {finalOffer && (
          <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/15 rounded-xl px-3.5 py-2.5">
            <p className="text-[11px] text-[#D4AF37] font-semibold mb-0.5">Offer included in message</p>
            <p className="text-[12px] text-[#9CA3AF]">{buildOfferDesc()}</p>
          </div>
        )}
      </div>
    </AdminModal>
  );
}
