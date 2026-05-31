import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, Save } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { AdminCard, FadeIn } from '../../../components/admin';
import RewardEditor from './RewardEditor';

const DEFAULT_REFERRAL_CONFIG = {
  enabled: true,
  require_admin_approval: true,
  max_referrals_per_month: null,
  referrer_reward: { type: 'points', value: 250 },
  referred_reward: { type: 'points', value: 100 },
};

// Tolerate legacy shapes saved by older builds:
//   { type: 'points', points: 5000, label: '...' }   → { type: 'points', value: 5000 }
//   { type: 'points', value: 250 }                   → unchanged
//   { type: 'gym_reward', reward_id: '<uuid>' }      → unchanged
function normalizeRewardShape(r) {
  if (!r || typeof r !== 'object') return { type: 'points', value: 0 };
  if (r.type === 'gym_reward') {
    return { type: 'gym_reward', reward_id: r.reward_id || '' };
  }
  const v = r.value ?? r.points ?? 0;
  return { type: 'points', value: Number(v) || 0 };
}

/**
 * Card editing the gym's referral program config (enabled flag, approval mode,
 * monthly cap, referrer/referred rewards). Persists to `gyms.referral_config`
 * as a JSONB column. Originally lived in AdminSettings; moved here so the
 * Referrals page is the single home for everything referral-related.
 */
export default function ReferralProgramConfig({ gymId, config, t, isEs }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_REFERRAL_CONFIG);
  const [saving, setSaving] = useState(false);

  // Active rewards inventory (shared picker for referrer + referred)
  const { data: rewards = [] } = useQuery({
    queryKey: ['admin', 'rewards', gymId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, emoji_icon, is_active, sort_order')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    const incoming = config || {};
    setDraft({
      ...DEFAULT_REFERRAL_CONFIG,
      ...incoming,
      referrer_reward: normalizeRewardShape(incoming.referrer_reward),
      referred_reward: normalizeRewardShape(incoming.referred_reward),
    });
  }, [config]);

  const setReward = (which, next) => setDraft(prev => ({ ...prev, [which]: next }));

  const set = (path, val) => setDraft(prev => {
    const next = { ...prev };
    if (path.includes('.')) {
      const [a, b] = path.split('.');
      next[a] = { ...next[a], [b]: val };
    } else {
      next[path] = val;
    }
    return next;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanReward = (r) => {
        if (r.type === 'gym_reward') {
          if (!r.reward_id) {
            throw new Error(t('admin.referral.errorPickReward', 'Pick a reward from inventory'));
          }
          return { type: 'gym_reward', reward_id: r.reward_id };
        }
        const v = parseInt(r.value, 10);
        if (!Number.isFinite(v) || v < 0) {
          throw new Error(t('admin.referral.errorInvalidPoints', 'Invalid point value'));
        }
        return { type: 'points', value: v };
      };

      const payload = {
        ...draft,
        max_referrals_per_month: draft.max_referrals_per_month ? Number(draft.max_referrals_per_month) : null,
        referrer_reward: cleanReward(draft.referrer_reward),
        referred_reward: cleanReward(draft.referred_reward),
      };
      // .select() so an RLS-silent-fail (0 rows updated) surfaces as an error
      // instead of looking like a successful no-op.
      const { data, error } = await supabase
        .from('gyms')
        .update({ referral_config: payload, updated_at: new Date().toISOString() })
        .eq('id', gymId)
        .select('id, referral_config');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(t('admin.referral.errorRlsBlocked', 'Save was blocked — you may not have admin permission on this gym.'));
      }
      // Invalidate BOTH key shapes — fetch uses adminKeys.referrals.config,
      // older code paths used the legacy 'referral-config' key. Invalidate
      // the whole referrals namespace too so the milestones list & stats
      // pick up any cascading changes.
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals.config(gymId) });
      queryClient.invalidateQueries({ queryKey: ['admin', 'referral-config', gymId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'referrals', gymId] });
      showToast(t('admin.settings.saved', 'Saved!'), 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const rewardLabel = (r) => r ? `${r.emoji_icon || '🎁'} ${(isEs && r.name_es) ? r.name_es : r.name}` : '—';

  return (
    <FadeIn>
      <AdminCard hover className="mt-6 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Settings2 size={16} style={{ color: 'var(--color-accent)' }} />
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {t('admin.referral.sectionTitle', 'Referral program')}
            </h3>
          </div>
          <label className="flex items-center gap-2 text-[12px] font-semibold cursor-pointer" style={{ color: draft.enabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
            <input
              type="checkbox" className="sr-only"
              checked={!!draft.enabled}
              onChange={e => set('enabled', e.target.checked)}
            />
            <span>{draft.enabled ? t('admin.settings.enabled', 'Enabled') : t('admin.settings.disabled', 'Disabled')}</span>
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <RewardEditor
            label={t('admin.referral.referrerReward', 'Referrer reward')}
            reward={draft.referrer_reward}
            onChange={(r) => setReward('referrer_reward', r)}
            rewards={rewards}
            rewardLabel={rewardLabel}
            t={t}
          />
          <RewardEditor
            label={t('admin.referral.referredReward', 'Referred friend reward')}
            reward={draft.referred_reward}
            onChange={(r) => setReward('referred_reward', r)}
            rewards={rewards}
            rewardLabel={rewardLabel}
            t={t}
          />
          <div>
            <label className="block text-[11px] uppercase mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em', fontWeight: 800 }}>
              {t('admin.referral.maxPerMonth', 'Max referrals per member per month')}
            </label>
            <input
              type="number" min="0"
              value={draft.max_referrals_per_month ?? ''}
              onChange={e => set('max_referrals_per_month', e.target.value || null)}
              placeholder={t('admin.referral.unlimited', 'Unlimited')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[12px] font-medium cursor-pointer" style={{ color: 'var(--color-text-primary)' }}>
              <input
                type="checkbox"
                checked={!!draft.require_admin_approval}
                onChange={e => set('require_admin_approval', e.target.checked)}
                className="w-4 h-4 rounded"
              />
              {t('admin.referral.approvalRequired', 'Require admin approval before reward is granted')}
            </label>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
          >
            <Save size={14} />
            {saving ? t('admin.settings.saving', 'Saving...') : t('admin.settings.save', 'Save')}
          </button>
        </div>
      </AdminCard>
    </FadeIn>
  );
}
