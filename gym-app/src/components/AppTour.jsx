import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

// Step order is the user-visible tour sequence. titleKey/textKey reference the
// pre-existing numbered i18n entries — the new feature stops (Recovery, Exercise
// Library, Food Scan) use keys 11/12/13 so we don't have to renumber the
// existing 10 entries on disk.
const TOUR_STEP_KEYS = [
  { route: '/', target: 'tour-my-plan', titleKey: 'appTour.step1Title', textKey: 'appTour.step1Text', position: 'below' },
  { route: '/', target: 'tour-quick-buttons', titleKey: 'appTour.step2Title', textKey: 'appTour.step2Text', position: 'below' },
  { route: '/', target: 'tour-hero-card', titleKey: 'appTour.step3Title', textKey: 'appTour.step3Text', position: 'above' },
  // NEW: Recovery pill — forced on by Dashboard while the tour is active
  { route: '/', target: 'tour-recovery-pill', titleKey: 'appTour.step11Title', textKey: 'appTour.step11Text', position: 'below' },
  { route: '/', target: 'tour-level', titleKey: 'appTour.step4Title', textKey: 'appTour.step4Text', position: 'above' },
  { route: '/workouts', target: 'tour-workouts-page', titleKey: 'appTour.step5Title', textKey: 'appTour.step5Text', position: 'below' },
  // NEW: Exercise library + body diagram
  { route: '/exercises', target: 'tour-exercise-library', titleKey: 'appTour.step12Title', textKey: 'appTour.step12Text', position: 'below' },
  { route: '/record', target: 'tour-quickstart-page', titleKey: 'appTour.step6Title', textKey: 'appTour.step6Text', position: 'below' },
  // NEW: AI food scan FAB on Nutrition
  { route: '/nutrition', target: 'tour-nutrition-scan', titleKey: 'appTour.step13Title', textKey: 'appTour.step13Text', position: 'above' },
  { route: '/progress', target: 'tour-progress-page', titleKey: 'appTour.step7Title', textKey: 'appTour.step7Text', position: 'below' },
  { route: '/community', target: 'tour-community-page', titleKey: 'appTour.step8Title', textKey: 'appTour.step8Text', position: 'below' },
  { route: '/profile', target: 'tour-profile-page', titleKey: 'appTour.step9Title', textKey: 'appTour.step9Text', position: 'below' },
  { route: '/', target: 'tour-nav-record', titleKey: 'appTour.step10Title', textKey: 'appTour.step10Text', position: 'above' },
];

const STORAGE_PREFIX = 'app_tour_completed_';
const STEP_KEY = 'app_tour_step';
const ACTIVE_KEY = 'app_tour_active';
const TOOLTIP_W = 300;
const PAD = 8;

