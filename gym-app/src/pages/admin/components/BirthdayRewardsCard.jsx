import { useEffect, useState } from 'react';
import { Cake, ToggleLeft, ToggleRight, ChevronDown, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { logAdminAction } from '../../../lib/adminAudit';
import { AdminCard, FadeIn, SectionLabel } from '../../../components/admin';

/**
 * Card-form on the AdminRewards page (moved out of AdminSettings) that
 * configures the gym's birthday-rewards feature: enable toggle, picker
 * for the catalog reward to gift, optional bonus points, and optional
 * custom message.
 *
 * Writes go directly to the `gyms` row (no separate config table for
 * this feature). The points input is clamped 0–10000 so a typo can't
 * accidentally award an obscene bonus.
 */
export default function BirthdayRewardsCard({ gymId, rewards, t, isEs }) {
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
