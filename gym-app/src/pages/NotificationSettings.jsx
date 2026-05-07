import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell, BellOff, Settings, ShieldCheck, Megaphone, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePostHog } from '@posthog/react';

// Notification preference columns grouped by Apple 4.5.4 category.
// Transactional notifications relate to the user's own data + service-critical
// alerts (rest timer, workout reminders the user opted into, streak warnings).
// Promotional includes everything that is marketing-style or social — a user
// must be able to disable these without breaking the app.
const TRANSACTIONAL_COLUMNS = [
  { col: 'notif_workout_reminders', titleKey: 'workoutReminders', descKey: 'workoutRemindersDesc' },
  { col: 'notif_streak_alerts',     titleKey: 'streakAlerts',     descKey: 'streakAlertsDesc' },
];

const PROMOTIONAL_COLUMNS = [
  { col: 'notif_friend_activity',    titleKey: 'friendActivity',    descKey: 'friendActivityDesc' },
  { col: 'notif_challenge_updates',  titleKey: 'challengeUpdates',  descKey: 'challengeUpdatesDesc' },
  { col: 'notif_milestone_alerts',   titleKey: 'milestoneAlerts',   descKey: 'milestoneAlertsDesc' },
  { col: 'notif_reward_reminders',   titleKey: 'rewardReminders',   descKey: 'rewardRemindersDesc' },
  { col: 'notif_weekly_summary',     titleKey: 'weeklySummary',     descKey: 'weeklySummaryDesc' },
];

// Inline switch component matching the app's existing role="switch" pattern.
function PrefSwitch({ checked, onChange, ariaLabel, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-12 h-7 rounded-full relative flex-shrink-0 transition-colors focus:ring-2 focus:ring-[var(--color-accent)]/40 focus:outline-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      style={{ backgroundColor: checked ? 'var(--color-accent, #D4AF37)' : 'var(--color-text-muted)' }}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{ left: checked ? 'calc(100% - 23px)' : '3px' }}
      />
    </button>
  );
}

