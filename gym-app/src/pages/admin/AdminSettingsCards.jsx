/**
 * AdminSettingsCards — per-gym tuning for the print-card retention engine:
 *   1. Brand fields (cup_noun + founded_year on `gyms`)
 *   2. Behavior tunables (gym_card_settings)
 *   3. Per-occasion enable toggles + default reward labels
 * All save in one batch. Restyled onto settingsKit.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import { TK, FK, Card, DIC, SettingsHeader, CardHd, Fld, Help, Toggle, TextField, SaveBar } from './components/settingsKit';

const OCCASIONS = [
  { key: 'welcome', enableKey: 'enable_welcome' },
  { key: 'habit_9in6', enableKey: 'enable_habit_9in6' },
  { key: 'tenure_30', enableKey: 'enable_tenure_30' },
  { key: 'tenure_90', enableKey: 'enable_tenure_90' },
  { key: 'tenure_365', enableKey: 'enable_tenure_365' },
  { key: 'milestone_100', enableKey: 'enable_milestone_100' },
  { key: 'milestone_250', enableKey: 'enable_milestone_250' },
  { key: 'milestone_500', enableKey: 'enable_milestone_500' },
  { key: 'returning', enableKey: 'enable_returning' },
  { key: 'birthday', enableKey: 'enable_birthday' },
];

const DEFAULTS = {
  cup_noun: '', founded_year: '',
  habit_window_days: 42, habit_target_count: 9, habit_dedup_days: 90,
  returning_silence_days: 21, birthday_lookahead_days: 3,
  default_rewards: {},
  enable_welcome: true, enable_habit_9in6: true, enable_tenure_30: true, enable_tenure_90: true,
  enable_tenure_365: true, enable_milestone_100: true, enable_milestone_250: true,
  enable_milestone_500: true, enable_returning: true, enable_birthday: true,
};

function Field({ label, hint, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <Fld style={{ margin: '0 0 8px' }}>{label}</Fld>
      <TextField value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} />
      {hint && <Help>{hint}</Help>}
    </div>
  );
}

function NumberField({ label, hint, value, onChange, min, max }) {
  return (
    <div>
      <Fld style={{ margin: '0 0 8px' }}>{label}</Fld>
      <TextField type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)} min={min} max={max} mono />
      {hint && <Help>{hint}</Help>}
    </div>
  );
}

export default function AdminSettingsCards() {
  const { profile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [form, setForm] = useState(DEFAULTS);
  const [error, setError] = useState('');

  useEffect(() => { document.title = `${t('admin.settings.cardsTitle', { defaultValue: 'Print cards' })} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: loaded, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'cards'],
    queryFn: async () => {
      const [gymRes, settingsRes] = await Promise.all([
        supabase.from('gyms').select('cup_noun, founded_year').eq('id', gymId).maybeSingle(),
        supabase.from('gym_card_settings').select('*').eq('gym_id', gymId).maybeSingle(),
      ]);
      return {
        cup_noun: gymRes.data?.cup_noun || '',
        founded_year: gymRes.data?.founded_year || '',
        settings: settingsRes.data || null,
      };
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    if (!loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((prev) => ({
      ...prev,
      cup_noun: loaded.cup_noun,
      founded_year: loaded.founded_year,
      ...(loaded.settings ? {
        habit_window_days: loaded.settings.habit_window_days ?? DEFAULTS.habit_window_days,
        habit_target_count: loaded.settings.habit_target_count ?? DEFAULTS.habit_target_count,
        habit_dedup_days: loaded.settings.habit_dedup_days ?? DEFAULTS.habit_dedup_days,
        returning_silence_days: loaded.settings.returning_silence_days ?? DEFAULTS.returning_silence_days,
        birthday_lookahead_days: loaded.settings.birthday_lookahead_days ?? DEFAULTS.birthday_lookahead_days,
        default_rewards: loaded.settings.default_rewards || {},
        enable_welcome: loaded.settings.enable_welcome ?? true,
        enable_habit_9in6: loaded.settings.enable_habit_9in6 ?? true,
        enable_tenure_30: loaded.settings.enable_tenure_30 ?? true,
        enable_tenure_90: loaded.settings.enable_tenure_90 ?? true,
        enable_tenure_365: loaded.settings.enable_tenure_365 ?? true,
        enable_milestone_100: loaded.settings.enable_milestone_100 ?? true,
        enable_milestone_250: loaded.settings.enable_milestone_250 ?? true,
        enable_milestone_500: loaded.settings.enable_milestone_500 ?? true,
        enable_returning: loaded.settings.enable_returning ?? true,
        enable_birthday: loaded.settings.enable_birthday ?? true,
      } : {}),
    }));
  }, [loaded]);

  const set = (key) => (val) => setForm((prev) => ({ ...prev, [key]: val }));
  const setReward = (occasion, label) => setForm((prev) => ({ ...prev, default_rewards: { ...prev.default_rewards, [occasion]: label } }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (form.habit_window_days < 7 || form.habit_window_days > 365) {
        throw new Error(t('admin.settings.cardsErrWindow', { defaultValue: 'Habit window must be between 7 and 365 days' }));
      }
      if (form.habit_target_count < 1 || form.habit_target_count > 50) {
        throw new Error(t('admin.settings.cardsErrTarget', { defaultValue: 'Habit target must be between 1 and 50 workouts' }));
      }
      const cleanRewards = Object.fromEntries(Object.entries(form.default_rewards).filter(([, v]) => v && v.trim().length > 0));

      const { error: gymErr } = await supabase.from('gyms').update({
        cup_noun: form.cup_noun.trim() || null,
        founded_year: form.founded_year.trim() || null,
      }).eq('id', gymId);
      if (gymErr) throw gymErr;

      const { error: settingsErr } = await supabase.from('gym_card_settings').upsert({
        gym_id: gymId,
        habit_window_days: form.habit_window_days,
        habit_target_count: form.habit_target_count,
        habit_dedup_days: form.habit_dedup_days,
        returning_silence_days: form.returning_silence_days,
        birthday_lookahead_days: form.birthday_lookahead_days,
        default_rewards: cleanRewards,
        enable_welcome: form.enable_welcome,
        enable_habit_9in6: form.enable_habit_9in6,
        enable_tenure_30: form.enable_tenure_30,
        enable_tenure_90: form.enable_tenure_90,
        enable_tenure_365: form.enable_tenure_365,
        enable_milestone_100: form.enable_milestone_100,
        enable_milestone_250: form.enable_milestone_250,
        enable_milestone_500: form.enable_milestone_500,
        enable_returning: form.enable_returning,
        enable_birthday: form.enable_birthday,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'gym_id' });
      if (settingsErr) throw settingsErr;
    },
    onSuccess: () => {
      logAdminAction('settings_cards_updated', 'gym_card_settings', gymId);
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      queryClient.invalidateQueries({ queryKey: ['print-cards-gym-extras', gymId] });
      queryClient.invalidateQueries({ queryKey: ['gym-card-settings', gymId] });
      showToast(t('admin.settings.cardsSaved', { defaultValue: 'Card settings saved' }), 'success');
      setError('');
    },
    onError: (err) => setError(err?.message || 'Save failed'),
  });

  if (!isAuthorized) {
    return (
      <AdminPageShell>
        <Card style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: FK.body, fontSize: 14, color: TK.textMute }}>{t('admin.unauthorized', { defaultValue: 'Not authorized' })}</p>
        </Card>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <SettingsHeader t={t} title={t('admin.settings.cardsTitle', { defaultValue: 'Print card settings' })} sub={t('admin.settings.cardsSubtitle', { defaultValue: 'Tune what fires, when it fires, and what gets rewarded' })} />

      {isLoading ? (
        <div style={{ marginTop: 22 }}><CardSkeleton h="h-[200px]" /></div>
      ) : (
        <FadeIn>
          <div style={{ marginTop: 22 }}>
            {/* Section 1: brand details */}
            <Card style={{ padding: '22px 24px' }}>
              <CardHd icon={DIC.printer}>{t('admin.settings.cardsBrandSection', { defaultValue: 'Brand details' })}</CardHd>
              <Help>{t('admin.settings.cardsBrandHelp', { defaultValue: 'These appear on specific cards. Leave blank to skip.' })}</Help>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }}>
                <Field label={t('admin.settings.cardsCupNoun', { defaultValue: 'What you call your drinkware' })} hint={t('admin.settings.cardsCupNounHint', { defaultValue: 'Used on the Habit pickup ticket: "One shaker, with your name on it." Try: shaker / bottle / cup / jug.' })} value={form.cup_noun} onChange={set('cup_noun')} placeholder="shaker" maxLength={20} />
                <Field label={t('admin.settings.cardsFoundedYear', { defaultValue: 'Founding year' })} hint={t('admin.settings.cardsFoundedYearHint', { defaultValue: 'Shown quietly on the Tenure-365 folded card back panel as "est. ____".' })} value={form.founded_year} onChange={set('founded_year')} placeholder="2018" maxLength={8} />
              </div>
            </Card>

            {/* Section 2: behavior */}
            <Card style={{ padding: '22px 24px', marginTop: 16 }}>
              <CardHd icon={DIC.clock}>{t('admin.settings.cardsBehaviorSection', { defaultValue: 'Behavior' })}</CardHd>
              <Help>{t('admin.settings.cardsBehaviorHelp', { defaultValue: 'Controls when the daily generator queues cards. Defaults are tuned for PR-market gyms.' })}</Help>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', marginTop: 8 }}>
                <NumberField label={t('admin.settings.cardsHabitWindow', { defaultValue: 'Habit window (days)' })} hint={t('admin.settings.cardsHabitWindowHint', { defaultValue: 'Rolling window for the "N sessions in M days" habit card.' })} value={form.habit_window_days} onChange={set('habit_window_days')} min={7} max={365} />
                <NumberField label={t('admin.settings.cardsHabitTarget', { defaultValue: 'Habit target (workouts)' })} hint={t('admin.settings.cardsHabitTargetHint', { defaultValue: 'Workouts in the window required to earn the card. Default 9.' })} value={form.habit_target_count} onChange={set('habit_target_count')} min={1} max={50} />
                <NumberField label={t('admin.settings.cardsHabitDedup', { defaultValue: 'Habit re-fire wait (days)' })} hint={t('admin.settings.cardsHabitDedupHint', { defaultValue: 'After earning the habit card, how long before they can earn it again.' })} value={form.habit_dedup_days} onChange={set('habit_dedup_days')} min={1} max={365} />
                <NumberField label={t('admin.settings.cardsReturning', { defaultValue: 'Returning silence (days)' })} hint={t('admin.settings.cardsReturningHint', { defaultValue: 'Days of absence that trigger the "good to see you back" card.' })} value={form.returning_silence_days} onChange={set('returning_silence_days')} min={7} max={180} />
                <NumberField label={t('admin.settings.cardsBirthday', { defaultValue: 'Birthday lookahead (days)' })} hint={t('admin.settings.cardsBirthdayHint', { defaultValue: 'How far ahead of a birthday to queue the card.' })} value={form.birthday_lookahead_days} onChange={set('birthday_lookahead_days')} min={0} max={14} />
              </div>
            </Card>

            {/* Section 3: occasions */}
            <Card style={{ padding: '22px 24px', marginTop: 16 }}>
              <CardHd icon={DIC.printer}>{t('admin.settings.cardsOccasionsSection', { defaultValue: 'Occasions' })}</CardHd>
              <Help>{t('admin.settings.cardsOccasionsHelp', { defaultValue: 'Toggle which cards the system generates. Optional default reward label pre-fills the attach modal.' })}</Help>
              <div style={{ marginTop: 10 }}>
                {OCCASIONS.map((occ) => {
                  const enabled = form[occ.enableKey];
                  const supportsReward = occ.key !== 'returning';
                  return (
                    <div key={occ.key} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderTop: `1px solid ${TK.divider}`, flexWrap: 'wrap' }}>
                      <Toggle on={enabled} onClick={() => set(occ.enableKey)(!enabled)} />
                      <span style={{ flex: 1, minWidth: 120, fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text }}>{t(`admin.printCards.occasions.${occ.key}`, occ.key)}</span>
                      {supportsReward && enabled && (
                        <TextField value={form.default_rewards[occ.key] || ''} onChange={(e) => setReward(occ.key, e.target.value)} placeholder={t('admin.settings.cardsRewardPlaceholder', { defaultValue: 'Default reward (optional)' })} maxLength={60} style={{ width: 230, flexShrink: 0, fontSize: 13, padding: '10px 14px' }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {error && (
              <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, fontFamily: FK.body, fontSize: 12.5, background: 'var(--color-danger-soft)', color: 'var(--color-danger-ink, var(--color-danger))', border: '1px solid color-mix(in srgb, var(--color-danger) 20%, transparent)' }}>
                {error}
              </div>
            )}

            <SaveBar onClick={() => saveMutation.mutate()} saving={saveMutation.isPending} label={t('admin.settings.save', { defaultValue: 'Save changes' })} savingLabel={t('admin.settings.saving', { defaultValue: 'Saving…' })} />
          </div>
        </FadeIn>
      )}
    </AdminPageShell>
  );
}
