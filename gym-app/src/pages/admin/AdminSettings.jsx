import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { getAllPalettes } from '../../lib/palettes';
import { FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import { TK, FK, TONE, Card } from './components/retosKit';
import SettingsHubGrid from './components/SettingsHubGrid';

// ── Live-config summary chip (tone pill + dot) ──
function SummaryChip({ label, value, tone = 'accent' }) {
  const c = TONE[tone] || TONE.accent;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, background: c.bg, border: `1px solid ${c.line}` }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: c.fg, flexShrink: 0 }} />
      <span style={{ fontFamily: FK.body, fontSize: 13, fontWeight: 700, color: c.ink }}>{label}: <b style={{ fontWeight: 800 }}>{value}</b></span>
    </span>
  );
}

/**
 * AdminSettings root: hub-only landing page. Each card in the
 * SettingsHubGrid navigates to a dedicated sub-page that owns its own data
 * fetching + save mutation. This page renders the live config summary chips
 * and the hub grid (restyled onto retosKit per the "Configuración" design).
 */
export default function AdminSettings() {
  const { profile, availableRoles } = useAuth();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && availableRoles.some(r => r === 'admin' || r === 'super_admin') && !!gymId;

  useEffect(() => { document.title = `${t('admin.settings.pageTitle', 'Admin - Settings')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Minimal query just for the live-config summary chips.
  const { data: summary, isLoading } = useQuery({
    queryKey: [...adminKeys.settings(gymId), 'summary'],
    queryFn: async () => {
      const [gymResult, brandingResult] = await Promise.all([
        supabase.from('gyms').select('name, registration_mode').eq('id', gymId).single(),
        supabase.from('gym_branding').select('palette_name').eq('gym_id', gymId).maybeSingle(),
      ]);
      if (gymResult.error) logger.warn('Failed to load gym summary', gymResult.error);
      if (brandingResult.error) logger.warn('Failed to load branding summary', brandingResult.error);
      return { gym: gymResult.data, branding: brandingResult.data };
    },
    enabled: !!gymId,
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
      <CardSkeleton h="h-[140px]" />
      <CardSkeleton h="h-[280px]" />
    </AdminPageShell>
  );

  const name = summary?.gym?.name || '';
  const registrationMode = summary?.gym?.registration_mode || 'both';
  const paletteId = summary?.branding?.palette_name || null;
  const regModeLabel = registrationMode === 'invite_only'
    ? t('admin.registrationMode.inviteOnly')
    : registrationMode === 'gym_code'
      ? t('admin.registrationMode.gymCode')
      : t('admin.registrationMode.both');
  const paletteName = paletteId
    ? (getAllPalettes().find(p => p.id === paletteId)?.name || paletteId)
    : t('admin.settings.tabDefault', 'Default');

  return (
    <AdminPageShell>
      {/* header */}
      <div style={{ minWidth: 0 }}>
        <h1 className="admin-page-title" style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>{t('admin.settings.title', 'Settings')}</h1>
        <div style={{ fontFamily: FK.body, fontSize: 14, color: TK.textSub, marginTop: 9 }}>{t('admin.settings.subtitle', 'Gym branding and configuration')}</div>
      </div>

      {/* current config summary */}
      <FadeIn delay={0}>
        <Card style={{ padding: '16px 22px', marginTop: 22, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: FK.body, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.3, textTransform: 'uppercase', color: TK.textFaint }}>
            {t('admin.settings.liveConfigTitle', 'Current Live Config')}
          </span>
          <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
            <SummaryChip label={t('admin.settings.gymName', 'Gym Name')} value={name || '—'} tone="accent" />
            <SummaryChip label={t('admin.settings.summaryPalette', 'Palette')} value={paletteName} tone="accent" />
            <SummaryChip label={t('admin.settings.summaryRegistration', 'Registration')} value={regModeLabel} tone={registrationMode === 'invite_only' ? 'warn' : 'good'} />
          </div>
        </Card>
      </FadeIn>

      {/* hub: card grid that routes to each sub-page */}
      <SettingsHubGrid />
    </AdminPageShell>
  );
}
