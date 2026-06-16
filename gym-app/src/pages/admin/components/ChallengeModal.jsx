import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Gift, ChevronDown, ArrowLeft, ArrowRight, Flame, Dumbbell, Zap, TrendingUp, Users, Timer, Crown } from 'lucide-react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import posthog from 'posthog-js';
import { AdminModal } from '../../../components/admin';

const CHALLENGE_TYPES = [
  { value: 'consistency' },
  { value: 'volume' },
  { value: 'pr_count' },
  { value: 'specific_lift' },
  { value: 'team' },
];

const CHALLENGE_COVERS = [
  { key: 'fire',      labelKey: 'admin.challenges.cover.fire',      icon: Flame,      gradient: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)' },
  { key: 'power',     labelKey: 'admin.challenges.cover.power',     icon: Dumbbell,   gradient: 'linear-gradient(135deg, #D4AF37 0%, #92751E 100%)' },
  { key: 'endurance', labelKey: 'admin.challenges.cover.endurance', icon: Zap,        gradient: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)' },
  { key: 'growth',    labelKey: 'admin.challenges.cover.growth',    icon: TrendingUp, gradient: 'linear-gradient(135deg, #10B981 0%, #047857 100%)' },
  { key: 'compete',   labelKey: 'admin.challenges.cover.compete',   icon: Trophy,     gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)' },
  { key: 'team',      labelKey: 'admin.challenges.cover.team',      icon: Users,      gradient: 'linear-gradient(135deg, #EC4899 0%, #BE185D 100%)' },
  { key: 'speed',     labelKey: 'admin.challenges.cover.speed',     icon: Timer,      gradient: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' },
  { key: 'champion',  labelKey: 'admin.challenges.cover.champion',  icon: Crown,      gradient: 'linear-gradient(135deg, #6366F1 0%, #4338CA 100%)' },
];

const DEFAULT_REWARDS = [
  { place: '1st', points: 500, prize: '', product_id: null, prizeType: 'none' },
  { place: '2nd', points: 300, prize: '', product_id: null, prizeType: 'none' },
  { place: '3rd', points: 150, prize: '', product_id: null, prizeType: 'none' },
];

/**
 * Create / Edit Challenge modal.
 * When `challenge` is provided, operates in edit mode.
 */
export default function ChallengeModal({ isOpen, onClose, gymId, adminId, challenge = null, prefill = null }) {
  const { t } = useTranslation('pages');
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!challenge;

  // ── Fetch gym products for prize selector ──
  const { data: gymProducts = [] } = useQuery({
    queryKey: ['gym_products', gymId, 'active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('gym_products')
        .select('id, name, emoji_icon')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('name');
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Derive initial form values ──
  const initialForm = () => {
    if (!challenge) {
      return {
        name: '', type: 'consistency', starts_at: '', ends_at: '', description: '',
        cover_preset: '',
        enableRewards: false,
        rewards: [...DEFAULT_REWARDS],
        // Quick-template prefill (create mode only) — seeds name/type/cover/desc.
        ...(prefill || {}),
      };
    }
    let rewards = [...DEFAULT_REWARDS];
    let enableRewards = false;
    try {
      const parsed = challenge.reward_description ? JSON.parse(challenge.reward_description) : null;
      if (parsed && Array.isArray(parsed)) {
        enableRewards = true;
        rewards = parsed.map((r, i) => {
          let prizeType = 'none';
          if (r.product_id) prizeType = 'product';
          else if (r.prize) prizeType = 'custom';
          return {
            place: r.place || ['1st', '2nd', '3rd'][i],
            points: r.points || 0,
            prize: r.prize || '',
            product_id: r.product_id || null,
            prizeType,
          };
        });
      }
    } catch { /* ignore parse errors */ }
    const toLocal = (iso) => {
      const d = new Date(iso);
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    return {
      name: challenge.name,
      type: challenge.type,
      description: challenge.description || '',
      cover_preset: challenge.cover_preset || '',
      starts_at: toLocal(challenge.start_date),
      ends_at: toLocal(challenge.end_date),
      enableRewards,
      rewards,
    };
  };

  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1);
  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    // Clear field error on change
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const validateStep1 = () => {
    const e = {};
    if (!form.name.trim()) e.name = t('admin.validation.nameRequired', 'Name is required');
    else if (form.name.trim().length < 3) e.name = t('admin.validation.tooShort', { min: 3 });
    if (!form.starts_at) e.starts_at = t('admin.validation.startDateRequired', 'Start date is required');
    if (!form.ends_at) e.ends_at = t('admin.validation.endDateRequired', 'End date is required');
    if (form.starts_at && form.ends_at && new Date(form.ends_at) <= new Date(form.starts_at)) {
      e.ends_at = t('admin.validation.endDateAfterStart', 'End date must be after start date');
    }
    if (!form.cover_preset) e.cover_preset = t('admin.validation.coverRequired', 'Please select a cover image');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleBlur = (field) => {
    const e = { ...errors };
    if (field === 'name') {
      if (!form.name.trim()) e.name = t('admin.validation.nameRequired', 'Name is required');
      else if (form.name.trim().length < 3) e.name = t('admin.validation.tooShort', { min: 3 });
      else delete e.name;
    }
    if (field === 'starts_at') {
      if (!form.starts_at) e.starts_at = t('admin.validation.startDateRequired', 'Start date is required');
      else delete e.starts_at;
    }
    if (field === 'ends_at') {
      if (!form.ends_at) e.ends_at = t('admin.validation.endDateRequired', 'End date is required');
      else if (form.starts_at && new Date(form.ends_at) <= new Date(form.starts_at)) e.ends_at = t('admin.validation.endDateAfterStart', 'End date must be after start date');
      else delete e.ends_at;
    }
    setErrors(e);
  };

  // ── Create mutation ──
  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { error: err } = await supabase.from('challenges').insert(payload);
      if (err) throw err;
    },
    onSuccess: () => {
      logAdminAction('create_challenge', 'challenge', null);
      posthog?.capture('admin_challenge_created', { source: 'manual' });
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.challengeCreated', 'Challenge created'), 'success');
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  // ── Update mutation ──
  const updateMutation = useMutation({
    mutationFn: async (payload) => {
      const { error: err } = await supabase.from('challenges').update(payload).eq('id', challenge.id);
      if (err) throw err;
    },
    onSuccess: () => {
      logAdminAction('update_challenge', 'challenge', challenge.id);
      queryClient.invalidateQueries({ queryKey: adminKeys.challenges(gymId) });
      showToast(t('admin.challenges.challengeUpdated', 'Challenge updated'), 'success');
      onClose();
    },
    onError: (err) => { setError(err.message); showToast(err.message, 'error'); },
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSave = () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    setError('');
    const rewardData = form.enableRewards
      ? JSON.stringify(form.rewards.map(r => {
          const entry = { place: r.place, points: r.points, prize: null, product_id: null };
          if (r.prizeType === 'product' && r.product_id) {
            const product = gymProducts.find(p => p.id === r.product_id);
            entry.prize = product?.name || 'Product';
            entry.product_id = r.product_id;
          } else if (r.prizeType === 'custom' && r.prize) {
            entry.prize = r.prize;
          }
          return entry;
        }))
      : null;

    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      cover_preset: form.cover_preset,
      reward_description: rewardData,
      start_date: new Date(form.starts_at).toISOString(),
      end_date: new Date(form.ends_at).toISOString(),
    };

    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate({
        ...payload,
        gym_id: gymId,
        created_by: adminId,
        status: 'active',
      });
    }
  };

  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

  const handlePrizeTypeChange = (index, prizeType) => {
    const updated = [...form.rewards];
    updated[index] = {
      ...updated[index],
      prizeType,
      prize: prizeType === 'custom' ? updated[index].prize : '',
      product_id: prizeType === 'product' ? updated[index].product_id : null,
    };
    set('rewards', updated);
  };

  const handleProductChange = (index, productId) => {
    const updated = [...form.rewards];
    updated[index] = { ...updated[index], product_id: productId || null };
    set('rewards', updated);
  };

  const canProceed = form.name.trim() && form.starts_at && form.ends_at && form.cover_preset;

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? t('admin.challenges.editChallenge', 'Edit Challenge') : t('admin.challenges.newChallenge', 'New Challenge')}
      titleIcon={Trophy}
      footer={
        <div className="flex gap-2">
          {step === 2 && (
            <button onClick={() => setStep(1)}
              className="flex items-center justify-center gap-1.5 flex-1 px-4 py-3 rounded-xl font-semibold text-[13px] leading-tight text-center transition-colors hover:brightness-95"
              style={{ color: 'var(--color-admin-text)', background: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
              <ArrowLeft size={14} className="flex-shrink-0" /> {t('admin.challenges.back', 'Back')}
            </button>
          )}
          {step === 1 ? (
            <button onClick={() => { if (!validateStep1()) return; setError(''); setStep(2); }}
              className="flex items-center justify-center gap-1.5 flex-1 px-4 py-3 rounded-xl font-bold text-[13px] leading-tight text-center transition-colors hover:brightness-[1.04]" style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}>
              <span>{t('admin.challenges.nextStep', 'Scoring & Rewards')}</span> <ArrowRight size={14} className="flex-shrink-0" />
            </button>
          ) : (
            <button onClick={handleSave} disabled={saving}
              className="flex-1 px-4 py-3 rounded-xl font-bold text-[13px] leading-tight text-center disabled:opacity-50 transition-opacity" style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}>
              {saving ? (isEdit ? t('admin.challenges.saving', 'Saving...') : t('admin.challenges.creating', 'Creating...')) : isEdit ? t('admin.challenges.saveChanges', 'Save Changes') : t('admin.challenges.createChallenge', 'Create Challenge')}
            </button>
          )}
        </div>
      }
    >
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-4">
        {[1, 2].map(s => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors"
              style={step >= s
                ? { background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }
                : { background: 'var(--color-admin-panel)', color: 'var(--color-admin-text-faint)' }}>{s}</div>
            <span className="text-[11px] font-medium" style={{ color: step >= s ? 'var(--color-admin-text)' : 'var(--color-admin-text-faint)' }}>
              {s === 1 ? t('admin.challenges.stepBasic', 'Basic Info') : t('admin.challenges.stepRewards', 'Scoring & Rewards')}
            </span>
            {s === 1 && <div className="flex-1 h-[1px]" style={{ background: step >= 2 ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-admin-border)' }} />}
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.challenges.challengeName', 'Challenge Name')} <span style={{ color: 'var(--color-danger)' }}>*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              onBlur={() => handleBlur('name')}
              placeholder={t('admin.challenges.namePlaceholder', 'e.g. March Volume Wars')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
              style={errors.name
                ? { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-danger)', color: 'var(--color-admin-text)' }
                : { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
            {errors.name && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{errors.name}</p>}
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.challenges.typeLabel', 'Type')}</label>
            <div className="space-y-2">
              {CHALLENGE_TYPES.map(ct => (
                <label key={ct.value} className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors"
                  style={form.type === ct.value
                    ? { border: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)', background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)' }
                    : { border: '1px solid var(--color-admin-border)' }}>
                  <input type="radio" name="challenge-type" value={ct.value} checked={form.type === ct.value}
                    onChange={e => set('type', e.target.value)} className="mt-0.5" style={{ accentColor: 'var(--color-accent)' }} />
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{t(`admin.challengeTypes.${ct.value}`)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t(`admin.challengeTypes.${ct.value}_desc`)}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.challenges.startDate', 'Start Date')} <span style={{ color: 'var(--color-danger)' }}>*</span></label>
              <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)}
                onBlur={() => handleBlur('starts_at')}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                style={errors.starts_at
                  ? { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-danger)', color: 'var(--color-admin-text)' }
                  : { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
              {errors.starts_at && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{errors.starts_at}</p>}
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.challenges.endDate', 'End Date')} <span style={{ color: 'var(--color-danger)' }}>*</span></label>
              <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)}
                onBlur={() => handleBlur('ends_at')}
                className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-colors"
                style={errors.ends_at
                  ? { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-danger)', color: 'var(--color-admin-text)' }
                  : { backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
              {errors.ends_at && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{errors.ends_at}</p>}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>{t('admin.challenges.descriptionLabel', 'Description (optional)')}</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder={t('admin.challenges.descriptionPlaceholder', 'Tell members what this challenge is about...')}
              className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none transition-colors"
              style={{ backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }} />
          </div>

          {/* Cover preset selection */}
          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.challenges.coverLabel', 'Cover Image')} <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CHALLENGE_COVERS.map(c => {
                const Icon = c.icon;
                const selected = form.cover_preset === c.key;
                return (
                  <button key={c.key} type="button"
                    onClick={() => set('cover_preset', c.key)}
                    className={`rounded-xl p-2.5 flex flex-col items-center gap-1 transition-all ${selected ? 'scale-[1.03]' : 'opacity-70 hover:opacity-100'}`}
                    style={{ background: c.gradient, boxShadow: selected ? '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-accent)' : 'none' }}>
                    <Icon size={20} className="text-white/90" />
                    <span className="text-[8px] font-bold text-white/80 uppercase tracking-wide">{t(c.labelKey)}</span>
                  </button>
                );
              })}
            </div>
            {errors.cover_preset && <p className="text-[11px] mt-1" style={{ color: 'var(--color-danger)' }}>{errors.cover_preset}</p>}
          </div>

          {error && <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Rewards toggle */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative w-10 h-[22px] rounded-full transition-colors"
                style={{ background: form.enableRewards ? 'var(--color-accent)' : 'var(--color-admin-panel)' }}
                onClick={() => set('enableRewards', !form.enableRewards)}>
                <div className={`absolute top-[3px] w-4 h-4 rounded-full transition-all ${form.enableRewards ? 'left-[22px]' : 'left-[3px]'}`} style={{ background: form.enableRewards ? 'var(--color-text-on-accent, #fff)' : 'var(--color-admin-text-muted)' }} />
              </div>
              <div className="flex items-center gap-2">
                <Gift size={15} style={{ color: form.enableRewards ? 'var(--color-accent)' : 'var(--color-admin-text-muted)' }} />
                <span className="text-[13px] font-medium" style={{ color: 'var(--color-admin-text)' }}>{t('admin.challenges.addRewards', 'Add Rewards')}</span>
              </div>
            </label>
            <p className="text-[11px] mt-1 ml-[52px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.rewardsHint', 'Incentivize participation with points and prizes')}</p>
          </div>

          {form.enableRewards && (
            <div className="space-y-3 rounded-xl p-4 overflow-hidden" style={{ backgroundColor: 'var(--color-admin-panel)', border: '1px solid var(--color-admin-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.rewardPerPlacement', 'Reward per placement')}</p>
              {form.rewards.map((r, i) => (
                <div key={r.place} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[16px] w-6 text-center">{medals[i]}</span>
                    <div className="flex-1 flex gap-2">
                      <div className="w-24">
                        <input
                          type="number" min={0} max={100000} value={r.points}
                          aria-label={`${medals[i]} ${t('admin.challenges.points', 'points')}`}
                          onChange={e => {
                            // Clamp to [0, 100000] to mirror the server cap in
                            // award_challenge_prizes (migration 0490). Prevents an
                            // admin minting unbounded points via the prize field.
                            const pts = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, 100000));
                            const updated = [...form.rewards];
                            updated[i] = { ...r, points: pts };
                            set('rewards', updated);
                          }}
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none text-center transition-colors"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                        />
                        <p className="text-[10px] text-center mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.points', 'points')}</p>
                      </div>
                      <div className="flex-1">
                        <div className="relative">
                          <select
                            value={r.prizeType}
                            onChange={e => handlePrizeTypeChange(i, e.target.value)}
                            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none appearance-none pr-8 cursor-pointer transition-colors"
                            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                          >
                            <option value="none">{t('admin.challenges.noPrize', 'Points only')}</option>
                            {gymProducts.length > 0 && (
                              <option value="product">{t('admin.challenges.selectProduct', 'Select product')}</option>
                            )}
                            <option value="custom">{t('admin.challenges.customPrize', 'Custom prize')}</option>
                          </select>
                          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.prizeOptional', 'prize (optional)')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Product selector */}
                  {r.prizeType === 'product' && gymProducts.length > 0 && (
                    <div className="ml-9 pl-3">
                      <div className="relative">
                        <select
                          value={r.product_id || ''}
                          onChange={e => handleProductChange(i, e.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-[13px] outline-none appearance-none pr-8 cursor-pointer transition-colors"
                          style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                        >
                          <option value="">{t('admin.challenges.selectProduct', 'Select product')}...</option>
                          {gymProducts.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.emoji_icon ? `${p.emoji_icon} ` : ''}{p.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-admin-text-muted)' }} />
                      </div>
                    </div>
                  )}

                  {/* Custom prize text input */}
                  {r.prizeType === 'custom' && (
                    <div className="ml-9 pl-3">
                      <input
                        value={r.prize}
                        onChange={e => {
                          const updated = [...form.rewards];
                          updated[i] = { ...r, prize: e.target.value };
                          set('rewards', updated);
                        }}
                        placeholder={t('admin.challenges.customPrizePlaceholder', 'e.g. Free smoothie, 1 PT session...')}
                        aria-label={`${medals[i]} ${t('admin.challenges.customPrize', 'Custom prize')}`}
                        className="w-full rounded-lg px-3 py-2 text-[13px] outline-none transition-colors"
                        style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-admin-border)', color: 'var(--color-admin-text)' }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!form.enableRewards && (
            <div className="text-center py-6">
              <Gift size={28} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>{t('admin.challenges.noRewardsHint', 'No rewards configured \u2014 challenge will be for bragging rights only')}</p>
            </div>
          )}

          {error && <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        </div>
      )}
    </AdminModal>
  );
}
