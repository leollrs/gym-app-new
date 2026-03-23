import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

/*
  Interactive app tour that highlights real UI elements and navigates
  between pages. Each step specifies a route + target DOM element.
*/
const TOUR_STEPS = [
  // ── HOME ──
  {
    route: '/',
    target: 'tour-my-plan',
    title: 'Your Daily Plan',
    text: 'This is your home screen. We pick the best workout for each day based on your schedule. Swipe the day strip to see upcoming days.',
    position: 'below',
  },
  {
    route: '/',
    target: 'tour-quick-buttons',
    title: 'Quick Access',
    text: 'Nutrition tracks your calories and macros. QR opens your check-in code to scan at the gym.',
    position: 'below',
  },
  {
    route: '/',
    target: 'tour-hero-card',
    title: 'Start Your Workout',
    text: 'Tap here to begin today\'s session. We\'ll suggest weights and reps based on your history — just follow along.',
    position: 'above',
  },
  {
    route: '/',
    target: 'tour-level',
    title: 'Level & Challenge',
    text: 'Earn XP from workouts, PRs, and check-ins to level up. Complete the daily challenge for bonus points!',
    position: 'above',
  },
  // ── WORKOUTS ──
  {
    route: '/workouts',
    target: 'tour-workouts-page',
    title: 'Your Routines',
    text: 'All your workout routines and gym programs live here. Create custom routines or follow a structured program.',
    position: 'below',
  },
  // ── QUICK START ──
  {
    route: '/record',
    target: 'tour-quickstart-page',
    title: 'Quick Start',
    text: 'The fastest way to begin. Shows today\'s workout with a big start button. Tap it when you\'re ready to train.',
    position: 'below',
  },
  // ── PROGRESS ──
  {
    route: '/progress',
    target: 'tour-progress-page',
    title: 'Track Progress',
    text: 'Your workout history, body measurements, weight chart, and personal records — all in one place.',
    position: 'below',
  },
  // ── COMMUNITY ──
  {
    route: '/community',
    target: 'tour-community-page',
    title: 'Community',
    text: 'See friends\' activity, join gym challenges, and compete on leaderboards. Invite friends to earn bonus points!',
    position: 'below',
  },
  // ── PROFILE ──
  {
    route: '/profile',
    target: 'tour-profile-page',
    title: 'Your Profile',
    text: 'View your stats, achievements, goals, and gym info. Level up and unlock new achievement badges as you train.',
    position: 'below',
  },
  // ── BACK TO NAV ──
  {
    route: '/',
    target: 'tour-nav-record',
    title: 'You\'re All Set!',
    text: 'Hit this button anytime to start training. The app learns from every session to make your next one even better. Let\'s go!',
    position: 'above',
  },
];

const STORAGE_PREFIX = 'app_tour_completed_';
const TOOLTIP_W = 300;
const PAD = 8;

