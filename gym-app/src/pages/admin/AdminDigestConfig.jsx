import { useState, useEffect, useMemo } from 'react';
import {
  Mail, Clock, Calendar, Bell, Save, Check, Eye,
  BarChart3, Users, UserPlus, Trophy, DollarSign, MessageCircle,
  Power, PowerOff,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  PageHeader, AdminCard, AdminPageShell, AdminModal,
  FadeIn, SectionLabel, StatCard,
} from '../../components/admin';

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

const SECTION_ICONS = {
  include_churn: BarChart3,
  include_attendance: Users,
  include_signups: UserPlus,
  include_challenges: Trophy,
  include_revenue: DollarSign,
  include_nps: MessageCircle,
};

const SECTION_COLORS = {
  include_churn: '#EF4444',
  include_attendance: '#60A5FA',
  include_signups: '#10B981',
  include_challenges: '#D4AF37',
  include_revenue: '#F97316',
  include_nps: '#A78BFA',
};

// ── Toggle switch component ────────────────────────────────────────────────

function Toggle({ enabled, onChange, ariaLabel, size = 'default' }) {
  const w = size === 'lg' ? 'w-12 h-7' : 'w-9 h-5';
  const knob = size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';
  const offLeft = size === 'lg' ? '3px' : '2px';
  const onLeft = size === 'lg' ? 'calc(100% - 23px)' : 'calc(100% - 18px)';

  return (
    <button
      onClick={() => onChange(!enabled)}
      aria-label={ariaLabel}
      className={`${w} rounded-full relative flex-shrink-0 transition-colors focus:ring-2 focus:ring-[#D4AF37]/40 focus:outline-none`}
      style={{ backgroundColor: enabled ? '#D4AF37' : '#6B7280' }}
    >
      <span
        className={`absolute top-0.5 ${knob} rounded-full bg-white shadow transition-transform`}
        style={{ left: enabled ? onLeft : offLeft }}
      />
    </button>
  );
}

// ── Preview Modal ──────────────────────────────────────────────────────────

