import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

// ── Branded launch animation ────────────────────────────────────────────────
// Plays once per COLD launch (module flag survives re-renders/navigation; resets
// on a fresh JS load = a real app open). Choreographed, no "pop":
//   bg ignition blooms → logo fades/scales in (subtle) → specular shimmer sweeps
//   across the logo → hold → whole thing fades into the app.
//
// White-label: gym's own logo when in a gym; the gym NAME wordmark while its
// logo URL resolves (never flashes the platform brand at a gym's members); the
// platform logo (/tugympr-logo.png, wordmark fallback) on the pre-login launch.

let splashPlayed = false;

const MIN_MS = 1900;   // lets the full choreography play even on instant boots
const MAX_MS = 4000;   // hard cap so a slow/stuck boot never traps the user
const SPLASH_BG = '#05070B';
const PLATFORM_LOGO_SRC = '/tugympr-logo.png';
const ACCENT = 'var(--color-accent, #D4AF37)';

const reduce =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

const LOGO_STYLE = { position: 'relative', width: 'min(48vw, 200px)', maxHeight: 200, objectFit: 'contain', display: 'block' };

// Sweeping specular sheen, clipped to the logo's shape via mask-image so only
// the logo pixels light up. Skipped under reduced-motion.
const Shimmer = ({ src }) => (
  <motion.div
    aria-hidden
    style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'screen',
      WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`,
      WebkitMaskSize: 'contain', maskSize: 'contain',
      WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
      WebkitMaskPosition: 'center', maskPosition: 'center',
      background: 'linear-gradient(100deg, transparent 40%, rgba(255,255,255,0.75) 50%, transparent 60%)',
      backgroundSize: '250% 100%', backgroundRepeat: 'no-repeat',
    }}
    initial={{ backgroundPosition: '175% 0', opacity: 0 }}
    animate={{ backgroundPosition: '-75% 0', opacity: [0, 1, 1, 0] }}
    transition={{ duration: 0.95, ease: 'easeInOut', delay: 0.8 }}
  />
);

// Wordmark with an accent highlight sweeping through the text (background-clip).
const Wordmark = ({ text }) => (
  <motion.span
    style={{
      position: 'relative',
      fontFamily: "'Barlow Condensed', 'Barlow', system-ui, sans-serif",
      fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.01em',
      fontSize: 'clamp(30px, 9vw, 48px)', whiteSpace: 'nowrap',
      background: `linear-gradient(100deg, var(--color-text-primary,#fff) 38%, color-mix(in srgb, ${ACCENT} 85%, #fff) 50%, var(--color-text-primary,#fff) 62%)`,
      backgroundSize: '250% 100%', backgroundRepeat: 'no-repeat',
      WebkitBackgroundClip: 'text', backgroundClip: 'text',
      WebkitTextFillColor: 'transparent', color: 'transparent',
    }}
    initial={reduce ? { opacity: 0 } : { backgroundPosition: '175% 0' }}
    animate={reduce ? { opacity: 1 } : { backgroundPosition: '-75% 0' }}
    transition={{ duration: 1.1, ease: 'easeInOut', delay: 0.55 }}
  >
    {text}
  </motion.span>
);

const PlatformMark = () => {
  const [failed, setFailed] = useState(false);
  if (failed) return <Wordmark text={(typeof window !== 'undefined' && window.__APP_NAME) || 'TuGymPR'} />;
  return (
    <div style={{ position: 'relative' }}>
      <img src={PLATFORM_LOGO_SRC} alt="" onError={() => setFailed(true)} style={LOGO_STYLE} />
      {!reduce && <Shimmer src={PLATFORM_LOGO_SRC} />}
    </div>
  );
};

export default function LaunchSplash() {
  const { gymLogoUrl, gymName, profile, loading } = useAuth();
  const [show, setShow] = useState(!splashPlayed);
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    if (!show) { splashPlayed = true; return; }
    const minT = setTimeout(() => setMinElapsed(true), MIN_MS);
    const maxT = setTimeout(() => setShow(false), MAX_MS);
    return () => { clearTimeout(minT); clearTimeout(maxT); };
  }, [show]);

  useEffect(() => {
    if (show && minElapsed && !loading) setShow(false);
  }, [show, minElapsed, loading]);

  const inGym = !!(gymLogoUrl || profile?.gym_id || gymName);

  let mark;
  if (gymLogoUrl) {
    mark = (
      <div style={{ position: 'relative' }}>
        <img src={gymLogoUrl} alt={gymName || ''} style={LOGO_STYLE} />
        {!reduce && <Shimmer src={gymLogoUrl} />}
      </div>
    );
  } else if (inGym) {
    mark = <Wordmark text={gymName || ''} />;
  } else {
    mark = <PlatformMark />;
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="launch-splash"
          className="fixed inset-0 flex items-center justify-center overflow-hidden"
          style={{ background: SPLASH_BG, zIndex: 99999 }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeInOut' }}
        >
          {!reduce && (
            <>
              {/* Drifting accent mesh — ambient depth */}
              <motion.div aria-hidden style={{
                position: 'absolute', top: '12%', left: '8%', width: 420, height: 420, borderRadius: '50%',
                background: `radial-gradient(circle, color-mix(in srgb, ${ACCENT} 16%, transparent) 0%, transparent 70%)`,
                filter: 'blur(40px)', pointerEvents: 'none',
              }} initial={{ opacity: 0, x: -30, y: -10 }} animate={{ opacity: 0.7, x: 20, y: 20 }} transition={{ duration: 6, ease: 'easeOut' }} />
              <motion.div aria-hidden style={{
                position: 'absolute', bottom: '10%', right: '6%', width: 460, height: 460, borderRadius: '50%',
                background: `radial-gradient(circle, color-mix(in srgb, ${ACCENT} 12%, transparent) 0%, transparent 70%)`,
                filter: 'blur(48px)', pointerEvents: 'none',
              }} initial={{ opacity: 0, x: 30, y: 20 }} animate={{ opacity: 0.6, x: -20, y: -16 }} transition={{ duration: 7, ease: 'easeOut' }} />

              {/* Center ignition — light blooms outward once, then settles */}
              <motion.div aria-hidden style={{
                position: 'absolute', width: 540, height: 540, borderRadius: '50%',
                background: `radial-gradient(circle, color-mix(in srgb, ${ACCENT} 30%, transparent) 0%, transparent 62%)`,
                filter: 'blur(30px)', pointerEvents: 'none',
              }} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 0.85, 0.4], scale: [0.4, 1, 0.92] }} transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }} />

              {/* Expanding ring pulse */}
              <motion.div aria-hidden style={{
                position: 'absolute', width: 200, height: 200, borderRadius: '50%',
                border: `1px solid color-mix(in srgb, ${ACCENT} 45%, transparent)`, pointerEvents: 'none',
              }} initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: [0, 0.5, 0], scale: [0.5, 2.4, 3] }} transition={{ duration: 1.6, ease: 'easeOut', delay: 0.15 }} />
            </>
          )}

          {/* Logo / wordmark — smooth fade + gentle scale (no pop) */}
          <motion.div
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.965, y: 6 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          >
            {mark}
          </motion.div>

          {/* Vignette for focus/depth */}
          <div aria-hidden style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(circle at center, transparent 45%, rgba(0,0,0,0.45) 100%)',
          }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
