import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell, BellOff, Settings } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function NotificationSettings() {
  const navigate = useNavigate();
  const { t } = useTranslation('pages');
  const { user, profile } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setEnabled(profile.notif_push_enabled ?? true);
  }, [profile]);

  const toggleNotifications = async () => {
    const newVal = !enabled;
    setEnabled(newVal);
    setSaving(true);
    // Enable/disable all notification types at once
    const updates = {
      notif_push_enabled: newVal,
      notif_workout_reminders: newVal,
      notif_streak_alerts: newVal,
      notif_weekly_summary: newVal,
      notif_friend_activity: newVal,
      notif_milestone_alerts: newVal,
      notif_challenge_updates: newVal,
      notif_reward_reminders: newVal,
    };
    await supabase.from('profiles').update(updates).eq('id', user.id);
    setSaving(false);
  };

  return (
    <div className="min-h-screen pb-32" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur-2xl" style={{ backgroundColor: 'var(--color-bg-nav)', borderBottom: '1px solid var(--color-border-default)' }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
            style={{ color: 'var(--color-text-muted)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' }}>
            <Bell size={18} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h1 className="text-[18px] font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('notificationSettings.title')}</h1>
        </div>
      </div>

      <div className="px-4 pt-5 max-w-lg mx-auto space-y-4">
        {/* Status Card */}
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: enabled ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)' }}>
              {enabled
                ? <Bell size={24} style={{ color: '#10B981' }} />
                : <BellOff size={24} style={{ color: 'var(--color-text-muted)' }} />
              }
            </div>
            <div className="flex-1">
              <p className="text-[16px] font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {enabled ? t('notificationSettings.notificationsActive') : t('notificationSettings.allNotificationsOff')}
              </p>
              <p className="text-[12px]" style={{ color: enabled ? '#10B981' : 'var(--color-text-muted)' }}>
                {enabled ? t('notificationSettings.receivingAll', 'Receiving all notifications') : t('notificationSettings.wontReceiveAny')}
              </p>
            </div>
          </div>

          <button type="button" onClick={toggleNotifications} disabled={saving}
            className="w-full py-3 rounded-xl text-[14px] font-bold transition-colors disabled:opacity-50"
            style={enabled
              ? { backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.15)' }
              : { backgroundColor: 'var(--color-accent)', color: '#fff' }
            }>
            {saving
              ? t('notificationSettings.saving', 'Saving...')
              : enabled
                ? t('notificationSettings.turnAllOff')
                : t('notificationSettings.turnAllOn')
            }
          </button>
        </div>

        {/* Settings hint */}
        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
          <div className="flex items-start gap-3">
            <Settings size={16} style={{ color: 'var(--color-text-muted)' }} className="mt-0.5 shrink-0" />
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {t('notificationSettings.settingsHint', 'To manage notification permissions or fully deactivate notifications, go to your device Settings > Notifications > TuGymPR.')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
