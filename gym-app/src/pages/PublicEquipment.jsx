// /invite/e/:slug — where a printed machine sticker lands.
//
// People scan these with the PHONE CAMERA, not from inside the app, so this URL
// is reached by two very different visitors and has to serve both:
//
//   • App installed → the OS matches the /invite/* universal link and hands the
//     URL to the app before a browser ever opens. This component never renders.
//   • No app → the browser opens it. THIS is the case that used to be broken:
//     /equipment/:slug lives behind ProtectedRoute, so a stranger scanning a
//     machine got a LOGIN WALL — not the app, not an install prompt, just a
//     door with no handle.
//
// So the page shows the real thing: every exercise you can do on that machine,
// to anyone, with no account. That's also what makes it a sales tool — the
// founder can scan a sticker in front of a gym owner and show actual content
// instead of describing it.
//
// Nothing here touches the network or auth: the 36-station taxonomy is bundled
// and exerciseStore starts from the static exercise list, so a logged-out
// visitor sees the full catalogue on first paint.
import React from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { stationBySlug } from '../data/equipmentStations';
import Equipment from './Equipment';

const isEs = (i18n) => (i18n.language || '').toLowerCase().startsWith('es');

export default function PublicEquipment() {
  const { slug } = useParams();
  const { user, loading } = useAuth();
  const { i18n } = useTranslation('pages');
  const spanish = isEs(i18n);

  // Wait for auth to settle before deciding. Rendering the public page first and
  // redirecting after would flash an "install the app" banner at a member who
  // already has it — the one person who least needs to see it.
  if (loading) return null;

  // Signed in → send them to the real in-app screen, which has the nav, the
  // "start this now" actions and their own workout context. The public page is
  // strictly the fallback for people we don't know yet.
  if (user) return <Navigate to={`/equipment/${slug || ''}`} replace />;

  // An unknown slug still renders: Equipment falls back to the station browser,
  // which is a better answer than a 404 for a sticker that got out of date.
  const station = slug ? stationBySlug(slug) : null;

  // Hand off to the app via the registered scheme. main.jsx already routes
  // tugympr://equipment/<slug> to the station, and that handler shipped in the
  // current build — so this works today even where the universal link doesn't
  // (Apple's AASA CDN serving a stale copy, Android not yet re-verified).
  // If the app isn't installed nothing happens and the page stays put, so it is
  // safe to show to everyone.
  const openInApp = () => {
    if (station) window.location.href = `tugympr://equipment/${station.slug}`;
  };

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg-primary)', paddingBottom: 96 }}>
      <Equipment publicMode />

      {/* Sticky, because the exercise list is long and the visitor decides to
          install AFTER scrolling through it — not before seeing anything. */}
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          background: 'var(--color-surface-primary)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex', gap: 10, alignItems: 'center',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
            {spanish ? 'Lleva esto contigo' : 'Take this with you'}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {spanish
              ? 'Registra tus series y te dice cuánto subir'
              : 'Log your sets and it tells you when to go heavier'}
          </p>
        </div>
        {station && (
          <button
            type="button"
            onClick={openInApp}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
              padding: '10px 14px', borderRadius: 12, fontWeight: 700, fontSize: 13,
              background: 'var(--color-surface-secondary)', color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-default)',
            }}
          >
            <ExternalLink size={15} aria-hidden="true" />
            {spanish ? 'Abrir' : 'Open'}
          </button>
        )}
        <Link
          to={`/get?c=equipment${station ? `&id=${encodeURIComponent(station.slug)}` : ''}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            padding: '10px 16px', borderRadius: 12, fontWeight: 700, fontSize: 13,
            background: 'var(--color-accent)', color: 'var(--color-text-on-accent)',
          }}
        >
          <Download size={15} aria-hidden="true" />
          {spanish ? 'Instalar' : 'Get the app'}
        </Link>
      </div>
    </div>
  );
}