function getTargetRect(key) {
  const el = document.querySelector(`[data-tour="${key}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, el };
}

export default function AppTour({ userId }) {
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  const [rect, setRect] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const storageKey = `${STORAGE_PREFIX}${userId || 'anon'}`;
  const findRef = useRef(null);

  // Show tour on first visit for this user
  useEffect(() => {
    if (!userId) return;
    if (localStorage.getItem(storageKey)) return;
    const timer = setTimeout(() => setShow(true), 2000);
    return () => clearTimeout(timer);
  }, [userId, storageKey]);

  // Find and highlight the target element
  const findTarget = useCallback(() => {
    if (!show || navigating) return;
    const current = TOUR_STEPS[step];
    if (!current) return;

    // Navigate if we're not on the right page
    if (current.route && location.pathname !== current.route) {
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
        // Scroll into view first
        r.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Re-measure after scroll settles
        findRef.current = setTimeout(() => {
          const updated = getTargetRect(current.target);
          if (updated) setRect(updated);
          else setRect(r);
        }, 400);
      } else if (attempts < 15) {
        attempts++;
        findRef.current = setTimeout(tryFind, 250);
      } else {
        // Target not found — skip to next step
        setRect(null);
      }
    };
    tryFind();
  }, [step, show, navigating, location.pathname, navigate]);

  // When navigating completes (location changes), stop navigating flag
  useEffect(() => {
    if (!navigating) return;
    const current = TOUR_STEPS[step];
    if (current?.route && location.pathname === current.route) {
      // Wait for page to render
      const timer = setTimeout(() => setNavigating(false), 500);
      return () => clearTimeout(timer);
    }
  }, [location.pathname, navigating, step]);

  useEffect(() => { findTarget(); }, [findTarget]);

  // Re-measure on scroll
  useEffect(() => {
    if (!show || !rect) return;
    const handler = () => {
      const current = TOUR_STEPS[step];
      if (current) {
        const r = getTargetRect(current.target);
        if (r) setRect(r);
      }
    };
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [show, step, rect]);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(storageKey, 'true');
    navigate('/');
  };

  const next = () => {
    if (step < TOUR_STEPS.length - 1) {
      setRect(null);
      setStep(step + 1);
    } else {
      dismiss();
    }
  };

  const back = () => {
    if (step > 0) {
      setRect(null);
      setStep(step - 1);
    }
  };

  if (!show) return null;

  const current = TOUR_STEPS[step];
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Clamp tooltip to viewport
  let tooltipStyle = { left: Math.max(12, (vw - TOOLTIP_W) / 2) };
  if (rect) {
    // Horizontal: center on element, clamp to screen
    const idealLeft = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    tooltipStyle.left = Math.max(12, Math.min(idealLeft, vw - TOOLTIP_W - 12));

    if (current.position === 'below') {
      const top = rect.top + rect.height + PAD + 10;
      // If tooltip would go off bottom, put it above instead
      if (top + 200 > vh) {
        tooltipStyle.top = Math.max(12, rect.top - PAD - 10);
        tooltipStyle.transform = 'translateY(-100%)';
      } else {
        tooltipStyle.top = top;
      }
    } else {
      const top = rect.top - PAD - 10;
      // If tooltip would go off top, put it below instead
      if (top < 200) {
        tooltipStyle.top = rect.top + rect.height + PAD + 10;
      } else {
        tooltipStyle.top = top;
        tooltipStyle.transform = 'translateY(-100%)';
      }
    }
  } else {
    // No target found — center tooltip
    tooltipStyle.top = vh / 2 - 100;
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
            boxShadow: '0 0 24px rgba(212,175,55,0.35)',
          }}
        />
      )}

      {/* Click anywhere to advance */}
      <div className="absolute inset-0" onClick={next} />

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="absolute"
          style={{ ...tooltipStyle, width: TOOLTIP_W, pointerEvents: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-[#0A0F1A] border border-[#D4AF37]/30 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
            {/* Progress */}
            <div className="flex items-center justify-between px-4 pt-3.5">
              <div className="flex items-center gap-1">
                {TOUR_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-[3px] rounded-full transition-all duration-300 ${
                      i <= step ? 'w-3 bg-[#D4AF37]' : 'w-1.5 bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <span className="text-[10px] text-[#4B5563]">{step + 1}/{TOUR_STEPS.length}</span>
            </div>

            {/* Content */}
            <div className="px-4 pt-2.5 pb-2">
              <h3 className="text-[15px] font-black text-[#E5E7EB] mb-1">{current.title}</h3>
              <p className="text-[12px] text-[#9CA3AF] leading-relaxed">{current.text}</p>
            </div>

            {/* Buttons */}
            <div className="px-4 pb-3.5 flex gap-2 mt-0.5">
              {step > 0 && (
                <button onClick={back} className="flex-1 py-2.5 rounded-xl bg-white/5 text-[#9CA3AF] font-semibold text-[12px]">
                  Back
                </button>
              )}
              <button
                onClick={next}
                className="flex-1 py-2.5 rounded-xl bg-[#D4AF37] text-black font-bold text-[12px] flex items-center justify-center gap-1"
              >
                {step < TOUR_STEPS.length - 1 ? (
                  <>Next <ChevronRight size={14} /></>
                ) : "Let's go!"}
              </button>
              {step === 0 && (
                <button onClick={dismiss} className="py-2.5 px-3 rounded-xl bg-white/5 text-[#4B5563] font-semibold text-[11px]">
                  Skip
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function resetAppTour(userId) {
  localStorage.removeItem(`${STORAGE_PREFIX}${userId || 'anon'}`);
}
