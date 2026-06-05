/**
 * AdminSettingsGymInfo: standalone sub-page for gym identity — name + slug
 * display, membership pricing, language selector, and the multi-role view
 * switcher. Owns its own gym query + save mutation. Restyled onto settingsKit
 * per the "Configuración — detalle" design.
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
import ViewSwitcherModal from '../../components/ViewSwitcherModal';
import { TK, FK, Ico, Card, DIC, SettingsHeader, CardHd, Fld, TextField, SaveBar } from './components/settingsKit';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'es', label: 'Español', flag: '\u{1F1EA}\u{1F1F8}' },
];

// `gyms.address` lands with migration 0519 — until it's deployed, selecting or
// updating it 400s (42703 / PGRST204). Detect that so we can fall back.
const isMissingColumn = (e) => !!e && (e.code === '42703' || e.code === 'PGRST204');

export default function AdminSettingsGymInfo() {
  const { profile, refreshProfile, availableRoles } = useAuth();
  const hasMultipleViews = Array.isArray(availableRoles) && availableRoles.length > 1;
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);

  useEffect(() => { document.title = `${t('admin.settings.gymName', 'Gym Name')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: gymData, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'gym-info'],
    queryFn: async () => {
      let { data, error: gymErr } = await supabase
        .from('gyms')
        .select('name, slug, address')
        .eq('id', gymId)
        .single();
      // `address` (migration 0519) may not be deployed yet — retry without it.
      if (gymErr && isMissingColumn(gymErr)) {
        ({ data, error: gymErr } = await supabase.from('gyms').select('name, slug').eq('id', gymId).single());
      }
      if (gymErr) logger.warn('Failed to load gym info', gymErr);
      return data;
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    if (gymData?.name != null) setName(gymData.name);
    if (gymData?.address != null) setAddress(gymData.address);
  }, [gymData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const base = { name, updated_at: new Date().toISOString() };
      let { error: gymErr } = await supabase.from('gyms').update({ ...base, address: address.trim() || null }).eq('id', gymId);
      // `address` (migration 0519) may not be deployed yet — still save the rest.
      if (gymErr && isMissingColumn(gymErr)) {
        ({ error: gymErr } = await supabase.from('gyms').update(base).eq('id', gymId));
      }
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

  const changeLang = async (code) => {
    i18n.changeLanguage(code);
    if (profile?.id) {
      await supabase.from('profiles').update({ preferred_language: code }).eq('id', profile.id);
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

  return (
    <AdminPageShell>
      <SettingsHeader t={t} title={t('admin.settings.gymName', 'Gym Name')} sub={t('admin.settings.subtitle', 'Gym branding and configuration')} />

      {error && <p style={{ fontFamily: FK.body, fontSize: 13, color: 'var(--color-danger)', margin: '14px 0 0' }}>{error}</p>}

      <div style={{ marginTop: 22 }}>
        <FadeIn delay={0}>
          <Card style={{ padding: '22px 24px' }}>
            <CardHd icon={DIC.building}>{t('admin.settings.gymName', 'Gym Name')}</CardHd>
            <Fld>{t('admin.settings.gymName', 'Gym Name')}</Fld>
            <TextField value={name} onChange={e => setName(e.target.value)} />
            <Fld>{t('admin.settings.gymAddress', 'Address')}</Fld>
            <TextField value={address} onChange={e => setAddress(e.target.value)} placeholder={t('admin.settings.gymAddressPlaceholder', 'Street, city, country')} />
            <div style={{ marginTop: 18, fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text }}>{t('admin.settings.gymSlug', 'Gym Slug')}</div>
            <div style={{ fontFamily: FK.body, fontSize: 13.5, color: TK.textMute, marginTop: 5, wordBreak: 'break-word' }}>
              {t('admin.settings.gymSlugDesc', 'Members sign up using:')}{' '}
              <b style={{ color: TK.accent, fontWeight: 700, fontFamily: FK.mono }}>{gymData?.slug}</b>
            </div>
          </Card>
        </FadeIn>

        {hasMultipleViews && (
          <FadeIn delay={15}>
            <Card style={{ padding: '22px 24px', marginTop: 16 }}>
              <CardHd icon={DIC.repeat}>{t('common:viewSwitcher.eyebrow', 'Switch view')}</CardHd>
              <button type="button" onClick={() => setShowViewSwitcher(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', background: TK.surface2, border: `1px solid ${TK.borderSolid}`, marginTop: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Ico ch={DIC.repeat} size={17} color={TK.accent} stroke={2} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: FK.body, fontSize: 14, fontWeight: 700, color: TK.text }}>{t('common:viewSwitcher.title', 'Choose your experience')}</span>
                    <span style={{ display: 'block', fontFamily: FK.body, fontSize: 11.5, color: TK.textFaint, marginTop: 2 }}>{t('common:viewSwitcher.help', 'Your data and identity stay the same — only the layout changes.')}</span>
                  </span>
                </span>
                <Ico ch={DIC.chevD} size={16} color={TK.textMute} stroke={2.2} style={{ transform: 'rotate(-90deg)' }} />
              </button>
            </Card>
          </FadeIn>
        )}

        <FadeIn delay={30}>
          <Card style={{ padding: '22px 24px', marginTop: 16 }}>
            <CardHd icon={DIC.globe}>{t('admin.settings.language')}</CardHd>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
              {LANGUAGES.map(lang => {
                const on = i18n.language?.startsWith(lang.code);
                return (
                  <button key={lang.code} type="button" onClick={() => changeLang(lang.code)} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', background: on ? TK.accentWash : TK.surface2, border: `1.5px solid ${on ? TK.accent : TK.borderSolid}` }}>
                    <span style={{ fontSize: 20 }}>{lang.flag}</span>
                    <span style={{ flex: 1, fontFamily: FK.body, fontSize: 15, fontWeight: 700, color: TK.text }}>{lang.label}</span>
                    {on && <Ico ch={DIC.check} size={17} color={TK.accent} stroke={2.4} />}
                  </button>
                );
              })}
            </div>
          </Card>
        </FadeIn>

        <FadeIn delay={60}>
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

      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
    </AdminPageShell>
  );
}
