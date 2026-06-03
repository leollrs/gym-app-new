import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, CheckCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import logger from '../../../lib/logger';
import { useToast } from '../../../contexts/ToastContext';
import { AdminModal, SectionLabel } from '../../../components/admin';

// Stable enum keys persisted to DB (winback_campaigns.variant_a/b.offer_type).
// Display labels come from t(`admin.churn.campaign.offer.${key}`, fallback).
const OFFER_TYPES = [
  { key: 'pt_session', value: 'pt_session', fallback: 'Free PT session' },
  { key: 'monthly_discount', value: 'monthly_discount', fallback: '1 month discount' },
  { key: 'class_pass', value: 'class_pass', fallback: 'Free class pass' },
  { key: 'free_days', value: 'free_days', fallback: 'Free days' },
  { key: 'custom', value: 'custom', fallback: 'Custom' },
];

// Stable enum keys persisted to DB (winback_campaigns.target_tier).
// Display labels come from t(`admin.churn.campaign.tier.${key}`, fallback).
const TIERS = [
  { key: 'critical', value: 'critical', fallback: 'Critical' },
  { key: 'high', value: 'high', fallback: 'High' },
  { key: 'medium', value: 'medium', fallback: 'Medium' },
];

const inputClass = 'w-full rounded-xl px-3.5 py-2.5 text-[12.5px] outline-none transition-colors bg-[var(--color-bg-deep)] border border-[var(--color-admin-border)] text-[var(--color-admin-text)] placeholder:text-[var(--color-admin-text-faint)] focus:border-[var(--color-accent)]';

// Selectable chip style — accent wash when on, neutral panel when off.
const chipStyle = (on) => (on
  ? { background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)', border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)' }
  : { background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-sub)', border: '1px solid var(--color-admin-border)' });

function VariantForm({ label, variant, onChange, t }) {
  const update = (field, value) => onChange({ ...variant, [field]: value });

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
      <p className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>{label}</p>
      <div>
        <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.churn.campaign.offerType', 'Offer Type')}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {OFFER_TYPES.map(o => (
            <button key={o.value} onClick={() => update('offer_type', o.value)} type="button"
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
              style={chipStyle(variant.offer_type === o.value)}>
              {t(`admin.churn.campaign.offer.${o.key}`, o.fallback)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--color-admin-text-muted)' }}>
          {t('admin.churn.campaign.message', 'Message')}
        </label>
        <textarea value={variant.message || ''} onChange={e => update('message', e.target.value)} rows={3}
          placeholder={t('admin.churn.campaign.messagePlaceholder', 'Write the win-back message for this variant...')}
          className={`${inputClass} resize-none`} style={{ background: 'var(--color-bg-card)' }} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--color-admin-text-muted)' }}>
            {t('admin.churn.campaign.discountPct', 'Discount %')}
          </label>
          <input type="number" min={0} max={100} value={variant.discount_pct || ''} onChange={e => update('discount_pct', e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            className={inputClass} style={{ background: 'var(--color-bg-card)' }} />
        </div>
        <div className="flex-1">
          <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--color-admin-text-muted)' }}>
            {t('admin.churn.campaign.freeDays', 'Free Days')}
          </label>
          <input type="number" min={0} max={90} value={variant.free_days || ''} onChange={e => update('free_days', e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            className={inputClass} style={{ background: 'var(--color-bg-card)' }} />
        </div>
      </div>
    </div>
  );
}

export default function CreateCampaignModal({ gymId, onClose, onCreated }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
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
      showToast(err?.message || t('admin.churn.campaign.createError', { defaultValue: 'Failed to create campaign. Please try again.' }), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminModal isOpen onClose={onClose}
      title={t('admin.churn.campaign.createTitle', 'New A/B Campaign')}
      subtitle={t('admin.churn.campaign.createSubtitle', 'Test two win-back variants to find what works best')}
      titleIcon={FlaskConical}
      size="lg"
      footer={
        <>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors whitespace-nowrap hover:brightness-[1.04]"
            style={{ background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-sub)', border: '1px solid var(--color-admin-border)' }}>
            {t('admin.churn.campaign.cancel', 'Cancel')}
          </button>
          <button onClick={handleCreate} disabled={saving || !isValid || saved}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-bold transition-colors disabled:opacity-50 whitespace-nowrap hover:brightness-[1.04]"
            style={{
              background: saved ? 'var(--color-success)' : 'var(--color-accent)',
              color: '#fff',
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
            className={inputClass} />
        </div>
        <div>
          <SectionLabel className="mb-2">{t('admin.churn.campaign.targetTier', 'Target Risk Tier')}</SectionLabel>
          <div className="flex gap-2">
            {TIERS.map(tier => (
              <button key={tier.value} onClick={() => setTargetTier(tier.value)}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={chipStyle(targetTier === tier.value)}>
                {t(`admin.churn.campaign.tier.${tier.key}`, tier.fallback)}
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
        <div className="rounded-xl px-3.5 py-2.5" style={{ background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)' }}>
          <p className="text-[11px] font-bold mb-0.5" style={{ color: 'var(--color-accent)' }}>
            {t('admin.churn.campaign.autoAssignTitle', 'Auto-assign variants')}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
            {t('admin.churn.campaign.autoAssignDesc', 'Each win-back outreach will be randomly assigned Variant A or B for unbiased comparison.')}
          </p>
        </div>
      </div>
    </AdminModal>
  );
}
