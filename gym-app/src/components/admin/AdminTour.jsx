import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles, LayoutDashboard, Users, AlertTriangle, UserCheck, Send,
  MessageSquare, Megaphone, CalendarDays, Dumbbell, Trophy, BarChart3,
  Tv, Award, ShoppingBag, TrendingUp, CalendarCheck, MessageCircle,
  Download, ShieldAlert, Settings, CheckCircle2, ChevronRight, ChevronLeft,
  X, Check,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

/**
 * AdminTour — a guided, page-by-page SPOTLIGHT walkthrough of the whole admin
 * dashboard, modeled on the member-side AppTour: it navigates to each real
 * page, dims everything, punches a spotlight over a real element on that page
 * (its header/hero, tagged with `data-admin-tour="<key>"`), and floats a
 * tooltip describing what the page does and why it matters for retention.
 *
 * Target resolution per step:
 *   1. `[data-admin-tour="<target>"]`        — the page's hero element
 *   2. `[data-admin-tour-nav="<route>"]`     — the sidebar menu item (desktop)
 *   3. centered card (no cutout)             — graceful fallback
 *
 * Triggers:
 *   - First run (no localStorage flag) auto-shows on the overview.
 *   - startAdminTour() (window event) from the Admin Profile button.
 *
 * Mounted once in AdminLayout so it survives route changes during the tour.
 */

const STEPS = [
  { key: 'welcome',       route: '/admin',                icon: Sparkles,        target: null,            features: ['f1', 'f2', 'f3'] },
  { key: 'overview',      route: '/admin',                icon: LayoutDashboard, target: 'overview',      features: ['f1', 'f2', 'f3'] },
  { key: 'members',       route: '/admin/members',        icon: Users,           target: 'members',       features: ['f1', 'f2', 'f3'] },
  { key: 'churn',         route: '/admin/churn',          icon: AlertTriangle,   target: 'churn',         features: ['f1', 'f2', 'f3'] },
  { key: 'trainers',      route: '/admin/trainers',       icon: UserCheck,       target: 'trainers',      features: ['f1', 'f2', 'f3'] },
  { key: 'outreach',      route: '/admin/outreach',       icon: Send,            target: 'outreach',      features: ['f1', 'f2', 'f3'] },
  { key: 'messages',      route: '/admin/messages',       icon: MessageSquare,   target: 'messages',      features: ['f1', 'f2', 'f3'] },
  { key: 'announcements', route: '/admin/announcements',  icon: Megaphone,       target: 'announcements', features: ['f1', 'f2', 'f3'] },
  { key: 'classes',       route: '/admin/classes',        icon: CalendarDays,    target: 'classes',       features: ['f1', 'f2', 'f3'] },
  { key: 'programs',      route: '/admin/programs',       icon: Dumbbell,        target: 'programs',      features: ['f1', 'f2', 'f3'] },
  { key: 'challenges',    route: '/admin/challenges',     icon: Trophy,          target: 'challenges',    features: ['f1', 'f2', 'f3'] },
  { key: 'leaderboard',   route: '/admin/leaderboard',    icon: BarChart3,       target: 'leaderboard',   features: ['f1', 'f2', 'f3'] },
  { key: 'tvDisplay',     route: '/admin/tv-setup',       icon: Tv,              target: 'tvDisplay',     features: ['f1', 'f2', 'f3'] },
  { key: 'rewards',       route: '/admin/rewards',        icon: Award,           target: 'rewards',       features: ['f1', 'f2', 'f3'] },
  { key: 'store',         route: '/admin/store',          icon: ShoppingBag,     target: 'store',         features: ['f1', 'f2', 'f3'] },
  { key: 'analytics',     route: '/admin/analytics',      icon: TrendingUp,      target: 'analytics',     features: ['f1', 'f2', 'f3'] },
  { key: 'attendance',    route: '/admin/attendance',     icon: CalendarCheck,   target: 'attendance',    features: ['f1', 'f2', 'f3'] },
  { key: 'nps',           route: '/admin/nps',            icon: MessageCircle,   target: 'nps',           features: ['f1', 'f2', 'f3'] },
  { key: 'reports',       route: '/admin/reports',        icon: Download,        target: 'reports',       features: ['f1', 'f2', 'f3'] },
  { key: 'moderation',    route: '/admin/moderation',     icon: ShieldAlert,     target: 'moderation',    features: ['f1', 'f2', 'f3'] },
  { key: 'settings',      route: '/admin/settings',       icon: Settings,        target: 'settings',      features: ['f1', 'f2', 'f3'] },
  { key: 'finish',        route: '/admin',                icon: CheckCircle2,    target: null,            features: ['f1'] },
];

