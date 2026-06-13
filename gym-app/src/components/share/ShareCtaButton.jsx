// ShareCtaButton.jsx
// -----------------------------------------------------------------------------
// The adaptive "confirm" button shared by all share sheets (workout, cardio,
// achievement) — the styling first built for Share Month: the background color,
// the glyph, and the label all adapt to the chosen destination (IG gradient for
// Instagram, Facebook blue for Facebook, the gym accent for everything else).
// -----------------------------------------------------------------------------

import React from 'react';
import { Loader2, Download } from 'lucide-react';

const FONT_D = '"Archivo", "Familjen Grotesk", system-ui, sans-serif';
const IG_GRADIENT = 'linear-gradient(135deg,#FEDA75,#FA7E1E 28%,#D62976 62%,#962FBF 100%)';

function IGGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1">
      <rect x="3" y="3" width="18" height="18" rx="5.4" /><circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.2" fill="#fff" stroke="none" />
    </svg>
  );
}
function WAGlyph() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.4A10 10 0 1012 2zm5 14.3c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-4.2-1.2a10 10 0 01-4.3-5.4c-.3-.9.4-1.6.7-2 .3-.2.6-.2.8-.2h.5c.2 0 .4 0 .6.4l.8 2c.1.2 0 .4-.1.5l-.3.4c-.1.2-.3.3-.1.6a7 7 0 003.4 3c.3.2.5.1.7 0l.6-.7c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.5.3 0 .2 0 .9-.2 1.3z" /></svg>;
}
function MsgGlyph() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 2C6.5 2 2 5.8 2 10.5c0 2.4 1.2 4.6 3.1 6.1L4 22l4.7-2.5c1 .3 2.2.5 3.3.5 5.5 0 10-3.8 10-8.5S17.5 2 12 2z" /></svg>;
}
function FBGlyph() {
  return <svg width="13" height="20" viewBox="0 0 320 512" fill="#fff"><path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z" /></svg>;
}
function TuGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M18 8v6M21 11h-6" />
    </svg>
  );
}
function DestGlyph({ dest }) {
  if (dest === 'wa') return <WAGlyph />;
  if (dest === 'im') return <MsgGlyph />;
  if (dest === 'fb') return <FBGlyph />;
  if (dest === 'tu') return <TuGlyph />;
  if (dest === 'save') return <Download size={18} color="#fff" />;
  return <IGGlyph />; // ig-story / ig-feed
}

export default function ShareCtaButton({ dest, busy, accent = '#2EC4C4', gymLabel, onClick, t }) {
  const isIG = dest === 'ig-story' || dest === 'ig-feed';
  const bg = !dest
    ? 'var(--color-bg-primary)'
    : isIG ? IG_GRADIENT
    : dest === 'fb' ? '#1877F2'
    : accent;
  const label = busy
    ? t('share.cta.preparing', 'Preparing…')
    : !dest ? t('share.cta.pick', 'Pick a destination')
    : isIG ? t('share.cta.instagram', 'Share to Instagram')
    : dest === 'fb' ? t('share.cta.facebook', 'Share to Facebook')
    : dest === 'wa' ? t('share.cta.whatsapp', 'Share to WhatsApp')
    : dest === 'im' ? t('share.cta.messages', 'Share to Messages')
    : dest === 'save' ? t('share.cta.save', 'Save image')
    : dest === 'tu' ? t('share.cta.gym', { defaultValue: 'Share to {{gym}}', gym: gymLabel || 'TuGymPR' })
    : t('share.cta.share', 'Share');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!dest || busy}
      style={{
        width: '100%',
        padding: 16,
        borderRadius: 14,
        border: 'none',
        cursor: dest && !busy ? 'pointer' : 'default',
        background: bg,
        color: dest ? '#fff' : 'var(--color-text-muted)',
        fontFamily: FONT_D,
        fontWeight: 800,
        fontSize: 15,
        letterSpacing: -0.2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        opacity: busy ? 0.7 : 1,
        transition: 'background 160ms',
      }}
    >
      {busy ? <Loader2 size={18} className="animate-spin" /> : <DestGlyph dest={dest} />}
      {label}
    </button>
  );
}
