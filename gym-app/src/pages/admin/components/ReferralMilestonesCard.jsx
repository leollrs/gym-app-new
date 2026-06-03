import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Milestone, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Save, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { AdminCard, FadeIn } from '../../../components/admin';
import RewardEditor from './RewardEditor';

/**
 * Card managing per-referral-count reward milestones (e.g. "3 referrals → $10
 * smoothie"). Writes to `referral_milestones` table whose CHECK constraint
 * enforces exactly one of (reward_id, points_amount). Originally lived in
 * AdminRewards' Performance tab; lives under Referrals now.
 */
export default function ReferralMilestonesCard({ gymId, t, isEs }) {
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
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
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
                          style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
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