function DigestPreviewModal({ isOpen, onClose, form, t }) {
  const enabledSections = SECTION_KEYS.filter(s => form?.[s]);

  return (
    <AdminModal isOpen={isOpen} onClose={onClose} title={t('admin.digestConfig.preview', { defaultValue: 'Digest Preview' })} titleIcon={Eye} size="md">
      <div className="space-y-4">
        {/* Email header simulation */}
        <div className="bg-white/[0.03] rounded-xl border border-white/6 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6 bg-[#D4AF37]/5">
            <p className="text-[14px] font-bold text-[#D4AF37]">
              {t('admin.digestConfig.previewSubject', { defaultValue: 'Your Gym Digest Summary' })}
            </p>
            <p className="text-[11px] text-[#6B7280] mt-0.5">
              {form?.frequency === 'daily'
                ? t('admin.digestConfig.previewDaily', { defaultValue: 'Delivered daily' })
                : form?.frequency === 'monthly'
                  ? t('admin.digestConfig.previewMonthly', { defaultValue: 'Delivered on the 1st of each month' })
                  : t('admin.digestConfig.previewWeekly', { defaultValue: 'Delivered every week' })}
              {' '}{t('admin.digestConfig.previewAt', { defaultValue: 'at' })} {form?.time_of_day || '09:00'}
            </p>
          </div>
          <div className="p-4 space-y-3">
            {enabledSections.length === 0 ? (
              <p className="text-[13px] text-[#6B7280] text-center py-4">
                {t('admin.digestConfig.previewNoSections', { defaultValue: 'No sections enabled. Toggle sections above to see them here.' })}
              </p>
            ) : enabledSections.map(sKey => {
              const Icon = SECTION_ICONS[sKey];
              const color = SECTION_COLORS[sKey];
              return (
                <div key={sKey} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/4">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}15` }}>
                    <Icon size={14} style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#E5E7EB]">{t(`admin.digestConfig.sections.${sKey}`)}</p>
                    <p className="text-[11px] text-[#6B7280] mt-0.5">{t(`admin.digestConfig.sections.${sKey}_desc`)}</p>
                    <div className="mt-2 flex gap-3">
                      <div className="h-2 w-16 rounded-full bg-white/6" />
                      <div className="h-2 w-10 rounded-full bg-white/6" />
                      <div className="h-2 w-12 rounded-full bg-white/6" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AdminModal>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function AdminDigestConfig() {
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { document.title = t('admin.digestConfig.pageTitle', 'Admin - Digest Settings | TuGymPR'); }, [t]);

  const { data: config } = useQuery({
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
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
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

  const enabledCount = useMemo(() => {
    if (!form) return 0;
    return SECTION_KEYS.filter(s => form[s]).length;
  }, [form]);

  // Compute next send description
  const nextSendDescription = useMemo(() => {
    if (!form?.enabled) return t('admin.digestConfig.disabled', { defaultValue: 'Disabled' });
    const freq = form.frequency;
    const time = form.time_of_day || '09:00';
    if (freq === 'daily') return `${t('admin.digestConfig.freq.daily')} @ ${time}`;
    if (freq === 'monthly') return `${t('admin.digestConfig.freq.monthly')} @ ${time}`;
    const dayName = tc(`days.${DAY_KEYS[form.day_of_week || 0]}`);
    return `${t('admin.digestConfig.freq.weekly')} \u2014 ${dayName} @ ${time}`;
  }, [form, t, tc]);

  if (!form) return null;
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <AdminPageShell>
      <PageHeader
        title={t('admin.digestConfig.title')}
        subtitle={t('admin.digestConfig.subtitle')}
        actions={
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-[#E5E7EB] bg-white/[0.04] border border-white/6 hover:border-white/10 hover:bg-white/[0.06] transition-colors"
          >
            <Eye size={14} />
            {t('admin.digestConfig.preview', { defaultValue: 'Preview' })}
          </button>
        }
      />

      {/* ── Summary stat cards ──────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5 mb-6">
          <StatCard
            label={t('admin.digestConfig.statusLabel', { defaultValue: 'Digest Status' })}
            value={form.enabled ? 1 : 0}
            sub={form.enabled
              ? t('admin.digestConfig.enabledStatus', { defaultValue: 'Active' })
              : t('admin.digestConfig.disabledStatus', { defaultValue: 'Inactive' })}
            borderColor={form.enabled ? '#10B981' : '#EF4444'}
            icon={form.enabled ? Power : PowerOff}
            delay={0}
          />
          <StatCard
            label={t('admin.digestConfig.frequency', { defaultValue: 'Frequency' })}
            value={enabledCount}
            sub={nextSendDescription}
            borderColor="#D4AF37"
            icon={Clock}
            delay={0.05}
          />
          <StatCard
            label={t('admin.digestConfig.sectionsLabel', { defaultValue: 'Active Sections' })}
            value={`${enabledCount}/${SECTION_KEYS.length}`}
            sub={t('admin.digestConfig.sectionsIncluded', { defaultValue: 'sections included' })}
            borderColor="#60A5FA"
            icon={Mail}
            delay={0.1}
          />
        </div>
      </FadeIn>

      {/* ── Enable toggle card ──────────────────────────────── */}
      <FadeIn delay={0.05}>
        <AdminCard className="mb-5" borderLeft={form.enabled ? '#10B981' : '#EF4444'}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: form.enabled ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }}>
                <Mail size={18} style={{ color: form.enabled ? '#10B981' : '#EF4444' }} />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#E5E7EB]">{t('admin.digestConfig.emailDigest')}</p>
                <p className="text-[12px] text-[#6B7280]">{t('admin.digestConfig.emailDigestDesc')}</p>
              </div>
            </div>
            <Toggle
              enabled={form.enabled}
              onChange={(v) => set('enabled', v)}
              ariaLabel={form.enabled ? t('admin.digestConfig.disableDigest') : t('admin.digestConfig.enableDigest')}
              size="lg"
            />
          </div>
        </AdminCard>
      </FadeIn>

      {form.enabled && (
        <>
          {/* ── Schedule Configuration ──────────────────────── */}
          <FadeIn delay={0.1}>
            <AdminCard className="mb-5" borderLeft="#D4AF37">
              <SectionLabel icon={Calendar}>{t('admin.digestConfig.schedule')}</SectionLabel>

              <div className="mt-4 space-y-5">
                {/* Frequency */}
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2.5">{t('admin.digestConfig.frequency')}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {FREQUENCY_KEYS.map(fKey => (
                      <button
                        key={fKey}
                        onClick={() => set('frequency', fKey)}
                        className={`py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                          form.frequency === fKey
                            ? 'bg-[#D4AF37]/15 text-[#D4AF37] border-2 border-[#D4AF37]/30 shadow-[0_0_12px_rgba(212,175,55,0.08)]'
                            : 'bg-[#0F172A] text-[#6B7280] border border-white/6 hover:border-white/10 hover:text-[#9CA3AF]'
                        }`}
                      >
                        {t(`admin.digestConfig.freq.${fKey}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Day of week (weekly only) */}
                {form.frequency === 'weekly' && (
                  <div>
                    <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2.5">{t('admin.digestConfig.day')}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {DAY_KEYS.map((dKey, i) => (
                        <button
                          key={dKey}
                          onClick={() => set('day_of_week', i)}
                          className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all ${
                            form.day_of_week === i
                              ? 'bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/30'
                              : 'bg-[#0F172A] text-[#6B7280] border border-white/6 hover:border-white/10'
                          }`}
                        >
                          {tc(`days.${dKey}`).slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Time */}
                <div>
                  <label className="block text-[12px] font-medium text-[#9CA3AF] mb-2.5">{t('admin.digestConfig.time')}</label>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-[#6B7280]" />
                    <input
                      type="time"
                      value={form.time_of_day}
                      onChange={e => set('time_of_day', e.target.value)}
                      className="bg-[#0F172A] border border-white/6 rounded-xl px-4 py-2.5 text-[13px] text-[#E5E7EB] outline-none focus:border-[#D4AF37]/40 focus:ring-1 focus:ring-[#D4AF37]/30 transition-colors"
                    />
                  </div>
                </div>
              </div>
            </AdminCard>
          </FadeIn>

          {/* ── Content Toggles ─────────────────────────────── */}
          <FadeIn delay={0.15}>
            <AdminCard className="mb-6" borderLeft="#60A5FA">
              <SectionLabel icon={Bell}>{t('admin.digestConfig.includeInDigest')}</SectionLabel>

              <div className="mt-4 space-y-1">
                {SECTION_KEYS.map(sKey => {
                  const Icon = SECTION_ICONS[sKey];
                  const color = SECTION_COLORS[sKey];
                  return (
                    <div
                      key={sKey}
                      className={`flex items-center justify-between py-3 px-3 rounded-xl transition-colors ${
                        form[sKey] ? 'bg-white/[0.02]' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${color}15` }}
                        >
                          <Icon size={14} style={{ color }} />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-[#E5E7EB]">{t(`admin.digestConfig.sections.${sKey}`)}</p>
                          <p className="text-[11px] text-[#6B7280]">{t(`admin.digestConfig.sections.${sKey}_desc`)}</p>
                        </div>
                      </div>
                      <Toggle
                        enabled={form[sKey]}
                        onChange={(v) => set(sKey, v)}
                        ariaLabel={`${form[sKey] ? tc('disable') : tc('enable')} ${t(`admin.digestConfig.sections.${sKey}`)}`}
                      />
                    </div>
                  );
                })}
              </div>
            </AdminCard>
          </FadeIn>
        </>
      )}

      {/* ── Save button ─────────────────────────────────────── */}
      <FadeIn delay={0.2}>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] text-black bg-[#D4AF37] hover:brightness-90 disabled:opacity-50 transition-all shadow-[0_0_20px_rgba(212,175,55,0.15)]"
        >
          <Save size={16} />
          {saveMutation.isPending ? tc('saving') : t('admin.digestConfig.saveButton')}
        </button>
      </FadeIn>

      {/* Preview modal */}
      <DigestPreviewModal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        form={form}
        t={t}
      />
    </AdminPageShell>
  );
}
