/**
 * AdminSettingsRegistration: member registration mode, class booking toggle,
 * and birthday rewards — all on the `gyms` row. Class toggle saves immediately;
 * the rest save via the bottom bar. Restyled onto settingsKit.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import { TK, FK, Card, DIC, SettingsHeader, CardHd, Fld, Help, Toggle, TextField, SaveBar } from './components/settingsKit';

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

  // Class booking toggle saves immediately (independent of the bottom save bar).
  const toggleClasses = async () => {
    if (classesSaving) return;
    const v = !classesEnabled;
    const prev = classesEnabled;
    setClassesEnabled(v);
    setClassesSaving(true);
    try {
      const { error: clsErr } = await supabase.from('gyms').update({ classes_enabled: v, updated_at: new Date().toISOString() }).eq('id', gymId);
      if (clsErr) throw clsErr;
      logAdminAction('update_settings', 'gym', gymId);
      await refreshProfile();
      showToast(v ? t('admin.classes.enabled', 'Classes enabled') : t('admin.classes.disabled', 'Classes disabled'), 'success');
    } catch (err) {
      setClassesEnabled(prev);
      showToast(err.message || t('admin.settings.saveFailed', 'Failed to save'), 'error');
    } finally {
      setClassesSaving(false);
    }
  };

  if (!isAuthorized) {
    return (
      <AdminPageShell>
        <Card style={{ padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ fontFamily: FK.body, fontSize: 14, color: 'var(--color-danger)' }}>{t('admin.overview.accessDenied', 'Access denied. You are not authorized to view this page.')}</p>
        </Card>
      </AdminPageShell>
    );
  }

  if (isLoading) return (
    <AdminPageShell className="space-y-4">
      <CardSkeleton h="h-[60px]" />
      <CardSkeleton h="h-[200px]" />
    </AdminPageShell>
  );

  const modeOpts = [
    { value: 'invite_only', label: t('admin.registrationMode.inviteOnly'), desc: t('admin.registrationMode.inviteOnlyDesc') },
    { value: 'gym_code', label: t('admin.registrationMode.gymCode'), desc: t('admin.registrationMode.gymCodeDesc') },
    { value: 'both', label: t('admin.registrationMode.both'), desc: t('admin.registrationMode.bothDesc') },
  ];

  return (
    <AdminPageShell>
      <SettingsHeader t={t} title={t('admin.registrationMode.sectionTitle', 'Registration')} sub={t('admin.settingsHub.registrationDesc', 'How members join your gym')} />

      {error && <p style={{ fontFamily: FK.body, fontSize: 13, color: 'var(--color-danger)', margin: '14px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 22 }}>
        <FadeIn delay={0}>
          <Card style={{ padding: '22px 24px' }}>
            <CardHd icon={DIC.shield}>{t('admin.registrationMode.sectionTitle')}</CardHd>
            <Help>{t('admin.registrationMode.description')}</Help>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 16 }}>
              {modeOpts.map(opt => {
                const on = registrationMode === opt.value;
                return (
                  <button key={opt.value} type="button" onClick={() => setRegistrationMode(opt.value)} style={{ display: 'flex', gap: 13, padding: '15px 17px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', width: '100%', background: on ? TK.accentWash : TK.surface2, border: `1.5px solid ${on ? TK.accent : TK.borderSolid}` }}>
                    <span style={{ width: 20, height: 20, borderRadius: 99, flexShrink: 0, marginTop: 1, border: `2px solid ${on ? TK.accent : TK.textFaint}`, display: 'grid', placeItems: 'center' }}>
                      {on && <span style={{ width: 9, height: 9, borderRadius: 99, background: TK.accent }} />}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: FK.body, fontSize: 15, fontWeight: 700, color: on ? TK.accent : TK.text }}>{opt.label}</div>
                      <div style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, marginTop: 3, lineHeight: 1.45 }}>{opt.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={30}>
          <Card id="classes" style={{ padding: '20px 24px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <CardHd icon={DIC.cal}>{t('admin.classes.settingTitle')}</CardHd>
              <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 4 }}>{t('admin.classes.settingDesc')}</div>
            </div>
            <Toggle on={classesEnabled} onClick={toggleClasses} disabled={classesSaving} />
          </Card>
        </FadeIn>

        <FadeIn delay={60}>
          <Card style={{ padding: '20px 24px', marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CardHd icon={DIC.cake}>{t('admin.settingsHub.birthday', 'Birthday rewards')}</CardHd>
                <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 4 }}>{t('admin.settingsHub.birthdayDesc', 'Auto-grant a reward on each member’s birthday')}</div>
              </div>
              <Toggle on={birthdayRewardsEnabled} onClick={() => setBirthdayRewardsEnabled(v => !v)} />
            </div>
            {birthdayRewardsEnabled && (
              <div style={{ marginTop: 16 }}>
                <Fld>{t('admin.settings.birthdayPoints', 'Points to grant')}</Fld>
                <TextField type="text" inputMode="numeric" placeholder="0" value={birthdayRewardPoints === 0 ? '' : String(birthdayRewardPoints)} onChange={e => { const d = e.target.value.replace(/\D/g, ''); setBirthdayRewardPoints(d === '' ? 0 : Number(d)); }} mono />
                <Fld>{t('admin.settings.birthdayMessage', 'Birthday message')}</Fld>
                <TextField value={birthdayRewardMessage} onChange={e => setBirthdayRewardMessage(e.target.value)} />
              </div>
            )}
          </Card>
        </FadeIn>

        <FadeIn delay={90}>
          <SaveBar
            onClick={() => { setError(''); saveMutation.mutate(); }}
            saving={saveMutation.isPending}
            saved={saved}
            label={t('admin.settings.saveGeneral', 'Save Settings')}
            savingLabel={t('admin.settings.saving', 'Saving...')}
            savedLabel={t('admin.settings.saved', 'Saved!')}
          />
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
