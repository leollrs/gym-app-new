import { useState, useEffect } from 'react';
import { Mail, Clock, Calendar, Bell, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { PageHeader, AdminCard, FadeIn } from '../../components/admin';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const FREQUENCY_KEYS = ['daily', 'weekly', 'monthly'];

const SECTION_KEYS = [
  'include_churn',
  'include_attendance',
  'include_signups',
  'include_challenges',
  'include_revenue',
  'include_nps',
];

export default function AdminDigestConfig() {
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  useEffect(() => { document.title = 'Admin - Digest Settings | TuGymPR'; }, []);

  const { data: config, isLoading } = useQuery({
    queryKey: ['admin', 'digest-config', gymId],
    queryFn: async () => {
      const { data } = await supabase
        .from('admin_digest_config')
        .select('*')
        .eq('gym_id', gymId)
        .eq('profile_id', user.id)
        .maybeSingle();
      return data || {
        enabled: false,
        frequency: 'weekly',
        day_of_week: 1,
        time_of_day: '09:00',
        include_churn: true,
        include_attendance: true,
        include_signups: true,
        include_challenges: true,
        include_revenue: true,
        include_nps: true,
      };
    },
    enabled: !!gymId,
  });

  const [form, setForm] = useState(null);
  useEffect(() => { if (config && !form) setForm(config); }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('admin_digest_config')
        .upsert({
          gym_id: gymId,
          profile_id: user.id,
          ...form,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'gym_id,profile_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'digest-config', gymId] });
      showToast(t('admin.digestConfig.saved'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  if (!form) return null;
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="px-4 md:px-8 py-6 pb-28 md:pb-12 max-w-[1600px] mx-auto">
      <PageHeader title={t('admin.digestConfig.title')} subtitle={t('admin.digestConfig.subtitle')} className="mb-6" />

      <FadeIn>
        <AdminCard className="mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)]/10 flex items-center justify-center">
                <Mail size={18} className="text-[var(--color-accent)]" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#E5E7EB]">{t('admin.digestConfig.emailDigest')}</p>
                <p className="text-[12px] text-[#6B7280]">{t('admin.digestConfig.emailDigestDesc')}</p>
              </div>
            </div>
            <button onClick={() => set('enabled', !form.enabled)}
              aria-label={form.enabled ? t('admin.digestConfig.disableDigest') : t('admin.digestConfig.enableDigest')}
              className="w-11 h-6 rounded-full relative flex-shrink-0 transition-colors"
              style={{ backgroundColor: form.enabled ? 'var(--color-accent)' : '#6B7280' }}>
              <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{ left: form.enabled ? 'calc(100% - 22px)' : '2px' }} />
            </button>
          </div>
        </AdminCard>
      </FadeIn>

      {form.enabled && (
        <>
          <FadeIn delay={60}>
            <AdminCard className="mb-4">
              <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t('admin.digestConfig.schedule')}</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.digestConfig.frequency')}</label>
                  <div className="flex gap-2">
                    {FREQUENCY_KEYS.map(fKey => (
                      <button key={fKey} onClick={() => set('frequency', fKey)}
                        className={`flex-1 py-2 rounded-xl text-[12px] font-semibold transition-colors ${
                          form.frequency === fKey
                            ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/25'
                            : 'bg-[#111827] text-[#6B7280] border border-white/6'
                        }`}>{t(`admin.digestConfig.freq.${fKey}`)}</button>
                    ))}
                  </div>
                </div>
                {form.frequency === 'weekly' && (
                  <div>
                    <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.digestConfig.day')}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {DAY_KEYS.map((dKey, i) => (
                        <button key={dKey} onClick={() => set('day_of_week', i)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                            form.day_of_week === i
                              ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                              : 'bg-[#111827] text-[#6B7280]'
                          }`}>{tc(`days.${dKey}`).slice(0, 3)}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2">{t('admin.digestConfig.time')}</label>
                  <input type="time" value={form.time_of_day} onChange={e => set('time_of_day', e.target.value)}
                    className="bg-[#111827] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[var(--color-accent)]/40" />
                </div>
              </div>
            </AdminCard>
          </FadeIn>

          <FadeIn delay={120}>
            <AdminCard className="mb-6">
              <p className="text-[12px] font-semibold text-[#6B7280] uppercase tracking-wider mb-3">{t('admin.digestConfig.includeInDigest')}</p>
              <div className="space-y-1">
                {SECTION_KEYS.map(sKey => (
                  <div key={sKey} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-[13px] font-medium text-[#E5E7EB]">{t(`admin.digestConfig.sections.${sKey}`)}</p>
                      <p className="text-[11px] text-[#6B7280]">{t(`admin.digestConfig.sections.${sKey}_desc`)}</p>
                    </div>
                    <button onClick={() => set(sKey, !form[sKey])}
                      aria-label={`${form[sKey] ? tc('disable') : tc('enable')} ${t(`admin.digestConfig.sections.${sKey}`)}`}
                      className="w-9 h-5 rounded-full relative flex-shrink-0 transition-colors"
                      style={{ backgroundColor: form[sKey] ? 'var(--color-accent)' : '#6B7280' }}>
                      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                        style={{ left: form[sKey] ? 'calc(100% - 18px)' : '2px' }} />
                    </button>
                  </div>
                ))}
              </div>
            </AdminCard>
          </FadeIn>
        </>
      )}

      <FadeIn delay={180}>
        <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[14px] text-black bg-[var(--color-accent)] hover:brightness-90 disabled:opacity-50 transition-colors">
          <Save size={16} />
          {saveMutation.isPending ? tc('saving') : t('admin.digestConfig.saveButton')}
        </button>
      </FadeIn>
    </div>
  );
}
