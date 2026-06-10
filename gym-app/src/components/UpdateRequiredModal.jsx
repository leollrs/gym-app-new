// UpdateRequiredModal.jsx
// Hard-gate modal shown when the bundled client version is below the
// server's `min_required_version` (see lib/appVersionCheck.js). The modal
// fills the screen, has no close affordance, and blocks all underlying
// interaction — the user MUST install the new build before continuing.
//
// Mounted globally in App.jsx so it overlays every route, including auth
// screens (an outdated unauthenticated client can't sign in either).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Download } from 'lucide-react';
import { subscribeToVersion } from '../lib/appVersionCheck';
import { useAuth } from '../contexts/AuthContext';

export default function UpdateRequiredModal() {
  const { t } = useTranslation('common');
  const { profile } = useAuth();
  const [status, setStatus] = useState(null);

  useEffect(() => subscribeToVersion(setStatus), []);

  // Lock background scroll while the gate is up.
  useEffect(() => {
    if (!status?.outdated) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [status?.outdated]);

  if (!status?.outdated) return null;

  // Self-lockout escape hatch: a super-admin on an outdated build still
  // needs to reach the Platform → Settings page to bump min_required_version
  // back down (or to ship a new bundle). Without this exemption, a misclick
  // on the version field can wedge the only role that can undo it.
  const isSuperAdmin = profile?.role === 'super_admin'
    || (Array.isArray(profile?.additional_roles) && profile.additional_roles.includes('super_admin'));
  if (isSuperAdmin) return null;

  const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
  let storeUrl = null;
  if (platform === 'ios')     storeUrl = status.iosStoreUrl;
  else if (platform === 'android') storeUrl = status.androidStoreUrl;

  const handleUpdate = async () => {
    if (platform === 'web') {
      // Reload to fetch the freshly deployed bundle.
      window.location.reload();
      return;
    }
    if (storeUrl) {
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: storeUrl });
      } catch {
        // Fallback if @capacitor/browser isn't available for some reason.
        try { window.open(storeUrl, '_blank'); } catch { /* opener blocked */ }
      }
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{
        zIndex: 2147483647,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
    >
      <div
        className="relative w-full max-w-[380px] rounded-[24px] p-7"
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border-subtle)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 mx-auto"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
        >
          <Download size={26} style={{ color: 'var(--color-accent)' }} />
        </div>

        <h3
          id="update-required-title"
          className="text-[20px] font-bold mb-2 text-center"
          style={{ color: 'var(--color-text-primary)', letterSpacing: -0.3 }}
        >
          {t('updateRequired.title', 'Update required')}
        </h3>
        <p
          className="text-[14px] leading-relaxed mb-6 text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t(
            'updateRequired.body',
            'A new version of the app is required to continue. Please update to keep using TuGymPR.'
          )}
        </p>

        <button
          type="button"
          onClick={handleUpdate}
          className="w-full py-3.5 rounded-[14px] text-[15px] font-bold"
          style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
        >
          {platform === 'web'
            ? t('updateRequired.reload', 'Reload now')
            : t('updateRequired.update', 'Update now')}
        </button>

        <p
          className="text-center mt-4 text-[11px]"
          style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
        >
          {t('updateRequired.versionLabel', 'Version {{client}} → {{required}}', {
            client: status.clientVersion,
            required: status.minRequired,
          })}
        </p>
      </div>
    </div>,
    document.body
  );
}
