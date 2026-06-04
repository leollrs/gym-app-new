import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useToast } from '../../../contexts/ToastContext';
import { adminKeys } from '../../../lib/adminQueryKeys';
import { rewardLabelText } from '../../../lib/rewardSymbols';
import { logAdminAction } from '../../../lib/adminAudit';
import { FadeIn } from '../../../components/admin';
import { TK, FK, Ico, ICON, Card, IconChip, PrimaryBtn } from './retosKit';

const fieldLabel = { fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: TK.textSub, marginBottom: 9 };
const helpText = { fontFamily: FK.body, fontSize: 12.5, color: TK.textFaint, marginTop: 8, lineHeight: 1.45 };
const boxBase = { borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.body, fontSize: 14.5, color: TK.text };

/**
 * Birthday-rewards automation card (Automatizaciones tab on AdminRewards).
 * Configures the gym's birthday feature: enable toggle, catalog reward to
 * gift, optional bonus points (clamped 0–10000), optional custom message.
 * Writes go directly to the `gyms` row.
 */
export default function BirthdayRewardsCard({ gymId, rewards, t, isEs }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState(0);
  const [message, setMessage] = useState('');
  const [rewardId, setRewardId] = useState('');
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
        setPoints(data.birthday_reward_points ?? 0);
        setMessage(data.birthday_reward_message ?? '');
        setRewardId(data.birthday_reward_id ?? '');
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
  const rewardLabel = (r) => rewardLabelText(r.emoji_icon, (isEs && r.name_es) ? r.name_es : r.name);

  return (
    <FadeIn>
      <Card style={{ overflow: 'hidden' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '22px 24px 20px', borderBottom: `1px solid ${TK.divider}`, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 15, minWidth: 0 }}>
            <IconChip ch={ICON.cake} tone="accent" size={46} r={14} strokeW={2} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FK.display, fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: TK.text }}>{t('admin.settings.birthdayTitle', 'Birthday rewards')}</div>
              <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute, marginTop: 5, maxWidth: 480, lineHeight: 1.45 }}>
                {t('admin.settings.birthdayDesc', "On a member's birthday, they get a celebration notification plus the reward you pick from the catalog. Optionally add bonus points.")}
              </div>
            </div>
          </div>
          {/* on/off switch */}
          <button type="button" onClick={() => setEnabled(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0, padding: '8px 14px 8px 16px', borderRadius: 999, cursor: 'pointer', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
            <span style={{ fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: enabled ? 'var(--color-success)' : TK.textMute }}>
              {enabled ? t('admin.settings.enabled', 'Enabled') : t('admin.settings.disabled', 'Disabled')}
            </span>
            <span style={{ width: 42, height: 24, borderRadius: 99, background: enabled ? 'var(--color-success)' : TK.surface3, border: `1px solid ${enabled ? 'transparent' : TK.borderSolid}`, position: 'relative', display: 'inline-block', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 2.5, left: enabled ? 20 : 2.5, width: 18, height: 18, borderRadius: 99, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s' }} />
            </span>
          </button>
        </div>

        {/* body */}
        <div style={{ padding: '24px 24px 26px' }}>
          <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6">
            {/* reward picker */}
            <div>
              <div style={fieldLabel}>{t('admin.settings.birthdayReward', 'Birthday reward')}</div>
              <div style={{ position: 'relative' }}>
                <select value={rewardId} onChange={e => setRewardId(e.target.value)}
                  style={{ ...boxBase, width: '100%', appearance: 'none', WebkitAppearance: 'none', padding: '13px 40px 13px 15px', fontWeight: rewardId ? 600 : 500, color: rewardId ? TK.text : TK.textFaint, cursor: 'pointer' }}>
                  <option value="">{t('admin.settings.birthdayNoReward', '— Pick a reward from the catalog —')}</option>
                  {activeRewards.map(r => <option key={r.id} value={r.id}>{rewardLabel(r)}</option>)}
                </select>
                <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                  <Ico ch={ICON.chevD} size={16} color={TK.textMute} stroke={2.2} />
                </span>
              </div>
              <div style={helpText}>{t('admin.settings.birthdayRewardHint', 'The member sees this reward as a claimable item in their Rewards page on their birthday.')}</div>
            </div>

            {/* points */}
            <div>
              <div style={fieldLabel}>{t('admin.settings.birthdayPoints', 'Bonus points')}</div>
              <div style={{ ...boxBase, display: 'flex', alignItems: 'center', gap: 10, padding: '4px 15px' }}>
                <input type="number" inputMode="numeric" min="0" max="10000" value={points}
                  onChange={e => setPoints(e.target.value)} placeholder="0"
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', padding: '9px 0', fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text }} />
                <span style={{ fontFamily: FK.mono, fontSize: 12.5, fontWeight: 700, color: TK.textMute }}>{t('admin.settings.birthdayPointsUnit', 'points')}</span>
              </div>
              <div style={helpText}>{t('admin.settings.birthdayPointsHint', 'Awarded in addition to the reward above. Leave at 0 to skip.')}</div>
            </div>
          </div>

          {/* message */}
          <div style={{ marginTop: 22 }}>
            <div style={fieldLabel}>{t('admin.settings.birthdayMessage', 'Custom message (optional)')}</div>
            <textarea rows={2} maxLength={140} value={message} onChange={e => setMessage(e.target.value)}
              placeholder={t('admin.settings.birthdayMessagePlaceholder', 'Happy birthday from the team! 🎂')}
              style={{ ...boxBase, width: '100%', padding: '14px 15px', resize: 'none', outline: 'none', lineHeight: 1.45 }} />
          </div>

          {/* preview chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 20, padding: '13px 16px', borderRadius: 13, background: TK.accentWash, border: `1px solid ${TK.accentSoft}` }}>
            <Ico ch={ICON.bolt} size={16} color={TK.accent} stroke={2.2} style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.accentInk, lineHeight: 1.45 }}>
              {t('admin.settings.birthdayPreview', 'When active, this automation runs every morning and delivers the day\'s birthday rewards.')}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
            <PrimaryBtn icon={ICON.gift} onClick={handleSave} disabled={saving}>
              {saving ? t('admin.settings.saving', 'Saving...') : t('admin.settings.save', 'Save')}
            </PrimaryBtn>
          </div>
        </div>
      </Card>
    </FadeIn>
  );
}
