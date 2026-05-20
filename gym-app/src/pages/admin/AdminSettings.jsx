import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import logger from '../../lib/logger';
import { adminKeys } from '../../lib/adminQueryKeys';
import { getAllPalettes } from '../../lib/palettes';
import { PageHeader, AdminCard, FadeIn, CardSkeleton, AdminPageShell } from '../../components/admin';
import SettingsHubGrid from './components/SettingsHubGrid';

// ── Status pill for live config summary ──
function ConfigPill({ label, value, color }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}: {value}
    </span>
  );
}

/**
 * AdminSettings root: hub-only landing page. Each card in the
 * SettingsHubGrid below navigates to a dedicated sub-page that owns its
 * own data fetching + save mutation. This page only renders the live
 * config summary pills and the hub grid.
 */
export default function AdminSettings() {
  const { profile } = useAuth();
  const { t } = useTranslation('pages');
  const gymId = profile?.gym_id;
  const isAuthorized = profile && ['admin', 'super_admin'].includes(profile.role) && !!gymId;

  useEffect(() => { document.title = `${t('admin.settings.pageTitle', 'Admin - Settings')} | ${window.__APP_NAME || 'TuGymPR'}`; }, [t]);

  // Minimal query just for the live-config summary pills.
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
      <PageHeader
        title={t('admin.settings.title', 'Settings')}
        subtitle={t('admin.settings.subtitle', 'Gym branding and configuration')}
        className="mb-4"
      />

      {/* ── Compact Live Config Summary ── */}
      <FadeIn delay={0}>
        <AdminCard padding="p-3 px-4" className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="admin-eyebrow mr-1">
              {t('admin.settings.liveConfigTitle', 'Current Live Config')}
            </span>
            <ConfigPill
              label={t('admin.settings.gymName', 'Gym Name')}
              value={name || '—'}
              color="var(--color-accent)"
            />
            <ConfigPill
              label={t('admin.settings.summaryPalette', 'Palette')}
              value={paletteName}
              color="var(--color-accent)"
            />
            <ConfigPill
              label={t('admin.settings.summaryRegistration', 'Registration')}
              value={regModeLabel}
              color={registrationMode === 'invite_only' ? 'var(--color-warning)' : 'var(--color-success)'}
            />
          </div>
        </AdminCard>
      </FadeIn>

      {/* ── Hub: card grid that routes to each sub-page ── */}
      <SettingsHubGrid />
    </AdminPageShell>
  );
}
