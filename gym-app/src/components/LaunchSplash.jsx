import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// ── Branded launch animation ────────────────────────────────────────────────
// Plays once per COLD launch (module flag survives re-renders/navigation; resets
// on a fresh JS load = a real app open).
//
// Per-gym custom video → code default fallback:
//   • If the gym uploaded a splash video, it plays over the code default and
//     fades in the moment it actually starts; the splash ends when it finishes.
//   • If there's no video, it's slow to start (>VIDEO_START_MS), or it errors,
//     the code default runs instead.
//   • First launch (video not cached) shows the default while the file is
//     prefetched into the SW cache → the gym's video plays from the 2nd launch.
//
// Code default = simple + premium (Apple-style restraint): the logo fades up with
// a gentle scale-in (no pop), a soft glow eases in behind it, and one quiet
// specular shimmer passes across — then it holds. CSS-keyframe driven, accent-driven
// (var(--ls-accent)) → white-label: every gym gets it in their own color/logo.
//
// White-label logo: gym's own logo in a gym; the gym NAME wordmark while its logo
// URL resolves; the platform logo (wordmark fallback) pre-login.

let splashPlayed = false;

const MIN_MS = 1900;          // default-path: deliberate beat even on instant boots
const MAX_MS = 8000;          // hard backstop (covers a late-starting custom video)
const VIDEO_START_MS = 3000;  // window for the video to actually start, else → default
const SPLASH_BG = '#05070B';
const PLATFORM_LOGO_SRC = '/tugympr-logo.png';
const ACCENT = 'var(--ls-accent, #F5A623)';

const reduce =
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

// Animations run only under `.ls-run`; `.ls-run .ls-center{opacity:0}` keeps the
// logo hidden until its fade-in runs (no pre-animation flash).
const SPLASH_CSS = `
.ls-glow{ position:absolute; top:50%; left:50%; width:64vmin; height:64vmin; border-radius:50%;
  pointer-events:none; filter:blur(30px); opacity:0; transform:translate(-50%,-50%);
  background:radial-gradient(circle, color-mix(in srgb, ${ACCENT} 40%, transparent) 0%, transparent 64%);
  will-change:transform,opacity; }
.ls-center{ position:relative; display:flex; align-items:center; justify-content:center; opacity:1; will-change:transform,opacity; }
.ls-run .ls-center{ opacity:0; }
.ls-logoBox{ position:relative; width:min(46vw,190px); height:min(46vw,190px); }
.ls-logo{ position:relative; width:100%; height:100%; object-fit:contain; display:block; }
.ls-shimmer{ position:absolute; inset:0; pointer-events:none; mix-blend-mode:screen; opacity:0;
  -webkit-mask-size:contain; mask-size:contain; -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
  -webkit-mask-position:center; mask-position:center;
  background:linear-gradient(100deg, transparent 42%, rgba(255,255,255,0.85) 50%, transparent 58%);
  background-size:250% 100%; background-repeat:no-repeat; background-position:175% 0;
  will-change:background-position,opacity; }
.ls-word{ position:relative; font-family:'Barlow Condensed','Barlow',system-ui,sans-serif;
  font-weight:800; text-transform:uppercase; letter-spacing:0.01em; font-size:clamp(30px,9vw,48px);
  white-space:nowrap;
  background:linear-gradient(100deg, var(--color-text-primary,#fff) 38%, color-mix(in srgb, ${ACCENT} 85%, #fff) 50%, var(--color-text-primary,#fff) 62%);
  background-size:250% 100%; background-repeat:no-repeat; background-position:-75% 0;
  -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; color:transparent; }
.ls-vignette{ position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(circle at center, transparent 55%, rgba(0,0,0,0.4) 100%); }

.ls-run .ls-glow{ animation:ls-glowIn 1100ms ease-out both; }
.ls-run .ls-center{ animation:ls-logoIn 900ms cubic-bezier(0.16,1,0.3,1) both; }
.ls-run .ls-shimmer{ animation:ls-sweep 1600ms ease-in-out both; }
.ls-run .ls-word{ animation:ls-sweepWord 1400ms ease-in-out both; }

@keyframes ls-logoIn{ 0%{opacity:0; transform:scale(0.93);} 55%{opacity:1;} 100%{opacity:1; transform:scale(1);} }
@keyframes ls-glowIn{ 0%{opacity:0; transform:translate(-50%,-50%) scale(0.85);} 100%{opacity:0.5; transform:translate(-50%,-50%) scale(1);} }
@keyframes ls-sweep{ 0%,40%{background-position:175% 0; opacity:0;} 52%{opacity:0.85;} 66%{opacity:0.85;} 80%{background-position:-75% 0; opacity:0;} 100%{background-position:-75% 0; opacity:0;} }
@keyframes ls-sweepWord{ 0%,7%{opacity:0; background-position:175% 0;} 35%{opacity:1;} 100%{opacity:1; background-position:-75% 0;} }
`;

const Wordmark = ({ text }) => <span className="ls-word">{text}</span>;

