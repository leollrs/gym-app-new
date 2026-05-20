/**
 * AdminSettingsHours: standalone sub-page for gym opening hours by day +
 * holiday closures. Self-contained query + save mutation against the
 * `gym_hours` table; closures handled by the existing GymClosuresCard.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Clock, ArrowLeft } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import GymClosuresCard from './components/GymClosuresCard';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const defaultHours = () => [0,1,2,3,4,5,6].map(d => ({ day_of_week: d, open_time: '06:00', close_time: '22:00', is_closed: false }));

export default function AdminSettingsHours() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

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

      // Sync the derived `open_days` + open/close fallback on `gyms` so admin
      // dashboard and member-facing "is gym open" checks stay coherent.
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
      <CardSkeleton h="h-[280px]" />
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
        title={t('admin.settings.gymHours', 'Gym Hours')}
        subtitle={t('admin.settingsHub.hoursDesc', 'Daily opening hours + closures')}
        actions={backLink}
        className="mb-4"
      />

      {error && <p className="text-[13px] text-red-400 mb-4">{error}</p>}

      <div className="space-y-4 min-w-0">
        <div className="grid xl:grid-cols-12 gap-4 min-w-0">
          <FadeIn delay={0} className="xl:col-span-6 min-w-0">
            <AdminCard hover padding="p-4 sm:p-5">
              <SectionLabel icon={Clock} className="mb-4">{t('admin.settings.gymHours', 'Gym Hours')}</SectionLabel>
              <p className="text-[12px] mb-4" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.gymHoursDesc', 'Set opening hours for each day. Toggle days off to mark as closed.')}</p>
              <div className="space-y-2">
                {DAY_KEYS.map((dayKey, idx) => {
                  const dayLabel = t(`common:days.${dayKey}`);
                  const dayShort = t(`common:days.${dayKey.slice(0, 3)}`);
                  const dh = dayHours.find(d => d.day_of_week === idx) || { open_time: '06:00', close_time: '22:00', is_closed: false };
                  const updateDay = (field, value) => {
                    setDayHours(prev => prev.map(d => d.day_of_week === idx ? { ...d, [field]: value } : d));
                  };
                  return (
                    <div key={dayKey} className={`flex flex-wrap items-center gap-2 sm:gap-3 rounded-xl px-3 sm:px-4 py-3 transition-colors ${dh.is_closed ? 'opacity-50' : ''}`}
                      style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
                      <button
                        onClick={() => updateDay('is_closed', !dh.is_closed)}
                        className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                        style={{ backgroundColor: dh.is_closed ? 'var(--color-text-faint)' : 'var(--color-accent)' }}
                        aria-label={`Toggle ${dayLabel}`}
                      >
                        <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                          style={{ left: dh.is_closed ? '2px' : 'calc(100% - 18px)' }} />
                      </button>
                      <span className="text-[13px] font-semibold w-12 flex-shrink-0" style={{ color: 'var(--color-text-primary)' }}>
                        {dayShort}
                      </span>
                      {dh.is_closed ? (
                        <span className="text-[12px] font-medium" style={{ color: 'var(--color-danger)' }}>{t('admin.settings.closed', 'Closed')}</span>
                      ) : (
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                          <input type="time" value={dh.open_time} onChange={e => updateDay('open_time', e.target.value)}
                            className="rounded-lg px-2 sm:px-2.5 py-1.5 text-[12px] outline-none flex-1 min-w-0 sm:flex-none sm:w-[110px] transition-colors"
                            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                          <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.to', 'to')}</span>
                          <input type="time" value={dh.close_time} onChange={e => updateDay('close_time', e.target.value)}
                            className="rounded-lg px-2 sm:px-2.5 py-1.5 text-[12px] outline-none flex-1 min-w-0 sm:flex-none sm:w-[110px] transition-colors"
                            style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </AdminCard>
          </FadeIn>

          <GymClosuresCard id="closures" gymId={gymId} delay={60} />
        </div>

        <FadeIn delay={120}>
          <button
            onClick={() => { setError(''); saveMutation.mutate(); }}
            disabled={saveMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] transition-all disabled:opacity-50"
            style={{
              backgroundColor: saved ? 'var(--color-success)' : 'var(--color-accent)',
              color: saved ? '#fff' : 'var(--color-bg-base)',
            }}
          >
            <Save size={16} />
            {saveMutation.isPending
              ? t('admin.settings.saving', 'Saving...')
              : saved
                ? t('admin.settings.saved', 'Saved!')
                : t('admin.settings.saveGeneral', 'Save General Settings')}
          </button>
        </FadeIn>
      </div>
    </AdminPageShell>
  );
}
