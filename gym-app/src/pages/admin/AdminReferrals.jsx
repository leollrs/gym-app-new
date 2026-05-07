import { useState, useEffect } from 'react';
import { Gift, Users, TrendingUp, CheckCircle, Clock, XCircle, Search, Download, Eye, ChevronDown, Save, Settings2, Milestone, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useTranslation } from 'react-i18next';
import { PageHeader, AdminCard, FadeIn, CardSkeleton, AdminPageShell, StatCard } from '../../components/admin';

const PERIODS = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: null },
];

const STATUS_TONE = {
  pending: 'warn',
  completed: 'good',
  expired: 'hot',
};

function StatusBadge({ status, t }) {
  const tone = STATUS_TONE[status] || 'warn';
  return (
    <span className={`admin-pill admin-pill--${tone}`}>
      {t(`admin.referrals.status.${status}`, status)}
    </span>
  );
}

function AvatarInitial({ name }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
      style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}
    >
      {initial}
    </div>
  );
}

// ── Referral Program Config (moved from AdminSettings) ─────
const DEFAULT_REFERRAL_CONFIG = {
  enabled: true,
  approval_required: true,
  max_per_month: null,
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
  // points (default)
  const v = r.value ?? r.points ?? 0;
  return { type: 'points', value: Number(v) || 0 };
}

