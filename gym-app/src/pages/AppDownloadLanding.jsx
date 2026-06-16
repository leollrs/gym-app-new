import { useEffect, useState } from 'react';
import { useParams, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { Download } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { APP_STORE_URL, PLAY_STORE_URL } from '../lib/appUrls';
import logger from '../lib/logger';

// Public "download the app" landing. Two variants share the same chrome:
//
//   variant="trainer" (default) — the `/t/:id` + `/invite/t/:id` trainer share
//     link. Personalizes the headline ("Train with <name>") and, with the app
//     installed, the universal link opens the app instead (see appUrlOpen in
//     main.jsx) — this page is the no-app fallback, never the bare web profile.
//
//   variant="get" — the `/get?c=<kind>&id=<id>` link baked into every shared
//     poster's caption (appShareUrl). A non-user who taps a shared workout / PR /
//     achievement / streak / recap / cardio image lands here and is pushed to
//     download (or, if they already have the app, to open it via the scheme).
//
// Fixed dark/brand look on purpose (it's a first impression for non-users), not
// the theme-aware app palette. Pre-launch shows a "coming soon" state; set
// APP_STORE_URL / PLAY_STORE_URL in lib/appUrls.js to flip on real buttons.
const ACCENT = '#2DD4BF';

export default function AppDownloadLanding({ variant = 'trainer' }) {
  const { id } = useParams();
  const location = useLocation();
  const { t } = useTranslation('pages');
  const [name, setName] = useState('');

  const native = Capacitor.isNativePlatform();
  const isGet = variant === 'get';

  // `/get` carries the share context in the query string (c=kind, id=record id).
  const params = new URLSearchParams(location.search || '');
  const shareKind = (params.get('c') || '').trim();
  const shareId = (params.get('id') || '').trim();

  useEffect(() => {
    // Personalize ("Train with <name>") when we can read the public profile.
    // Anonymous visitors may be blocked by RLS — fall back to the generic copy.
    // Only the trainer variant has a profile to fetch.
    if (isGet || native || !id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_trainer_public_profile', { p_trainer_id: id });
        if (cancelled || error) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.full_name) setName(row.full_name);
      } catch (e) {
        logger.error?.('AppDownloadLanding name fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [id, native, isGet]);

  // Belt-and-suspenders: if this ever renders inside the native app, route to a
  // real in-app destination instead of a download page. The trainer variant
  // goes to the profile; the generic /get variant just lands on home (the share
  // context isn't a routable in-app screen on its own).
  if (native) return <Navigate to={isGet ? '/' : `/trainers/${id}`} replace />;

  const stores = [
    APP_STORE_URL && { url: APP_STORE_URL, label: t('appDownload.appStore', 'Download for iOS') },
    PLAY_STORE_URL && { url: PLAY_STORE_URL, label: t('appDownload.playStore', 'Download for Android') },
  ].filter(Boolean);

  const openInApp = () => {
    // Hand off to the installed app via the registered custom scheme. Works even
    // when the universal link doesn't fire (e.g. Apple's AASA CDN is still
    // serving a stale copy) — the OS routes the scheme straight to the app, no
    // CDN involved. If the app isn't installed nothing happens (page stays), so
    // it's safe to show to everyone.
    if (isGet) {
      // Forward the share context so the app can (later) route on it; even with
      // no handler the OS still foregrounds the installed app.
      const qs = [shareKind && `c=${encodeURIComponent(shareKind)}`, shareId && `id=${encodeURIComponent(shareId)}`]
        .filter(Boolean).join('&');
      window.location.href = `tugympr://get${qs ? `?${qs}` : ''}`;
    } else if (id) {
      window.location.href = `tugympr://t/${id}`;
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 24px calc(40px + env(safe-area-inset-bottom, 0px))',
        background: 'radial-gradient(circle at 50% 0%, #15302C 0%, #0B0F12 58%)',
        color: '#fff',
        fontFamily: 'Barlow, system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ maxWidth: 460, width: '100%' }}>
        <div style={{
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 34, letterSpacing: -0.5, lineHeight: 1,
        }}>
          TuGym<span style={{ color: ACCENT }}>PR</span>
        </div>
        <div style={{ fontSize: 12.5, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 8 }}>
          {t('appDownload.brandTagline', 'Train. Compete. Progress.')}
        </div>

        <h1 style={{
          fontFamily: '"Barlow Condensed", Barlow, system-ui, sans-serif',
          fontWeight: 800, fontSize: 30, lineHeight: 1.1, letterSpacing: -0.4,
          margin: '34px 0 12px',
        }}>
          {name
            ? t('appDownload.headlineNamed', 'Train with {{name}} on TuGymPR', { name })
            : t('appDownload.headline', 'Get the TuGymPR app')}
        </h1>
        <p style={{ fontSize: 15.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.72)', margin: '0 auto 28px', maxWidth: 380 }}>
          {t('appDownload.sub', 'Your workouts, classes, progress and coach — all in one app.')}
        </p>

        {stores.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 320, margin: '0 auto' }}>
            {stores.map((s) => (
              <a
                key={s.url}
                href={s.url}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '14px 18px', borderRadius: 14,
                  background: ACCENT, color: '#06231F',
                  fontWeight: 800, fontSize: 15, textDecoration: 'none',
                }}
              >
                <Download size={17} strokeWidth={2.4} />
                {s.label}
              </a>
            ))}
          </div>
        ) : (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 18px', borderRadius: 999,
            background: 'rgba(45,212,191,0.12)',
            border: '1px solid rgba(45,212,191,0.35)',
            color: ACCENT, fontWeight: 700, fontSize: 14,
          }}>
            {t('appDownload.comingSoon', 'Coming soon to the App Store and Google Play')}
          </div>
        )}

        <button
          type="button"
          onClick={openInApp}
          style={{
            marginTop: 18, background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.7)', fontSize: 13.5, fontWeight: 600,
          }}
        >
          {t('appDownload.haveApp', 'Already have the app?')}{' '}
          <span style={{ color: ACCENT, textDecoration: 'underline' }}>
            {t('appDownload.openIt', 'Open it')}
          </span>
        </button>
      </div>
    </div>
  );
}
