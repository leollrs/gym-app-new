import { useState } from 'react';
import { format } from 'date-fns';
import { es as esLocale } from 'date-fns/locale/es';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { logAdminAction } from '../../lib/adminAudit';
import { AdminModal, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import { typeColor, rewardKeys, REWARD_INPUT_CLASS } from './components/rewardConstants';
import RewardModal from './components/RewardModal';
import RewardLog from './components/RewardLog';
import BirthdayRewardsCard from './components/BirthdayRewardsCard';
import { TK, FK, TONE, Ico, ICON, Card, IconChip, Pill, PrimaryBtn } from './components/retosKit';
import { RewardSymbol } from '../../lib/rewardSymbols';

// reward_type → tone + line icon (fallback when a reward has no emoji)
const REWARD_VISUAL = {
  smoothie:     { tone: 'good',  icon: ICON.gift },
  guest_pass:   { tone: 'info',  icon: ICON.ticket },
  merch:        { tone: 'coach', icon: ICON.gift },
  pt_session:   { tone: 'warn',  icon: ICON.star },
  free_month:   { tone: 'good',  icon: ICON.ticket },
  class_pass:   { tone: 'coach', icon: ICON.ticket },
  discount:     { tone: 'warn',  icon: ICON.tag },
  bring_friend: { tone: 'coach', icon: ICON.users },
  custom:       { tone: 'accent', icon: ICON.gift },
};
const visualFor = (type) => REWARD_VISUAL[type] || REWARD_VISUAL.custom;

const eyebrow = { fontFamily: FK.body, fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', color: TK.textFaint };

const SectLabel = ({ icon, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '26px 0 16px' }}>
    {icon && <Ico ch={icon} size={15} color={TK.textFaint} stroke={2} />}
    <span style={eyebrow}>{children}</span>
  </div>
);

// square switch button (active = green)
function RewardToggle({ active, onClick, title }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} style={{
      width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
      background: active ? 'var(--color-success-soft)' : TK.surface,
      border: `1px solid ${active ? 'color-mix(in srgb, var(--color-success) 35%, transparent)' : TK.borderSolid}`,
    }}>
      <span style={{ width: 26, height: 15, borderRadius: 99, background: active ? 'var(--color-success)' : TK.surface3, position: 'relative', display: 'inline-block' }}>
        <span style={{ position: 'absolute', top: 1.5, left: active ? 12.5 : 1.5, width: 12, height: 12, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s' }} />
      </span>
    </button>
  );
}

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

  const TABS = [
    { key: 'catalog', label: t('admin.rewards.tabCatalog', 'Catalog'), icon: ICON.gift },
    { key: 'redemptions', label: t('admin.rewards.tabRedemptions', 'Redemptions'), icon: ICON.clock },
    { key: 'automations', label: t('admin.rewards.tabAutomations', 'Automations'), icon: ICON.cake },
  ];

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.rewards.title', 'Rewards')}</h1>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 11, fontFamily: FK.body, fontSize: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: TK.textSub }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--color-success)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-success) 18%, transparent)' }} />
              <b style={{ color: TK.text, fontWeight: 700 }}>{activeRewards.length}</b> {t('admin.rewards.active', 'active')}
            </span>
            <span style={{ width: 4, height: 4, borderRadius: 99, background: TK.textFaint }} />
            <span style={{ color: TK.textMute }}><b style={{ color: TK.textSub, fontWeight: 700 }}>{rewards.length - activeRewards.length}</b> {t('admin.rewards.inactive', 'inactive')}</span>
          </div>
        </div>
        <PrimaryBtn icon={ICON.plus} onClick={openAdd}>{t('admin.rewards.addReward', 'Add Reward')}</PrimaryBtn>
      </div>

      {/* icon tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderBottom: `1px solid ${TK.borderSolid}`, marginTop: 22 }}>
        {TABS.map(tb => {
          const on = rewardsTab === tb.key;
          return (
            <button key={tb.key} type="button" onClick={() => setRewardsTab(tb.key)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 0 16px', position: 'relative', cursor: 'pointer', background: 'transparent', border: 'none' }}>
              <Ico ch={tb.icon} size={19} color={on ? TK.accent : TK.textMute} stroke={on ? 2.1 : 1.9} />
              <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: on ? 700 : 600, color: on ? TK.accent : TK.textMute }}>{tb.label}</span>
              {on && <span style={{ position: 'absolute', left: '34%', right: '34%', bottom: -1, height: 2.5, borderRadius: 99, background: TK.accent }} />}
            </button>
          );
        })}
      </div>

      {/* ── Catalog ── */}
      {rewardsTab === 'catalog' && <>
        <SectLabel icon={ICON.gift}>{t('admin.rewards.catalog', 'Reward Catalog')}</SectLabel>
        {loadingRewards ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
            {[1, 2, 3].map(i => <CardSkeleton key={i} h="h-[230px]" />)}
          </div>
        ) : rewards.length === 0 ? (
          <FadeIn>
            <Card style={{ textAlign: 'center', padding: '48px 24px' }}>
              <Ico ch={ICON.gift} size={40} color={TK.textMute} stroke={1.6} style={{ margin: '0 auto 12px' }} />
              <p style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, margin: 0 }}>{t('admin.rewards.noRewards', 'No rewards yet')}</p>
              <p style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textMute, margin: '4px 0 18px' }}>{t('admin.rewards.noRewardsHint', 'Add your first reward to start building your catalog.')}</p>
              <div style={{ display: 'inline-flex' }}><PrimaryBtn icon={ICON.plus} onClick={openAdd}>{t('admin.rewards.addReward', 'Add Reward')}</PrimaryBtn></div>
            </Card>
          </FadeIn>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
            {rewards.map((r, idx) => {
              const v = visualFor(r.reward_type);
              const tone = TONE[v.tone] || TONE.accent;
              return (
                <FadeIn key={r.id} delay={idx * 40}>
                  <Card style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', opacity: r.is_active ? 1 : 0.6 }}>
                    {/* chip + PTS */}
                    <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 15, background: tone.bg, display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 24, lineHeight: 1 }}>
                        {r.emoji_icon ? <RewardSymbol value={r.emoji_icon} size={24} color={tone.fg} /> : <Ico ch={v.icon} size={24} color={tone.fg} stroke={2} />}
                      </div>
                      {r.cost_points > 0 && (
                        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, padding: '7px 13px', borderRadius: 999, background: TK.accentSoft, border: `1px solid ${TK.accentLine}` }}>
                          <span style={{ fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.accentInk, letterSpacing: -0.3 }}>{r.cost_points.toLocaleString()}</span>
                          <span style={{ fontFamily: FK.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: TK.accent }}>{t('admin.rewards.pts', 'PTS')}</span>
                        </span>
                      )}
                    </div>
                    {/* name + type + desc */}
                    <div style={{ padding: '15px 18px 0' }}>
                      <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, color: TK.text, letterSpacing: -0.4 }}>{rewardName(r)}</div>
                      <div style={{ marginTop: 8 }}>
                        <Pill tone={v.tone} icon={v.icon}>{t(`admin.rewards.type_${r.reward_type}`, r.reward_type)}</Pill>
                      </div>
                      {rewardDesc(r) && (
                        <p style={{ margin: '13px 0 0', fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, lineHeight: 1.5 }}>{rewardDesc(r)}</p>
                      )}
                      {!r.is_active && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
                          <Pill tone="hot">{t('admin.rewards.inactive', 'Inactive')}</Pill>
                          {r.deactivated_at && <span style={{ fontFamily: FK.mono, fontSize: 11, color: TK.textFaint }}>{format(new Date(r.deactivated_at), 'MMM d, yyyy', dateFnsLocale)}</span>}
                        </div>
                      )}
                    </div>
                    {/* footer actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '16px 18px 18px', marginTop: 'auto' }}>
                      <button type="button" onClick={() => openEdit(r)}
                        style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 0', borderRadius: 11, cursor: 'pointer', background: TK.accentWash, border: `1px solid ${TK.accentLine}`, fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.accent }}>
                        <Ico ch={ICON.edit} size={15} color={TK.accent} stroke={2.1} />{t('admin.rewards.edit', 'Edit')}
                      </button>
                      <RewardToggle active={r.is_active}
                        title={r.is_active ? t('admin.rewards.deactivate', 'Deactivate') : t('admin.rewards.activate', 'Activate')}
                        onClick={() => {
                          if (r.is_active) { setDeactivateTarget(r); setDeactivateNote(''); }
                          else toggleActiveMutation.mutate({ id: r.id, is_active: true });
                        }} />
                      <button type="button" onClick={() => setDeleteConfirmId(r.id)} aria-label={t('admin.rewards.deleteReward', 'Delete')}
                        style={{ width: 42, height: 42, borderRadius: 11, display: 'grid', placeItems: 'center', cursor: 'pointer', background: TK.surface, border: `1px solid ${TK.borderSolid}`, flexShrink: 0 }}>
                        <Ico ch={ICON.trash} size={16} color="var(--color-danger)" stroke={2} />
                      </button>
                    </div>
                  </Card>
                </FadeIn>
              );
            })}
          </div>
        )}
      </>}

      {/* ── Redemptions ── */}
      {rewardsTab === 'redemptions' && <RewardLog gymId={gymId} isEs={isEs} t={t} />}

      {/* ── Automations ── */}
      {rewardsTab === 'automations' && (
        <>
          <SectLabel icon={ICON.cake}>{t('admin.rewards.automations', 'Automations')}</SectLabel>
          <BirthdayRewardsCard gymId={gymId} rewards={rewards} t={t} isEs={isEs} />
        </>
      )}

      {/* ── Reward Modal ── */}
      <RewardModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        gymId={gymId}
        reward={editingReward}
        t={t}
      />

      {/* ── Delete confirm modal ── */}
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
                  onClick={() => { deleteRewardMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
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
                  <span style={{ color: 'var(--color-admin-text)' }}><RewardSymbol value={target.emoji_icon} size={20} /></span>
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

      {/* ── Deactivate modal ── */}
      {deactivateTarget && (
        <AdminModal
          isOpen
          onClose={() => { setDeactivateTarget(null); setDeactivateNote(''); }}
          title={t('admin.rewards.deactivateReward', 'Deactivate Reward')}
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)' }}>
              <span style={{ color: 'var(--color-admin-text)' }}><RewardSymbol value={deactivateTarget.emoji_icon} size={20} /></span>
              <div>
                <p className="text-[14px] font-semibold" style={{ color: 'var(--color-admin-text)' }}>{rewardName(deactivateTarget)}</p>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${typeColor(deactivateTarget.reward_type)}`}>
                  {t(`admin.rewards.type_${deactivateTarget.reward_type}`, deactivateTarget.reward_type)}
                </span>
              </div>
            </div>

            <p className="text-[13px]" style={{ color: 'var(--color-admin-text-sub)' }}>
              {t('admin.rewards.deactivateDesc', 'This reward will no longer be available for members. You can reactivate it later.')}
            </p>

            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-admin-text-muted)' }}>
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
                className="flex-1 py-2.5 rounded-xl text-[13px] font-medium"
                style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-subtle)' }}
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                onClick={() => toggleActiveMutation.mutate({ id: deactivateTarget.id, is_active: false, note: deactivateNote.trim() })}
                disabled={toggleActiveMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-50"
                style={{ background: 'var(--color-danger)' }}
              >
                {toggleActiveMutation.isPending ? '…' : t('admin.rewards.deactivate', 'Deactivate')}
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </AdminPageShell>
  );
}
