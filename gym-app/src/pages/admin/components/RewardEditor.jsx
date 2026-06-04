import { TK, FK, Ico, ICON } from './retosKit';

/**
 * Shared reward picker used by both ReferralProgramConfig (referrer/referred
 * rewards) and ReferralMilestonesCard (per-milestone rewards). The two reward
 * shapes are mutually exclusive: points (numeric) or gym_reward (inventory
 * row). Parents pass in the current value + an `onChange` that receives the
 * new reward in either shape.
 *
 * Restyled onto the Referidos / retosKit design system (styled native select
 * + number field) while keeping the original onChange contract intact.
 */
const fieldLabel = {
  display: 'block', fontFamily: FK.body, fontSize: 11, fontWeight: 800,
  letterSpacing: 1.1, textTransform: 'uppercase', color: TK.textMute, marginBottom: 9,
};

function Chevrons() {
  return (
    <span style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 1, pointerEvents: 'none' }}>
      <Ico ch={ICON.chevU} size={13} color={TK.textMute} stroke={2.4} />
      <Ico ch={ICON.chevD} size={13} color={TK.textMute} stroke={2.4} />
    </span>
  );
}

export default function RewardEditor({ label, reward, onChange, rewards, rewardLabel, t, compact = false }) {
  const type = reward?.type === 'gym_reward' ? 'gym_reward' : 'points';
  const padY = compact ? 10 : 13;

  const selectStyle = {
    width: '100%', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    padding: `${padY}px 38px ${padY}px 15px`, borderRadius: 12,
    background: TK.surface, border: `1px solid ${TK.borderSolid}`,
    fontFamily: FK.body, fontSize: 14.5, fontWeight: 600, color: TK.text, outline: 'none', cursor: 'pointer',
  };

  return (
    <div>
      {label && <span style={fieldLabel}>{label}</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {/* Type */}
        <div>
          <span style={fieldLabel}>{t('admin.referral.fieldType', 'Type')}</span>
          <div style={{ position: 'relative' }}>
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
              style={selectStyle}
            >
              <option value="points">{t('admin.referral.typePoints', 'Points')}</option>
              <option value="gym_reward">{t('admin.referral.typeGymReward', 'From inventory')}</option>
            </select>
            <Chevrons />
          </div>
        </div>

        {/* Amount (points) or Reward picker (inventory) */}
        <div>
          <span style={fieldLabel}>
            {type === 'points' ? t('admin.referral.fieldAmount', 'Amount') : t('admin.referrals.selectReward', 'Reward')}
          </span>
          {type === 'points' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `${padY}px 15px`, borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}` }}>
              <input
                type="number" min="0"
                value={reward?.value ? String(reward.value) : ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { onChange({ type: 'points', value: 0 }); return; }
                  const n = parseInt(raw, 10);
                  onChange({ type: 'points', value: Number.isFinite(n) ? n : 0 });
                }}
                placeholder={t('admin.referral.pointsPlaceholder', 'e.g. 250')}
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontFamily: FK.display, fontSize: 16, fontWeight: 800, color: TK.text, letterSpacing: -0.3 }}
              />
              <span style={{ fontFamily: FK.mono, fontSize: 11.5, fontWeight: 700, color: TK.accent }}>PTS</span>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <select
                value={reward?.reward_id || ''}
                onChange={(e) => onChange({ type: 'gym_reward', reward_id: e.target.value })}
                style={selectStyle}
              >
                <option value="">{t('admin.referrals.selectReward', 'Select reward...')}</option>
                {(rewards || []).map((r) => (
                  <option key={r.id} value={r.id}>{rewardLabel(r)}</option>
                ))}
              </select>
              <Chevrons />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
