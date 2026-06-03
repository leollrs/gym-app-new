/**
 * AdminSettingsRegistration: standalone sub-page for member registration
 * mode, class booking toggle, and birthday rewards. All three slices live
 * on the `gyms` row; self-contained query + save mutation.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Shield, CalendarDays, Cake, ArrowLeft } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell, Toggle } from '../../components/admin';

export default function AdminSettingsRegistration() {
  const { profile, refreshProfile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [registrationMode, setRegistrationMode] = useState('both');
  const [classesEnabled, setClassesEnabled] = useState(false);
  const [classesSaving, setClassesSaving] = useState(false);
  const [birthdayRewardsEnabled, setBirthdayRewardsEnabled] = useState(false);
  const [birthdayRewardPoints, setBirthdayRewardPoints] = useState(100);
  const [birthdayRewardMessage, setBirthdayRewardMessage] = useState('');

  useEffect(() => { document.title = `${t('admin.registrationMode.sectionTitle', 'Registration')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: gymData, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'registration'],
    queryFn: async () => {
      const { data, error: gymErr } = await supabase
        .from('gyms')
        .select('registration_mode, classes_enabled, birthday_rewards_enabled, birthday_reward_points, birthday_reward_message')
        .eq('id', gymId)
        .single();
      if (gymErr) logger.warn('Failed to load gym registration settings', gymErr);
      return data;
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    if (!gymData) return;
    setRegistrationMode(gymData.registration_mode ?? 'both');
    setClassesEnabled(gymData.classes_enabled ?? false);
    setBirthdayRewardsEnabled(gymData.birthday_rewards_enabled ?? false);
    setBirthdayRewardPoints(gymData.birthday_reward_points ?? 100);
    setBirthdayRewardMessage(gymData.birthday_reward_message ?? '');
  }, [gymData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error: gymErr } = await supabase.from('gyms').update({
        registration_mode: registrationMode,
        birthday_rewards_enabled: birthdayRewardsEnabled,
        birthday_reward_points: birthdayRewardPoints,
        birthday_reward_message: birthdayRewardMessage,
        updated_at: new Date().toISOString(),
      }).eq('id', gymId);
      if (gymErr) throw gymErr;
      logAdminAction('update_settings', 'gym', gymId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
      refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      showToast(t('admin.settings.settingsSaved', 'Settings saved'), 'success');
    },
    onError: (err) => {
      setError(err.message);
      showToast(err.message, 'error');
    },
  });

  if (!isAuthorized) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px] font-semibold" style={{ color: 'var(--color-danger, #EF4444)' }}>
          {t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}
        </p>
      </div>
    );
  }

  if (isLoading) return (
    <AdminPageShell className="space-y-4">
      <CardSkeleton h="h-[60px]" />
      <CardSkeleton h="h-[200px]" />
    </AdminPageShell>
  );

  const backLink = (
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
      {t('admin.settings.title', 'Settings')}
    </Link>
  );

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.registrationMode.sectionTitle', 'Registration')}
        subtitle={t('admin.settingsHub.registrationDesc', 'How members join your gym')}
        actions={backLink}
        className="mb-4"
      />

      {error && <p className="text-[13px] text-red-400 mb-4">{error}</p>}

      <div className="space-y-4 min-w-0">
        <FadeIn delay={0}>
          <AdminCard hover padding="p-4 sm:p-5">
            <SectionLabel icon={Shield} className="mb-4">{t('admin.registrationMode.sectionTitle')}</SectionLabel>
            <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.registrationMode.description')}</p>
            <div className="space-y-2">
              {[
                { value: 'invite_only', label: t('admin.registrationMode.inviteOnly'), desc: t('admin.registrationMode.inviteOnlyDesc') },
                { value: 'gym_code', label: t('admin.registrationMode.gymCode'), desc: t('admin.registrationMode.gymCodeDesc') },
                { value: 'both', label: t('admin.registrationMode.both'), desc: t('admin.registrationMode.bothDesc') },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRegistrationMode(opt.value)}
                  className="w-full flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-all border"
                  style={{
                    backgroundColor: registrationMode === opt.value
                      ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                      : 'var(--color-bg-deep)',
                    borderColor: registrationMode === opt.value
                      ? 'color-mix(in srgb, var(--color-accent) 30%, transparent)'
                      : 'var(--color-border-subtle)',
                  }}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors`}
                    style={{ borderColor: registrationMode === opt.value ? 'var(--color-accent)' : 'var(--color-text-faint)' }}>
                    {registrationMode === opt.value && (
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold" style={{ color: registrationMode === opt.value ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </AdminCard>
        </FadeIn>

        <FadeIn delay={30}>
          <div id="classes" />
          <AdminCard hover padding="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <SectionLabel icon={CalendarDays}>{t('admin.classes.settingTitle')}</SectionLabel>
              </div>
              <Toggle
                checked={classesEnabled}
                onChange={async (v) => {
                  const prev = classesEnabled;
                  setClassesEnabled(v);
                  setClassesSaving(true);
                  try {
                    const { error: clsErr } = await supabase
                      .from('gyms')
                      .update({ classes_enabled: v, updated_at: new Date().toISOString() })
                      .eq('id', gymId);
                    if (clsErr) throw clsErr;
                    logAdminAction('update_settings', 'gym', gymId);
                    await refreshProfile();
                    showToast(v
                      ? t('admin.classes.enabled', 'Classes enabled')
                      : t('admin.classes.disabled', 'Classes disabled'), 'success');
                  } catch (err) {
                    setClassesEnabled(prev);
                    showToast(err.message || t('admin.settings.saveFailed', 'Failed to save'), 'error');
                  } finally {
                    setClassesSaving(false);
                  }
                }}
                disabled={classesSaving}
                label={t('admin.classes.settingTitle')}
              />
            </div>
            <p className="text-[12px] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.classes.settingDesc')}</p>
          </AdminCard>
        </FadeIn>

        <FadeIn delay={60}>
          <AdminCard hover padding="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <SectionLabel icon={Cake}>{t('admin.settingsHub.birthday', 'Birthday rewards')}</SectionLabel>
              <Toggle
                checked={birthdayRewardsEnabled}
                onChange={setBirthdayRewardsEnabled}
                label={t('admin.settingsHub.birthday', 'Birthday rewards')}
              />
            </div>
            <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.settingsHub.birthdayDesc', 'Auto-grant a reward on each member’s birthday')}
            </p>
            {birthdayRewardsEnabled && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="bd-points" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.settings.birthdayPoints', 'Points to grant')}
                  </label>
                  <input
                    id="bd-points"
                    type="number"
                    value={birthdayRewardPoints}
                    min={0}
                    onChange={e => setBirthdayRewardPoints(Number(e.target.value) || 0)}
                    className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                  />
                </div>
                <div>
                  <label htmlFor="bd-msg" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {t('admin.settings.birthdayMessage', 'Birthday message')}
                  </label>
                  <textarea
                    id="bd-msg"
                    rows={2}
                    value={birthdayRewardMessage}
                    onChange={e => setBirthdayRewardMessage(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none resize-none transition-colors"
                    style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                  />
                </div>
              </div>
            )}
          </AdminCard>
        </FadeIn>

        <FadeIn delay={90}>
          <button
            onClick={() => { setError(''); saveMutation.mutate(); }}
            disabled={saveMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-50"
            style={{
              backgroundColor: saved ? 'var(--color-success)' : 'var(--color-accent)',
              color: saved ? '#fff' : 'var(--color-text-on-accent)',
            }}
          >
            <Save size={16} />
            {saveMutation.isPending
              ? t('admin.settings.saving', 'Saving...')
              : saved
                ? t('admin.settings.saved', 'Saved!')
                : t('admin.settings.saveGeneral', 'Save Settings')}
          </button>
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
