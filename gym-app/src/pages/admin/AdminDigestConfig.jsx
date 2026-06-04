import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { AdminPageShell, AdminModal, FadeIn } from '../../components/admin';
import { TK, FK, Ico, ICON, Card, DIC, SettingsHeader, CardHd, Fld, Toggle, SaveBar } from './components/settingsKit';

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const FREQUENCY_KEYS = ['daily', 'weekly', 'monthly'];
const SECTION_KEYS = ['include_churn', 'include_attendance', 'include_signups', 'include_challenges', 'include_revenue', 'include_nps'];

const SECTION_ICON = {
  include_churn: ICON.trend,
  include_attendance: ICON.users,
  include_signups: ICON.users,
  include_challenges: ICON.trophy,
  include_revenue: DIC.dollar,
  include_nps: ICON.star,
};
const SECTION_COLOR = {
  include_churn: 'var(--color-danger)',
  include_attendance: 'var(--color-info)',
  include_signups: 'var(--color-success)',
  include_challenges: 'var(--color-accent)',
  include_revenue: 'var(--color-warning)',
  include_nps: 'var(--color-coach)',
};
const tint = (c) => `color-mix(in srgb, ${c} 14%, transparent)`;

// ── Stat card (rail accent) ──
function ResStat({ value, label, sub, icon, rail }) {
  return (
    <Card style={{ position: 'relative', overflow: 'hidden', padding: '18px 20px' }}>
      <span style={{ position: 'absolute', left: 0, top: 13, bottom: 13, width: 3.5, borderRadius: 99, background: rail }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: FK.display, fontSize: 34, fontWeight: 800, color: TK.text, letterSpacing: -1, lineHeight: 1 }}>{value}</div>
        <span style={{ width: 34, height: 34, borderRadius: 99, display: 'grid', placeItems: 'center', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, flexShrink: 0 }}><Ico ch={icon} size={16} color={TK.textMute} stroke={2} /></span>
      </div>
      <div style={{ fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: TK.text, marginTop: 12 }}>{label}</div>
      <div style={{ fontFamily: FK.body, fontSize: 12.5, color: TK.textFaint, marginTop: 2 }}>{sub}</div>
    </Card>
  );
}

