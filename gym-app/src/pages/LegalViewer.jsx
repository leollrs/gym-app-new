// LegalViewer.jsx
// -----------------------------------------------------------------------------
// In-app viewer for Privacy Policy and Terms of Service. Embeds the live page
// from tugympr.com in an iframe so the content stays in sync with the website
// without shipping a copy of the text in the bundle. App chrome (header,
// back button) wraps the iframe so it feels native — no system browser bounce.
// -----------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

const FONT_DISPLAY = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const FONT_BODY = '"Familjen Grotesk", "Archivo", system-ui, sans-serif';

const PAGES = {
  privacy: {
    url: 'https://tugympr.com/privacy',
    titleKey: 'settings.privacyPolicy',
    fallbackTitle: 'Privacy Policy',
  },
  terms: {
    url: 'https://tugympr.com/terms',
    titleKey: 'settings.termsOfService',
    fallbackTitle: 'Terms of Service',
  },
};

// Allow-list of hostnames we are willing to open in the in-app browser /
// system browser for the "open in browser" fallback. The iframe is unaffected.
// TODO: extend with gymConfig.customDomain when added to gym schema
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'tugympr.com',
  'www.tugympr.com',
]);

// Open an external URL using SFSafariViewController (via @capacitor/browser)
// when available, falling back to window.open for the web build. Apple prefers
// in-app browser sessions for native targets.
async function openExternalUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
    if (!ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
      throw new Error(`Blocked external host: ${u.hostname}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[openExternalUrl] rejected', err);
    return;
  }
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* swallow */ }
  }
}

export default function LegalViewer({ page }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('pages');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Derive page from prop or route suffix so the same component handles both
  // /legal/privacy and /legal/terms
  const effectivePage = page || (location.pathname.endsWith('/terms') ? 'terms' : 'privacy');
  const config = PAGES[effectivePage] || PAGES.privacy;

  useEffect(() => {
    document.title = t(config.titleKey, config.fallbackTitle);
    setLoaded(false);
    setError(false);
    // Safety timeout — if the iframe never fires onLoad (offline, blocked),
    // hide the spinner after 10s so the empty-frame state surfaces.
    const to = setTimeout(() => setLoaded(true), 10000);
    return () => clearTimeout(to);
  }, [effectivePage, config, t]);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{
        background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: FONT_BODY,
      }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0"
        style={{
          background: 'var(--color-bg-primary)',
          borderBottom: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
        }}
      >
        <div className="flex items-center gap-3 px-4 pb-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('common:back', 'Back')}
            className="flex items-center justify-center transition-transform active:scale-90"
            style={{
              width: 40, height: 40, borderRadius: 20,
              background: 'var(--color-surface-hover, rgba(255,255,255,0.06))',
              border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.06))',
              color: 'var(--color-text-primary)',
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p
              className="uppercase"
              style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.16em',
                color: 'var(--color-accent)',
              }}
            >
              {t('settings.legal', 'Legal')}
            </p>
            <h1
              className="truncate"
              style={{
                fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 900,
                letterSpacing: -0.4, lineHeight: 1.1,
                color: 'var(--color-text-primary)',
              }}
            >
              {t(config.titleKey, config.fallbackTitle)}
            </h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative" style={{ background: '#FFFFFF' }}>
        {!loaded && !error && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)' }}
          >
            <div
              className="w-8 h-8 rounded-full animate-spin"
              style={{
                border: '2px solid var(--color-border-subtle, rgba(255,255,255,0.1))',
                borderTopColor: 'var(--color-accent)',
              }}
            />
          </div>
        )}
        {error && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
            style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-muted)' }}
          >
            <p className="text-[14px] mb-4">
              {t('legal.loadFailed', "Couldn't load from the web. Check your connection.")}
            </p>
            <button
              type="button"
              onClick={() => { openExternalUrl(config.url); }}
              style={{
                padding: '10px 20px', borderRadius: 999,
                background: 'var(--color-accent)',
                color: 'var(--color-bg-card, #0A0D10)',
                fontWeight: 800, fontSize: 13, letterSpacing: 0.3,
                border: 'none',
              }}
            >
              {t('legal.openInBrowser', 'Open in browser')}
            </button>
          </div>
        )}
        <iframe
          src={config.url}
          title={t(config.titleKey, config.fallbackTitle)}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{
            width: '100%', height: '100%', border: 'none',
            background: '#FFFFFF',
          }}
        />
      </div>
    </div>
  );
}
