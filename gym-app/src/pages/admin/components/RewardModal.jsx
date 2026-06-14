import { useState, useEffect } from 'react';
import { Gift, ToggleLeft, ToggleRight, ChevronRight } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { useAutoTranslate } from '../../../hooks/useAutoTranslate';
import { AdminModal } from '../../../components/admin';
import { REWARD_TYPES, rewardKeys, REWARD_INPUT_CLASS as inputClass } from './rewardConstants';
import { REWARD_SYMBOLS, RewardSymbol, isRewardSymbol } from '../../../lib/rewardSymbols';

/**
 * Create/edit modal for a `gym_rewards` row.
 *
 * Two-section layout: required fields up top (emoji, name, type, cost,
 * active toggle, featured toggle) and a collapsible "Translations &
 * Advanced" section for ES copy + sort order. Auto-expands the advanced
 * section when editing an existing reward that already has translations.
 *
 * `is_featured` is enforced unique-per-gym at the DB level by a partial
 * unique index — we manually clear any other featured row before save
 * to avoid hitting that constraint.
 */
export default function RewardModal({ isOpen, onClose, gymId, reward, t }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { translate, translating } = useAutoTranslate();
  const isEdit = !!reward;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    name: '', name_es: '', description: '', description_es: '',
    reward_type: 'custom', emoji_icon: 'gift', cost_points: '0', is_active: true,
    sort_order: '0', is_featured: false,
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (reward) {
      setForm({
        name: reward.name || '',
        name_es: reward.name_es || '',
        description: reward.description || '',
        description_es: reward.description_es || '',
        reward_type: reward.reward_type || 'custom',
        emoji_icon: reward.emoji_icon || 'gift',
        cost_points: reward.cost_points?.toString() || '0',
        is_active: reward.is_active ?? true,
        sort_order: reward.sort_order?.toString() || '0',
        is_featured: !!reward.is_featured,
      });
      setErrors({});
      // Auto-expand advanced if reward has translations or custom sort
      setShowAdvanced(!!(reward.name_es || reward.description_es || (reward.sort_order && reward.sort_order !== 0)));
    } else {
      setForm({
        name: '', name_es: '', description: '', description_es: '',
        reward_type: 'custom', emoji_icon: 'gift', cost_points: '0', is_active: true,
        sort_order: '0',
      });
      setErrors({});
      setShowAdvanced(false);
    }
  }, [reward, isOpen]);

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  // Sanity bounds — server has no upper cap on cost_points, so without these
  // an admin can save a 10,000,000-pt reward and break the gamification economy.
  const REWARD_NAME_MAX = 80;
  const REWARD_POINTS_MAX = 1_000_000;

  const validateForm = () => {
    const e = {};
    if (!form.name.trim()) e.name = t('admin.validation.nameRequired', 'Name is required');
    else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
    else if (form.name.trim().length > REWARD_NAME_MAX) e.name = t('admin.validation.tooLong', { max: REWARD_NAME_MAX, defaultValue: 'Max {{max}} characters' });
    const pts = parseInt(form.cost_points, 10);
    if (Number.isNaN(pts) || pts < 0) e.cost_points = t('admin.validation.pointsMin', 'Points must be 0 or more');
    else if (pts > REWARD_POINTS_MAX) e.cost_points = t('admin.validation.pointsMax', { max: REWARD_POINTS_MAX.toLocaleString(), defaultValue: 'Max {{max}} points' });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleBlur = (field) => {
    const e = { ...errors };
    if (field === 'name') {
      if (!form.name.trim()) e.name = t('admin.validation.nameRequired', 'Name is required');
      else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
      else if (form.name.trim().length > REWARD_NAME_MAX) e.name = t('admin.validation.tooLong', { max: REWARD_NAME_MAX, defaultValue: 'Max {{max}} characters' });
      else delete e.name;
    }
    if (field === 'cost_points') {
      const pts = parseInt(form.cost_points, 10);
      if (Number.isNaN(pts) || pts < 0) e.cost_points = t('admin.validation.pointsMin', 'Points must be 0 or more');
      else if (pts > REWARD_POINTS_MAX) e.cost_points = t('admin.validation.pointsMax', { max: REWARD_POINTS_MAX.toLocaleString(), defaultValue: 'Max {{max}} points' });
      else delete e.cost_points;
    }
    setErrors(e);
  };

  const handleAutoTranslate = async () => {
    const texts = [form.name, form.description].filter(Boolean);
    if (!texts.length) return;
    const result = await translate(texts, 'ES');
    if (result?.translations) {
      const [nameEs, descEs] = result.translations;
      if (nameEs) set('name_es', nameEs);
      if (descEs) set('description_es', descEs);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!validateForm()) throw new Error(t('admin.rewards.nameRequired', 'Reward name is required.'));

      // Reject duplicate names within the gym (case-insensitive), excluding self —
      // two rewards with the same name confuse members and the pickers.
      const trimmedName = form.name.trim();
      const { data: dupes, error: dupeErr } = await supabase
        .from('gym_rewards')
        .select('id, name')
        .eq('gym_id', gymId)
        .ilike('name', trimmedName);
      if (dupeErr) throw dupeErr;
      const conflict = (dupes || []).some(d => d.id !== reward?.id && (d.name || '').trim().toLowerCase() === trimmedName.toLowerCase());
      if (conflict) {
        setErrors(prev => ({ ...prev, name: t('admin.rewards.duplicateName', 'A reward with this name already exists') }));
        throw new Error(t('admin.rewards.duplicateName', 'A reward with this name already exists'));
      }

      const payload = {
        gym_id: gymId,
        name: form.name.trim(),
        name_es: form.name_es.trim() || null,
        description: form.description.trim() || null,
        description_es: form.description_es.trim() || null,
        reward_type: form.reward_type,
        emoji_icon: form.emoji_icon || 'gift',
        cost_points: parseInt(form.cost_points) || 0,
        is_active: form.is_active,
        sort_order: parseInt(form.sort_order) || 0,
        is_featured: !!form.is_featured,
      };

      // Only one featured reward per gym — clear any existing featured flag
      // before saving this one to satisfy the partial unique index.
      if (payload.is_featured) {
        const { error: clearError } = await supabase
          .from('gym_rewards')
          .update({ is_featured: false })
          .eq('gym_id', gymId)
          .eq('is_featured', true)
          .neq('id', reward?.id || '00000000-0000-0000-0000-000000000000');
        if (clearError) throw clearError;
      }

      if (isEdit) {
        const { error } = await supabase.from('gym_rewards').update(payload).eq('id', reward.id).eq('gym_id', gymId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gym_rewards').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (!isEdit) posthog?.capture('admin_reward_created', { name: form.name.trim() });
      queryClient.invalidateQueries({ queryKey: rewardKeys.all(gymId) });
      showToast(t('admin.rewards.saved', 'Reward saved'), 'success');
      onClose();
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  return (
    <AdminModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? t('admin.rewards.editReward', 'Edit Reward') : t('admin.rewards.addReward', 'Add Reward')}
      titleIcon={Gift}
      footer={
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full py-3 rounded-xl font-bold text-[14px] text-black disabled:opacity-50 transition-colors"
          style={{ background: '#D4AF37' }}
        >
          {saveMutation.isPending
            ? t('admin.rewards.saving', 'Saving...')
            : isEdit
              ? t('admin.rewards.saveChanges', 'Save Changes')
              : t('admin.rewards.createReward', 'Create Reward')}
        </button>
      }
    >
      <div className="space-y-5">
        {/* ── Essential fields ── */}

        {/* Name */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.rewards.rewardName', 'Reward Name')} <span className="text-red-400">*</span></label>
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            placeholder={t('admin.rewards.rewardNamePlaceholder', 'e.g. Free Smoothie')}
            className={errors.name ? `${inputClass} !border-red-500/50 focus:!border-red-500/50 focus:!ring-red-500/30` : inputClass}
          />
          {errors.name && <p className="text-[11px] text-red-400 mt-1">{errors.name}</p>}
        </div>

        {/* Symbol picker (custom icons in place of emoji) */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.rewards.symbol', 'Symbol')}</label>
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
            {REWARD_SYMBOLS.map(s => {
              const on = form.emoji_icon === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => set('emoji_icon', s.key)}
                  aria-label={s.key}
                  className="aspect-square rounded-lg grid place-items-center transition-colors"
                  style={{
                    background: on ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'var(--color-bg-card)',
                    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-admin-border)'}`,
                    color: on ? 'var(--color-accent)' : 'var(--color-admin-text-sub)',
                  }}
                >
                  <RewardSymbol value={s.key} size={20} color={on ? 'var(--color-accent)' : 'currentColor'} />
                </button>
              );
            })}
          </div>
          {form.emoji_icon && !isRewardSymbol(form.emoji_icon) && (
            <p className="text-[11px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>
              <span className="text-[15px]">{form.emoji_icon}</span>
              {t('admin.rewards.symbolLegacyHint', 'Pick a symbol above to replace your current emoji.')}
            </p>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.rewards.rewardDescription', 'Description')}</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={2}
            placeholder={t('admin.rewards.descriptionPlaceholder', 'Optional description...')}
            className={`${inputClass} resize-none`}
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.rewards.rewardType', 'Reward Type')}</label>
          <div className="flex gap-2 flex-wrap">
            {REWARD_TYPES.map(rt => (
              <button
                key={rt.value}
                onClick={() => set('reward_type', rt.value)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  form.reward_type === rt.value ? rt.color : 'bg-white/[0.03] border border-white/6 text-[#6B7280]'
                }`}
              >
                {t(`admin.rewards.type_${rt.value}`, rt.value)}
              </button>
            ))}
          </div>
        </div>

        {/* Active toggle */}
        <button
          onClick={() => set('is_active', !form.is_active)}
          className="flex items-center gap-2.5 py-2"
        >
          {form.is_active
            ? <ToggleRight size={22} className="text-emerald-400" />
            : <ToggleLeft size={22} className="text-[#6B7280]" />}
          <span className={`text-[13px] font-medium ${form.is_active ? 'text-emerald-400' : 'text-[#6B7280]'}`}>
            {t('admin.rewards.active', 'Active')}
          </span>
        </button>

        {/* Featured toggle — only one reward can be featured per gym */}
        <button
          onClick={() => set('is_featured', !form.is_featured)}
          className="flex items-center gap-2.5 py-2"
        >
          {form.is_featured
            ? <ToggleRight size={22} className="text-amber-400" />
            : <ToggleLeft size={22} className="text-[#6B7280]" />}
          <span className={`text-[13px] font-medium ${form.is_featured ? 'text-amber-400' : 'text-[#6B7280]'}`}>
            {t('admin.rewards.featured', 'Featured (replaces any current featured reward)')}
          </span>
        </button>

        {/* ── Advanced / Translation fields (progressive disclosure) ── */}
        <div className="border-t border-white/6 pt-3">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-[12px] font-semibold text-[#6B7280] hover:text-[#9CA3AF] transition-colors w-full"
          >
            <ChevronRight size={14} className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
            {t('admin.rewards.advancedSettings', 'Translations & Advanced')}
            {(form.name_es || form.description_es) && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] flex-shrink-0" />
            )}
          </button>

          {showAdvanced && (
            <div className="space-y-4 mt-4">
              {/* Name ES + Auto-translate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-[#9CA3AF]">{t('admin.rewards.rewardName', 'Reward Name')} (ES)</label>
                  <button
                    onClick={handleAutoTranslate}
                    disabled={translating || !form.name.trim()}
                    className="text-[11px] text-[#D4AF37] hover:text-[#C5A028] disabled:opacity-40 transition-colors"
                  >
                    {translating ? '...' : t('admin.rewards.autoTranslate', 'Auto-translate')}
                  </button>
                </div>
                <input
                  value={form.name_es}
                  onChange={e => set('name_es', e.target.value)}
                  placeholder={t('admin.rewards.namePlaceholder', 'e.g. Free Smoothie')}
                  className={inputClass}
                />
              </div>

              {/* Description ES */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.rewards.rewardDescription', 'Description')} (ES)</label>
                <textarea
                  value={form.description_es}
                  onChange={e => set('description_es', e.target.value)}
                  rows={2}
                  placeholder={t('admin.rewards.descriptionPlaceholder', 'Optional description...')}
                  className={`${inputClass} resize-none`}
                />
              </div>

              {/* Sort Order */}
              <div>
                <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.rewards.sortOrder', 'Sort Order')}</label>
                <input
                  type="number"
                  min="0"
                  value={form.sort_order}
                  onChange={e => set('sort_order', e.target.value)}
                  placeholder="0"
                  className={inputClass}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminModal>
  );
}