// ── Preview Modal ──
function DigestPreviewModal({ isOpen, onClose, form, t }) {
  const enabledSections = SECTION_KEYS.filter(s => form?.[s]);
  return (
    <AdminModal isOpen={isOpen} onClose={onClose} title={t('admin.digestConfig.preview', { defaultValue: 'Digest Preview' })} size="md">
      <div style={{ borderRadius: 14, overflow: 'hidden', background: TK.surface2, border: `1px solid ${TK.borderSolid}` }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${TK.divider}`, background: TK.accentWash }}>
          <p style={{ margin: 0, fontFamily: FK.display, fontSize: 14, fontWeight: 800, color: TK.accent }}>{t('admin.digestConfig.previewSubject', { defaultValue: 'Your Gym Digest Summary' })}</p>
          <p style={{ margin: '3px 0 0', fontFamily: FK.body, fontSize: 11.5, color: TK.textFaint }}>
            {form?.frequency === 'daily'
              ? t('admin.digestConfig.previewDaily', { defaultValue: 'Delivered daily' })
              : form?.frequency === 'monthly'
                ? t('admin.digestConfig.previewMonthly', { defaultValue: 'Delivered on the 1st of each month' })
                : t('admin.digestConfig.previewWeekly', { defaultValue: 'Delivered every week' })}
            {' '}{t('admin.digestConfig.previewAt', { defaultValue: 'at' })} {form?.time_of_day || '09:00'}
          </p>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {enabledSections.length === 0 ? (
            <p style={{ fontFamily: FK.body, fontSize: 13, color: TK.textFaint, textAlign: 'center', padding: '16px 0' }}>{t('admin.digestConfig.previewNoSections', { defaultValue: 'No sections enabled. Toggle sections above to see them here.' })}</p>
          ) : enabledSections.map(sKey => {
            const color = SECTION_COLOR[sKey];
            return (
              <div key={sKey} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, background: TK.surface, border: `1px solid ${TK.borderSolid}` }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: tint(color) }}><Ico ch={SECTION_ICON[sKey]} size={15} color={color} stroke={2} /></span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: TK.text }}>{t(`admin.digestConfig.sections.${sKey}`)}</p>
                  <p style={{ margin: '2px 0 0', fontFamily: FK.body, fontSize: 11.5, color: TK.textFaint }}>{t(`admin.digestConfig.sections.${sKey}_desc`)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AdminModal>
  );
}

export default function AdminDigestConfig() {
  const { profile, user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const gymId = profile?.gym_id;

  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { document.title = t('admin.digestConfig.pageTitle', `Admin - Digest Settings | ${window.__APP_NAME || 'TuGymPR'}`); }, [t]);

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
        enabled: false, frequency: 'weekly', day_of_week: 1, time_of_day: '09:00',
        include_churn: true, include_attendance: true, include_signups: true,
        include_challenges: true, include_revenue: true, include_nps: true,
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
        .upsert({ gym_id: gymId, profile_id: user.id, ...form, updated_at: new Date().toISOString() }, { onConflict: 'gym_id,profile_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'digest-config', gymId] });
      showToast(t('admin.digestConfig.saved'), 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const enabledCount = useMemo(() => (!form ? 0 : SECTION_KEYS.filter(s => form[s]).length), [form]);

  const nextSendDescription = useMemo(() => {
    if (!form?.enabled) return t('admin.digestConfig.disabled', { defaultValue: 'Disabled' });
    const freq = form.frequency;
    const time = form.time_of_day || '09:00';
    if (freq === 'daily') return `${t('admin.digestConfig.freq.daily')} @ ${time}`;
    if (freq === 'monthly') return `${t('admin.digestConfig.freq.monthly')} @ ${time}`;
    const dayName = tc(`days.${DAY_KEYS[form.day_of_week || 0]}`);
    return `${t('admin.digestConfig.freq.weekly')} — ${dayName} @ ${time}`;
  }, [form, t, tc]);

  if (!form) return null;
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const freqBtn = (active) => ({ padding: '11px 0', borderRadius: 11, cursor: 'pointer', textAlign: 'center', minHeight: 44, fontFamily: FK.body, fontSize: 13, fontWeight: 700, background: active ? TK.accentWash : TK.surface2, border: `1.5px solid ${active ? TK.accent : TK.borderSolid}`, color: active ? TK.accent : TK.textSub });
  const dayPill = (active) => ({ flexShrink: 0, padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: FK.body, fontSize: 12, fontWeight: 700, background: active ? TK.accentWash : TK.surface2, border: `1px solid ${active ? TK.accent : TK.borderSolid}`, color: active ? TK.accent : TK.textSub });

  return (
    <AdminPageShell>
      <SettingsHeader
        t={t}
        title={t('admin.digestConfig.title')}
        sub={t('admin.digestConfig.subtitle')}
        extra={
          <button type="button" onClick={() => setShowPreview(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 999, cursor: 'pointer', background: TK.text, border: 'none', fontFamily: FK.body, fontSize: 13.5, fontWeight: 700, color: 'var(--color-admin-shell)' }}>
            <Ico ch={DIC.eye} size={15} color="var(--color-admin-shell)" stroke={2} />{t('admin.digestConfig.preview', { defaultValue: 'Preview' })}
          </button>
        }
      />

      <div style={{ marginTop: 22 }}>
        {/* summary stats */}
        <FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ResStat value={form.enabled ? 1 : 0} label={t('admin.digestConfig.statusLabel', { defaultValue: 'Digest Status' })} sub={form.enabled ? t('admin.digestConfig.enabledStatus', { defaultValue: 'Active' }) : t('admin.digestConfig.disabledStatus', { defaultValue: 'Inactive' })} icon={form.enabled ? DIC.eye : DIC.eyeOff} rail={form.enabled ? 'var(--color-success)' : 'var(--color-danger)'} />
            <ResStat value={enabledCount} label={t('admin.digestConfig.frequency', { defaultValue: 'Frequency' })} sub={nextSendDescription} icon={DIC.clock} rail="var(--color-accent)" />
            <ResStat value={`${enabledCount}/${SECTION_KEYS.length}`} label={t('admin.digestConfig.sectionsLabel', { defaultValue: 'Active Sections' })} sub={t('admin.digestConfig.sectionsIncluded', { defaultValue: 'sections included' })} icon={DIC.mail} rail="var(--color-info)" />
          </div>
        </FadeIn>

        {/* enable toggle */}
        <FadeIn delay={0.05}>
          <Card style={{ padding: '18px 22px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 15 }}>
            <span style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: form.enabled ? 'var(--color-success-soft)' : 'var(--color-danger-soft)' }}>
              <Ico ch={DIC.mail} size={20} color={form.enabled ? 'var(--color-success)' : 'var(--color-danger)'} stroke={2} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FK.display, fontSize: 17, fontWeight: 800, color: TK.text, letterSpacing: -0.3 }}>{t('admin.digestConfig.emailDigest')}</div>
              <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 3 }}>{t('admin.digestConfig.emailDigestDesc')}</div>
            </div>
            <Toggle on={form.enabled} onClick={() => set('enabled', !form.enabled)} />
          </Card>
        </FadeIn>

        {form.enabled && (
          <>
            {/* schedule */}
            <FadeIn delay={0.1}>
              <Card style={{ padding: '22px 24px', marginTop: 16 }}>
                <CardHd icon={DIC.cal}>{t('admin.digestConfig.schedule')}</CardHd>
                <Fld>{t('admin.digestConfig.frequency')}</Fld>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {FREQUENCY_KEYS.map(fKey => (
                    <button key={fKey} type="button" onClick={() => { set('frequency', fKey); if (fKey !== 'weekly') set('day_of_week', null); else if (form.day_of_week == null) set('day_of_week', 1); }} style={freqBtn(form.frequency === fKey)}>
                      {t(`admin.digestConfig.freq.${fKey}`)}
                    </button>
                  ))}
                </div>
                {form.frequency === 'weekly' && (
                  <>
                    <Fld>{t('admin.digestConfig.day')}</Fld>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {DAY_KEYS.map((dKey, i) => (
                        <button key={dKey} type="button" onClick={() => set('day_of_week', i)} style={dayPill(form.day_of_week === i)}>{tc(`days.${dKey}`).slice(0, 3)}</button>
                      ))}
                    </div>
                  </>
                )}
                <Fld>{t('admin.digestConfig.time')}</Fld>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Ico ch={DIC.clock} size={15} color={TK.textMute} stroke={2} />
                  <input type="time" value={form.time_of_day} onChange={e => set('time_of_day', e.target.value)} onFocus={e => { e.target.style.borderColor = TK.accent; }} onBlur={e => { e.target.style.borderColor = 'var(--color-admin-border)'; }} style={{ padding: '11px 14px', borderRadius: 11, background: TK.surface2, border: `1px solid ${TK.borderSolid}`, fontFamily: FK.mono, fontSize: 13.5, color: TK.text, outline: 'none' }} />
                </div>
              </Card>
            </FadeIn>

            {/* content sections */}
            <FadeIn delay={0.15}>
              <Card style={{ padding: '22px 24px', marginTop: 16 }}>
                <CardHd icon={ICON.bar}>{t('admin.digestConfig.includeInDigest')}</CardHd>
                <div style={{ marginTop: 8 }}>
                  {SECTION_KEYS.map(sKey => {
                    const color = SECTION_COLOR[sKey];
                    return (
                      <div key={sKey} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 0', borderTop: `1px solid ${TK.divider}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <span style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: tint(color) }}><Ico ch={SECTION_ICON[sKey]} size={15} color={color} stroke={2} /></span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text }}>{t(`admin.digestConfig.sections.${sKey}`)}</div>
                            <div style={{ fontFamily: FK.body, fontSize: 12, color: TK.textFaint, marginTop: 1 }}>{t(`admin.digestConfig.sections.${sKey}_desc`)}</div>
                          </div>
                        </div>
                        <Toggle on={!!form[sKey]} onClick={() => set(sKey, !form[sKey])} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            </FadeIn>
          </>
        )}

        <FadeIn delay={0.2}>
          <SaveBar onClick={() => saveMutation.mutate()} saving={saveMutation.isPending} label={t('admin.digestConfig.saveButton')} savingLabel={tc('saving')} />
        </FadeIn>
      </div>

      <DigestPreviewModal isOpen={showPreview} onClose={() => setShowPreview(false)} form={form} t={t} />
    </AdminPageShell>
  );
}
