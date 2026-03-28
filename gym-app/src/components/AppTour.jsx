import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const TOUR_STEP_KEYS = [
  { route: '/', target: 'tour-my-plan', titleKey: 'appTour.step1Title', textKey: 'appTour.step1Text', position: 'below' },
  { route: '/', target: 'tour-quick-buttons', titleKey: 'appTour.step2Title', textKey: 'appTour.step2Text', position: 'below' },
  { route: '/', target: 'tour-hero-card', titleKey: 'appTour.step3Title', textKey: 'appTour.step3Text', position: 'above' },
  { route: '/', target: 'tour-level', titleKey: 'appTour.step4Title', textKey: 'appTour.step4Text', position: 'above' },
  { route: '/workouts', target: 'tour-workouts-page', titleKey: 'appTour.step5Title', textKey: 'appTour.step5Text', position: 'below' },
  { route: '/record', target: 'tour-quickstart-page', titleKey: 'appTour.step6Title', textKey: 'appTour.step6Text', position: 'below' },
  { route: '/progress', target: 'tour-progress-page', titleKey: 'appTour.step7Title', textKey: 'appTour.step7Text', position: 'below' },
  { route: '/community', target: 'tour-community-page', titleKey: 'appTour.step8Title', textKey: 'appTour.step8Text', position: 'below' },
  { route: '/profile', target: 'tour-profile-page', titleKey: 'appTour.step9Title', textKey: 'appTour.step9Text', position: 'below' },
  { route: '/', target: 'tour-nav-record', titleKey: 'appTour.step10Title', textKey: 'appTour.step10Text', position: 'above' },
];

const STORAGE_PREFIX = 'app_tour_completed_';
const TOOLTIP_W = 300;
const PAD = 8;

function getTargetRect(key) {
  const el = document.querySelector(`[data-tour="${key}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height, el };
}

export default function AppTour({ userId }) {
  const { t } = useTranslation('pages');
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

  const findTarget = useCallback(() => {
    if (!show || navigating) return;
    const current = TOUR_STEP_KEYS[step];
    if (!current) return;

    const normalizedPath = location.pathname.replace(/\/$/, '') || '/';
    const normalizedRoute = (current.route || '/').replace(/\/$/, '') || '/';
    if (current.route && normalizedPath !== normalizedRoute) {
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
        }, 400);
      } else if (attempts < 30) {
        // More attempts (30 × 300ms = 9s) to handle lazy-loaded pages
        attempts++;
        findRef.current = setTimeout(tryFind, 300);
      } else {
        // Target truly not found — auto-advance to next step instead of getting stuck
        if (step < TOUR_STEP_KEYS.length - 1) {
          setStep(s => s + 1);
        } else {
          dismiss();
        }
      }
    };
    tryFind();

    return () => clearTimeout(findRef.current);
  }, [step, show, navigating, location.pathname, navigate]);

  useEffect(() => {
    if (!navigating) return;
    const current = TOUR_STEP_KEYS[step];
    // Check if we've arrived (flexible match — ignore trailing slash)
    const normalizedPath = location.pathname.replace(/\/$/, '') || '/';
    const normalizedRoute = (current?.route || '/').replace(/\/$/, '') || '/';
    if (normalizedPath === normalizedRoute) {
      const timer = setTimeout(() => setNavigating(false), 600);
      return () => clearTimeout(timer);
    }
    // Safety timeout — if navigation takes too long, force un-stuck
    const safety = setTimeout(() => setNavigating(false), 3000);
    return () => clearTimeout(safety);
  }, [location.pathname, navigating, step]);

  useEffect(() => { findTarget(); }, [findTarget]);

  useEffect(() => {
    if (!show || !rect) return;
    const handler = () => {
      const current = TOUR_STEP_KEYS[step];
      if (current) {
        const r = getTargetRect(current.target);
        if (r) setRect(r);
      }
    };
    window.addEventListener('scroll', handler, true);
    return () => window.removeEventListener('scroll', handler, true);
  }, [show, step, rect]);

  const dismiss = useCallback(() => {
    setShow(false);
    localStorage.setItem(storageKey, 'true');
    navigate('/');
  }, [storageKey, navigate]);

  const next = () => {
    if (step < TOUR_STEP_KEYS.length - 1) {
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

  const current = TOUR_STEP_KEYS[step];
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Position tooltip so it NEVER overlaps the highlighted element
  let tooltipStyle = { left: Math.max(12, (vw - TOOLTIP_W) / 2) };
  const TOOLTIP_H_ESTIMATE = 160;
  const GAP = 16; // minimum gap between highlight and tooltip

  if (rect) {
    const idealLeft = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    tooltipStyle.left = Math.max(12, Math.min(idealLeft, vw - TOOLTIP_W - 12));

    const spaceBelow = vh - (rect.top + rect.height + GAP);
    const spaceAbove = rect.top - GAP;

    if (current.position === 'below' && spaceBelow >= TOOLTIP_H_ESTIMATE) {
      // Place below
      tooltipStyle.top = rect.top + rect.height + GAP;
    } else if (current.position === 'above' && spaceAbove >= TOOLTIP_H_ESTIMATE) {
      // Place above
      tooltipStyle.bottom = vh - rect.top + GAP;
    } else if (spaceBelow >= spaceAbove) {
      // More space below
      tooltipStyle.top = rect.top + rect.height + GAP;
    } else {
      // More space above
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
            boxShadow: '0 0 24px rgba(212,175,55,0.35)',
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
          transition={{ duration: 0.2 }}
          className="absolute"
          style={{ ...tooltipStyle, width: TOOLTIP_W, pointerEvents: 'auto' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-[#0A0F1A] border border-[#D4AF37]/30 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">
            {/* Progress dots */}
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
              <span className="text-[10px] text-[#4B5563]">{step + 1}/{TOUR_STEP_KEYS.length}</span>
            </div>

            {/* Content */}
            <div className="px-4 pt-2.5 pb-2">
              <h3 className="text-[15px] font-black text-[#E5E7EB] mb-1">{t(current.titleKey)}</h3>
              <p className="text-[12px] text-[#9CA3AF] leading-relaxed">{t(current.textKey)}</p>
            </div>

            {/* Buttons */}
            <div className="px-4 pb-3.5 flex gap-2 mt-0.5">
              {step > 0 && (
                <button onClick={back} className="flex-1 py-2.5 rounded-xl bg-white/5 text-[#9CA3AF] font-semibold text-[12px]">
                  {t('appTour.back')}
                </button>
              )}
              <button
                onClick={next}
                className="flex-1 py-2.5 rounded-xl bg-[#D4AF37] text-black font-bold text-[12px] flex items-center justify-center gap-1"
              >
                {step < TOUR_STEP_KEYS.length - 1 ? (
                  <>{t('appTour.next')} <ChevronRight size={14} /></>
                ) : t('appTour.letsGo')}
              </button>
              {step === 0 && (
                <button onClick={dismiss} className="py-2.5 px-3 rounded-xl bg-white/5 text-[#4B5563] font-semibold text-[11px]">
                  {t('appTour.skip')}
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