export default function NotificationSettings() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const posthog = usePostHog();
  const [prefs, setPrefs] = useState({
    notif_push_enabled: true,
    notif_workout_reminders: true,
    notif_streak_alerts: true,
    notif_friend_activity: true,
    notif_challenge_updates: true,
    notif_milestone_alerts: true,
    notif_reward_reminders: true,
    notif_weekly_summary: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    // Server is source of truth on (re)mount. updatePref applies optimistic
    // updates synchronously and only re-runs this effect on a profile-id
    // change, so there's nothing in flight to "preserve" — spreading prior
    // local state here would clobber DB values with stale defaults.
    setPrefs({
      notif_push_enabled:       profile.notif_push_enabled       ?? true,
      notif_workout_reminders:  profile.notif_workout_reminders  ?? true,
      notif_streak_alerts:      profile.notif_streak_alerts      ?? true,
      notif_friend_activity:    profile.notif_friend_activity    ?? true,
      notif_challenge_updates:  profile.notif_challenge_updates  ?? true,
      notif_milestone_alerts:   profile.notif_milestone_alerts   ?? true,
      notif_reward_reminders:   profile.notif_reward_reminders   ?? true,
      notif_weekly_summary:     profile.notif_weekly_summary     ?? true,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const updatePref = async (col, newVal) => {
    if (!user?.id) return;
    setPrefs((p) => ({ ...p, [col]: newVal }));
    setSaving(true);
    try {
      await supabase.from('profiles').update({ [col]: newVal }).eq('id', user.id);
      posthog?.capture('notification_setting_toggled', { setting_name: col, enabled: newVal });
    } finally {
      setSaving(false);
    }
  };

  // Bulk toggle a group of columns. Used by "turn all promotional off"-style buttons.
  const updateGroup = async (cols, newVal) => {
    if (!user?.id) return;
    const updates = cols.reduce((acc, c) => ({ ...acc, [c]: newVal }), {});
    setPrefs((p) => ({ ...p, ...updates }));
    setSaving(true);
    try {
      await supabase.from('profiles').update(updates).eq('id', user.id);
      posthog?.capture('notification_setting_toggled', { setting_name: 'group', columns: cols, enabled: newVal });
    } finally {
      setSaving(false);
    }
  };

  const masterEnabled    = prefs.notif_push_enabled !== false;
  const promotionalCols  = PROMOTIONAL_COLUMNS.map((r) => r.col);
  const promotionalAnyOn = promotionalCols.some((c) => prefs[c] !== false);
  const transactionalAnyOff = TRANSACTIONAL_COLUMNS.some((r) => prefs[r.col] === false);

  return (
    <div className="min-h-screen pb-28 md:pb-12" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => navigate(-1)}
            aria-label={t('settings.goBack', 'Go back')}
            className="w-11 h-11 flex items-center justify-center rounded-xl transition-colors focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
            style={{ color: 'var(--color-text-muted)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
            <Bell size={18} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h1 className="text-[18px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{t('notificationSettings.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-[480px] md:max-w-4xl lg:max-w-6xl mx-auto space-y-4">
        {/* Master push toggle — required for any push to deliver */}
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: masterEnabled ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)' }}>
              {masterEnabled
                ? <Bell size={24} style={{ color: 'var(--color-success)' }} />
                : <BellOff size={24} style={{ color: 'var(--color-text-muted)' }} />
              }
            </div>
            <div className="flex-1">
              <p className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {masterEnabled ? t('notificationSettings.notificationsActive') : t('notificationSettings.allNotificationsOff')}
              </p>
              <p className="text-[12px]" style={{ color: masterEnabled ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {masterEnabled ? t('notificationSettings.receivingAll') : t('notificationSettings.wontReceiveAny')}
              </p>
            </div>
            <PrefSwitch
              checked={masterEnabled}
              onChange={(v) => updatePref('notif_push_enabled', v)}
              ariaLabel={t('notificationSettings.pushNotifications')}
              disabled={saving}
            />
          </div>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t('notificationSettings.masterDesc', 'Master switch. Turning this off disables every notification below.')}
          </p>
        </div>

        {/* Transactional section — service-critical alerts */}
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="px-5 pt-5 pb-3 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'rgba(16,185,129,0.1)' }}>
              <ShieldCheck size={18} style={{ color: 'var(--color-success)' }} />
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {t('notificationSettings.transactionalTitle', 'Service & account alerts')}
              </p>
              <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('notificationSettings.transactionalDesc', 'Workout reminders you scheduled, rest timer, streak protection, and account-safety alerts. We recommend keeping these on.')}
              </p>
            </div>
          </div>

          {transactionalAnyOff && (
            <div className="mx-5 mb-3 rounded-xl p-3 flex items-start gap-2"
              style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <AlertTriangle size={14} style={{ color: 'var(--color-warning, #F59E0B)' }} className="mt-0.5 shrink-0" />
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
                {t('notificationSettings.transactionalWarning', "You'll miss critical alerts like rest-timer endings and streak warnings while these are off.")}
              </p>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--color-border-default)' }}>
            {TRANSACTIONAL_COLUMNS.map((row, i) => (
              <div key={row.col}
                className="flex items-center gap-3 px-5 py-3.5"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-default)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t(`notificationSettings.${row.titleKey}`)}
                  </p>
                  <p className="text-[11.5px] leading-relaxed mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t(`notificationSettings.${row.descKey}`)}
                  </p>
                </div>
                <PrefSwitch
                  checked={prefs[row.col] !== false && masterEnabled}
                  onChange={(v) => updatePref(row.col, v)}
                  ariaLabel={t(`notificationSettings.${row.titleKey}`)}
                  disabled={saving || !masterEnabled}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Promotional / Announcements section */}
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="px-5 pt-5 pb-3 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
              <Megaphone size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {t('notificationSettings.promotionalTitle', 'Announcements & social')}
              </p>
              <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {t('notificationSettings.promotionalDesc', 'Gym news, challenges, friend activity, milestones, and reward nudges. Turn off any you don\'t want — the app keeps working normally.')}
              </p>
            </div>
          </div>

          <div className="px-5 pb-3">
            <button
              type="button"
              onClick={() => updateGroup(promotionalCols, !promotionalAnyOn)}
              disabled={saving || !masterEnabled}
              className="text-[12px] font-semibold py-1.5 px-3 rounded-lg transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
                color: 'var(--color-accent)',
                border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
              }}
            >
              {promotionalAnyOn
                ? t('notificationSettings.turnAllOff')
                : t('notificationSettings.turnAllOn')}
            </button>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border-default)' }}>
            {PROMOTIONAL_COLUMNS.map((row, i) => (
              <div key={row.col}
                className="flex items-center gap-3 px-5 py-3.5"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--color-border-default)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {t(`notificationSettings.${row.titleKey}`)}
                  </p>
                  <p className="text-[11.5px] leading-relaxed mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t(`notificationSettings.${row.descKey}`)}
                  </p>
                </div>
                <PrefSwitch
                  checked={prefs[row.col] !== false && masterEnabled}
                  onChange={(v) => updatePref(row.col, v)}
                  ariaLabel={t(`notificationSettings.${row.titleKey}`)}
                  disabled={saving || !masterEnabled}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Settings hint */}
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-start gap-3">
            <Settings size={16} style={{ color: 'var(--color-text-muted)' }} className="mt-0.5 shrink-0" />
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {t('notificationSettings.settingsHint')}
            </p>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-center px-4" style={{ color: 'var(--color-text-muted)' }}>
          {t('notificationSettings.noSpamDisclaimer')}
        </p>
      </div>
    </div>
  );
}