// Logo image with a single masked specular sweep; falls back to a wordmark if it fails.
const LogoMark = ({ src, fallbackText }) => {
  const [failed, setFailed] = useState(false);
  if (failed || !src) return <Wordmark text={fallbackText} />;
  return (
    <div className="ls-logoBox">
      <img className="ls-logo" src={src} alt="" onError={() => setFailed(true)} />
      {!reduce && (
        <div
          className="ls-shimmer"
          aria-hidden
          style={{ WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` }}
        />
      )}
    </div>
  );
};

export default function LaunchSplash() {
  const { gymLogoUrl, gymName, profile, loading } = useAuth();
  const gymId = profile?.gym_id || null;
  const videoKey = gymId ? `splash_video_${gymId}` : null;

  const [show, setShow] = useState(!splashPlayed);
  const [minElapsed, setMinElapsed] = useState(false);
  const [videoUrl, setVideoUrl] = useState(() => {
    try { return (videoKey && localStorage.getItem(videoKey)) || ''; } catch { return ''; }
  });
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoElRef = useRef(null);

  // Resolve / refresh the gym's splash video URL (members can read gym_branding
  // directly — RLS gym_id = current_gym_id()). Cache it for instant cold-start
  // and prefetch the file so the SW caches it → it plays from the 2nd launch on.
  useEffect(() => {
    if (!gymId) return;
    let cancelled = false;
    supabase.from('gym_branding').select('splash_video_url').eq('gym_id', gymId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const url = data?.splash_video_url || '';
        try { if (videoKey) localStorage.setItem(videoKey, url); } catch { /* ignore */ }
        if (url) {
          // Fire-and-forget; NOT aborted on unmount so it finishes caching.
          try { fetch(url).catch(() => {}); } catch { /* ignore */ }
          // Adopt the latest DB url and re-arm. `prev || url` used to pin the
          // stale cached url, so a re-upload (new ?v= cache-bust) never reached
          // members; now the fresh url replaces it and gets its own start window.
          setVideoUrl(prev => (prev === url ? prev : url));
          setVideoFailed(false);
        } else {
          setVideoUrl('');
        }
      }, () => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId]);

  const useVideo = !reduce && !!videoUrl && !videoFailed;

  // Give the video a window to actually start; if it doesn't, drop to the default.
  useEffect(() => {
    if (!show || !useVideo || videoReady) return;
    const f = setTimeout(() => setVideoFailed(true), VIDEO_START_MS);
    return () => clearTimeout(f);
  }, [show, useVideo, videoReady]);

  // Default-path timing (min beat + hard backstop).
  useEffect(() => {
    if (!show) { splashPlayed = true; return; }
    const minT = setTimeout(() => setMinElapsed(true), MIN_MS);
    const maxT = setTimeout(() => setShow(false), MAX_MS);
    return () => { clearTimeout(minT); clearTimeout(maxT); };
  }, [show]);

  // While a known custom video is still in play — URL resolved and not yet
  // failed — it OWNS when the splash ends (its onEnded), bounded only by the
  // MAX_MS backstop. Holding through the video's start window stops the
  // default's min-beat from cutting the video off right before it begins.
  // With no video (or once it fails) the default ends after the min beat AND
  // the app has finished booting.
  useEffect(() => {
    if (!show) return;
    if (useVideo) return;
    if (minElapsed && !loading) setShow(false);
  }, [show, useVideo, minElapsed, loading]);

  const inGym = !!(gymLogoUrl || gymId || gymName);

  let mark;
  if (gymLogoUrl) {
    mark = <LogoMark src={gymLogoUrl} fallbackText={gymName || ''} />;
  } else if (inGym) {
    mark = <Wordmark text={gymName || ''} />;
  } else {
    mark = (
      <LogoMark
        src={PLATFORM_LOGO_SRC}
        fallbackText={(typeof window !== 'undefined' && window.__APP_NAME) || 'TuGymPR'}
      />
    );
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="launch-splash"
          className={`fixed inset-0 flex items-center justify-center overflow-hidden${reduce ? '' : ' ls-run'}`}
          style={{
            background: SPLASH_BG,
            zIndex: 99999,
            // gym → their accent; pre-login → the platform gold.
            ['--ls-accent']: inGym ? 'var(--color-accent, #F5A623)' : '#F5A623',
          }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeInOut' }}
        >
          <style>{SPLASH_CSS}</style>

          {/* ── Code default (renders underneath; shown until/unless the video plays) ── */}
          {!reduce && <div className="ls-glow" aria-hidden />}

          <div className="ls-center">{mark}</div>

          <div className="ls-vignette" aria-hidden />

          {/* ── Custom gym video (on top; invisible until it actually starts) ── */}
          {useVideo && (
            <motion.video
              ref={videoElRef}
              src={videoUrl}
              muted
              playsInline
              autoPlay
              preload="auto"
              // Belt-and-suspenders for iOS: nudge playback the moment it can
              // play, in case the autoPlay attribute alone doesn't kick in.
              onCanPlay={() => { try { videoElRef.current?.play?.()?.catch?.(() => {}); } catch { /* ignore */ } }}
              onPlaying={() => setVideoReady(true)}
              onEnded={() => setShow(false)}
              onError={() => setVideoFailed(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: videoReady ? 1 : 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: SPLASH_BG, zIndex: 5 }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
