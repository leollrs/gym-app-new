/**
 * MaintenanceGate — full-screen "app is in maintenance" lock, like Clash
 * Royale's. When the super-admin enables maintenance mode in Operations,
 * every user's app polls get_maintenance_status() (migration 0436) and, while
 * it's on, this overlay blocks the entire app.
 *
 * Exemptions so the platform can still be recovered:
 *   • super_admins are never blocked (they need to turn it back off)
 *   • the /login and /reset-password routes stay reachable (so an admin can
 *     sign in during maintenance, then they're exempt by role)
 *
 * Polls every 30s + on window focus/reconnect so it flips on/off quickly
 * without a realtime subscription (which RLS would block for members anyway).
 */
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const AUTH_PATHS = ['/login', '/reset-password', '/signup'];

export default function MaintenanceGate() {
  const { t } = useTranslation('common');
  const { availableRoles } = useAuth();
  const location = useLocation();

  const isSuperAdmin = Array.isArray(availableRoles) && availableRoles.includes('super_admin');
  const onAuthRoute = AUTH_PATHS.some((p) => location.pathname.startsWith(p));

  const { data } = useQuery({
    queryKey: ['maintenance-status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_maintenance_status');
      if (error) throw error;
      return data || { enabled: false };
    },
    // Keep it cheap but responsive: re-check every 30s and whenever the app
    // regains focus / network, so the lock appears and clears quickly.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 15_000,
    retry: false,
  });

  if (!data?.enabled || isSuperAdmin || onAuthRoute) return null;

  const message = data.message || t('maintenance.body', 'We’re doing some quick maintenance to make things better. The app will be back shortly — thanks for your patience.');

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center px-6 text-center"
      style={{ background: 'var(--color-bg-primary, #05070B)' }}
      role="alertdialog"
      aria-modal="true"
      aria-label={t('maintenance.title', 'App is in maintenance')}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: 'color-mix(in srgb, var(--color-accent, #D4AF37) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--color-accent, #D4AF37) 28%, transparent)' }}
      >
        <Wrench size={28} style={{ color: 'var(--color-accent, #D4AF37)' }} />
      </div>
      <h1 className="text-[20px] font-bold mb-2" style={{ color: 'var(--color-text-primary, #E5E7EB)' }}>
        {t('maintenance.title', 'App is in maintenance')}
      </h1>
      <p className="text-[14px] leading-relaxed max-w-sm" style={{ color: 'var(--color-text-muted, #9CA3AF)' }}>
        {message}
      </p>
      <p className="text-[12px] mt-6" style={{ color: 'var(--color-text-subtle, #6B7280)' }}>
        {t('maintenance.autoResume', 'This screen will clear automatically when we’re done.')}
      </p>
    </div>
  );
}
