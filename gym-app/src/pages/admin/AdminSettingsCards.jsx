/**
 * AdminSettingsCards — per-gym tuning for the print-card retention engine.
 *
 * Three sections:
 *   1. Brand fields used inside the card designs
 *      → cup_noun (HabitCard pickup ticket) + founded_year (Tenure365 back panel)
 *      → stored on the `gyms` row directly (migration 0417)
 *   2. Behavior tunables that drive the daily generator + upcoming RPC
 *      → habit_window_days, habit_target_count, habit_dedup_days,
 *        returning_silence_days, birthday_lookahead_days
 *      → stored on `gym_card_settings` (migration 0415)
 *   3. Per-occasion enable toggles + default reward labels
 *      → enable_* booleans control whether the cron generates cards for
 *        each occasion (off = silent for that occasion)
 *      → default_rewards maps occasion → label so the attach modal can
 *        pre-fill ("shaker", "free smoothie", etc.)
 *
 * All three save in one batch — atomic from the admin's POV.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Printer, ArrowLeft } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';

// Source of truth for occasion-level controls. Order matters — it
// drives the rendered list order in both Enable + Default-rewards sections.
const OCCASIONS = [
  { key: 'welcome',       enableKey: 'enable_welcome'       },
  { key: 'habit_9in6',    enableKey: 'enable_habit_9in6'    },
  { key: 'tenure_30',     enableKey: 'enable_tenure_30'     },
  { key: 'tenure_90',     enableKey: 'enable_tenure_90'     },
  { key: 'tenure_365',    enableKey: 'enable_tenure_365'    },
  { key: 'milestone_100', enableKey: 'enable_milestone_100' },
  { key: 'milestone_250', enableKey: 'enable_milestone_250' },
  { key: 'milestone_500', enableKey: 'enable_milestone_500' },
  { key: 'returning',     enableKey: 'enable_returning'     },
  { key: 'birthday',      enableKey: 'enable_birthday'      },
];

const DEFAULTS = {
  cup_noun: '',
  founded_year: '',
  habit_window_days: 42,
  habit_target_count: 9,
  habit_dedup_days: 90,
  returning_silence_days: 21,
  birthday_lookahead_days: 3,
  default_rewards: {},
  enable_welcome: true,
  enable_habit_9in6: true,
  enable_tenure_30: true,
  enable_tenure_90: true,
  enable_tenure_365: true,
  enable_milestone_100: true,
  enable_milestone_250: true,
  enable_milestone_500: true,
  enable_returning: true,
  enable_birthday: true,
};

export default function AdminSettingsCards() {
  const { profile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [form, setForm] = useState(DEFAULTS);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = `${t('admin.settings.cardsTitle', { defaultValue: 'Print cards' })} | ${window.__APP_NAME || 'TuGymPR'}`;
  }, [t]);

  // Pull both rows in parallel — gym (for cup_noun + founded_year) and
  // gym_card_settings (for the rest). gym_card_settings may not exist yet
  // for this gym; the form just shows DEFAULTS in that case.
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

  // Hydrate the form when the query resolves. setState-in-effect is the
  // valid pattern here — local form state must follow async-loaded server data.
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
  const setReward = (occasion, label) => setForm((prev) => ({
    ...prev,
    default_rewards: { ...prev.default_rewards, [occasion]: label },
  }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Validation
      if (form.habit_window_days < 7 || form.habit_window_days > 365) {
        throw new Error(t('admin.settings.cardsErrWindow', { defaultValue: 'Habit window must be between 7 and 365 days' }));
      }
      if (form.habit_target_count < 1 || form.habit_target_count > 50) {
        throw new Error(t('admin.settings.cardsErrTarget', { defaultValue: 'Habit target must be between 1 and 50 workouts' }));
      }

      // Strip empty-string reward labels — empty means "no default for this occasion".
      const cleanRewards = Object.fromEntries(
        Object.entries(form.default_rewards).filter(([, v]) => v && v.trim().length > 0)
      );

      // Two writes — gym (cup_noun + founded_year) + gym_card_settings (everything else).
      const { error: gymErr } = await supabase
        .from('gyms')
        .update({
          cup_noun: form.cup_noun.trim() || null,
          founded_year: form.founded_year.trim() || null,
        })
        .eq('id', gymId);
      if (gymErr) throw gymErr;

      const { error: settingsErr } = await supabase
        .from('gym_card_settings')
        .upsert({
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
      // Print preview reads cup_noun/founded_year via its own query; bust it.
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
        <p className="text-center py-8" style={{ color: 'var(--color-text-subtle)' }}>
          {t('admin.unauthorized', { defaultValue: 'Not authorized' })}
        </p>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.settings.cardsTitle', { defaultValue: 'Print card settings' })}
        subtitle={t('admin.settings.cardsSubtitle', { defaultValue: 'Tune what fires, when it fires, and what gets rewarded' })}
        actions={(
          <Link
            to="/admin/settings"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-semibold transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-deep)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-muted)',
            }}
          >
            <ArrowLeft size={14} />
            {t('admin.settings.title', { defaultValue: 'Settings' })}
          </Link>
        )}
        className="mb-4"
      />

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <FadeIn>
          <div className="space-y-4">

            {/* ── Section 1: Brand fields used inside the card designs ───── */}
            <AdminCard>
              <SectionLabel>{t('admin.settings.cardsBrandSection', { defaultValue: 'Brand details' })}</SectionLabel>
              <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.settings.cardsBrandHelp', {
                  defaultValue: 'These appear on specific cards. Leave blank to skip.',
                })}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field
                  label={t('admin.settings.cardsCupNoun', { defaultValue: 'What you call your drinkware' })}
                  hint={t('admin.settings.cardsCupNounHint', { defaultValue: 'Used on the Habit pickup ticket: "One shaker, with your name on it." Try: shaker / bottle / cup / jug.' })}
                  value={form.cup_noun}
                  onChange={set('cup_noun')}
                  placeholder="shaker"
                  maxLength={20}
                />
                <Field
                  label={t('admin.settings.cardsFoundedYear', { defaultValue: 'Founding year' })}
                  hint={t('admin.settings.cardsFoundedYearHint', { defaultValue: 'Shown quietly on the Tenure-365 folded card back panel as "est. ____".' })}
                  value={form.founded_year}
                  onChange={set('founded_year')}
                  placeholder="2018"
                  maxLength={8}
                />
              </div>
            </AdminCard>

            {/* ── Section 2: Behavior tunables ─────────────────────────── */}
            <AdminCard>
              <SectionLabel>{t('admin.settings.cardsBehaviorSection', { defaultValue: 'Behavior' })}</SectionLabel>
              <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.settings.cardsBehaviorHelp', {
                  defaultValue: 'Controls when the daily generator queues cards. Defaults are tuned for PR-market gyms.',
                })}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <NumberField
                  label={t('admin.settings.cardsHabitWindow', { defaultValue: 'Habit window (days)' })}
                  hint={t('admin.settings.cardsHabitWindowHint', { defaultValue: 'Rolling window for the "N sessions in M days" habit card.' })}
                  value={form.habit_window_days}
                  onChange={set('habit_window_days')}
                  min={7} max={365}
                />
                <NumberField
                  label={t('admin.settings.cardsHabitTarget', { defaultValue: 'Habit target (workouts)' })}
                  hint={t('admin.settings.cardsHabitTargetHint', { defaultValue: 'Workouts in the window required to earn the card. Default 9.' })}
                  value={form.habit_target_count}
                  onChange={set('habit_target_count')}
                  min={1} max={50}
                />
                <NumberField
                  label={t('admin.settings.cardsHabitDedup', { defaultValue: 'Habit re-fire wait (days)' })}
                  hint={t('admin.settings.cardsHabitDedupHint', { defaultValue: 'After earning the habit card, how long before they can earn it again.' })}
                  value={form.habit_dedup_days}
                  onChange={set('habit_dedup_days')}
                  min={1} max={365}
                />
                <NumberField
                  label={t('admin.settings.cardsReturning', { defaultValue: 'Returning silence (days)' })}
                  hint={t('admin.settings.cardsReturningHint', { defaultValue: 'Days of absence that trigger the "good to see you back" card.' })}
                  value={form.returning_silence_days}
                  onChange={set('returning_silence_days')}
                  min={7} max={180}
                />
                <NumberField
                  label={t('admin.settings.cardsBirthday', { defaultValue: 'Birthday lookahead (days)' })}
                  hint={t('admin.settings.cardsBirthdayHint', { defaultValue: 'How far ahead of a birthday to queue the card.' })}
                  value={form.birthday_lookahead_days}
                  onChange={set('birthday_lookahead_days')}
                  min={0} max={14}
                />
              </div>
            </AdminCard>

            {/* ── Section 3: Per-occasion toggles + default rewards ────── */}
            <AdminCard>
              <SectionLabel>{t('admin.settings.cardsOccasionsSection', { defaultValue: 'Occasions' })}</SectionLabel>
              <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-subtle)' }}>
                {t('admin.settings.cardsOccasionsHelp', {
                  defaultValue: 'Toggle which cards the system generates. Optional default reward label pre-fills the attach modal.',
                })}
              </p>
              <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
                {OCCASIONS.map((occ) => {
                  const enabled = form[occ.enableKey];
                  // Returning cards intentionally never carry rewards (don't reward absence).
                  const supportsReward = occ.key !== 'returning';
                  return (
                    <li key={occ.key} className="py-2.5 flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => set(occ.enableKey)(!enabled)}
                        className="w-10 h-6 rounded-full relative transition flex-shrink-0"
                        style={{
                          background: enabled ? 'var(--color-accent)' : 'var(--color-bg-hover)',
                        }}
                        aria-pressed={enabled}
                      >
                        <span
                          className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                          style={{
                            left: enabled ? 'calc(100% - 22px)' : '2px',
                            background: 'var(--color-bg-card)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                          }}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                          {t(`admin.printCards.occasions.${occ.key}`, occ.key)}
                        </p>
                      </div>
                      {supportsReward && enabled && (
                        <input
                          type="text"
                          value={form.default_rewards[occ.key] || ''}
                          onChange={(e) => setReward(occ.key, e.target.value)}
                          placeholder={t('admin.settings.cardsRewardPlaceholder', { defaultValue: 'Default reward (optional)' })}
                          maxLength={60}
                          className="text-[12px] px-2.5 py-1.5 rounded-lg flex-shrink-0 w-full md:w-56"
                          style={{
                            background: 'var(--color-bg-input)',
                            border: '1px solid var(--color-border-default)',
                            color: 'var(--color-text-primary)',
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </AdminCard>

            {/* Save */}
            {error && (
              <div className="px-3 py-2 rounded-lg text-[12px]"
                style={{
                  background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)',
                  color: 'var(--color-danger)',
                }}>
                {error}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold transition active:scale-95 disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
              >
                <Save size={13} />
                {saveMutation.isPending
                  ? t('admin.settings.saving', { defaultValue: 'Saving…' })
                  : t('admin.settings.save', { defaultValue: 'Save changes' })}
              </button>
            </div>
          </div>
        </FadeIn>
      )}
    </AdminPageShell>
  );
}

function Field({ label, hint, value, onChange, placeholder, maxLength }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="w-full px-3 py-2 rounded-lg text-[13px]"
        style={{
          background: 'var(--color-bg-input)',
          border: '1px solid var(--color-border-default)',
          color: 'var(--color-text-primary)',
        }}
      />
      {hint && (
        <p className="text-[10.5px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{hint}</p>
      )}
    </div>
  );
}

function NumberField({ label, hint, value, onChange, min, max }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-subtle)' }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min={min}
        max={max}
        className="w-full px-3 py-2 rounded-lg text-[13px]"
        style={{
          background: 'var(--color-bg-input)',
          border: '1px solid var(--color-border-default)',
          color: 'var(--color-text-primary)',
        }}
      />
      {hint && (
        <p className="text-[10.5px] mt-1" style={{ color: 'var(--color-text-subtle)' }}>{hint}</p>
      )}
    </div>
  );
}
