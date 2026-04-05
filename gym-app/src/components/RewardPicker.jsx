import { useState, useEffect } from 'react';
import { Gift, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import logger from '../lib/logger';

/**
 * RewardPicker — lets a member choose their referral reward from the gym's
 * configured options. Reusable for both referred (onboarding) and referrer (notification).
 *
 * @param {string} rewardId - referral_rewards.id (the pending reward row)
 * @param {string} gymId - gym ID
 * @param {function} onChosen - called with { rewardName, rewardType } after choice
 * @param {function} [onSkip] - called when user skips (optional)
 * @param {string} [className] - additional CSS classes
 */
export default function RewardPicker({ rewardId, gymId, onChosen, onSkip, className = '' }) {
  const { t, i18n } = useTranslation('pages');
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const isEs = i18n.language === 'es';

  // Fetch available reward options
  useEffect(() => {
    if (!gymId) return;
    (async () => {
      try {
        // Get gym's referral config to see which rewards are available
        const { data: gym } = await supabase
          .from('gyms')
          .select('referral_config')
          .eq('id', gymId)
          .single();

        const config = gym?.referral_config;

        // Get all active gym rewards
        const { data: allRewards } = await supabase
          .from('gym_rewards')
          .select('id, name, name_es, description, description_es, reward_type, emoji_icon, cost_points, is_active')
          .eq('gym_id', gymId)
          .eq('is_active', true)
          .order('sort_order');

        if (!allRewards?.length) {
          setRewards([]);
          setLoading(false);
          return;
        }

        // Filter to configured referral reward options if specified
        const optionIds = config?.reward_options_referrer || config?.reward_options_referred || [];
        const filtered = optionIds.length > 0
          ? allRewards.filter(r => optionIds.includes(r.id))
          : allRewards; // If no specific options configured, show all active rewards

        setRewards(filtered);
      } catch (err) {
        logger.error('RewardPicker: fetch failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [gymId]);

  const handleChoose = async () => {
    if (!selected || !rewardId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('choose_referral_reward', {
        p_reward_id: rewardId,
        p_gym_reward_id: selected.id,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setDone(true);
      setTimeout(() => {
        onChosen?.({ rewardName: selected.name, rewardType: selected.reward_type });
      }, 1200);
    } catch (err) {
      logger.error('RewardPicker: choose failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (rewards.length === 0) {
    // No reward options configured — auto-skip
    useEffect(() => { onSkip?.(); }, []); // eslint-disable-line
    return null;
  }

  if (done) {
    return (
      <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: 'color-mix(in srgb, var(--color-success) 15%, transparent)' }}>
          <Check size={28} style={{ color: 'var(--color-success)' }} />
        </div>
        <p className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {t('rewards.rewardChosen', 'Reward chosen!')}
        </p>
        <p className="text-[13px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {selected?.emoji_icon} {isEs ? (selected?.name_es || selected?.name) : selected?.name}
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' }}>
          <Gift size={18} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div>
          <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {t('rewards.pickYourReward', 'Pick your reward')}
          </p>
          <p className="text-[12px]" style={{ color: 'var(--color-text-subtle)' }}>
            {t('rewards.pickSubtitle', 'Choose one of the options below')}
          </p>
        </div>
      </div>

      <div className="grid gap-2.5">
        {rewards.map(r => {
          const isSelected = selected?.id === r.id;
          const displayName = isEs ? (r.name_es || r.name) : r.name;
          const displayDesc = isEs ? (r.description_es || r.description) : r.description;
          return (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className="text-left w-full px-4 py-3.5 rounded-xl transition-all"
              style={{
                background: isSelected
                  ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)'
                  : 'var(--color-bg-input)',
                border: `2px solid ${isSelected
                  ? 'var(--color-accent)'
                  : 'var(--color-border-subtle)'}`,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-[24px] flex-shrink-0">{r.emoji_icon || '🎁'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold truncate" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                    {displayName}
                  </p>
                  {displayDesc && (
                    <p className="text-[11px] truncate" style={{ color: 'var(--color-text-subtle)' }}>{displayDesc}</p>
                  )}
                </div>
                {isSelected && (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--color-accent)' }}>
                    <Check size={14} color="#000" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-5">
        {onSkip && (
          <button
            onClick={onSkip}
            className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-colors"
            style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
          >
            {t('rewards.skipForNow', 'Skip for now')}
          </button>
        )}
        <button
          onClick={handleChoose}
          disabled={!selected || submitting}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-bold transition-all disabled:opacity-40"
          style={{ background: 'var(--color-accent)', color: 'var(--color-bg-base)' }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />}
          {submitting ? t('rewards.claiming', 'Claiming...') : t('rewards.claimReward', 'Claim Reward')}
        </button>
      </div>
    </div>
  );
}
