import { useEffect, useState } from 'react';
import {
  Plus, Gift, Pencil, Trash2, ToggleLeft, ToggleRight,
  Milestone, Award, Hash, Trophy, Mail, Clock, ChevronRight,
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
import { useAutoTranslate } from '../../hooks/useAutoTranslate';
import {
  PageHeader, AdminCard, AdminModal, FadeIn, CardSkeleton,
  SectionLabel, AdminPageShell, AdminTabs,
} from '../../components/admin';

// ── Constants ──────────────────────────────────────────────
const REWARD_TYPES = [
  { value: 'smoothie',     color: 'text-cyan-400 bg-cyan-500/10' },
  { value: 'guest_pass',   color: 'text-blue-400 bg-blue-500/10' },
  { value: 'merch',        color: 'text-purple-400 bg-purple-500/10' },
  { value: 'pt_session',   color: 'text-amber-400 bg-amber-500/10' },
  { value: 'free_month',   color: 'text-emerald-400 bg-emerald-500/10' },
  { value: 'class_pass',   color: 'text-pink-400 bg-pink-500/10' },
  { value: 'discount',     color: 'text-orange-400 bg-orange-500/10' },
  { value: 'bring_friend', color: 'text-indigo-400 bg-indigo-500/10' },
  { value: 'custom',       color: 'text-[#9CA3AF] bg-white/6' },
];

const rewardKeys = adminKeys.rewards;

const typeColor = (type) =>
  REWARD_TYPES.find(t => t.value === type)?.color ?? 'text-[#9CA3AF] bg-white/6';

// ── Input class (shared) ───────────────────────────────────
const inputClass = 'w-full bg-white/[0.04] border border-white/8 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] placeholder-[#4B5563] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-all';

// ── Reward Modal ───────────────────────────────────────────
const RewardModal = ({ isOpen, onClose, gymId, reward, t }) => {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { translate, translating } = useAutoTranslate();
  const isEdit = !!reward;
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    name: '', name_es: '', description: '', description_es: '',
    reward_type: 'custom', emoji_icon: '🎁', cost_points: '0', is_active: true,
    sort_order: '0',
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
        emoji_icon: reward.emoji_icon || '🎁',
        cost_points: reward.cost_points?.toString() || '0',
        is_active: reward.is_active ?? true,
        sort_order: reward.sort_order?.toString() || '0',
      });
      setErrors({});
      // Auto-expand advanced if reward has translations or custom sort
      setShowAdvanced(!!(reward.name_es || reward.description_es || (reward.sort_order && reward.sort_order !== 0)));
    } else {
      setForm({
        name: '', name_es: '', description: '', description_es: '',
        reward_type: 'custom', emoji_icon: '🎁', cost_points: '0', is_active: true,
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

  const validateForm = () => {
    const e = {};
    if (!form.name.trim()) e.name = t('admin.validation.nameRequired', 'Name is required');
    else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
    if (parseInt(form.cost_points) < 0) e.cost_points = t('admin.validation.pointsMin', 'Points must be 0 or more');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleBlur = (field) => {
    const e = { ...errors };
    if (field === 'name') {
      if (!form.name.trim()) e.name = t('admin.validation.nameRequired', 'Name is required');
      else if (form.name.trim().length < 2) e.name = t('admin.validation.tooShort', { min: 2 });
      else delete e.name;
    }
    if (field === 'cost_points') {
      if (parseInt(form.cost_points) < 0) e.cost_points = t('admin.validation.pointsMin', 'Points must be 0 or more');
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

      const payload = {
        gym_id: gymId,
        name: form.name.trim(),
        name_es: form.name_es.trim() || null,
        description: form.description.trim() || null,
        description_es: form.description_es.trim() || null,
        reward_type: form.reward_type,
        emoji_icon: form.emoji_icon || '🎁',
        cost_points: parseInt(form.cost_points) || 0,
        is_active: form.is_active,
        sort_order: parseInt(form.sort_order) || 0,
      };

      if (isEdit) {
        const { error } = await supabase.from('gym_rewards').update(payload).eq('id', reward.id).eq('gym_id', gymId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('gym_rewards').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
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
          className="w-full py-3 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:bg-[#C5A028] disabled:opacity-50 transition-colors"
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

        {/* Emoji + Name */}
        <div className="flex gap-3">
          <div className="w-20">
            <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.rewards.emojiIcon', 'Emoji')}</label>
            <input
              value={form.emoji_icon}
              onChange={e => set('emoji_icon', e.target.value)}
              placeholder="🎁"
              maxLength={4}
              className={`${inputClass} !text-center !text-[20px] !px-2`}
            />
          </div>
          <div className="flex-1">
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

        {/* Points Cost */}
        <div>
          <label className="block text-[12px] font-medium text-[#9CA3AF] mb-1.5">{t('admin.rewards.costPoints', 'Points Cost')} <span className="text-red-400">*</span></label>
          <input
            type="number"
            min="0"
            value={form.cost_points}
            onChange={e => set('cost_points', e.target.value)}
            onBlur={() => handleBlur('cost_points')}
            placeholder="0"
            className={errors.cost_points ? `${inputClass} !border-red-500/50 focus:!border-red-500/50 focus:!ring-red-500/30` : inputClass}
          />
          {errors.cost_points && <p className="text-[11px] text-red-400 mt-1">{errors.cost_points}</p>}
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
                  placeholder="e.g. Batido Gratis"
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
};

// ── Reward Activity Log ────────────────────────────────────
function RewardLog({ gymId, isEs, t }) {
  const dateFnsLocale = isEs ? { locale: esLocale } : undefined;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [deactivating, setDeactivating] = useState(null);

  const handleDeactivate = async (entry) => {
    setDeactivating(entry.id);
    try {
      const statusField = entry.table === 'reward_redemptions' ? 'status' : 'status';
      const { error } = await supabase
        .from(entry.table)
        .update({ [statusField]: 'expired' })
        .eq('id', entry.dbId);
      if (error) throw error;
      logAdminAction('expire_reward_redemption', entry.table, entry.dbId);
      queryClient.invalidateQueries({ queryKey: [...rewardKeys.all(gymId), 'activity-log'] });
      showToast(t('admin.rewards.rewardDeactivated', 'Reward deactivated'), 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeactivating(null);
    }
  };

  const { data: logEntries = [], isLoading } = useQuery({
    queryKey: [...rewardKeys.all(gymId), 'activity-log'],
    queryFn: async () => {
      // Fetch from 3 sources in parallel
      const [challengeRes, voucherRes, redemptionRes] = await Promise.all([
        supabase
          .from('challenge_prizes')
          .select('id, profile_id, placement, reward_label, points_awarded, status, created_at, redeemed_at, challenges(name), profiles!challenge_prizes_profile_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('email_reward_vouchers')
          .select('id, member_id, reward_label, reward_type, status, created_at, redeemed_at, profiles!email_reward_vouchers_member_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('reward_redemptions')
          .select('id, profile_id, reward_name, points_spent, status, created_at, claimed_at, profiles!reward_redemptions_profile_id_fkey(full_name)')
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const entries = [];

      (challengeRes.data || []).forEach(p => {
        const medals = ['🥇', '🥈', '🥉'];
        entries.push({
          id: `cp-${p.id}`,
          dbId: p.id,
          table: 'challenge_prizes',
          type: 'challenge',
          member: p.profiles?.full_name || '?',
          label: `${medals[p.placement - 1] || ''} ${p.challenges?.name || 'Challenge'}`,
          reward: p.reward_label,
          status: p.status,
          date: p.redeemed_at || p.created_at,
          canDeactivate: p.status === 'pending',
        });
      });

      (voucherRes.data || []).forEach(v => {
        entries.push({
          id: `ev-${v.id}`,
          dbId: v.id,
          table: 'email_reward_vouchers',
          type: 'email',
          member: v.profiles?.full_name || '?',
          label: t('admin.rewards.logEmailCampaign', 'Email campaign'),
          reward: v.reward_label,
          status: v.status,
          date: v.redeemed_at || v.created_at,
          canDeactivate: v.status === 'active',
        });
      });

      (redemptionRes.data || []).forEach(r => {
        entries.push({
          id: `rd-${r.id}`,
          dbId: r.id,
          table: 'reward_redemptions',
          type: 'redemption',
          member: r.profiles?.full_name || '?',
          label: t('admin.rewards.logPointsRedemption', 'Points redemption'),
          reward: r.reward_name,
          status: r.status,
          date: r.claimed_at || r.created_at,
          canDeactivate: r.status === 'pending',
        });
      });

      return entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    },
    enabled: !!gymId,
    staleTime: 30_000,
  });

  const sourceIcon = { challenge: Trophy, email: Mail, redemption: Gift };
  const sourceColor = { challenge: 'var(--color-accent)', email: '#3B82F6', redemption: 'var(--color-success, #10B981)' };
  const statusStyle = {
    pending: 'text-amber-400 bg-amber-500/10',
    active: 'text-amber-400 bg-amber-500/10',
    redeemed: 'text-emerald-400 bg-emerald-500/10',
    claimed: 'text-emerald-400 bg-emerald-500/10',
    expired: 'text-[#6B7280] bg-white/6',
  };

  const visible = showAll ? logEntries : logEntries.slice(0, 10);

  return (
    <>
      <SectionLabel>
        <Clock size={14} className="inline mr-1.5 -mt-px" />
        {t('admin.rewards.activityLog', 'Activity Log')}
      </SectionLabel>

      <FadeIn>
        <AdminCard className="mt-4">
          {isLoading ? (
            <div className="py-8 text-center text-[12px] text-[#6B7280]">{t('common:loading')}</div>
          ) : logEntries.length === 0 ? (
            <div className="py-8 text-center">
              <Clock size={24} className="mx-auto text-[#4B5563] mb-2" />
              <p className="text-[13px] text-[#6B7280]">{t('admin.rewards.noActivity', 'No reward activity yet')}</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-white/4">
                {visible.map(entry => {
                  const Icon = sourceIcon[entry.type] || Gift;
                  const color = sourceColor[entry.type] || '#6B7280';
                  return (
                    <div key={entry.id} className="flex items-center gap-3 py-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
                        <Icon size={13} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-[#E5E7EB]">
                          <span className="font-semibold">{entry.member}</span>
                          <span className="text-[#6B7280] mx-1.5">·</span>
                          <span className="text-[#9CA3AF]">{entry.label}</span>
                        </p>
                        <p className="text-[11px] text-[#6B7280] mt-0.5">{entry.reward}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusStyle[entry.status] || statusStyle.pending}`}>
                          {entry.status}
                        </span>
                        <span className="text-[10px] text-[#4B5563] tabular-nums">
                          {format(new Date(entry.date), 'MMM d', dateFnsLocale)}
                        </span>
                        {entry.canDeactivate && (
                          <button
                            onClick={() => handleDeactivate(entry)}
                            disabled={deactivating === entry.id}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                          >
                            {deactivating === entry.id ? '...' : t('admin.rewards.expire', 'Expire')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {logEntries.length > 10 && (
                <button onClick={() => setShowAll(p => !p)}
                  className="w-full mt-3 py-2 rounded-xl text-[12px] font-semibold text-[#D4AF37] bg-[#D4AF37]/8 hover:bg-[#D4AF37]/15 transition-colors">
                  {showAll ? t('admin.rewards.showLess', 'Show less') : t('admin.rewards.showAll', { count: logEntries.length, defaultValue: `Show all (${logEntries.length})` })}
                </button>
              )}
            </>
          )}
        </AdminCard>
      </FadeIn>
    </>
  );
}

// ── Main Component ─────────────────────────────────────────
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

  // Milestone form
  const [milestoneCount, setMilestoneCount] = useState('');
  const [milestoneRewardId, setMilestoneRewardId] = useState('');

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

  const { data: milestones = [], isLoading: loadingMilestones } = useQuery({
    queryKey: rewardKeys.milestones(gymId),
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
      queryClient.invalidateQueries({ queryKey: rewardKeys.milestones(gymId) });
      showToast(t('admin.rewards.deleted', 'Reward deleted'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const addMilestoneMutation = useMutation({
    mutationFn: async () => {
      const count = parseInt(milestoneCount);
      if (!count || count < 1) throw new Error('Invalid referral count');
      if (!milestoneRewardId) throw new Error('Select a reward');
      const { error } = await supabase.from('referral_milestones').insert({
        gym_id: gymId,
        referral_count: count,
        reward_id: milestoneRewardId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rewardKeys.milestones(gymId) });
      setMilestoneCount('');
      setMilestoneRewardId('');
      showToast(t('admin.rewards.saved', 'Saved'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const deleteMilestoneMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('referral_milestones').delete().eq('id', id).eq('gym_id', gymId);
      if (error) throw error;
      return id;
    },
    onSuccess: (_data, id) => {
      logAdminAction('delete_milestone', 'referral_milestone', id);
      queryClient.invalidateQueries({ queryKey: rewardKeys.milestones(gymId) });
      showToast(t('admin.rewards.deleted', 'Deleted'), 'success');
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
          { key: 'performance', label: t('admin.rewards.tabPerformance', 'Performance'), icon: Trophy },
        ]}
        active={rewardsTab}
        onChange={setRewardsTab}
        className="mb-6"
      />

      {/* ── Catalog Tab ───────────────────────────────────── */}
      {rewardsTab === 'catalog' && <>
      <SectionLabel className="mb-1">{t('admin.rewards.catalog', 'Reward Catalog')}</SectionLabel>

      {loadingRewards ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          {[1, 2, 3, 4].map(i => <CardSkeleton key={i} />)}
        </div>
      ) : rewards.length === 0 ? (
        <FadeIn>
          <AdminCard className="mt-4 text-center py-12">
            <Gift size={40} className="mx-auto text-[#6B7280] mb-3" />
            <p className="text-[15px] font-semibold text-[#E5E7EB]">
              {t('admin.rewards.noRewards', 'No rewards yet')}
            </p>
            <p className="text-[12px] text-[#6B7280] mt-1 mb-4">
              {t('admin.rewards.noRewardsHint', 'Add your first reward to start building your catalog.')}
            </p>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#D4AF37] text-black font-bold text-[13px] rounded-xl hover:bg-[#C4A030] transition-colors"
            >
              <Plus size={15} /> {t('admin.rewards.addReward', 'Add Reward')}
            </button>
          </AdminCard>
        </FadeIn>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          {rewards.map((r, idx) => (
            <FadeIn key={r.id} delay={idx * 40}>
              <AdminCard className="relative">
                {/* Top row: emoji + name + badges */}
                <div className={`flex items-center gap-3 ${!r.is_active ? 'opacity-40' : ''}`}>
                  <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/8 flex items-center justify-center flex-shrink-0 text-[20px]">
                    {r.emoji_icon || '🎁'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-[#E5E7EB] truncate">{rewardName(r)}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${typeColor(r.reward_type)}`}>
                        {t(`admin.rewards.type_${r.reward_type}`, r.reward_type)}
                      </span>
                      {r.cost_points > 0 && (
                        <span className="text-[11px] font-semibold text-[#D4AF37]">
                          {r.cost_points.toLocaleString()} {t('admin.rewards.pts', 'pts')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                {rewardDesc(r) && (
                  <p className={`text-[12px] text-[#6B7280] mt-2 line-clamp-2 ${!r.is_active ? 'opacity-40' : ''}`}>{rewardDesc(r)}</p>
                )}

                {/* Bottom row: inactive badge + actions */}
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/4">
                  <div className="flex-1 min-w-0">
                    {!r.is_active && (
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase text-red-400 bg-red-500/10">
                          {t('admin.rewards.inactive', 'Inactive')}
                        </span>
                        {r.deactivated_at && (
                          <span className="text-[10px] text-[#4B5563]">
                            {format(new Date(r.deactivated_at), 'MMM d, yyyy', dateFnsLocale)}
                          </span>
                        )}
                        {r.deactivated_note && (
                          <span className="text-[10px] text-[#6B7280] truncate">{r.deactivated_note}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (r.is_active) {
                          setDeactivateTarget(r);
                          setDeactivateNote('');
                        } else {
                          toggleActiveMutation.mutate({ id: r.id, is_active: true });
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                      aria-label={r.is_active ? t('admin.rewards.deactivate', 'Deactivate') : t('admin.rewards.activate', 'Activate')}
                    >
                      {r.is_active
                        ? <ToggleRight size={18} className="text-emerald-400" />
                        : <ToggleLeft size={18} className="text-[#6B7280]" />}
                    </button>
                    <button
                      onClick={() => openEdit(r)}
                      className="p-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
                      aria-label={t('admin.rewards.editReward', 'Edit')}
                    >
                      <Pencil size={14} className="text-[#9CA3AF]" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(t('admin.rewards.deleteConfirm', 'Delete this reward?'))) {
                          deleteRewardMutation.mutate(r.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                      aria-label={t('admin.rewards.deleteReward', 'Delete')}
                    >
                      <Trash2 size={14} className="text-[#6B7280] hover:text-red-400" />
                    </button>
                  </div>
                </div>
              </AdminCard>
            </FadeIn>
          ))}
        </div>
      )}
      </>}

      {/* ── Performance Tab ───────────────────────────────── */}
      {rewardsTab === 'performance' && <>
      <SectionLabel>
        {t('admin.rewards.referralMilestones', 'Referral Milestones')}
      </SectionLabel>

      <FadeIn>
        <AdminCard className="mt-4">
          {/* Add milestone row */}
          <div className="flex items-end gap-3 pb-4 border-b border-white/6">
            <div className="w-24">
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                {t('admin.rewards.referralCount', 'Referrals')}
              </label>
              <input
                type="number"
                min="1"
                value={milestoneCount}
                onChange={e => setMilestoneCount(e.target.value)}
                placeholder="3"
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                {t('admin.rewards.selectReward', 'Reward')}
              </label>
              <select
                value={milestoneRewardId}
                onChange={e => setMilestoneRewardId(e.target.value)}
                className={inputClass}
              >
                <option value="">{t('admin.rewards.selectReward', 'Select reward...')}</option>
                {activeRewards.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.emoji_icon} {rewardName(r)}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => addMilestoneMutation.mutate()}
              disabled={addMilestoneMutation.isPending || !milestoneCount || !milestoneRewardId}
              className="px-4 py-2.5 rounded-xl text-[12px] font-bold text-black bg-[#D4AF37] hover:bg-[#C5A028] disabled:opacity-40 transition-colors flex-shrink-0"
            >
              {t('admin.rewards.addMilestone', 'Add')}
            </button>
          </div>

          {/* Milestones list */}
          {loadingMilestones ? (
            <div className="py-6 text-center text-[12px] text-[#6B7280]">{t('common:loading')}</div>
          ) : milestones.length === 0 ? (
            <div className="py-8 text-center">
              <Milestone size={28} className="mx-auto text-[#6B7280] mb-2" />
              <p className="text-[13px] text-[#6B7280]">
                {t('admin.rewards.noMilestones', 'No referral milestones configured yet.')}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/6">
              {milestones.map(m => {
                const rw = m.gym_rewards;
                const rwName = isEs && rw?.name_es ? rw.name_es : rw?.name;
                return (
                  <div key={m.id} className="flex items-center gap-3 py-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-[13px] font-bold text-[#D4AF37] tabular-nums w-8 text-right">
                        {m.referral_count}
                      </span>
                      <span className="text-[12px] text-[#6B7280]">
                        {t('admin.rewards.referralsNeeded', 'referrals')}
                      </span>
                      <span className="text-[12px] text-[#6B7280] mx-1">&rarr;</span>
                      <span className="text-[15px]">{rw?.emoji_icon || '🎁'}</span>
                      <span className="text-[13px] font-medium text-[#E5E7EB] truncate">
                        {rwName || 'Unknown'}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        if (window.confirm(t('admin.rewards.deleteConfirm', 'Delete this milestone?'))) {
                          deleteMilestoneMutation.mutate(m.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors flex-shrink-0"
                      aria-label={t('admin.rewards.deleteMilestone', 'Delete milestone')}
                    >
                      <Trash2 size={14} className="text-[#6B7280]" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </AdminCard>
      </FadeIn>
      </>}

      {/* ── Redemptions Tab ───────────────────────────────── */}
      {rewardsTab === 'redemptions' && <RewardLog gymId={gymId} isEs={isEs} t={t} />}

      {/* ── Reward Modal ─────────────────────────────────────── */}
      <RewardModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        gymId={gymId}
        reward={editingReward}
        t={t}
      />

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
                className={inputClass + ' resize-none'}
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