// Shared editor: pick "Points" (numeric) or "From inventory" (gym_rewards row).
// Used by both ReferralProgramConfig (referrer/referred) and ReferralMilestonesCard.
function RewardEditor({ label, reward, onChange, rewards, rewardLabel, t, compact = false }) {
  const type = reward?.type === 'gym_reward' ? 'gym_reward' : 'points';
  const inputBase = {
    background: 'var(--color-bg-deep)',
    border: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-primary)',
  };
  const padCls = compact ? 'px-3 py-2' : 'px-3 py-2.5';

  return (
    <div>
      {label && (
        <label className="block text-[11px] uppercase mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em', fontWeight: 800 }}>
          {label}
        </label>
      )}
      <div className="flex flex-col gap-1.5">
        <select
          value={type}
          onChange={(e) => {
            const nextType = e.target.value;
            if (nextType === 'gym_reward') {
              onChange({ type: 'gym_reward', reward_id: reward?.reward_id || '' });
            } else {
              onChange({ type: 'points', value: Number(reward?.value) || 0 });
            }
          }}
          className={`w-full rounded-xl ${padCls} text-[13px] outline-none`}
          style={inputBase}
        >
          <option value="points">{t('admin.referral.typePoints', 'Points')}</option>
          <option value="gym_reward">{t('admin.referral.typeGymReward', 'From inventory')}</option>
        </select>

        {type === 'points' ? (
          <input
            type="number" min="0"
            value={reward?.value ? String(reward.value) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange({ type: 'points', value: 0 });
                return;
              }
              const n = parseInt(raw, 10);
              onChange({ type: 'points', value: Number.isFinite(n) ? n : 0 });
            }}
            placeholder={t('admin.referral.pointsPlaceholder', 'e.g. 250')}
            className={`w-full rounded-xl ${padCls} text-[13px] outline-none`}
            style={inputBase}
          />
        ) : (
          <select
            value={reward?.reward_id || ''}
            onChange={(e) => onChange({ type: 'gym_reward', reward_id: e.target.value })}
            className={`w-full rounded-xl ${padCls} text-[13px] outline-none`}
            style={inputBase}
          >
            <option value="">{t('admin.referrals.selectReward', 'Select reward...')}</option>
            {(rewards || []).map((r) => (
              <option key={r.id} value={r.id}>{rewardLabel(r)}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ReferralProgramConfig({ gymId, config, t, isEs }) {
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
        max_per_month: draft.max_per_month ? Number(draft.max_per_month) : null,
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
              value={draft.max_per_month ?? ''}
              onChange={e => set('max_per_month', e.target.value || null)}
              placeholder={t('admin.referral.unlimited', 'Unlimited')}
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[12px] font-medium cursor-pointer" style={{ color: 'var(--color-text-primary)' }}>
              <input
                type="checkbox"
                checked={!!draft.approval_required}
                onChange={e => set('approval_required', e.target.checked)}
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

// ── Referral Milestones (moved from AdminRewards Performance tab) ──
function ReferralMilestonesCard({ gymId, t, isEs }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const milestonesKey = ['admin', 'referrals', gymId, 'milestones'];

  const [count, setCount] = useState('');
  const [newReward, setNewReward] = useState({ type: 'points', value: 250 });
  const [editingId, setEditingId] = useState(null);
  const [editCount, setEditCount] = useState('');
  const [editReward, setEditReward] = useState({ type: 'points', value: 0 });

  // Active rewards (for the picker)
  const { data: rewards = [] } = useQuery({
    queryKey: ['admin', 'rewards', gymId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_rewards')
        .select('id, name, name_es, emoji_icon, is_active')
        .eq('gym_id', gymId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // Milestones list
  const { data: milestones = [], isLoading } = useQuery({
    queryKey: milestonesKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_milestones')
        .select('*, gym_rewards(name, name_es, emoji_icon)')
        .eq('gym_id', gymId)
        .order('referral_count', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  const rewardLabel = (r) => r ? `${r.emoji_icon || '🎁'} ${(isEs && r.name_es) ? r.name_es : r.name}` : '—';

  // Build a referral_milestones row from a {type,value|reward_id} reward.
  // DB CHECK constraint enforces exactly one of (reward_id, points_amount).
  const milestoneRowFromReward = (r) => {
    if (r.type === 'gym_reward') {
      if (!r.reward_id) throw new Error(t('admin.referrals.errorSelectReward', 'Select a reward'));
      return { reward_id: r.reward_id, points_amount: null };
    }
    const v = parseInt(r.value, 10);
    if (!Number.isFinite(v) || v < 1) {
      throw new Error(t('admin.referral.errorInvalidPoints', 'Invalid point value'));
    }
    return { reward_id: null, points_amount: v };
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const n = parseInt(count, 10);
      if (!n || n < 1) throw new Error(t('admin.referrals.errorInvalidCount', 'Invalid referral count'));
      const row = milestoneRowFromReward(newReward);
      const { error } = await supabase.from('referral_milestones').insert({
        gym_id: gymId,
        referral_count: n,
        ...row,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestonesKey });
      setCount(''); setNewReward({ type: 'points', value: 250 });
      showToast(t('admin.referrals.milestoneAdded', 'Milestone added'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }) => {
      const { error } = await supabase
        .from('referral_milestones')
        .update({ is_active })
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milestonesKey }),
    onError: (err) => showToast(err.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const n = parseInt(editCount, 10);
      if (!n || n < 1) throw new Error(t('admin.referrals.errorInvalidCount', 'Invalid referral count'));
      const row = milestoneRowFromReward(editReward);
      const { error } = await supabase
        .from('referral_milestones')
        .update({ referral_count: n, ...row })
        .eq('id', editingId)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestonesKey });
      setEditingId(null); setEditCount(''); setEditReward({ type: 'points', value: 0 });
      showToast(t('admin.referrals.milestoneUpdated', 'Milestone updated'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('referral_milestones')
        .delete()
        .eq('id', id)
        .eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestonesKey });
      showToast(t('admin.referrals.milestoneDeleted', 'Milestone deleted'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditCount(String(m.referral_count));
    if (m.reward_id) {
      setEditReward({ type: 'gym_reward', reward_id: m.reward_id });
    } else {
      setEditReward({ type: 'points', value: m.points_amount ?? 0 });
    }
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditCount('');
    setEditReward({ type: 'points', value: 0 });
  };

  return (
    <FadeIn>
      <AdminCard hover className="mt-6 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <Milestone size={16} style={{ color: 'var(--color-accent)' }} />
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {t('admin.referrals.milestonesTitle', 'Referral milestones')}
          </h3>
        </div>
        <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.referrals.milestonesDesc', 'Reward members automatically when they hit a referral count.')}
        </p>

        {/* Add row */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 sm:gap-3 pb-4 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="w-full sm:w-28">
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.referrals.referralCount', 'Referrals')}
            </label>
            <input
              type="number" min="1"
              value={count}
              onChange={e => setCount(e.target.value)}
              placeholder="3"
              className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none"
              style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.referrals.selectReward', 'Reward')}
            </label>
            <RewardEditor
              reward={newReward}
              onChange={setNewReward}
              rewards={rewards}
              rewardLabel={rewardLabel}
              t={t}
            />
          </div>
          <button
            onClick={() => addMutation.mutate()}
            disabled={
              addMutation.isPending
              || !count
              || (newReward.type === 'gym_reward' ? !newReward.reward_id : !(parseInt(newReward.value, 10) > 0))
            }
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
          >
            <Plus size={14} />
            {t('admin.referrals.addMilestone', 'Add')}
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="py-6 text-center text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{t('common:loading', 'Loading…')}</div>
        ) : milestones.length === 0 ? (
          <div className="py-8 text-center">
            <Milestone size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
            <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.referrals.noMilestones', 'No referral milestones configured yet.')}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
            {milestones.map(m => {
              const isEditing = editingId === m.id;
              const rw = m.gym_rewards;
              return (
                <div key={m.id} className="py-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  {isEditing ? (
                    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                      <input
                        type="number" min="1"
                        value={editCount}
                        onChange={e => setEditCount(e.target.value)}
                        className="w-full sm:w-28 rounded-xl px-3 py-2 text-[13px] outline-none"
                        style={{ background: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                      />
                      <div className="flex-1 min-w-0">
                        <RewardEditor
                          reward={editReward}
                          onChange={setEditReward}
                          rewards={rewards}
                          rewardLabel={rewardLabel}
                          t={t}
                          compact
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateMutation.mutate()}
                          disabled={updateMutation.isPending}
                          className="px-3 py-2 rounded-xl text-[12px] font-semibold disabled:opacity-50"
                          style={{ background: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
                        >
                          <Save size={12} className="inline mr-1" />
                          {t('admin.referrals.save', 'Save')}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-2 rounded-xl text-[12px] font-medium"
                          style={{ background: 'var(--color-bg-deep)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-3 ${!m.is_active ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-[14px] font-bold tabular-nums w-8 text-right" style={{ color: 'var(--color-accent)' }}>
                          {m.referral_count}
                        </span>
                        <span className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                          {t('admin.referrals.referralsNeeded', 'referrals')}
                        </span>
                        <span className="text-[12px] mx-1" style={{ color: 'var(--color-text-muted)' }}>→</span>
                        {m.points_amount ? (
                          <>
                            <span className="text-[15px]">⭐</span>
                            <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                              +{m.points_amount} {t('admin.referrals.pointsLabel', 'pts')}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-[15px]">{rw?.emoji_icon || '🎁'}</span>
                            <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                              {(isEs && rw?.name_es) ? rw.name_es : (rw?.name || t('admin.referrals.unknownReward', 'Unknown'))}
                            </span>
                          </>
                        )}
                        {!m.is_active && (
                          <span className="admin-pill admin-pill--hot" style={{ fontSize: '9.5px' }}>
                            {t('admin.referrals.inactive', 'Inactive')}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => toggleActiveMutation.mutate({ id: m.id, is_active: !m.is_active })}
                        className="w-8 h-8 rounded-lg grid place-items-center transition-colors"
                        style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
                        aria-label={m.is_active ? t('admin.referrals.deactivate', 'Deactivate') : t('admin.referrals.activate', 'Activate')}
                        title={m.is_active ? t('admin.referrals.deactivate', 'Deactivate') : t('admin.referrals.activate', 'Activate')}
                      >
                        {m.is_active
                          ? <ToggleRight size={14} style={{ color: 'var(--color-success)' }} />
                          : <ToggleLeft size={14} style={{ color: 'var(--color-text-muted)' }} />}
                      </button>
                      <button
                        onClick={() => startEdit(m)}
                        className="w-8 h-8 rounded-lg grid place-items-center transition-colors"
                        style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
                        aria-label={t('admin.referrals.editMilestone', 'Edit milestone')}
                        title={t('admin.referrals.editMilestone', 'Edit')}
                      >
                        <Pencil size={13} style={{ color: 'var(--color-text-muted)' }} />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(t('admin.referrals.deleteConfirm', 'Delete this milestone?'))) {
                            deleteMutation.mutate(m.id);
                          }
                        }}
                        className="w-8 h-8 rounded-lg grid place-items-center transition-colors"
                        style={{ border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-card)' }}
                        aria-label={t('admin.referrals.deleteMilestone', 'Delete milestone')}
                      >
                        <Trash2 size={13} style={{ color: 'var(--color-danger)' }} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>
    </FadeIn>
  );
}

export default function AdminReferrals() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;

  const isEs = i18n.language?.startsWith('es');
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  const [period, setPeriod] = useState(PERIODS[1]);
  const [search, setSearch] = useState('');
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);

  useEffect(() => { document.title = t('admin.referrals.pageTitle', 'Referrals · Admin'); }, [t]);

  // Fetch referral config from gyms.referral_config JSONB column
  const { data: config } = useQuery({
    queryKey: adminKeys.referrals?.config?.(gymId) ?? ['admin', 'referral-config', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('gyms')
        .select('referral_config')
        .eq('id', gymId)
        .single();
      return data?.referral_config ?? null;
    },
    enabled: !!gymId,
  });

  // Fetch referrals
  const { data: referrals = [], isLoading } = useQuery({
    queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId, period.key],
    queryFn: async () => {
      let query = supabase
        .from('referrals')
        .select('*, referrer:profiles!referrals_referrer_id_fkey(id, full_name, avatar_url, avatar_type, avatar_value), referred:profiles!referrals_referred_id_fkey(id, full_name)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false });

      if (period.days) {
        query = query.gte('created_at', subDays(new Date(), period.days).toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter(r => r.referrer);
    },
    enabled: !!gymId,
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (referralId) => {
      const { error } = await supabase
        .from('referrals')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId] });
      toast(t('admin.referrals.approvedToast', 'Referral approved'), 'success');
    },
    onError: () => toast(t('admin.referrals.approveFailedToast', 'Failed to approve referral'), 'error'),
  });

  // Reject mutation — record expired_at so historical audit can answer "when was this rejected?".
  const rejectMutation = useMutation({
    mutationFn: async (referralId) => {
      const { error } = await supabase
        .from('referrals')
        .update({ status: 'expired', expired_at: new Date().toISOString() })
        .eq('id', referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.referrals?.all?.(gymId) ?? ['admin', 'referrals', gymId] });
      toast(t('admin.referrals.rejectedToast', 'Referral rejected'), 'success');
    },
    onError: () => toast(t('admin.referrals.rejectFailedToast', 'Failed to reject referral'), 'error'),
  });

  // Self-referral filter applied to ALL metrics + lists (not just leaderboard).
  // A self-referral is when `referrer.id === referred.id`. The DB doesn't reject these
  // server-side yet, so we filter consistently on the client for honest counts.
  const validReferrals = referrals.filter(r => !r.referrer?.id || r.referrer.id !== r.referred?.id);

  // Computed stats — based on validReferrals, NOT raw `referrals`.
  const total = validReferrals.length;
  const completed = validReferrals.filter(r => r.status === 'completed').length;
  const pending = validReferrals.filter(r => r.status === 'pending').length;
  const pointsAwarded = validReferrals
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.points_awarded || 0), 0);

  // Top referrers — already filtered self-referrals; now also reads from validReferrals.
  const topReferrers = Object.values(
    validReferrals
      .filter(r => r.status === 'completed' && r.referrer?.id)
      .reduce((acc, r) => {
        const id = r.referrer?.id;
        if (!id) return acc;
        if (!acc[id]) acc[id] = { ...r.referrer, count: 0 };
        acc[id].count++;
        return acc;
      }, {})
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Pending approval list (still excludes self-referrals).
  const pendingApproval = validReferrals.filter(r => r.status === 'pending');

  // Search filter
  const filtered = validReferrals.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.referrer?.full_name?.toLowerCase().includes(q) ||
      r.referred?.full_name?.toLowerCase().includes(q)
    );
  });

  // CSV export — uses the shared exportCSV helper so values get formula-prefix
  // sanitization + proper escaping for embedded commas/quotes/newlines.
  const handleExportCSV = async () => {
    const { exportCSV } = await import('../../lib/csvExport');
    await exportCSV({
      filename: 'referrals',
      columns: [
        { key: 'referrer', label: t('admin.referrals.csvReferrer', 'Referrer') },
        { key: 'referred', label: t('admin.referrals.csvReferred', 'Referred') },
        { key: 'status',   label: t('admin.referrals.csvStatus', 'Status') },
        { key: 'date',     label: t('admin.referrals.csvDate', 'Date') },
        { key: 'points',   label: t('admin.referrals.csvPoints', 'Points') },
      ],
      data: filtered.map(r => ({
        referrer: r.referrer?.full_name || '',
        referred: r.referred?.full_name || '',
        status:   r.status,
        date:     format(new Date(r.created_at), 'yyyy-MM-dd'),
        points:   r.points_awarded || 0,
      })),
    });
  };

  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <AdminPageShell>
      <PageHeader title={t('admin.referrals.title', 'Referrals')} subtitle={t('admin.referrals.subtitle', 'Track and manage member referrals')} />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mt-6 mb-4">
        <StatCard label={t('admin.referrals.totalReferrals', 'Total Referrals')} value={total} icon={Gift} borderColor="var(--color-accent)" delay={0} />
        <StatCard label={t('admin.referrals.completed', 'Completed')} value={completed} icon={CheckCircle} borderColor="var(--color-success)" delay={30} />
        <StatCard label={t('admin.referrals.pending', 'Pending')} value={pending} icon={Clock} borderColor="var(--color-warning)" delay={60} />
        <StatCard label={t('admin.referrals.pointsAwarded', 'Points Awarded')} value={pointsAwarded} icon={TrendingUp} borderColor="var(--color-coach)" delay={90} />
      </div>

      {/* Filters Row */}
      <div className="flex flex-col md:flex-row gap-2.5 mb-4 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] w-full md:w-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-admin-text-muted)' }} />
          <input
            type="text"
            placeholder={t('admin.referrals.searchByName')}
            aria-label={t('admin.referrals.searchByName')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-[10px] pl-9 pr-4 py-2 text-[13px] outline-none"
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-admin-border)',
              color: 'var(--color-admin-text)',
            }}
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:overflow-visible">
          {/* Period filter as pills */}
          <div className="flex gap-1.5 flex-shrink-0 md:flex-wrap">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p)}
                className={`admin-pill flex-shrink-0 ${period.key === p.key ? 'admin-pill--dark' : 'admin-pill--outline'}`}
                style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {t(`admin.referrals.period.${p.key}`, p.key)}
              </button>
            ))}
          </div>

          {/* Export */}
          <button
            onClick={handleExportCSV}
            disabled={isLoading || !filtered.length}
            className="admin-pill admin-pill--outline flex items-center gap-1.5 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ padding: '0 16px', fontSize: 12, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Download size={12} />
            {t('admin.referrals.export', 'Export')}
          </button>
        </div>
      </div>

      {/* Approval Queue */}
      {config?.require_admin_approval && pendingApproval.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowApprovalQueue(!showApprovalQueue)}
            className="flex items-center gap-2 mb-3"
          >
            <span className="text-[14px] font-bold text-[#E5E7EB]">
              {t('admin.referrals.approvalQueue', 'Approval Queue')}
            </span>
            <span className="bg-amber-500/15 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
              {pendingApproval.length}
            </span>
            <ChevronDown
              size={14}
              className={`text-[#6B7280] transition-transform ${showApprovalQueue ? 'rotate-180' : ''}`}
            />
          </button>

          {showApprovalQueue && (
            <div className="space-y-2 mb-6">
              {pendingApproval.map((ref, idx) => (
                <FadeIn key={ref.id} delay={idx * 40}>
                  <AdminCard hover>
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <AvatarInitial name={ref.referrer?.full_name} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#E5E7EB] truncate">
                            {ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            {t('admin.referrals.referred', 'referred')} {ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => approveMutation.mutate(ref.id)}
                          disabled={approveMutation.isPending}
                          className="bg-emerald-500/15 text-emerald-400 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-500/25 transition-colors"
                        >
                          {t('admin.referrals.approve', 'Approve')}
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(ref.id)}
                          disabled={rejectMutation.isPending}
                          className="bg-red-500/15 text-red-400 text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-red-500/25 transition-colors"
                        >
                          {t('admin.referrals.reject', 'Reject')}
                        </button>
                      </div>
                    </div>
                  </AdminCard>
                </FadeIn>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Two-col: All Referrals + Top Referrers */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1fr] gap-4">
        {/* Referral List */}
        <div className="admin-card overflow-hidden" style={{ padding: 0 }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
            <span className="text-[13.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.referrals.allReferrals', 'All Referrals')}
            </span>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <Gift size={28} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {search ? t('admin.referrals.noSearchResults', 'No referrals match your search') : t('admin.referrals.noReferrals', 'No referrals yet')}
              </p>
            </div>
          ) : (
            filtered.map((ref, idx) => (
              <FadeIn key={ref.id} delay={idx * 40}>
                <div
                  className="flex items-center gap-3 px-[18px] py-[14px]"
                  style={{ borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--color-admin-border)' }}
                >
                  <div className="w-[30px] h-[30px]">
                    <AvatarInitial name={ref.referrer?.full_name} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
                        {ref.referrer?.full_name || t('admin.referrals.unknown', 'Unknown')}
                      </span>
                      <span className="text-[12px]" style={{ color: 'var(--color-admin-text-muted)' }}>→</span>
                      <span className="text-[13px]" style={{ color: 'var(--color-admin-text-sub)' }}>
                        {ref.referred?.full_name || t('admin.referrals.unknown', 'Unknown')}
                      </span>
                    </div>
                    <div className="text-[11.5px] mt-[2px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                      {formatDistanceToNow(new Date(ref.created_at), { addSuffix: true, ...dateFnsLocale })}
                      {ref.points_awarded > 0 && ` · +${ref.points_awarded} pts`}
                    </div>
                  </div>
                  <StatusBadge status={ref.status} t={t} />
                </div>
              </FadeIn>
            ))
          )}
        </div>

        {/* Top Referrers */}
        <div className="admin-card overflow-hidden" style={{ padding: 0 }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-admin-border)' }}>
            <Users size={14} style={{ color: 'var(--color-accent)' }} />
            <span className="text-[13.5px] font-bold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.referrals.topReferrers', 'Top Referrers')}
            </span>
          </div>

          {topReferrers.length === 0 ? (
            <div className="p-8 text-center">
              <Users size={24} className="mx-auto mb-2" style={{ color: 'var(--color-admin-text-muted)' }} />
              <p className="text-[13px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                {t('admin.referrals.noReferrers', 'No top referrers yet')}
              </p>
            </div>
          ) : (
            topReferrers.map((member, idx) => (
              <FadeIn key={member.id} delay={idx * 40}>
                <div
                  className="flex items-center gap-3 px-[18px] py-[13px]"
                  style={{ borderBottom: idx === topReferrers.length - 1 ? 'none' : '1px solid var(--color-admin-border)' }}
                >
                  <span className="text-[18px] w-6 text-center shrink-0">
                    {idx < 3 ? MEDALS[idx] : (
                      <span className="text-[13px] font-bold" style={{ color: 'var(--color-admin-text-muted)' }}>{idx + 1}</span>
                    )}
                  </span>
                  <AvatarInitial name={member.full_name} />
                  <span className="flex-1 text-[13px] font-bold truncate" style={{ color: 'var(--color-admin-text)' }}>
                    {member.full_name || t('admin.referrals.unknown', 'Unknown')}
                  </span>
                  <span className="admin-pill" style={{ background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
                    {member.count} {member.count === 1 ? t('admin.referrals.referralSingular', 'referral') : t('admin.referrals.referralPlural', 'referrals')}
                  </span>
                </div>
              </FadeIn>
            ))
          )}
        </div>
      </div>

      {/* Referral program configuration (moved from Settings) */}
      <ReferralProgramConfig gymId={gymId} config={config} t={t} isEs={isEs} />

      {/* Referral milestones (moved from Rewards Performance tab) */}
      <ReferralMilestonesCard gymId={gymId} t={t} isEs={isEs} />
    </AdminPageShell>
  );
}
