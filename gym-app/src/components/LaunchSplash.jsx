import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

// ── Branded launch animation ────────────────────────────────────────────────
// Plays once per COLD launch (the module flag survives re-renders + navigation;
// it resets only when the JS bundle reloads = a real app open). Overlaps the
// boot so it's a deliberate ~1.3s branded beat, not pure added delay.
//
// White-label logic:
//   • In a gym (branding loaded)      → that gym's own logo.
//   • In a gym, logo URL still loading → the gym's NAME wordmark (never flashes
//     the platform brand at a gym's members).
//   • Pre-login / signup (no gym)      → the PLATFORM logo (yours), falling back
//     to the "TuGymPR" wordmark until a logo file is dropped in public/.

let splashPlayed = false;

const MIN_MS = 1200;  // deliberate premium beat, even on instant cached boots
const MAX_MS = 3500;  // hard cap so a slow/stuck boot never traps the user
const SPLASH_BG = '#05070B';                 // matches the native splash → seamless handoff
const PLATFORM_LOGO_SRC = '/tugympr-logo.png'; // drop a transparent PNG here; else wordmark shows

const prefersReducedMotion =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

const Wordmark = ({ text }) => (
  <span
    style={{
      position: 'relative',
      fontFamily: "'Barlow Condensed', 'Barlow', system-ui, sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.01em',
      fontSize: 'clamp(28px, 8vw, 42px)',
      color: 'var(--color-text-primary, #fff)',
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </span>
);

// Platform logo: tries the image, falls back to the wordmark if it 404s.
const PlatformMark = () => {
  const [failed, setFailed] = useState(false);
  if (failed) return <Wordmark text={(typeof window !== 'undefined' && window.__APP_NAME) || 'TuGymPR'} />;
  return (
    <img
      src={PLATFORM_LOGO_SRC}
      alt=""
      onError={() => setFailed(true)}
      style={{ position: 'relative', width: 'min(46vw, 190px)', maxHeight: 190, objectFit: 'contain' }}
    />
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

  // Hide once the minimum beat has passed AND the app has finished booting.
  useEffect(() => {
    if (show && minElapsed && !loading) setShow(false);
  }, [show, minElapsed, loading]);

  const inGym = !!(gymLogoUrl || profile?.gym_id || gymName);

  let mark;
  if (gymLogoUrl) {
    mark = (
      <img
        src={gymLogoUrl}
        alt={gymName || ''}
        style={{ position: 'relative', width: 'min(46vw, 190px)', maxHeight: 190, objectFit: 'contain' }}
      />
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
          className="fixed inset-0 flex items-center justify-center"
          style={{ background: SPLASH_BG, zIndex: 99999 }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        >
          <motion.div
            style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.84, filter: 'blur(8px)' }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
          >
            {/* Soft accent glow that blooms behind the mark. */}
            {!prefersReducedMotion && (
              <motion.div
                aria-hidden
                style={{
                  position: 'absolute',
                  width: 300,
                  height: 300,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle, color-mix(in srgb, var(--color-accent, #D4AF37) 28%, transparent) 0%, transparent 68%)',
                  filter: 'blur(26px)',
                  pointerEvents: 'none',
                }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, 0.95, 0.7], scale: [0.6, 1.06, 1] }}
                transition={{ duration: 1.5, ease: 'easeOut' }}
              />
            )}
            {mark}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
