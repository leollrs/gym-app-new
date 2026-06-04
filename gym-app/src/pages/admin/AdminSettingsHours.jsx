/**
 * AdminSettingsHours: gym opening hours by day + holiday closures. Self-contained
 * query + save against `gym_hours`; closures handled by GymClosuresCard.
 * Restyled onto settingsKit per the "Configuración — detalle" design.
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
import GymClosuresCard from './components/GymClosuresCard';
import { TK, FK, Card, DIC, SettingsHeader, CardHd, Help, Toggle, SaveBar } from './components/settingsKit';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const defaultHours = () => [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, open_time: '06:00', close_time: '22:00', is_closed: false }));

export default function AdminSettingsHours() {
  const { profile, availableRoles } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [dayHours, setDayHours] = useState(defaultHours);

  useEffect(() => { document.title = `${t('admin.settings.gymHours', 'Gym Hours')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: hoursData, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'hours'],
    queryFn: async () => {
      const { data, error: hoursErr } = await supabase
        .from('gym_hours')
        .select('*')
        .eq('gym_id', gymId)
        .order('day_of_week');
      if (hoursErr) logger.warn('Failed to load gym hours', hoursErr);
      return data;
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    if (hoursData?.length) {
      setDayHours(hoursData.map(h => ({
        day_of_week: h.day_of_week,
        open_time: h.open_time,
        close_time: h.close_time,
        is_closed: h.is_closed,
      })));
    }
  }, [hoursData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const invalidDay = dayHours.find(d => !d.is_closed && d.open_time && d.close_time && d.open_time >= d.close_time);
      if (invalidDay) {
        throw new Error(t('admin.settings.invalidHours', 'Open time must be earlier than close time on every open day.'));
      }
      const hoursRows = dayHours.map(d => ({
        gym_id: gymId,
        day_of_week: d.day_of_week,
        open_time: d.open_time,
        close_time: d.close_time,
        is_closed: d.is_closed,
      }));
      const { error: hoursErr } = await supabase.from('gym_hours').upsert(hoursRows, { onConflict: 'gym_id,day_of_week' });
      if (hoursErr) throw hoursErr;

      const derivedOpenDays = dayHours.filter(d => !d.is_closed).map(d => d.day_of_week).sort();
      const firstOpen = dayHours.find(d => !d.is_closed);
      const { error: gymErr } = await supabase.from('gyms').update({
        open_time: firstOpen?.open_time || '06:00',
        close_time: firstOpen?.close_time || '22:00',
        open_days: derivedOpenDays,
        updated_at: new Date().toISOString(),
      }).eq('id', gymId);
      if (gymErr) throw gymErr;

      logAdminAction('update_hours', 'gym', gymId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings(gymId) });
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
      <CardSkeleton h="h-[280px]" />
    </AdminPageShell>
  );

  const timeInput = { flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, background: TK.surface, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.mono, fontSize: 13.5, fontWeight: 600, color: TK.text, outline: 'none' };

  return (
    <AdminPageShell>
      <SettingsHeader t={t} title={t('admin.settings.gymHours', 'Gym Hours')} sub={t('admin.settingsHub.hoursDesc', 'Daily opening hours + closures')} />

      {error && <p style={{ fontFamily: FK.body, fontSize: 13, color: 'var(--color-danger)', margin: '14px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 22 }}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-[18px] items-start">
          <FadeIn delay={0} className="min-w-0">
            <Card style={{ padding: '22px 24px' }}>
              <CardHd icon={DIC.clock}>{t('admin.settings.gymHours', 'Gym Hours')}</CardHd>
              <Help>{t('admin.settings.gymHoursDesc', 'Set opening hours for each day. Toggle days off to mark as closed.')}</Help>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 16 }}>
                {DAY_KEYS.map((dayKey, idx) => {
                  const dayShort = t(`common:days.${dayKey.slice(0, 3)}`);
                  const dh = dayHours.find(d => d.day_of_week === idx) || { open_time: '06:00', close_time: '22:00', is_closed: false };
                  const updateDay = (field, value) => setDayHours(prev => prev.map(d => d.day_of_week === idx ? { ...d, [field]: value } : d));
                  return (
                    <div key={dayKey} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderRadius: 13, background: TK.surface2, border: `1px solid ${TK.borderSolid}`, opacity: dh.is_closed ? 0.6 : 1 }}>
                      <Toggle on={!dh.is_closed} onClick={() => updateDay('is_closed', !dh.is_closed)} />
                      <span style={{ width: 44, flexShrink: 0, fontFamily: FK.body, fontSize: 14.5, fontWeight: 700, color: TK.text }}>{dayShort}</span>
                      {dh.is_closed ? (
                        <span style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: 'var(--color-danger)' }}>{t('admin.settings.closed', 'Closed')}</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 }}>
                          <input type="time" value={dh.open_time} onChange={e => updateDay('open_time', e.target.value)} style={timeInput} />
                          <span style={{ fontFamily: FK.body, fontSize: 13, color: TK.textMute, flexShrink: 0 }}>{t('admin.settings.to', 'to')}</span>
                          <input type="time" value={dh.close_time} onChange={e => updateDay('close_time', e.target.value)} style={timeInput} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </FadeIn>

          <GymClosuresCard id="closures" gymId={gymId} delay={60} />
        </div>

        <FadeIn delay={120}>
          <SaveBar
            onClick={() => { setError(''); saveMutation.mutate(); }}
            saving={saveMutation.isPending}
            saved={saved}
            label={t('admin.settings.saveGeneral', 'Save General Settings')}
            savingLabel={t('admin.settings.saving', 'Saving...')}
            savedLabel={t('admin.settings.saved', 'Saved!')}
          />
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
