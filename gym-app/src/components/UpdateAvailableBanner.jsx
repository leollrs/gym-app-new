// UpdateAvailableBanner.jsx
// The SOFT counterpart to UpdateRequiredModal.
//
// The hard gate only fires once a build drops below `min_required_version` —
// which we bump only for breaking changes. Between those, a member can sit on
// a months-old build indefinitely and never know a newer one exists, so bug
// fixes ship and nobody installs them.
//
// `get_app_version` already returned `latest_version` and nothing consumed it.
// This nudges on that instead: dismissible, never blocking, and it stays gone
// per version — dismissing 1.2.0 keeps quiet until 1.3.0 ships, rather than
// nagging on every cold start.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { ArrowUpCircle, X } from 'lucide-react';
import { subscribeToVersion, compareSemver } from '../lib/appVersionCheck';

const DISMISS_KEY = 'updateNudgeDismissedFor';

export default function UpdateAvailableBanner() {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState(null);
  const [dismissedFor, setDismissedFor] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
  });

  useEffect(() => subscribeToVersion(setStatus), []);

  // Native only. On the web the "update" is just the next page load, so a
  // banner asking someone to visit a store they can't use is noise.
  if (!Capacitor.isNativePlatform()) return null;
  if (!status || status.outdated) return null;          // hard gate wins
  const latest = status.latest;
  if (!latest || compareSemver(status.clientVersion, latest) >= 0) return null;
  if (dismissedFor === latest) return null;

  const storeUrl = Capacitor.getPlatform() === 'ios' ? status.iosStoreUrl : status.androidStoreUrl;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, latest); } catch { /* private mode */ }
    setDismissedFor(latest);
  };

  return (
    <div
      className="fixed left-0 right-0 z-[95] px-4"
      // Sits above the bottom tab bar, not over it — the member should still be
      // able to navigate away from a banner they haven't decided about.
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
      role="status"
    >
      <div
        className="flex items-center gap-3 rounded-2xl px-4 py-3 mx-auto"
        style={{
          maxWidth: 520,
          background: 'var(--color-bg-card)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        }}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' }}>
          <ArrowUpCircle size={18} style={{ color: 'var(--color-accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
            {t('updateAvailable.title', 'Update available')}
          </p>
          <p className="text-[11.5px] truncate" style={{ color: 'var(--color-text-subtle)' }}>
            {t('updateAvailable.body', { version: latest, defaultValue: `Version ${latest} is ready to install.` })}
          </p>
        </div>
        {storeUrl && (
          <a
            href={storeUrl} target="_blank" rel="noreferrer" onClick={dismiss}
            className="shrink-0 px-3.5 py-2 rounded-xl text-[12.5px] font-bold active:scale-95 transition-transform"
            style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #000)' }}
          >
            {t('updateAvailable.cta', 'Update')}
          </a>
        )}
        <button
          type="button" onClick={dismiss}
          aria-label={t('close', 'Close')}
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
