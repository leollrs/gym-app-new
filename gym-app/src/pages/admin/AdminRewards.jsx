import { useEffect, useState } from 'react';
import {
  Plus, Gift, Pencil, Trash2, ToggleLeft, ToggleRight,
  Trophy, Mail, Clock, ChevronRight, ChevronDown,
  Cake, Save,
} from 'lucide-react';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { adminKeys } from '../../lib/adminQueryKeys';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAdminAction } from '../../lib/adminAudit';
import logger from '../../lib/logger';
import posthog from 'posthog-js';
import { useAutoTranslate } from '../../hooks/useAutoTranslate';
import {
  PageHeader, AdminCard, AdminModal, FadeIn, CardSkeleton,
  SectionLabel, AdminPageShell, AdminTabs,
} from '../../components/admin';
import { typeColor, rewardKeys, REWARD_INPUT_CLASS } from './components/rewardConstants';
import RewardModal from './components/RewardModal';
import RewardLog from './components/RewardLog';
import BirthdayRewardsCard from './components/BirthdayRewardsCard';


export default function AdminRewards() {
  const { t, i18n } = useTranslation('pages');
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const gymId = profile?.gym_id;
  const isEs = i18n.language?.startsWith('es');

  const [rewardsTab, setRewardsTab] = useState('catalog');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivateNote, setDeactivateNote] = useState('');
  // State-driven delete confirm — replaces window.confirm() so we get the
  // themed modal treatment and avoid jarring native dialogs.
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // ── Queries ────────────────────────────────────────────────
  const { data: rewards = [], isLoading: loadingRewards } = useQuery({
    queryKey: rewardKeys.all(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_rewards')
        .select('*')
        .eq('gym_id', gymId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!gymId,
  });

  // ── Mutations ──────────────────────────────────────────────
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active, note }) => {
      const payload = { is_active };
      if (!is_active) {
        payload.deactivated_at = new Date().toISOString();
        payload.deactivated_note = note || null;
      } else {
        payload.deactivated_at = null;
        payload.deactivated_note = null;
      }
      const { error } = await supabase.from('gym_rewards').update(payload).eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
    },
    onSuccess: (_data, { id, is_active, note }) => {
      logAdminAction(is_active ? 'activate_reward' : 'deactivate_reward', 'reward', id, { note: note || null });
      queryClient.invalidateQueries({ queryKey: rewardKeys.all(gymId) });
      setDeactivateTarget(null);
      setDeactivateNote('');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const deleteRewardMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('gym_rewards').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
      return id;
    },
    onSuccess: (_data, id) => {
      logAdminAction('delete_reward', 'reward', id);
      queryClient.invalidateQueries({ queryKey: rewardKeys.all(gymId) });
      showToast(t('admin.rewards.deleted', 'Reward deleted'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const openAdd = () => { setEditingReward(null); setModalOpen(true); };
  const openEdit = (r) => { setEditingReward(r); setModalOpen(true); };

  const activeRewards = rewards.filter(r => r.is_active);
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;

  const rewardName = (r) => isEs && r.name_es ? r.name_es : r.name;
  const rewardDesc = (r) => isEs && r.description_es ? r.description_es : r.description;

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.rewards.title', 'Rewards')}
        subtitle={
          !loadingRewards && rewards.length > 0
            ? `${activeRewards.length} ${t('admin.rewards.active', 'active')} · ${rewards.length - activeRewards.length} ${t('admin.rewards.inactive', 'inactive')}`
            : t('admin.rewards.subtitle', 'Manage your reward catalog and referral milestones')
        }
        actions={
          rewardsTab === 'catalog' && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold text-[#D4AF37] bg-[#D4AF37]/10 border border-[#D4AF37]/25 hover:bg-[#D4AF37]/20 transition-colors"
            >
              <Plus size={14} />
              {t('admin.rewards.addReward', 'Add Reward')}
            </button>
          )
        }
      />

      {/* ── Tabs ──────────────────────────────────────────── */}
      <AdminTabs
        tabs={[
          { key: 'catalog', label: t('admin.rewards.tabCatalog', 'Catalog'), icon: Gift },
          { key: 'redemptions', label: t('admin.rewards.tabRedemptions', 'Redemptions'), icon: Clock },
          { key: 'automations', label: t('admin.rewards.tabAutomations', 'Automations'), icon: Cake },
        ]}
        active={rewardsTab}
        onChange={setRewardsTab}
        className="mb-6"
      />

      {/* ── Catalog Tab ───────────────────────────────────── */}
      {rewardsTab === 'catalog' && <>
      <span className="admin-eyebrow block mb-3">{t('admin.rewards.catalog', 'Reward Catalog')}</span>

      {loadingRewards ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 md:gap-3">
          {[1, 2, 3, 4].map(i => <CardSkeleton key={i} />)}
        </div>
      ) : rewards.length === 0 ? (
        <FadeIn>
          <AdminCard className="text-center py-12">
            <Gift size={40} className="mx-auto mb-3" style={{ color: 'var(--color-admin-text-muted)' }} />
            <p className="text-[15px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>
              {t('admin.rewards.noRewards', 'No rewards yet')}
            </p>
            <p className="text-[12px] mt-1 mb-4" style={{ color: 'var(--color-admin-text-muted)' }}>
              {t('admin.rewards.noRewardsHint', 'Add your first reward to start building your catalog.')}
            </p>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-4 py-2.5 font-bold text-[13px] rounded-xl transition-colors"
              style={{ background: 'var(--color-accent)', color: '#000' }}
            >
              <Plus size={15} /> {t('admin.rewards.addReward', 'Add Reward')}
            </button>
          </AdminCard>
        </FadeIn>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 md:gap-3">
          {rewards.map((r, idx) => {
            // Map reward_type to a tone class for emoji background tint
            const toneMap = {
              smoothie: 'info', guest_pass: 'info', merch: 'coach',
              pt_session: 'warn', free_month: 'good', class_pass: 'coach',
              discount: 'warn', bring_friend: 'coach', custom: 'info',
            };
            const tone = toneMap[r.reward_type] || 'info';
            const tintBg = tone === 'good' ? 'var(--color-success-soft)'
              : tone === 'warn' ? 'var(--color-warning-soft)'
              : tone === 'coach' ? 'var(--color-coach-soft)'
              : 'var(--color-info-soft)';
            return (
            <FadeIn key={r.id} delay={idx * 40}>
              <div className={`admin-card p-3 sm:p-4 h-full flex flex-col ${!r.is_active ? 'opacity-60' : ''}`}>
                {/* Top row: emoji icon + PTS pill */}
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0 text-[20px]"
                    style={{ background: tintBg }}
                  >
                    {r.emoji_icon || '🎁'}
                  </div>
                  {r.cost_points > 0 && (
                    <span className={`admin-pill admin-pill--${tone === 'info' ? 'info' : tone}`}>
                      {r.cost_points.toLocaleString()} {t('admin.rewards.pts', 'PTS')}
                    </span>
                  )}
                </div>

                {/* Name */}
                <div className="admin-kpi text-[15px] leading-tight" style={{ letterSpacing: '-0.15px' }}>
                  {rewardName(r)}
                </div>

                {/* Type eyebrow pill */}
                <span className="admin-pill admin-pill--outline mt-1 self-start" style={{ fontSize: '9.5px' }}>
                  {t(`admin.rewards.type_${r.reward_type}`, r.reward_type).toUpperCase()}
                </span>

                {/* Description */}
                {rewardDesc(r) && (
                  <p className="text-[12px] mt-2 leading-[1.4] line-clamp-2" style={{ color: 'var(--color-admin-text-sub)' }}>
                    {rewardDesc(r)}
                  </p>
                )}

                {/* Inactive meta */}
                {!r.is_active && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="admin-pill admin-pill--hot" style={{ fontSize: '9.5px' }}>
                      {t('admin.rewards.inactive', 'Inactive')}
                    </span>
                    {r.deactivated_at && (
                      <span className="text-[10px]" style={{ color: 'var(--color-admin-text-faint)' }}>
                        {format(new Date(r.deactivated_at), 'MMM d, yyyy', dateFnsLocale)}
                      </span>
                    )}
                  </div>
                )}

                {/* Action buttons row */}
                <div className="flex items-center gap-1.5 mt-auto pt-3">
                  <button
                    onClick={() => openEdit(r)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-colors"
                    style={{
                      background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                      color: 'var(--color-accent)',
                      border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
                    }}
                  >
                    <Pencil size={12} />
                    {t('admin.rewards.edit', 'Editar')}
                  </button>
                  <button
                    onClick={() => {
                      if (r.is_active) {
                        setDeactivateTarget(r);
                        setDeactivateNote('');
                      } else {
                        toggleActiveMutation.mutate({ id: r.id, is_active: true });
                      }
                    }}
                    className="w-9 h-9 rounded-lg grid place-items-center transition-colors flex-shrink-0"
                    style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-card)' }}
                    aria-label={r.is_active ? t('admin.rewards.deactivate', 'Deactivate') : t('admin.rewards.activate', 'Activate')}
                    title={r.is_active ? t('admin.rewards.deactivate', 'Deactivate') : t('admin.rewards.activate', 'Activate')}
                  >
                    {r.is_active
                      ? <ToggleRight size={14} style={{ color: 'var(--color-success)' }} />
                      : <ToggleLeft size={14} style={{ color: 'var(--color-admin-text-sub)' }} />}
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(r.id)}
                    className="w-9 h-9 rounded-lg grid place-items-center transition-colors flex-shrink-0"
                    style={{ border: '1px solid var(--color-admin-border)', background: 'var(--color-bg-card)' }}
                    aria-label={t('admin.rewards.deleteReward', 'Delete')}
                    title={t('admin.rewards.deleteReward', 'Delete')}
                  >
                    <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
                  </button>
                </div>
              </div>
            </FadeIn>
          );
          })}
        </div>
      )}

      </>}

      {/* ── Redemptions Tab ───────────────────────────────── */}
      {rewardsTab === 'redemptions' && <RewardLog gymId={gymId} isEs={isEs} t={t} />}

      {/* ── Automations Tab ───────────────────────────────── */}
      {rewardsTab === 'automations' && (
        <>
          <span className="admin-eyebrow block mb-3">{t('admin.rewards.automations', 'Automations')}</span>
          <BirthdayRewardsCard gymId={gymId} rewards={rewards} t={t} isEs={isEs} />
        </>
      )}

      {/* ── Reward Modal ─────────────────────────────────────── */}
      <RewardModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        gymId={gymId}
        reward={editingReward}
        t={t}
      />

      {/* ── Delete confirm modal (replaces window.confirm) ─── */}
      {deleteConfirmId && (() => {
        const target = rewards.find(r => r.id === deleteConfirmId);
        return (
          <AdminModal
            isOpen
            onClose={() => setDeleteConfirmId(null)}
            title={t('admin.rewards.deleteReward', 'Delete reward')}
            titleIcon={Trash2}
            size="sm"
            footer={
              <div className="flex gap-2 justify-end w-full">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 rounded-xl text-[13px] font-medium"
                  style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
                >
                  {t('common:cancel', 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    deleteRewardMutation.mutate(deleteConfirmId);
                    setDeleteConfirmId(null);
                  }}
                  disabled={deleteRewardMutation.isPending}
                  className="px-4 py-2 rounded-xl text-[13px] font-bold text-white disabled:opacity-50"
                  style={{ background: 'var(--color-danger)' }}
                >
                  {t('admin.rewards.deleteReward', 'Delete')}
                </button>
              </div>
            }
          >
            <div className="space-y-2">
              <p className="text-[13.5px]" style={{ color: 'var(--color-admin-text)' }}>
                {t('admin.rewards.deleteConfirm', 'Delete this reward?')}
              </p>
              {target && (
                <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
                  <span className="text-[20px]">{target.emoji_icon || '🎁'}</span>
                  <div>
                    <p className="text-[14px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{rewardName(target)}</p>
                    {target.cost_points > 0 && (
                      <p className="text-[11px]" style={{ color: 'var(--color-admin-text-muted)' }}>
                        {target.cost_points.toLocaleString()} {t('admin.rewards.pts', 'PTS')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </AdminModal>
        );
      })()}

      {/* ── Deactivate Modal ──────────────────────────────────── */}
      {deactivateTarget && (
        <AdminModal
          isOpen
          onClose={() => { setDeactivateTarget(null); setDeactivateNote(''); }}
          title={t('admin.rewards.deactivateReward', 'Deactivate Reward')}
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-[#111827] rounded-xl border border-white/6">
              <span className="text-[20px]">{deactivateTarget.emoji_icon || '🎁'}</span>
              <div>
                <p className="text-[14px] font-semibold text-[#E5E7EB]">{rewardName(deactivateTarget)}</p>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${typeColor(deactivateTarget.reward_type)}`}>
                  {t(`admin.rewards.type_${deactivateTarget.reward_type}`, deactivateTarget.reward_type)}
                </span>
              </div>
            </div>

            <p className="text-[13px] text-[#9CA3AF]">
              {t('admin.rewards.deactivateDesc', 'This reward will no longer be available for members. You can reactivate it later.')}
            </p>

            <div>
              <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">
                {t('admin.rewards.deactivateNote', 'Note (optional)')}
              </label>
              <textarea
                value={deactivateNote}
                onChange={e => setDeactivateNote(e.target.value)}
                rows={2}
                placeholder={t('admin.rewards.deactivateNotePlaceholder', 'Reason for deactivating...')}
                className={REWARD_INPUT_CLASS + ' resize-none'}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setDeactivateTarget(null); setDeactivateNote(''); }}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-[#9CA3AF] bg-white/[0.04] hover:bg-white/[0.06] transition-colors"
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                onClick={() => toggleActiveMutation.mutate({ id: deactivateTarget.id, is_active: false, note: deactivateNote.trim() })}
                disabled={toggleActiveMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {toggleActiveMutation.isPending ? '...' : t('admin.rewards.deactivate', 'Deactivate')}
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </AdminPageShell>
  );
}
