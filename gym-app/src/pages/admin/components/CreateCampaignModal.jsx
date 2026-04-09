import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, CheckCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { AdminModal, SectionLabel } from '../../../components/admin';

const OFFER_TYPES = [
  { value: 'Free PT session', key: 'pt_session' },
  { value: '1 month discount', key: 'discount' },
  { value: 'Free class pass', key: 'class_pass' },
  { value: 'Free days', key: 'free_days' },
  { value: 'Custom', key: 'custom' },
];

const TIERS = [
  { value: 'critical', key: 'critical' },
  { value: 'high', key: 'high' },
  { value: 'medium', key: 'medium' },
];

function VariantForm({ label, variant, onChange, t }) {
  const update = (field, value) => onChange({ ...variant, [field]: value });

  return (
    <div className="bg-[#111827] border border-white/6 rounded-xl p-4 space-y-3">
      <p className="text-[13px] font-semibold text-[#E5E7EB]">{label}</p>
      <div>
        <label className="text-[11px] text-[#6B7280] font-medium mb-1 block">
          {t('admin.churn.campaign.offerType', 'Offer Type')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {OFFER_TYPES.map(o => (
            <button key={o.value} onClick={() => update('offer_type', o.value)} type="button"
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                variant.offer_type === o.value
                  ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30'
                  : 'bg-white/4 text-[#9CA3AF] border-white/6 hover:text-[#E5E7EB]'
              }`}>
              {t(`admin.churn.campaign.offer.${o.key}`, o.value)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[11px] text-[#6B7280] font-medium mb-1 block">
          {t('admin.churn.campaign.message', 'Message')}
        </label>
        <textarea value={variant.message || ''} onChange={e => update('message', e.target.value)} rows={3}
          placeholder={t('admin.churn.campaign.messagePlaceholder', 'Write the win-back message for this variant...')}
          className="w-full bg-[#0F172A] border border-white/6 rounded-xl px-3 py-2.5 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 resize-none transition-colors" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[11px] text-[#6B7280] font-medium mb-1 block">
            {t('admin.churn.campaign.discountPct', 'Discount %')}
          </label>
          <input type="number" min={0} max={100} value={variant.discount_pct || ''} onChange={e => update('discount_pct', e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            className="w-full bg-[#0F172A] border border-white/6 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-[#6B7280] font-medium mb-1 block">
            {t('admin.churn.campaign.freeDays', 'Free Days')}
          </label>
          <input type="number" min={0} max={90} value={variant.free_days || ''} onChange={e => update('free_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            className="w-full bg-[#0F172A] border border-white/6 rounded-xl px-3 py-2 text-[12px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
        </div>
      </div>
    </div>
  );
}

export default function CreateCampaignModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const [name, setName] = useState('');
  const [targetTier, setTargetTier] = useState('high');
  const [variantA, setVariantA] = useState({ offer_type: '', message: '', discount_pct: null, free_days: null });
  const [variantB, setVariantB] = useState({ offer_type: '', message: '', discount_pct: null, free_days: null });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isValid = name.trim() && variantA.offer_type && variantA.message?.trim() && variantB.offer_type && variantB.message?.trim();

  const handleCreate = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('winback_campaigns').insert({
        gym_id: gymId,
        name: name.trim(),
        target_tier: targetTier,
        variant_a: variantA,
        variant_b: variantB,
        is_active: true,
      });
      if (error) throw error;
      setSaved(true);
      setTimeout(() => { onCreated?.(); onClose(); }, 800);
    } catch (err) {
      logger.error('Failed to create A/B campaign', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose}
      title={t('admin.churn.campaign.createTitle', 'New A/B Campaign')}
      subtitle={t('admin.churn.campaign.createSubtitle', 'Test two win-back variants to find what works best')}
      size="lg"
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold bg-white/4 text-[#9CA3AF] border border-white/6 hover:text-[#E5E7EB] transition-colors whitespace-nowrap">
            {t('admin.churn.campaign.cancel', 'Cancel')}
          </button>
          <button onClick={handleCreate} disabled={saving || !isValid || saved}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            style={{
              background: saved ? 'rgba(16,185,129,0.15)' : 'rgba(212,175,55,0.12)',
              color: saved ? '#10B981' : '#D4AF37',
              border: `1px solid ${saved ? 'rgba(16,185,129,0.25)' : 'rgba(212,175,55,0.25)'}`,
            }}>
            {saved ? <><CheckCircle size={14} /> {t('admin.churn.campaign.created', 'Created!')}</>
              : saving ? t('admin.churn.campaign.creating', 'Creating...')
              : <><FlaskConical size={13} /> {t('admin.churn.campaign.create', 'Create Campaign')}</>}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <SectionLabel className="mb-2">{t('admin.churn.campaign.name', 'Campaign Name')}</SectionLabel>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={t('admin.churn.campaign.namePlaceholder', 'e.g. March Win-Back Test')}
            aria-label={t('admin.churn.campaign.name', 'Campaign Name')}
            className="w-full bg-[#111827] border border-white/6 rounded-xl px-3.5 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 transition-colors" />
        </div>
        <div>
          <SectionLabel className="mb-2">{t('admin.churn.campaign.targetTier', 'Target Risk Tier')}</SectionLabel>
          <div className="flex gap-2">
            {TIERS.map(tier => (
              <button key={tier.value} onClick={() => setTargetTier(tier.value)}
                className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                  targetTier === tier.value
                    ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-[#D4AF37]/30'
                    : 'bg-white/4 text-[#9CA3AF] border-white/6 hover:text-[#E5E7EB]'
                }`}>
                {t(`admin.churn.campaign.tier.${tier.key}`, tier.value.charAt(0).toUpperCase() + tier.value.slice(1))}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <VariantForm
            label={t('admin.churn.ab.variantA', 'Variant A')}
            variant={variantA} onChange={setVariantA} t={t} />
          <VariantForm
            label={t('admin.churn.ab.variantB', 'Variant B')}
            variant={variantB} onChange={setVariantB} t={t} />
        </div>
        <div className="bg-[#D4AF37]/8 border border-[#D4AF37]/15 rounded-xl px-3.5 py-2.5">
          <p className="text-[11px] text-[#D4AF37] font-semibold mb-0.5">
            {t('admin.churn.campaign.autoAssignTitle', 'Auto-assign variants')}
          </p>
          <p className="text-[11px] text-[#9CA3AF]">
            {t('admin.churn.campaign.autoAssignDesc', 'Each win-back outreach will be randomly assigned Variant A or B for unbiased comparison.')}
          </p>
        </div>
      </div>
    </AdminModal>
  );
}