function getTargetRect(key) {
  const el = document.querySelector(`[data-tour="${key}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height, el };
}

// Preload a route's chunk by triggering the lazy import directly so the
// chunk is warm in the cache before the user navigates. Used at tour start
// to fire every visited route in parallel — by the time the user advances
// past Dashboard, every other page is already in memory and transitions
// are instant. (Previously the /record case mis-imported Workouts.jsx and
// nothing warmed /exercises or /nutrition — the new tour stops would have
// hit a cold lazy() chunk and made the user wait.)
const preloadedRoutes = new Set();
async function preloadRoute(route) {
  if (preloadedRoutes.has(route)) return;
  preloadedRoutes.add(route);
  try {
    if (route.startsWith('/workouts')) await import('../pages/Workouts.jsx');
    else if (route.startsWith('/exercises')) await import('../pages/ExerciseLibrary.jsx');
    else if (route.startsWith('/record')) await import('../pages/QuickStart.jsx');
    else if (route.startsWith('/nutrition')) await import('../pages/Nutrition.jsx');
    else if (route.startsWith('/progress')) await import('../pages/Progress.jsx');
    else if (route.startsWith('/community')) await import('../pages/Community.jsx');
    else if (route.startsWith('/profile')) await import('../pages/Profile.jsx');
    else if (route === '/' || route.startsWith('/dashboard')) await import('../pages/Dashboard.jsx');
  } catch { /* ignore preload failures */ }
}

// Kick off every route in the tour in parallel. Called once when the tour
// becomes active so subsequent step navigations are instant.
function preloadAllTourRoutes() {
  const unique = new Set(TOUR_STEP_KEYS.map(s => s.route));
  for (const r of unique) preloadRoute(r);
}

export default function AppTour({ userId }) {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = `${STORAGE_PREFIX}${userId || 'anon'}`;
  const findRef = useRef(null);
  const throttleRef = useRef(false);

  // Persist step + active state across background/foreground cycles
  const [step, setStepRaw] = useState(() => {
    try { return parseInt(sessionStorage.getItem(STEP_KEY)) || 0; } catch { return 0; }
  });
  const [show, setShowRaw] = useState(() => {
    try { return sessionStorage.getItem(ACTIVE_KEY) === 'true'; } catch { return false; }
  });
  const [rect, setRect] = useState(null);
  const [navigating, setNavigating] = useState(false);

  const setStep = useCallback((v) => {
    setStepRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      try { sessionStorage.setItem(STEP_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const setShow = useCallback((v) => {
    setShowRaw(v);
    try { sessionStorage.setItem(ACTIVE_KEY, String(v)); } catch {}
    // Broadcast active-state. Dashboard listens so the Recovery pill renders
    // during the tour even on training days when its normal gate would hide
    // it (the pill is the anchor for the Recovery step).
    try {
      window.__appTourActive = !!v;
      window.dispatchEvent(new CustomEvent('app-tour-active', { detail: !!v }));
    } catch {}
    // First time the tour activates, warm every route's chunk in parallel so
    // step transitions don't pay a cold lazy-import latency penalty.
    if (v) preloadAllTourRoutes();
  }, []);

  // Restored-from-session sync: setShow() only runs on transitions, so an
  // already-active tour from a page reload would skip its broadcast +
  // preload. Replay both here on mount.
  useEffect(() => {
    if (!show) return;
    try {
      window.__appTourActive = true;
      window.dispatchEvent(new CustomEvent('app-tour-active', { detail: true }));
    } catch {}
    preloadAllTourRoutes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show tour on first visit — check localStorage then DB
  useEffect(() => {
    if (!userId) return;
    // If tour is already active (restored from session), skip the check
    if (show) return;
    if (localStorage.getItem(storageKey)) return;

    let cancelled = false;
    supabase
      .from('profiles')
      .select('has_seen_tour')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.has_seen_tour) {
          localStorage.setItem(storageKey, 'true');
          return;
        }
        // Short delay for page to settle, then show
        setTimeout(() => {
          if (!cancelled) {
            setShow(true);
            setStep(0);
          }
        }, 1500);
      });
    return () => { cancelled = true; };
  }, [userId, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find target element for current step
  const findTarget = useCallback(() => {
    if (!show || navigating) return;
    const current = TOUR_STEP_KEYS[step];
    if (!current) return;

    const normalizedPath = location.pathname.replace(/\/$/, '') || '/';
    const normalizedRoute = (current.route || '/').replace(/\/$/, '') || '/';
    if (normalizedPath !== normalizedRoute) {
      setNavigating(true);
      setRect(null);
      navigate(current.route);
      return;
    }

    let attempts = 0;
    clearTimeout(findRef.current);
    const tryFind = () => {
      const r = getTargetRect(current.target);
      if (r) {
        r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        findRef.current = setTimeout(() => {
          const updated = getTargetRect(current.target);
          setRect(updated || r);
        }, 250);
      } else if (attempts < 40) {
        // ~6 s budget (was 3 s) — covers slower lazy chunks + first-paint
        // skeletons on the new Recovery / ExerciseLibrary / Nutrition stops.
        attempts++;
        findRef.current = setTimeout(tryFind, 150);
      } else {
        // Target not found — skip to next
        if (step < TOUR_STEP_KEYS.length - 1) {
          setStep(s => s + 1);
        } else {
          dismiss();
        }
      }
    };
    tryFind();

    return () => clearTimeout(findRef.current);
  }, [step, show, navigating, location.pathname, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle navigation completion
  useEffect(() => {
    if (!navigating) return;
    const current = TOUR_STEP_KEYS[step];
    const normalizedPath = location.pathname.replace(/\/$/, '') || '/';
    const normalizedRoute = (current?.route || '/').replace(/\/$/, '') || '/';
    if (normalizedPath === normalizedRoute) {
      const timer = setTimeout(() => setNavigating(false), 300);
      return () => clearTimeout(timer);
    }
    const safety = setTimeout(() => setNavigating(false), 2000);
    return () => clearTimeout(safety);
  }, [location.pathname, navigating, step]);

  useEffect(() => { findTarget(); }, [findTarget]);

  // Preload the NEXT step's route so transition is instant
  useEffect(() => {
    if (!show) return;
    const nextStep = TOUR_STEP_KEYS[step + 1];
    if (nextStep && nextStep.route !== TOUR_STEP_KEYS[step]?.route) {
      // Navigate will lazy-load the chunk; we just warm the route cache
      // by doing nothing here — React Router's lazy() handles it.
      // The key optimization is the reduced retry delay above.
    }
  }, [step, show]);

  // Update rect on scroll
  const throttledScrollHandler = useCallback(() => {
    if (throttleRef.current) return;
    throttleRef.current = true;
    requestAnimationFrame(() => {
      const current = TOUR_STEP_KEYS[step];
      if (current) {
        const r = getTargetRect(current.target);
        if (r) setRect(r);
      }
      throttleRef.current = false;
    });
  }, [step]);

  useEffect(() => {
    if (!show || !rect) return;
    window.addEventListener('scroll', throttledScrollHandler, true);
    return () => window.removeEventListener('scroll', throttledScrollHandler, true);
  }, [show, rect, throttledScrollHandler]);

  // Restore rect when app comes back from background
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && show) {
        // Re-find target after returning from background
        setTimeout(() => {
          const current = TOUR_STEP_KEYS[step];
          if (current) {
            const r = getTargetRect(current.target);
            if (r) setRect(r);
            else findTarget();
          }
        }, 300);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [show, step, findTarget]);

  const dismiss = useCallback(() => {
    setShow(false);
    try { sessionStorage.removeItem(STEP_KEY); sessionStorage.removeItem(ACTIVE_KEY); } catch {}
    localStorage.setItem(storageKey, 'true');
    if (userId) {
      supabase.from('profiles').update({ has_seen_tour: true }).eq('id', userId).then(() => {});
    }
    navigate('/');
  }, [storageKey, userId, navigate, setShow]);

  const next = useCallback(() => {
    if (step < TOUR_STEP_KEYS.length - 1) {
      setRect(null);
      setStep(step + 1);
    } else {
      dismiss();
    }
  }, [step, setStep, dismiss]);

  const back = useCallback(() => {
    if (step > 0) {
      setRect(null);
      setStep(step - 1);
    }
  }, [step, setStep]);

  if (!show) return null;

  const current = TOUR_STEP_KEYS[step];
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  let tooltipStyle = { left: Math.max(12, (vw - TOOLTIP_W) / 2) };
  const TOOLTIP_H_ESTIMATE = 180;
  const GAP = 16;

  if (rect) {
    const idealLeft = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    tooltipStyle.left = Math.max(12, Math.min(idealLeft, vw - TOOLTIP_W - 12));

    const spaceBelow = vh - (rect.top + rect.height + GAP);
    const spaceAbove = rect.top - GAP;

    if (current.position === 'below' && spaceBelow >= TOOLTIP_H_ESTIMATE) {
      tooltipStyle.top = rect.top + rect.height + GAP;
    } else if (current.position === 'above' && spaceAbove >= TOOLTIP_H_ESTIMATE) {
      tooltipStyle.bottom = vh - rect.top + GAP;
    } else if (spaceBelow >= spaceAbove) {
      tooltipStyle.top = rect.top + rect.height + GAP;
    } else {
      tooltipStyle.bottom = vh - rect.top + GAP;
    }
  } else {
    tooltipStyle.top = vh / 2 - 80;
  }

  return (
    <div className="fixed inset-0 z-[200]" style={{ pointerEvents: 'auto' }}>
      {/* Dark overlay with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PAD}
                y={rect.top - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx={14}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.78)" mask="url(#tour-mask)" />
      </svg>

      {/* Highlight ring */}
      {rect && (
        <div
          className="absolute border-2 border-[#D4AF37] pointer-events-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 14,
            boxShadow: '0 0 24px var(--color-accent-glow)',
          }}
        />
      )}

      {/* Click overlay to advance */}
      <div className="absolute inset-0" onClick={next} />

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          className="absolute"
          style={{ ...tooltipStyle, width: TOOLTIP_W, pointerEvents: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border border-[#D4AF37]/30 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden" style={{ background: 'var(--color-bg-deep, #0A0F1A)' }}>
            {/* Progress dots + skip */}
            <div className="flex items-center justify-between px-4 pt-3.5">
              <div className="flex items-center gap-1">
                {TOUR_STEP_KEYS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-[3px] rounded-full transition-all duration-300 ${
                      i <= step ? 'w-3 bg-[#D4AF37]' : 'w-1.5 bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={dismiss}
                className="flex items-center gap-1 text-[10px] font-medium transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label={t('appTour.skip')}
              >
                {t('appTour.skip')} <X size={12} />
              </button>
            </div>

            {/* Content */}
            <div className="px-4 pt-2.5 pb-2">
              <h3 className="text-[15px] font-black mb-1" style={{ color: 'var(--color-text-primary)' }}>{t(current.titleKey)}</h3>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{t(current.textKey)}</p>
            </div>

            {/* Buttons */}
            <div className="px-4 pb-3.5 flex gap-2 mt-0.5">
              {step > 0 && (
                <button onClick={back} className="flex-1 py-2.5 rounded-xl bg-white/5 font-semibold text-[12px] min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none" style={{ color: 'var(--color-text-muted)' }}>
                  {t('appTour.back')}
                </button>
              )}
              <button
                onClick={next}
                className="flex-1 py-2.5 rounded-xl bg-[#D4AF37] text-black font-bold text-[12px] flex items-center justify-center gap-1 min-h-[44px] focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
              >
                {step < TOUR_STEP_KEYS.length - 1 ? (
                  <>{t('appTour.next')} <ChevronRight size={14} /></>
                ) : t('appTour.letsGo')}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function resetAppTour(userId) {
  localStorage.removeItem(`${STORAGE_PREFIX}${userId || 'anon'}`);
  try { sessionStorage.removeItem(STEP_KEY); sessionStorage.removeItem(ACTIVE_KEY); } catch {}
}
