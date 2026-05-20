/**
 * Shared reward picker used by both ReferralProgramConfig (referrer/referred
 * rewards) and ReferralMilestonesCard (per-milestone rewards). The two reward
 * shapes are mutually exclusive: points (numeric) or gym_reward (inventory
 * row). Parents pass in the current value + an `onChange` that receives the
 * new reward in either shape.
 */
export default function RewardEditor({ label, reward, onChange, rewards, rewardLabel, t, compact = false }) {
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
