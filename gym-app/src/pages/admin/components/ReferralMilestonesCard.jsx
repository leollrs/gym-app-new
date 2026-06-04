import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { FadeIn } from '../../../components/admin';
import RewardEditor from './RewardEditor';
import { TK, FK, Ico, ICON, Card, IconChip, Pill } from './retosKit';

const fieldLabel = {
  display: 'block', fontFamily: FK.body, fontSize: 11, fontWeight: 800,
  letterSpacing: 1.1, textTransform: 'uppercase', color: TK.textMute, marginBottom: 9,
};
const numInput = {
  width: '100%', padding: '13px 15px', borderRadius: 12, background: TK.surface,
  border: `1px solid ${TK.borderSolid}`, fontFamily: FK.display, fontSize: 16, fontWeight: 800,
  color: TK.text, letterSpacing: -0.3, outline: 'none',
};
const squareBtn = { width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 };

/**
 * Card managing per-referral-count reward milestones (e.g. "3 referrals → $10
 * smoothie"). Writes to `referral_milestones` table whose CHECK constraint
 * enforces exactly one of (reward_id, points_amount). Restyled onto the
 * Referidos design system.
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

  const addDisabled = addMutation.isPending
    || !count
    || (newReward.type === 'gym_reward' ? !newReward.reward_id : !(parseInt(newReward.value, 10) > 0));

  // reward display element for a saved milestone row
  const RewardCell = ({ m }) => {
    const rw = m.gym_rewards;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <span style={{ width: 26, height: 26, borderRadius: 99, background: TK.accentSoft, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Ico ch={m.points_amount ? ICON.star : ICON.gift} size={14} color={TK.accent} stroke={2} />
        </span>
        {m.points_amount ? (
          <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, letterSpacing: -0.3, whiteSpace: 'nowrap' }}>
            +{m.points_amount} {t('admin.referrals.pointsLabel', 'pts')}
          </span>
        ) : (
          <span style={{ fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {(isEs && rw?.name_es) ? rw.name_es : (rw?.name || t('admin.referrals.unknownReward', 'Unknown'))}
          </span>
        )}
      </span>
    );
  };

  return (
    <FadeIn>
      <Card style={{ overflow: 'hidden' }}>
        {/* header + add row */}
        <div style={{ padding: '20px 24px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <IconChip ch={ICON.signpost} tone="accent" size={38} r={11} strokeW={2} />
            <div>
              <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>
                {t('admin.referrals.milestonesTitle', 'Referral milestones')}
              </div>
              <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 3 }}>
                {t('admin.referrals.milestonesDesc', 'Reward members automatically when they hit a referral count.')}
              </div>
            </div>
          </div>

          {/* add row */}
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4 sm:items-start" style={{ marginTop: 20 }}>
            <div>
              <span style={fieldLabel}>{t('admin.referrals.referralCount', 'Referrals')}</span>
              <input
                type="number" min="1"
                value={count}
                onChange={e => setCount(e.target.value)}
                placeholder="3"
                style={numInput}
              />
            </div>
            <RewardEditor reward={newReward} onChange={setNewReward} rewards={rewards} rewardLabel={rewardLabel} t={t} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              type="button"
              onClick={() => addMutation.mutate()}
              disabled={addDisabled}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12,
                cursor: addDisabled ? 'default' : 'pointer', border: 'none', background: TK.accent, color: '#fff',
                fontFamily: FK.body, fontSize: 14, fontWeight: 700, opacity: addDisabled ? 0.45 : 1,
                boxShadow: addDisabled ? 'none' : '0 2px 10px color-mix(in srgb, var(--color-accent) 32%, transparent)',
              }}
            >
              <Ico ch={ICON.plus} size={16} color="#fff" stroke={2.6} />{t('admin.referrals.addMilestone', 'Add')}
            </button>
          </div>
        </div>

        {/* list */}
        {isLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', fontFamily: FK.body, fontSize: 13, color: TK.textMute, borderTop: `1px solid ${TK.divider}` }}>
            {t('common:loading', 'Loading…')}
          </div>
        ) : milestones.length === 0 ? (
          <div style={{ padding: '36px 24px', textAlign: 'center', borderTop: `1px solid ${TK.divider}` }}>
            <Ico ch={ICON.signpost} size={28} color={TK.textFaint} stroke={1.6} style={{ margin: '0 auto 10px' }} />
            <p style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, margin: 0 }}>
              {t('admin.referrals.noMilestones', 'No referral milestones configured yet.')}
            </p>
          </div>
        ) : (
          milestones.map((m) => {
            const isEditing = editingId === m.id;
            if (isEditing) {
              return (
                <div key={m.id} style={{ padding: '16px 22px', borderTop: `1px solid ${TK.divider}` }}>
                  <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4 sm:items-start">
                    <div>
                      <span style={fieldLabel}>{t('admin.referrals.referralCount', 'Referrals')}</span>
                      <input type="number" min="1" value={editCount} onChange={e => setEditCount(e.target.value)} style={numInput} />
                    </div>
                    <RewardEditor reward={editReward} onChange={setEditReward} rewards={rewards} rewardLabel={rewardLabel} t={t} compact />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                    <button type="button" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: TK.accent, color: '#fff', fontFamily: FK.body, fontSize: 13, fontWeight: 700, opacity: updateMutation.isPending ? 0.6 : 1 }}>
                      <Ico ch={ICON.check} size={14} color="#fff" stroke={2.4} />{t('admin.referrals.save', 'Save')}
                    </button>
                    <button type="button" onClick={cancelEdit}
                      style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 10, cursor: 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                      <Ico ch={ICON.x} size={15} color={TK.textMute} stroke={2.2} />
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 22px', borderTop: `1px solid ${TK.divider}`, opacity: m.is_active ? 1 : 0.55 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: TK.accentSoft, border: `1px solid ${TK.accentLine}`, fontFamily: FK.display, fontSize: 15, fontWeight: 800, color: TK.accentInk }}>
                    {m.referral_count}
                  </span>
                  <span style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 600, color: TK.textMute }} className="hidden sm:inline">
                    {t('admin.referrals.referralsNeeded', 'referrals')}
                  </span>
                </span>
                <Ico ch={ICON.arrowR} size={17} color={TK.textFaint} stroke={2} />
                <div style={{ flex: 1, minWidth: 0 }}><RewardCell m={m} /></div>
                {!m.is_active && <Pill tone="hot">{t('admin.referrals.inactive', 'Inactive')}</Pill>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                  <button type="button" onClick={() => toggleActiveMutation.mutate({ id: m.id, is_active: !m.is_active })}
                    title={m.is_active ? t('admin.referrals.deactivate', 'Deactivate') : t('admin.referrals.activate', 'Activate')}
                    aria-label={m.is_active ? t('admin.referrals.deactivate', 'Deactivate') : t('admin.referrals.activate', 'Activate')}
                    style={{ ...squareBtn, background: m.is_active ? 'var(--color-success-soft)' : TK.surface2, border: `1px solid ${m.is_active ? 'color-mix(in srgb, var(--color-success) 32%, transparent)' : TK.borderSolid}` }}>
                    <span style={{ width: 22, height: 13, borderRadius: 99, background: m.is_active ? 'var(--color-success)' : TK.textFaint, position: 'relative', display: 'inline-block' }}>
                      <span style={{ position: 'absolute', top: 1.5, left: m.is_active ? 11 : 1.5, width: 10, height: 10, borderRadius: 99, background: '#fff', transition: 'left .15s' }} />
                    </span>
                  </button>
                  <button type="button" onClick={() => startEdit(m)}
                    title={t('admin.referrals.editMilestone', 'Edit')} aria-label={t('admin.referrals.editMilestone', 'Edit milestone')}
                    style={{ ...squareBtn, background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
                    <Ico ch={ICON.edit} size={15} color={TK.textSub} stroke={2} />
                  </button>
                  <button type="button"
                    onClick={() => { if (window.confirm(t('admin.referrals.deleteConfirm', 'Delete this milestone?'))) deleteMutation.mutate(m.id); }}
                    title={t('admin.referrals.deleteMilestone', 'Delete milestone')} aria-label={t('admin.referrals.deleteMilestone', 'Delete milestone')}
                    style={{ ...squareBtn, background: TK.surface, border: `1px solid ${TK.borderSolid}` }}>
                    <Ico ch={ICON.trash} size={15} color="var(--color-danger)" stroke={2} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </FadeIn>
  );
}
