/**
 * AdminSettingsGymInfo: standalone sub-page for gym identity — name + slug
 * display, language selector, and the multi-role view switcher. Owns its
 * own gym query + save mutation for the name field.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, Globe, Check, Repeat, ChevronRight, ArrowLeft, DollarSign } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { logAdminAction } from '../../lib/adminAudit';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { PageHeader, AdminCard, SectionLabel, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import ViewSwitcherModal from '../../components/ViewSwitcherModal';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'es', label: 'Español', flag: '\u{1F1EA}\u{1F1F8}' },
];

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
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [showViewSwitcher, setShowViewSwitcher] = useState(false);

  useEffect(() => { document.title = `${t('admin.settings.gymName', 'Gym Name')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  const { data: gymData, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'gym-info'],
    queryFn: async () => {
      const { data, error: gymErr } = await supabase
        .from('gyms')
        .select('name, slug, monthly_price, currency')
        .eq('id', gymId)
        .single();
      if (gymErr) logger.warn('Failed to load gym info', gymErr);
      return data;
    },
    enabled: !!gymId,
  });

  useEffect(() => {
    if (gymData?.name != null) setName(gymData.name);
    if (gymData?.monthly_price != null) setMonthlyPrice(String(gymData.monthly_price));
    if (gymData?.currency) setCurrency(gymData.currency);
  }, [gymData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Empty input clears the price; otherwise parse and validate.
      let priceValue = null;
      if (monthlyPrice !== '' && monthlyPrice != null) {
        const parsed = Number(monthlyPrice);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(t('admin.settings.priceInvalid', { defaultValue: 'Monthly price must be a positive number.' }));
        }
        priceValue = Math.round(parsed * 100) / 100;
      }
      const trimmedCurrency = (currency || 'USD').toUpperCase();
      if (!/^[A-Z]{3}$/.test(trimmedCurrency)) {
        throw new Error(t('admin.settings.currencyInvalid', { defaultValue: 'Currency must be a 3-letter ISO code (e.g. USD).' }));
      }
      const { error: gymErr } = await supabase.from('gyms').update({
        name,
        monthly_price: priceValue,
        currency: trimmedCurrency,
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
        title={t('admin.settings.gymName', 'Gym Name')}
        subtitle={t('admin.settings.subtitle', 'Gym branding and configuration')}
        actions={backLink}
        className="mb-4"
      />

      {error && <p className="text-[13px] text-red-400 mb-4">{error}</p>}

      <div className="space-y-4 min-w-0">
        <FadeIn delay={0}>
          <AdminCard hover padding="p-4 sm:p-5">
            <SectionLabel className="mb-4">{t('admin.settings.gymName', 'Gym Name')}</SectionLabel>
            <div className="space-y-4">
              <div>
                <label htmlFor="gym-name" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('admin.settings.gymName', 'Gym Name')}</label>
                <input id="gym-name" value={name} onChange={e => setName(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }} />
              </div>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('admin.settings.gymSlug', 'Gym Slug')}</p>
                <p className="text-[12px] mt-0.5 break-words" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.settings.gymSlugDesc', 'Members sign up using:')}{' '}
                  <span style={{ color: 'var(--color-accent)' }} className="font-mono break-all">{gymData?.slug}</span>
                </p>
              </div>
            </div>
          </AdminCard>
        </FadeIn>

        <FadeIn delay={10}>
          <AdminCard hover padding="p-4 sm:p-5">
            <SectionLabel icon={DollarSign} className="mb-3">
              {t('admin.settings.pricingLabel', 'Membership pricing')}
            </SectionLabel>
            <p className="text-[12px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
              {t('admin.settings.pricingDesc', 'Used to calculate member lifetime value (LTV) in retention reports. Members never see this.')}
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label htmlFor="gym-monthly-price" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.settings.monthlyPrice', 'Monthly price')}
                </label>
                <input
                  id="gym-monthly-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={monthlyPrice}
                  onChange={e => setMonthlyPrice(e.target.value)}
                  placeholder="50.00"
                  className="w-full rounded-xl px-4 py-2.5 text-[13px] outline-none transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                />
              </div>
              <div className="w-24">
                <label htmlFor="gym-currency" className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                  {t('admin.settings.currency', 'Currency')}
                </label>
                <input
                  id="gym-currency"
                  type="text"
                  maxLength={3}
                  value={currency}
                  onChange={e => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  placeholder="USD"
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] font-mono uppercase outline-none transition-colors"
                  style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)' }}
                />
              </div>
            </div>
          </AdminCard>
        </FadeIn>

        {hasMultipleViews && (
          <FadeIn delay={15}>
            <AdminCard hover padding="p-4 sm:p-5">
              <SectionLabel icon={Repeat} className="mb-3">{t('common:viewSwitcher.eyebrow', 'Switch view')}</SectionLabel>
              <button
                type="button"
                onClick={() => setShowViewSwitcher(true)}
                className="w-full flex items-center justify-between rounded-2xl px-5 py-4 text-left transition-colors duration-200"
                style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Repeat size={16} style={{ color: 'var(--color-accent)' }} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {t('common:viewSwitcher.title', 'Choose your experience')}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                      {t('common:viewSwitcher.help', 'Your data and identity stay the same — only the layout changes.')}
                    </div>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-text-subtle)' }} />
              </button>
            </AdminCard>
          </FadeIn>
        )}

        <FadeIn delay={30}>
          <AdminCard hover padding="p-4 sm:p-5">
            <SectionLabel icon={Globe} className="mb-3">{t('admin.settings.language')}</SectionLabel>
            <div className="rounded-2xl min-w-0 divide-y" style={{ backgroundColor: 'var(--color-bg-deep)', border: '1px solid var(--color-border-subtle)' }}>
              {LANGUAGES.map(lang => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={async () => {
                    i18n.changeLanguage(lang.code);
                    if (profile?.id) {
                      await supabase.from('profiles').update({ preferred_language: lang.code }).eq('id', profile.id);
                    }
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 text-left transition-colors duration-200"
                  style={{ backgroundColor: i18n.language?.startsWith(lang.code) ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)' : 'transparent' }}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[18px]">{lang.flag}</span>
                    <span className="text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{lang.label}</span>
                  </div>
                  {i18n.language?.startsWith(lang.code) && (
                    <Check size={16} style={{ color: 'var(--color-accent)' }} />
                  )}
                </button>
              ))}
            </div>
          </AdminCard>
        </FadeIn>

        <FadeIn delay={60}>
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
                : t('admin.settings.saveGeneral', 'Save Settings')}
          </button>
        </FadeIn>
      </div>

      <ViewSwitcherModal open={showViewSwitcher} onClose={() => setShowViewSwitcher(false)} />
    </AdminPageShell>
  );
}
