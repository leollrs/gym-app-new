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
        emoji_icon: reward.emoji_icon || '🎁',
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
        is_featured: !!form.is_featured,
      };

      // Only one featured reward per gym — clear any existing featured flag
      // before saving this one to satisfy the partial unique index.
      if (payload.is_featured) {
        await supabase
          .from('gym_rewards')
          .update({ is_featured: false })
          .eq('gym_id', gymId)
          .eq('is_featured', true)
          .neq('id', reward?.id || '00000000-0000-0000-0000-000000000000');
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
      // If cancelling a pending redemption, refund the points by calling the
      // server-side `add_reward_points` RPC (which is the authoritative way to
      // mutate balances — same RPC the redemption flow uses to deduct).
      // Doing it here means the toast copy "points returned" is actually true.
      if (entry.table === 'reward_redemptions' && entry.status === 'pending') {
        const { data: redemption } = await supabase
          .from('reward_redemptions')
          .select('profile_id, points_spent')
          .eq('id', entry.dbId)
          .single();
        if (redemption?.profile_id && (redemption.points_spent || 0) > 0) {
          const { error: refundErr } = await supabase.rpc('add_reward_points', {
            p_profile_id: redemption.profile_id,
            p_points: redemption.points_spent,
            p_source: 'redemption_refund',
            p_metadata: { redemption_id: entry.dbId, expired_by_admin: true },
          });
          // Don't block the expire on a refund-RPC missing — fall back to logging.
          if (refundErr) logger.error('Refund failed for redemption', entry.dbId, refundErr);
        }
      }

      const { error } = await supabase
        .from(entry.table)
        .update({ status: 'expired' })
        .eq('id', entry.dbId);
      if (error) throw error;
      logAdminAction('expire_reward_redemption', entry.table, entry.dbId);
      queryClient.invalidateQueries({ queryKey: [...rewardKeys.all(gymId), 'activity-log'] });
      showToast(t('admin.rewards.rewardCancelled', 'Reward cancelled — points returned'), 'success');
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
  const sourceColor = { challenge: 'var(--color-accent)', email: 'var(--color-info)', redemption: 'var(--color-success, #10B981)' };
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
                  const color = sourceColor[entry.type] || 'var(--color-admin-text-sub)';
                  return (
                    <div key={entry.id} className="flex items-start gap-3 py-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${color}15` }}>
                        <Icon size={13} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[12px] text-[#E5E7EB] truncate min-w-0">
                            <span className="font-semibold">{entry.member}</span>
                            <span className="text-[#6B7280] mx-1.5">·</span>
                            <span className="text-[#9CA3AF]">{entry.label}</span>
                          </p>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${statusStyle[entry.status] || statusStyle.pending}`}>
                            {t(`admin.rewards.statusPill.${entry.status}`, entry.status)}
                          </span>
                          <span className="text-[10px] text-[#4B5563] tabular-nums whitespace-nowrap flex-shrink-0 ml-auto">
                            {format(new Date(entry.date), 'MMM d', dateFnsLocale)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#6B7280] mt-0.5 line-clamp-2 break-words">{entry.reward}</p>
                        {entry.canDeactivate && (
                          <button
                            onClick={() => handleDeactivate(entry)}
                            disabled={deactivating === entry.id}
                            className="mt-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors disabled:opacity-40"
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
// ── Birthday Rewards Card (moved from AdminSettings) ───────
function BirthdayRewardsCard({ gymId, rewards, t, isEs }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState(0);
  const [message, setMessage] = useState('');
  const [rewardId, setRewardId] = useState('');
  const [pointsOpen, setPointsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gymId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('gyms')
        .select('birthday_rewards_enabled, birthday_reward_points, birthday_reward_message, birthday_reward_id')
        .eq('id', gymId)
        .single();
      if (cancelled) return;
      if (!error && data) {
        setEnabled(!!data.birthday_rewards_enabled);
        const pts = data.birthday_reward_points ?? 0;
        setPoints(pts);
        setMessage(data.birthday_reward_message ?? '');
        setRewardId(data.birthday_reward_id ?? '');
        setPointsOpen(pts > 0); // only auto-expand if there are existing points
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [gymId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('gyms')
        .update({
          birthday_rewards_enabled: enabled,
          birthday_reward_points: Math.max(0, Math.min(10000, parseInt(points, 10) || 0)),
          birthday_reward_message: message?.trim() || null,
          birthday_reward_id: rewardId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', gymId);
      if (error) throw error;
      logAdminAction('update_birthday_rewards', 'gym', gymId);
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      showToast(t('admin.settings.saved', 'Saved!'), 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  const activeRewards = (rewards || []).filter(r => r.is_active);
  const rewardLabel = (r) => `${r.emoji_icon || '🎁'} ${(isEs && r.name_es) ? r.name_es : r.name}`;

  return (
    <FadeIn>
      <AdminCard hover padding="p-4 sm:p-5" className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <SectionLabel icon={Cake}>{t('admin.settings.birthdayTitle', 'Birthday rewards')}</SectionLabel>
          <button
            type="button"
            onClick={() => setEnabled(v => !v)}
            className="flex items-center gap-1 text-[12px] font-semibold transition-colors"
            style={{ color: enabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}
          >
            {enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
            {enabled ? t('admin.settings.enabled', 'Enabled') : t('admin.settings.disabled', 'Disabled')}
          </button>
        </div>
        <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
          {t('admin.settings.birthdayDesc', 'On a member\'s birthday, they get a celebration notification plus the reward you pick from the catalog. Optionally add bonus points.')}
        </p>

        {/* PRIMARY: Reward picker */}
        <div className="mb-4">
          <label className="block text-[11px] uppercase mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em', fontWeight: 800 }}>
            {t('admin.settings.birthdayReward', 'Birthday reward')}
          </label>
          <select
            value={rewardId}
            onChange={e => setRewardId(e.target.value)}
            disabled={!enabled}
            className="w-full rounded-xl px-3 py-3 text-[14px] font-medium focus:outline-none disabled:opacity-50"
            style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.04))', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', color: 'var(--color-text-primary)' }}
          >
            <option value="">{t('admin.settings.birthdayNoReward', '— Pick a reward from the catalog —')}</option>
            {activeRewards.map(r => (
              <option key={r.id} value={r.id}>{rewardLabel(r)}</option>
            ))}
          </select>
          <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
            {t('admin.settings.birthdayRewardHint', 'The member sees this reward as a claimable item in their Rewards page on their birthday.')}
          </p>
        </div>

        {/* SECONDARY: bonus points (collapsed by default) */}
        <button
          type="button"
          onClick={() => setPointsOpen(o => !o)}
          disabled={!enabled}
          className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-[12px] font-semibold mb-3 transition-colors disabled:opacity-50"
          style={{
            background: 'var(--color-surface-hover, rgba(255,255,255,0.03))',
            border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>{t('admin.settings.birthdayPointsToggle', '+ Add bonus points (optional)')}</span>
          <ChevronDown size={14} className={`transition-transform ${pointsOpen ? 'rotate-180' : ''}`} />
        </button>

        {pointsOpen && (
          <div className="mb-4">
            <label className="block text-[11px] uppercase mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em', fontWeight: 800 }}>
              {t('admin.settings.birthdayPoints', 'Bonus points')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" inputMode="numeric" min="0" max="10000"
                value={points}
                onChange={e => setPoints(e.target.value)}
                disabled={!enabled}
                placeholder="0"
                className="w-full rounded-xl px-3 py-2.5 text-[14px] font-bold focus:outline-none disabled:opacity-50"
                style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.04))', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', color: 'var(--color-text-primary)' }}
              />
              <span className="text-[12px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                {t('admin.settings.birthdayPointsUnit', 'points')}
              </span>
            </div>
            <p className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.settings.birthdayPointsHint', 'Awarded in addition to the reward above. Leave at 0 to skip.')}
            </p>
          </div>
        )}

        {/* Optional custom message */}
        <div>
          <label className="block text-[11px] uppercase mb-1.5" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.12em', fontWeight: 800 }}>
            {t('admin.settings.birthdayMessage', 'Custom message (optional)')}
          </label>
          <input
            type="text" maxLength={140}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={t('admin.settings.birthdayMessagePlaceholder', 'Happy birthday from the team! 🎂')}
            className="w-full rounded-xl px-3 py-2.5 text-[14px] focus:outline-none"
            style={{ background: 'var(--color-surface-hover, rgba(255,255,255,0.04))', border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))', color: 'var(--color-text-primary)' }}
          />
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
                    onClick={() => {
                      if (window.confirm(t('admin.rewards.deleteConfirm', 'Delete this reward?'))) {
                        deleteRewardMutation.mutate(r.id);
                      }
                    }}
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

      {/* Birthday Rewards (moved from Settings) */}
      <BirthdayRewardsCard gymId={gymId} rewards={rewards} t={t} isEs={isEs} />
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