const START_EVENT = 'admin-tour:start';
const flagKey = (gymId, pid) => `admin_tour_done_${gymId || 'x'}_${pid || 'x'}`;

const TIP_W = 360;       // tooltip width
const TIP_H = 250;       // tooltip height estimate (for placement)
const PAD = 8;           // spotlight padding around target
const GAP = 14;          // gap between target and tooltip

/** Fire from anywhere to (re)launch the tour. */
export function startAdminTour() {
  try { window.dispatchEvent(new CustomEvent(START_EVENT)); } catch { /* noop */ }
}

function measure(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function AdminTour() {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, gymConfig } = useAuth();
  const gymId = profile?.gym_id;
  const pid = profile?.id;
  // AdminOnboardingWizard (gyms.setup_completed=false) renders at z-[100];
  // the tour overlay (z-[200]) would bury it. Only explicit `false` blocks —
  // undefined means an older gym with no setup flow (treated as complete).
  const setupPending = gymConfig?.setupCompleted === false;

  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);     // null → centered card, no cutout
  const elRef = useRef(null);                  // currently spotlighted element
  const timerRef = useRef(null);

  // ── First-run auto-show (only when landing on the overview) ──
  // Waits for the setup wizard: while gyms.setup_completed === false the
  // wizard owns the screen, so the auto-start bails and this effect re-runs
  // (setupPending in deps) to fire on the /admin visit after setup completes.
  //
  // Two-layer "seen" persistence, mirroring the member AppTour:
  //   1. localStorage (fast, per-device)
  //   2. profiles.has_seen_admin_tour (DB backstop — survives a localStorage
  //      wipe from a Capgo bundle swap, reinstall, or a different device).
  // localStorage-only was the bug: the welcome guide re-nagged on every launch
  // whenever the WebView store got cleared.
  useEffect(() => {
    if (!gymId || !pid || setupPending) return;
    let doneLocal = false;
    try { doneLocal = localStorage.getItem(flagKey(gymId, pid)) === '1'; } catch { /* ignore */ }
    if (doneLocal) return;

    let cancelled = false;
    let timerId = null;
    const scheduleAutoShow = () => {
      timerId = setTimeout(() => {
        if (window.location.pathname.replace(/\/$/, '') === '/admin') {
          setStep(0);
          setActive(true);
        }
      }, 1200);
    };

    // supabase's builder is a thenable without .catch — wrap in Promise.resolve.
    // A missing column (pre-migration) returns an error object (not a throw),
    // so data is null and we fall through to localStorage-only behavior.
    Promise.resolve(
      supabase.from('profiles').select('has_seen_admin_tour').eq('id', pid).single()
    )
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.has_seen_admin_tour) {
          try { localStorage.setItem(flagKey(gymId, pid), '1'); } catch { /* ignore */ }
          return;
        }
        scheduleAutoShow();
      })
      .catch(() => { if (!cancelled) scheduleAutoShow(); });

    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [gymId, pid, setupPending]);

  // ── Manual launch (Admin Profile button) ──
  useEffect(() => {
    const onStart = () => { setStep(0); setRect(null); elRef.current = null; setActive(true); };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, []);

  // ── Resolve the current step: navigate to its page, then spotlight a real
  //    element on it (retry until it mounts, else fall back gracefully) ──
  useEffect(() => {
    if (!active) { clearTimeout(timerRef.current); return; }
    const s = STEPS[step];
    const path = location.pathname.replace(/\/$/, '') || '/';
    const route = (s.route || '/').replace(/\/$/, '') || '/';
    if (path !== route) {
      setRect(null);
      elRef.current = null;
      navigate(s.route);
      return;
    }

    const selectors = [
      s.target ? `[data-admin-tour="${s.target}"]` : null,
      s.route ? `[data-admin-tour-nav="${s.route}"]` : null,
    ].filter(Boolean);

    let attempts = 0;
    clearTimeout(timerRef.current);

    const tryFind = () => {
      let el = null;
      for (const sel of selectors) {
        const found = document.querySelector(sel);
        if (found && measure(found)) { el = found; break; }
      }
      if (el) {
        elRef.current = el;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        timerRef.current = setTimeout(() => setRect(measure(el)), 150);
      } else if (s.target === null) {
        // Intentionally targetless step (welcome / finish) → centered card.
        elRef.current = null;
        setRect(null);
      } else if (attempts < 50) {
        attempts++;
        timerRef.current = setTimeout(tryFind, 80);
      } else {
        // Gave up finding an anchor → centered card.
        elRef.current = null;
        setRect(null);
      }
    };
    tryFind();
    return () => clearTimeout(timerRef.current);
  }, [active, step, location.pathname, navigate]);

  // ── Keep the spotlight glued to the element on scroll / resize ──
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (elRef.current) setRect(measure(elRef.current));
      });
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [active]);

  const dismiss = useCallback(() => {
    setActive(false);
    setRect(null);
    elRef.current = null;
    try { localStorage.setItem(flagKey(gymId, pid), '1'); } catch { /* ignore */ }
    // Durable backstop so "seen" survives a localStorage wipe (reinstall /
    // Capgo / new device). Fire-and-forget; pre-migration this no-ops on the
    // missing column and localStorage still gates the tour.
    if (pid) {
      Promise.resolve(
        supabase.from('profiles').update({ has_seen_admin_tour: true }).eq('id', pid)
      ).catch(() => { /* ignore — localStorage already set above */ });
    }
  }, [gymId, pid]);

  const next = useCallback(() => {
    setRect(null);
    setStep((s) => {
      if (s < STEPS.length - 1) return s + 1;
      dismiss();
      return s;
    });
  }, [dismiss]);

  const back = useCallback(() => {
    setRect(null);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  if (!active) return null;

  const cur = STEPS[step];
  const Icon = cur.icon;
  const total = STEPS.length;
  const isLast = step === total - 1;
  const tk = (suffix) => t(`adminTour.${cur.key}.${suffix}`);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Tooltip placement
  let tip;
  if (rect) {
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - TIP_W / 2, vw - TIP_W - 12));
    const spaceBelow = vh - (rect.top + rect.height);
    if (spaceBelow >= TIP_H + GAP) {
      tip = { left, top: rect.top + rect.height + GAP };
    } else if (rect.top >= TIP_H + GAP) {
      tip = { left, top: Math.max(12, rect.top - TIP_H - GAP) };
    } else {
      // Not enough room either side — dock near the bottom.
      tip = { left, top: Math.max(12, vh - TIP_H - 16) };
    }
  } else {
    tip = { left: Math.max(12, (vw - TIP_W) / 2), top: Math.max(24, vh / 2 - TIP_H / 2) };
  }

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-label={t('adminTour.ariaLabel', 'Guided tour')}>
      {/* Dimmer with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="admin-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PAD}
                y={rect.top - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx={16}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(8,11,18,0.72)" mask="url(#admin-tour-mask)" />
      </svg>

      {/* Highlight ring */}
      {rect && (
        <div
          className="absolute pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 16,
            border: '2px solid var(--color-accent)',
            boxShadow: '0 0 0 9999px transparent, 0 0 28px color-mix(in srgb, var(--color-accent) 55%, transparent)',
          }}
        />
      )}

      {/* Click-anywhere-to-advance layer */}
      <div className="absolute inset-0" onClick={next} />

      {/* Tooltip */}
      <div
        className="absolute animate-fade-in-up"
        style={{ ...tip, width: TIP_W, maxWidth: 'calc(100vw - 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-default)',
            boxShadow: '0 24px 60px -16px rgba(0,0,0,0.6)',
          }}
        >
          {/* Progress bar */}
          <div className="h-1 w-full" style={{ background: 'var(--color-border-subtle)' }}>
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${((step + 1) / total) * 100}%`, background: 'var(--color-accent)' }}
            />
          </div>

          <div className="p-4 sm:p-5">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}
              >
                <Icon className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-[10px] font-bold tracking-[0.18em] uppercase mb-0.5"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {t('adminTour.stepCounter', { current: step + 1, total, defaultValue: `${step + 1} / ${total}` })}
                </p>
                <h3 className="text-[17px] font-extrabold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                  {tk('title')}
                </h3>
              </div>
              <button
                onClick={dismiss}
                aria-label={t('adminTour.skip', 'Skip')}
                className="p-1.5 rounded-lg flex-shrink-0 transition-colors hover:bg-black/5"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Description */}
            <p className="text-[13px] leading-relaxed mt-3" style={{ color: 'var(--color-text-muted)' }}>
              {tk('desc')}
            </p>

            {/* Feature bullets */}
            {cur.features?.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {cur.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
                    <span className="text-[12.5px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                      {tk(f)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Footer nav */}
            <div className="flex items-center gap-2 mt-4">
              {step > 0 ? (
                <button
                  onClick={back}
                  className="px-3.5 py-2 rounded-xl text-[12.5px] font-semibold inline-flex items-center gap-1 transition-colors"
                  style={{ background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)' }}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> {t('adminTour.back', 'Back')}
                </button>
              ) : (
                <button
                  onClick={dismiss}
                  className="px-3.5 py-2 rounded-xl text-[12.5px] font-semibold transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('adminTour.skip', 'Skip')}
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={next}
                className="px-5 py-2 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-1.5 transition-all hover:brightness-[1.05]"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-on-accent, #fff)' }}
              >
                {isLast ? t('adminTour.done', 'Finish') : t('adminTour.next', 'Next')}
                {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
