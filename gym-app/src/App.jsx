import { lazy, Suspense, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { usePostHog } from '@posthog/react';
import { useQueryClient } from '@tanstack/react-query';
import QRCodeModal from './components/QRCodeModal';
import UpdateRequiredModal from './components/UpdateRequiredModal';
import MaintenanceGate from './components/MaintenanceGate';
import { startVersionCheck } from './lib/appVersionCheck';
import './App.css';

import { useAuth } from './contexts/AuthContext';
import { useToast } from './contexts/ToastContext';
import ErrorBoundary from './components/ErrorBoundary';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import Skeleton from './components/Skeleton';
import { initPushNotifications } from './lib/pushNotifications';
import { supabase } from './lib/supabase';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';
import { getQueue } from './lib/offlineQueue';
import { setNavigateFn, safeReload } from './lib/navigationRef';

// ── Eagerly loaded (critical path for members) ──────────────
import Navigation from './components/Navigation';
import AppTour from './components/AppTour';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Signup from './pages/Signup';
// Onboarding is lazy: most launches are returning users who skip it. It
// transitively pulls ~280 KB of meal data + a 100 KB exercise library; keeping
// it out of the boot bundle is the single biggest TTI win.
const Onboarding = lazy(() => import('./pages/Onboarding'));

// ── Lazy-loaded member pages (loaded on navigation) ─────────
// Preload the 5 main tab chunks so tab switching feels instant.
// import() returns a promise that Webpack/Vite caches — calling it
// twice doesn't re-download, so lazy() still works as before.
// Preload imports — each called once, Vite caches the result.
// Grouped by priority: tab pages first, then secondary pages.
const workoutsImport    = () => import('./pages/Workouts');
const socialFeedImport  = () => import('./pages/SocialFeed');
const quickStartImport  = () => import('./pages/QuickStart');
const progressImport    = () => import('./pages/Progress');
const communityImport   = () => import('./pages/Community');
const profileImport     = () => import('./pages/Profile');
const rewardsImport     = () => import('./pages/Rewards');
const challengesImport  = () => import('./pages/Challenges');
const nutritionImport   = () => import('./pages/Nutrition');
const activeSessionImport = () => import('./pages/ActiveSession');
const messagesImport    = () => import('./pages/Messages');
const myGymImport       = () => import('./pages/MyGym');
const exerciseLibImport = () => import('./pages/ExerciseLibrary');

// Wave 1 (2s): main 5 tabs — what you see in bottom nav
// Wave 2 (4s): secondary pages — commonly visited from tabs
if (typeof window !== 'undefined') {
  setTimeout(() => {
    workoutsImport();
    quickStartImport();
    progressImport();
    communityImport();
    profileImport();
  }, 2000);
  setTimeout(() => {
    socialFeedImport();
    rewardsImport();
    challengesImport();
    // nutritionImport() intentionally NOT prefetched — the Nutrition chunk pulls
    // ~312KB of recipe + food-image data (+ recharts) that most sessions never
    // need. It still lazy-loads on actual navigation to /nutrition.
    activeSessionImport();
    messagesImport();
    myGymImport();
    exerciseLibImport();
  }, 4000);
}

const Workouts = lazy(workoutsImport);
const SocialFeed       = lazy(socialFeedImport);
const ActiveSession    = lazy(activeSessionImport);
const LiveCardio       = lazy(() => import('./pages/LiveCardio'));
const CardioSessionDetail = lazy(() => import('./pages/CardioSessionDetail'));
const Profile          = lazy(profileImport);
const MemberSettings   = lazy(() => import('./pages/MemberSettings'));
const PersonalInfo     = lazy(() => import('./pages/PersonalInfo'));
const Support          = lazy(() => import('./pages/Support'));
const ResetPassword    = lazy(() => import('./pages/ResetPassword'));
const LegalViewer      = lazy(() => import('./pages/LegalViewer'));
const WorkoutBuilder   = lazy(() => import('./pages/WorkoutBuilder'));
const SessionSummary   = lazy(() => import('./pages/SessionSummary'));
const Nutrition        = lazy(nutritionImport);
const MyGym            = lazy(myGymImport);
const CheckIn          = lazy(() => import('./pages/CheckIn'));
const ExerciseLibraryPage = lazy(() => exerciseLibImport().then(m => ({ default: m.ExerciseLibraryPage })));
const Challenges       = lazy(challengesImport);
const Messages         = lazy(messagesImport);
const Progress         = lazy(progressImport);
const Community        = lazy(communityImport);
const Notifications    = lazy(() => import('./pages/Notifications'));
const NotificationSettings = lazy(() => import('./pages/NotificationSettings'));
const Rewards          = lazy(rewardsImport);
const Referrals        = lazy(() => import('./pages/Referrals'));
const FirstWorkoutWelcome = lazy(() => import('./components/FirstWorkoutWelcome'));
const TVDisplay        = lazy(() => import('./pages/TVDisplay'));
const QuickStart       = lazy(quickStartImport);
const HealthSync       = lazy(() => import('./pages/HealthSync'));
const Classes          = lazy(() => import('./pages/Classes'));
const PublicTrainerProfile = lazy(() => import('./pages/PublicTrainerProfile'));

// ── Lazy-loaded trainer pages ───────────────────────────────
const TrainerLayout        = lazy(() => import('./layouts/TrainerLayout'));
const TrainerHome          = lazy(() => import('./pages/trainer/TrainerHome'));
const TrainerClients       = lazy(() => import('./pages/trainer/TrainerClients'));
const TrainerClientDetail  = lazy(() => import('./pages/trainer/TrainerClientDetail'));
const TrainerCalendar      = lazy(() => import('./pages/trainer/TrainerCalendar'));
const TrainerPlans         = lazy(() => import('./pages/trainer/TrainerPlans'));
const TrainerMessages      = lazy(() => import('./pages/trainer/TrainerMessages'));
const TrainerSocial        = lazy(() => import('./pages/trainer/TrainerSocial'));
const TrainerClasses       = lazy(() => import('./pages/trainer/TrainerClasses'));
const TrainerProfile       = lazy(() => import('./pages/trainer/TrainerProfile'));
const TrainerSettings      = lazy(() => import('./pages/trainer/TrainerSettings'));
const TrainerHelp          = lazy(() => import('./pages/trainer/TrainerHelp'));
const TrainerPrivacy       = lazy(() => import('./pages/trainer/TrainerPrivacy'));
const TrainerLiveSession   = lazy(() => import('./pages/trainer/TrainerLiveSession'));
const TrainerNotifications = lazy(() => import('./pages/trainer/TrainerNotifications'));
const TrainerPayments      = lazy(() => import('./pages/trainer/TrainerPayments'));

// ── Lazy-loaded admin pages ─────────────────────────────────
const AdminLayout        = lazy(() => import('./layouts/AdminLayout'));
const AdminOverview      = lazy(() => import('./pages/admin/AdminOverview'));
const AdminMembers       = lazy(() => import('./pages/admin/AdminMembers'));
const AdminTVDisplay     = lazy(() => import('./pages/admin/AdminTVDisplay'));
const AdminAttendance    = lazy(() => import('./pages/admin/AdminAttendance'));
const AdminChallenges    = lazy(() => import('./pages/admin/AdminChallenges'));
const AdminPrograms      = lazy(() => import('./pages/admin/AdminPrograms'));
const AdminLeaderboard   = lazy(() => import('./pages/admin/AdminLeaderboard'));
const AdminAnnouncements = lazy(() => import('./pages/admin/AdminAnnouncements'));
const AdminOutreach      = lazy(() => import('./pages/admin/AdminOutreach'));
const AdminSettings      = lazy(() => import('./pages/admin/AdminSettings'));
const AdminSettingsBranding     = lazy(() => import('./pages/admin/AdminSettingsBranding'));
const AdminSettingsHours        = lazy(() => import('./pages/admin/AdminSettingsHours'));
const AdminSettingsCards        = lazy(() => import('./pages/admin/AdminSettingsCards'));
const AdminSettingsRegistration = lazy(() => import('./pages/admin/AdminSettingsRegistration'));
const AdminSettingsGymInfo      = lazy(() => import('./pages/admin/AdminSettingsGymInfo'));
const AdminAnalytics     = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminModeration    = lazy(() => import('./pages/admin/AdminModeration'));
const AdminChurn         = lazy(() => import('./pages/admin/AdminChurn'));
const AdminTrainers      = lazy(() => import('./pages/admin/AdminTrainers'));
const AdminMessaging     = lazy(() => import('./pages/admin/AdminMessaging'));
const AdminStore         = lazy(() => import('./pages/admin/AdminStore'));
const AdminClasses       = lazy(() => import('./pages/admin/AdminClasses'));
const AdminSegments      = lazy(() => import('./pages/admin/AdminSegments'));
const AdminRevenue       = lazy(() => import('./pages/admin/AdminRevenue'));
const AdminAuditLog      = lazy(() => import('./pages/admin/AdminAuditLog'));
const AdminReports       = lazy(() => import('./pages/admin/AdminReports'));
const AdminReferrals     = lazy(() => import('./pages/admin/AdminReferrals'));
const AdminNPS           = lazy(() => import('./pages/admin/AdminNPS'));
const AdminDigestConfig  = lazy(() => import('./pages/admin/AdminDigestConfig'));
const AdminABTesting     = lazy(() => import('./pages/admin/AdminABTesting'));
const AdminEmailTemplates = lazy(() => import('./pages/admin/AdminEmailTemplates'));
const AdminMessageTemplates = lazy(() => import('./pages/admin/AdminMessageTemplates'));
const PrintCardsView      = lazy(() => import('./pages/admin/PrintCardsView'));
const AdminPrintCards    = lazy(() => import('./pages/admin/AdminPrintCards'));
const AdminRewards       = lazy(() => import('./pages/admin/AdminRewards'));
const AdminProfile       = lazy(() => import('./pages/admin/AdminProfile'));
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications'));

// ── Lazy-loaded platform super-admin pages ──────────────────
const PlatformLayout     = lazy(() => import('./layouts/PlatformLayout'));
const Operations         = lazy(() => import('./pages/platform/Operations'));
const GymsOverview       = lazy(() => import('./pages/platform/GymsOverview'));
const GymDetail          = lazy(() => import('./pages/platform/GymDetail'));
const GymImport          = lazy(() => import('./pages/platform/GymImport'));
const GymDiagnostic      = lazy(() => import('./pages/platform/GymDiagnostic'));
const GymOps             = lazy(() => import('./pages/platform/GymOps'));
const PlatformAnalytics  = lazy(() => import('./pages/platform/PlatformAnalytics'));
const SupportConsole     = lazy(() => import('./pages/platform/SupportConsole'));
const PlatformSettings   = lazy(() => import('./pages/platform/PlatformSettings'));
const AuditLog           = lazy(() => import('./pages/platform/AuditLog'));
const ErrorLogs          = lazy(() => import('./pages/platform/ErrorLogs'));
const GymHealth          = lazy(() => import('./pages/platform/GymHealth'));
const FeatureAdoption    = lazy(() => import('./pages/platform/FeatureAdoption'));
const CardQueue          = lazy(() => import('./pages/platform/CardQueue'));
const Attention          = lazy(() => import('./pages/platform/Attention'));
const PlatformNotifications = lazy(() => import('./pages/platform/PlatformNotifications'));

// ── APPLY SAVED THEME PREFERENCE ────────────────────────────
// Theme is now system-based — html.dark class managed by ThemeContext + index.html

// ── SCROLL TO TOP ON NAVIGATION ──────────────────────────────
// Disable browser scroll restoration — we handle it manually
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    const reset = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      // AdminLayout / TrainerLayout main content is its own scroll container.
      document.getElementById('main-content')?.scrollTo(0, 0);
      // Some admin pages render their own scroll wrappers — reset them too.
      document.querySelectorAll('[data-scroll-container]').forEach((el) => {
        try { el.scrollTo(0, 0); } catch { el.scrollTop = 0; }
      });
    };
    reset();
    // Retry after lazy components mount and after Suspense resolves.
    const t1 = setTimeout(reset, 50);
    const t2 = setTimeout(reset, 150);
    const t3 = setTimeout(reset, 350);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [pathname]);
  return null;
}

// ── LOADING SCREEN (animated runner) ─────────────────────────
const LoadingScreen = () => {
  const { t } = useTranslation('common');
  // After a few seconds still loading, surface a gentle "slow connection"
  // hint so a stalled boot on bad wifi reads as "still working" instead of
  // an unexplained indefinite spinner. AuthContext's 6s loading-gate
  // timeout means this is rarely on screen long — it just covers the
  // window before the gate drops and the app renders cached state.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(id);
  }, []);

  return (
  <div
    className="min-h-screen bg-[#05070B] flex items-center justify-center"
    data-loading-screen="1"
  >
    <div className="flex flex-col items-center gap-6">
      {/* Animated running figure */}
      <div className="relative w-20 h-20">
        <svg
          viewBox="0 0 64 64"
          fill="none"
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ground line */}
          <line x1="8" y1="56" x2="56" y2="56" stroke="#D4AF37" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="3 3">
            <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="0.6s" repeatCount="indefinite" />
          </line>

          {/* Head */}
          <circle cx="32" cy="12" r="5" fill="#D4AF37">
            <animate attributeName="cy" values="12;10.5;12" dur="0.5s" repeatCount="indefinite" />
          </circle>

          {/* Body */}
          <line x1="32" y1="17" x2="32" y2="34" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="y1" values="17;15.5;17" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="34;32.5;34" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Left arm */}
          <line x1="32" y1="22" x2="22" y2="28" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="22;40;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="22;20.5;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="28;26;28" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Right arm */}
          <line x1="32" y1="22" x2="40" y2="28" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="40;22;40" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="22;20.5;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="28;26;28" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Left leg */}
          <line x1="32" y1="34" x2="22" y2="52" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="22;40;22" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="34;32.5;34" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="52;54;52" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Right leg */}
          <line x1="32" y1="34" x2="40" y2="52" stroke="#D4AF37" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="x2" values="40;22;40" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y1" values="34;32.5;34" dur="0.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="52;54;52" dur="0.5s" repeatCount="indefinite" />
          </line>

          {/* Dust particles */}
          <circle r="1.5" fill="#D4AF37" opacity="0">
            <animate attributeName="cx" values="24;12;8" dur="0.8s" repeatCount="indefinite" />
            <animate attributeName="cy" values="54;52;48" dur="0.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.2;0" dur="0.8s" repeatCount="indefinite" />
          </circle>
          <circle r="1" fill="#D4AF37" opacity="0">
            <animate attributeName="cx" values="26;16;10" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
            <animate attributeName="cy" values="55;50;46" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.15;0" dur="0.8s" begin="0.2s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      {/* Pulsing dots instead of "Loading..." text */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/60 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>

      {slow && (
        <p className="text-[12px] text-[#9CA3AF] text-center max-w-[240px] leading-relaxed px-6">
          {t('slowConnectionHint', { defaultValue: 'Taking longer than usual — check your connection.' })}
        </p>
      )}
    </div>
  </div>
  );
};

// ── GYM DEACTIVATED SCREEN ────────────────────────────────
const GymDeactivatedScreen = () => {
  const { signOut, gymName } = useAuth();
  const { t } = useTranslation('pages');
  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#E5E7EB] mb-3">{t('blocking.gymDeactivatedTitle')}</h1>
        <p className="text-[14px] text-[#9CA3AF] mb-2">
          {gymName
            ? t('blocking.gymDeactivatedBodyNamed', { gymName })
            : t('blocking.gymDeactivatedBody')}
        </p>
        <p className="text-[13px] text-[#6B7280] mb-8">
          {t('blocking.gymDeactivatedDetail')}
        </p>
        <button
          onClick={signOut}
          className="bg-white/6 hover:bg-white/10 border border-white/8 text-[#E5E7EB] rounded-xl px-6 py-3 text-[13px] font-medium transition-colors"
        >
          {t('blocking.signOut')}
        </button>
      </div>
    </div>
  );
};

// ── MEMBER BLOCKED SCREEN (individual deactivation/ban) ───
const MemberBlockedScreen = () => {
  const { signOut, memberBlocked, gymName } = useAuth();
  const { t } = useTranslation('pages');
  // 3 variants: banned (permanent), deactivated (revoked), frozen (paused).
  // Each gets its own copy + tone so the member knows whether this is
  // permanent (banned/deactivated) or a hold they can resolve in person (frozen).
  const variant = memberBlocked === 'banned'
    ? { titleKey: 'memberBannedTitle',     bodyKey: 'memberBannedBody',     detailKey: 'memberBannedDetail',     accent: 'red',    icon: 'block' }
    : memberBlocked === 'frozen'
    ? { titleKey: 'memberFrozenTitle',     bodyKey: 'memberFrozenBody',     detailKey: 'memberFrozenDetail',     accent: 'blue',   icon: 'snow' }
    : { titleKey: 'memberDeactivatedTitle', bodyKey: 'memberDeactivatedBody', detailKey: 'memberDeactivatedDetail', accent: 'orange', icon: 'block' };

  const ringBg = { red: 'bg-red-500/10 border border-red-500/20', blue: 'bg-blue-500/10 border border-blue-500/20', orange: 'bg-orange-500/10 border border-orange-500/20' }[variant.accent];
  const iconColor = { red: 'text-red-400', blue: 'text-blue-400', orange: 'text-orange-400' }[variant.accent];

  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${ringBg}`}>
          <svg className={`w-8 h-8 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {variant.icon === 'snow' ? (
              // Snowflake — communicates "frozen / on hold" rather than blocked
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M5.636 5.636l12.728 12.728M3 12h18M18.364 5.636L5.636 18.364" />
            ) : (
              // Crossed-out circle — blocked / deactivated
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            )}
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#E5E7EB] mb-3">
          {t(`blocking.${variant.titleKey}`)}
        </h1>
        <p className="text-[14px] text-[#9CA3AF] mb-2">
          {t(`blocking.${variant.bodyKey}`, { gymName: gymName || '' })}
        </p>
        <p className="text-[13px] text-[#6B7280] mb-8">
          {t(`blocking.${variant.detailKey}`, { gymName: gymName || '' })}
        </p>
        <button
          onClick={signOut}
          className="bg-white/6 hover:bg-white/10 border border-white/8 text-[#E5E7EB] rounded-xl px-6 py-3 text-[13px] font-medium transition-colors"
        >
          {t('blocking.signOut')}
        </button>
      </div>
    </div>
  );
};

// ── AGE VERIFICATION REQUIRED (legacy users) ──────────────
// Shown to users whose `date_of_birth` was never set (signed up before
// migration 0344 added the column). New signups are gated at Signup.jsx
// so they always have DOB. GDPR-K Article 8: 16+ globally.
// Self-signup floor. Under-13 users sign up via gym invite code only;
// the gym handles parental consent in the real world (membership waiver
// signed at the counter). Once signed up, no runtime age gate fires —
// age handling is collected at signup and never re-prompted.
const AGE_VERIFY_MIN = 13;
const AgeVerificationScreen = () => {
  const { signOut, user, refreshProfile, patchProfile } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation('pages');
  // Three independent fields (month / day / year) — sidesteps iOS WKWebView's
  // flaky <input type="date"> which silently fails to open its native picker
  // when the input has `appearance-none` and behaves inconsistently across
  // locales. Three <select>s render identically on every platform.
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [year, setYear] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const dob = useMemo(() => {
    if (!month || !day || !year) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }, [month, day, year]);

  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const arr = [];
    for (let y = currentYear; y >= currentYear - 110; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  const monthOptions = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'long' });
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: fmt.format(new Date(2000, i, 1)),
    }));
  }, []);

  const daysInMonth = useMemo(() => {
    if (!month || !year) return 31;
    return new Date(Number(year), Number(month), 0).getDate();
  }, [month, year]);

  const dayOptions = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [daysInMonth]);

  const computeAge = (iso) => {
    if (!iso) return NaN;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return NaN;
    const today = new Date();
    let a = today.getFullYear() - d.getFullYear();
    const m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) a--;
    return a;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    console.log('[AgeVerify] submit', { month, day, year, dob });
    setErr('');
    if (!dob) { setErr(t('ageVerify.required', { defaultValue: 'Date of birth is required.' })); return; }
    const age = computeAge(dob);
    if (Number.isNaN(age) || age < 0) { setErr(t('ageVerify.invalid', { defaultValue: 'Please enter a valid date.' })); return; }
    if (age < AGE_VERIFY_MIN) {
      setErr(t('ageVerify.tooYoung', { defaultValue: `You must be ${AGE_VERIFY_MIN} or older to use TuGymPR.`, min: AGE_VERIFY_MIN }));
      return;
    }
    setSubmitting(true);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('profiles')
      .update({ date_of_birth: dob, age_verified_at: nowIso })
      .eq('id', user.id);
    if (error) {
      // Surface the underlying message so RLS / column-missing failures
      // are diagnosable from the device instead of a generic toast.
      console.error('[AgeVerify] update failed:', error);
      setSubmitting(false);
      setErr(error.message || t('ageVerify.saveFailed', { defaultValue: 'Could not save. Please try again.' }));
      showToast(t('ageVerify.saveFailed', { defaultValue: 'Could not save. Please try again.' }), 'error');
      return;
    }
    // Optimistic local patch — flips requiresAgeVerification immediately so
    // the route guard releases the user without waiting on the RPC roundtrip
    // (the get_auth_context RPC must include date_of_birth + age_verified_at,
    // see migration 0349).
    patchProfile?.({ date_of_birth: dob, age_verified_at: nowIso });
    await refreshProfile?.();
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[#05070B] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--color-accent,#D4AF37)]/10 border border-[var(--color-accent,#D4AF37)]/25 flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="var(--color-accent,#D4AF37)" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-[#E5E7EB] mb-3">
          {t('ageVerify.title', { defaultValue: 'Confirm your age' })}
        </h1>
        <p className="text-[14px] text-[#9CA3AF] mb-6">
          {t('ageVerify.body', { defaultValue: 'TuGymPR requires all members to be 16 or older to comply with privacy regulations. Please confirm your date of birth to continue.' })}
        </p>
        <label className="block text-left text-[12px] text-[#9CA3AF] mb-2 px-1">
          {t('ageVerify.dobLabel', { defaultValue: 'Date of birth' })}
        </label>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); setErr(''); }}
            className="block w-full min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-3 text-[14px] text-left text-[#E5E7EB] focus:outline-none focus:border-[var(--color-accent,#D4AF37)]/50"
            required
          >
            <option value="">{t('ageVerify.month', { defaultValue: 'Month' })}</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            value={day}
            onChange={(e) => { setDay(e.target.value); setErr(''); }}
            className="block w-full min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-3 text-[14px] text-left text-[#E5E7EB] focus:outline-none focus:border-[var(--color-accent,#D4AF37)]/50"
            required
          >
            <option value="">{t('ageVerify.day', { defaultValue: 'Day' })}</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => { setYear(e.target.value); setErr(''); }}
            className="block w-full min-w-0 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-3 text-[14px] text-left text-[#E5E7EB] focus:outline-none focus:border-[var(--color-accent,#D4AF37)]/50"
            required
          >
            <option value="">{t('ageVerify.year', { defaultValue: 'Year' })}</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        {err && (
          <p className="text-[12.5px] text-red-400 text-left px-1 mb-3">{err}</p>
        )}
        <div className="flex items-center justify-center gap-3 mt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl px-5 py-3 text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--color-accent, #D4AF37)', color: 'var(--color-bg-card, #000)' }}
          >
            {submitting
              ? t('ageVerify.saving', { defaultValue: 'Saving…' })
              : t('ageVerify.confirm', { defaultValue: 'Confirm' })}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="rounded-xl px-5 py-3 text-[13px] font-medium transition-colors bg-white/[0.06] border border-white/[0.08] text-[#E5E7EB]"
          >
            {t('blocking.signOut', { defaultValue: 'Sign out' })}
          </button>
        </div>
      </form>
    </div>
  );
};

// ── PROFILE UNAVAILABLE SCREEN ─────────────────────────────
// Differentiates "we're offline + cache was wiped" from "your profile genuinely
// failed to load" — the first case auto-recovers as soon as network returns,
// so we shouldn't scare the user with an error screen + Sign out button.
const ProfileUnavailableScreen = () => {
  const { signOut, refreshProfile } = useAuth();
  const { t } = useTranslation('pages');
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const [retrying, setRetrying] = useState(false);
  // GRACE WINDOW: on a fresh login the boot watchdog can drop `loading` to false
  // while the profile fetch is still in flight — leaving `user` set but
  // `profile` null for a beat. Without this, the scary "profile unavailable /
  // error" card flashes before the profile lands and the dashboard paints,
  // making a perfectly normal login look broken. So while ONLINE we show the
  // neutral LoadingScreen for a few seconds first; only if the profile STILL
  // hasn't arrived do we reveal the retry/sign-out UI (a genuine failure).
  // Offline is a definite state, so we skip the grace and show it immediately.
  const [graceElapsed, setGraceElapsed] = useState(offline);
  useEffect(() => {
    if (offline) { setGraceElapsed(true); return undefined; }
    const id = setTimeout(() => setGraceElapsed(true), 5000);
    return () => clearTimeout(id);
  }, [offline]);

  const handleRetry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refreshProfile?.();
    } finally {
      setRetrying(false);
    }
  }, [retrying, refreshProfile]);

  // Still within the grace window and online → the profile fetch is almost
  // certainly just in flight. Show the same neutral splash the rest of the
  // boot uses, NOT the error card. This component unmounts the instant the
  // profile arrives (ProtectedRoute re-renders children), so the user never
  // sees this on a normal login.
  if (!graceElapsed) return <LoadingScreen />;

  // Auto-reload when we come back online — the next boot will hydrate the
  // profile from a fresh getSession + fetchProfile. safeReload uses navigate(0)
  // on Capacitor to avoid the WebView teardown that can leave a black screen
  // when the service worker isn't yet in scope.
  useEffect(() => {
    if (!offline) return;
    const onOnline = () => safeReload();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offline]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-bg-primary, #05070B)' }}>
      <div className="max-w-md w-full text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{
            background: offline ? 'rgba(245, 158, 11, 0.10)' : 'rgba(245, 158, 11, 0.10)',
            border: '1px solid rgba(245, 158, 11, 0.20)',
          }}
        >
          {offline ? (
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#F59E0B" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636L5.636 18.364m12.728 0L5.636 5.636M12 19c-3.866 0-7-3.134-7-7s3.134-7 7-7 7 3.134 7 7-3.134 7-7 7z" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 4h.01M3.055 19h17.89c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L1.323 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
        </div>
        <h1 className="text-xl font-bold mb-3" style={{ color: 'var(--color-text-primary, #E5E7EB)' }}>
          {offline
            ? t('blocking.offlineTitle', 'You\u2019re offline')
            : t('blocking.profileUnavailableTitle')}
        </h1>
        <p className="text-[14px] mb-8" style={{ color: 'var(--color-text-muted, #9CA3AF)' }}>
          {offline
            ? t('blocking.offlineBody', 'Reconnect to the internet to load your account. The app will resume automatically.')
            : t('blocking.profileUnavailableBody')}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={offline ? () => safeReload() : handleRetry}
            disabled={retrying}
            className="rounded-xl px-5 py-3 text-[13px] font-semibold transition-colors disabled:opacity-60"
            style={{ background: 'var(--color-accent, #D4AF37)', color: 'var(--color-bg-card, #000)' }}
          >
            {retrying ? t('blocking.retrying', 'Reintentando…') : t('blocking.retry')}
          </button>
          {!offline && (
            <button
              onClick={signOut}
              className="rounded-xl px-5 py-3 text-[13px] font-medium transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--color-text-primary, #E5E7EB)',
              }}
            >
              {t('blocking.signOut')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Multi-role helpers ────────────────────────────────────
// All checks read activeView + availableRoles, never just profile.role.
// activeView is the user's *current* experience (they may have switched);
// availableRoles is everything they're entitled to.
const hasRole = (availableRoles, role) =>
  Array.isArray(availableRoles) && availableRoles.includes(role);

const isSuperAdminView = (activeView) => activeView === 'super_admin';
const isAdminView = (activeView) => activeView === 'admin' || activeView === 'super_admin';
const isTrainerView = (activeView) => activeView === 'trainer';

// Redirects a logged-out user to /login, but first remembers where they were
// trying to go (e.g. a challenge deep link scanned from the gym TV while signed
// out) so PublicRoute can send them back there after they authenticate. The
// sessionStorage write is render-phase on purpose — it must land before the
// <Navigate> below changes the URL to /login.
function RedirectToLogin() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  if (typeof window !== 'undefined' && path && path !== '/' && !path.startsWith('/login')) {
    try { sessionStorage.setItem('postLoginRedirect', path); } catch { /* noop */ }
  }
  return <Navigate to="/login" replace />;
}

// ── PROTECTED ROUTE (member) ───────────────────────────────
const ProtectedRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked, requiresAgeVerification, activeView, availableRoles } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <RedirectToLogin />;
  if (!profile) return <ProfileUnavailableScreen />;
  // Defensive: cached profile may be hydrated without role data (stripped for
  // security on cold start). Wait for the live profile fetch before deciding
  // routing — otherwise an admin briefly sees the member home on slow wifi.
  if (!Array.isArray(availableRoles) || availableRoles.length === 0) return <LoadingScreen />;
  if (gymDeactivated) return <GymDeactivatedScreen />;
  if (memberBlocked) return <MemberBlockedScreen />;
  // Runtime age gate removed — DOB is collected once at signup, never re-prompted.
  // Super admins always go to /platform — they don't have a member
  // experience even if technically `member` is in additional_roles.
  if (isSuperAdminView(activeView)) return <Navigate to="/platform/attention" replace />;
  if (!profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  // Route based on the user's chosen view, not their primary role. A
  // trainer who switched to member view stays here.
  if (isAdminView(activeView))   return <Navigate to="/admin" replace />;
  if (isTrainerView(activeView)) return <Navigate to="/trainer" replace />;
  return children;
};

// ── ONBOARDING ROUTE ───────────────────────────────────────
// Allows authenticated but not-yet-onboarded users through.
// Redirects away if already onboarded.
const OnboardingRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked, requiresAgeVerification, activeView } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <RedirectToLogin />;
  if (!profile) return <ProfileUnavailableScreen />;
  if (gymDeactivated) return <GymDeactivatedScreen />;
  if (memberBlocked) return <MemberBlockedScreen />;
  // Runtime age gate removed — DOB is collected once at signup, never re-prompted.
  if (profile.is_onboarded) {
    if (isSuperAdminView(activeView)) return <Navigate to="/platform/attention" replace />;
    if (isAdminView(activeView))      return <Navigate to="/admin" replace />;
    if (isTrainerView(activeView))    return <Navigate to="/trainer" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

// ── ADMIN ROUTE ────────────────────────────────────────────
const AdminRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked, requiresAgeVerification, availableRoles, activeView } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)            return <Navigate to="/login" replace />;
  if (!profile)         return <ProfileUnavailableScreen />;
  // Defensive: see ProtectedRoute. Roles aren't cached client-side, so wait
  // for the live fetch before letting an admin route render anything.
  if (!Array.isArray(availableRoles) || availableRoles.length === 0) return <LoadingScreen />;
  if (gymDeactivated)   return <GymDeactivatedScreen />;
  if (memberBlocked)    return <MemberBlockedScreen />;
  // Runtime age gate removed — DOB is collected once at signup, never re-prompted.
  if (isSuperAdminView(activeView)) return <Navigate to="/platform/attention" replace />;
  // Entitlement check: must hold admin (or super_admin) somewhere — and
  // the activeView must be admin/super_admin (so a trainer who's also
  // an admin but switched to trainer view doesn't accidentally see
  // /admin links).
  const entitled = hasRole(availableRoles, 'admin') || hasRole(availableRoles, 'super_admin');
  if (!entitled) return <Navigate to="/" replace />;
  if (!isAdminView(activeView)) {
    // They're entitled but viewing as something else — bounce them to
    // their current view's home so the URL bar matches reality.
    if (isTrainerView(activeView)) return <Navigate to="/trainer" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

// ── PLATFORM ROUTE (super_admin only) ─────────────────────
const PlatformRoute = ({ children }) => {
  const { user, profile, loading, requiresAgeVerification, availableRoles } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)                  return <Navigate to="/login" replace />;
  if (!profile)               return <ProfileUnavailableScreen />;
  // Defensive (matches ProtectedRoute / AdminRoute pattern): the cached
  // profile is hydrated without role for security, so `availableRoles`
  // is briefly empty after `loading` flips to false. Without this gate
  // the super_admin check returns false during that window, redirects
  // to "/", and PublicRoute then bounces back to /platform/attention —
  // dropping any deep-link path the user actually wanted (e.g. cold-
  // loading /platform/gym/:id/ops would land on operations instead).
  if (!Array.isArray(availableRoles) || availableRoles.length === 0) return <LoadingScreen />;
  // Runtime age gate removed — DOB is collected once at signup, never re-prompted.
  // Super admin is identity-level, not view-level — anyone holding
  // super_admin gets in regardless of activeView (so they can always
  // recover from a bad view-switch).
  if (!hasRole(availableRoles, 'super_admin')) return <Navigate to="/" replace />;
  return children;
};

// ── TRAINER ROUTE ──────────────────────────────────────────
const TrainerRoute = ({ children }) => {
  const { user, profile, loading, gymDeactivated, memberBlocked, requiresAgeVerification, availableRoles, activeView } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)              return <Navigate to="/login" replace />;
  if (!profile)           return <ProfileUnavailableScreen />;
  // Defensive: see ProtectedRoute.
  if (!Array.isArray(availableRoles) || availableRoles.length === 0) return <LoadingScreen />;
  if (gymDeactivated)     return <GymDeactivatedScreen />;
  if (memberBlocked)      return <MemberBlockedScreen />;
  // Runtime age gate removed — DOB is collected once at signup, never re-prompted.
  if (!hasRole(availableRoles, 'trainer')) return <Navigate to="/" replace />;
  if (!isTrainerView(activeView)) {
    // Entitled but viewing as something else — go to the chosen view.
    if (isAdminView(activeView))      return <Navigate to="/admin" replace />;
    if (isSuperAdminView(activeView)) return <Navigate to="/platform/attention" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

// ── AUTHENTICATED ROUTE (any role, no role-based redirects) ─
// Used for pages like TVDisplay that need auth but are accessible to all roles.
const AuthenticatedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user)   return <RedirectToLogin />;
  return children;
};

// ── PUBLIC ROUTE ───────────────────────────────────────────
const PublicRoute = ({ children }) => {
  const { user, profile, loading, availableRoles, activeView } = useAuth();
  if (loading) return <LoadingScreen />;
  // When user just signed in, profile may still be loading — show loading instead
  // of flashing ProfileUnavailableScreen during the brief fetch window
  if (user && !profile) return <LoadingScreen />;
  // Super-admin is identity-level — always route to /platform regardless of activeView
  if (user && profile && hasRole(availableRoles, 'super_admin')) return <Navigate to="/platform/attention" replace />;
  if (user && profile && !profile.is_onboarded) return <Navigate to="/onboarding" replace />;
  if (user && profile?.is_onboarded) {
    // Honor a deep-link destination saved before login (e.g. a TV challenge QR
    // scanned while signed out). Internal app paths only; consume once.
    let dest = null;
    try { dest = sessionStorage.getItem('postLoginRedirect'); } catch { /* noop */ }
    if (dest && dest.startsWith('/') && !dest.startsWith('//') && !dest.startsWith('/login')) {
      try { sessionStorage.removeItem('postLoginRedirect'); } catch { /* noop */ }
      return <Navigate to={dest} replace />;
    }
    if (isAdminView(activeView))   return <Navigate to="/admin" replace />;
    if (isTrainerView(activeView)) return <Navigate to="/trainer" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
};

// RecordEntry removed — /record now renders QuickStart directly

// ── Member route keep-alive ──────────────────────────────────
// Every static member page is kept mounted after FIRST visit. The wrapper
// toggles `display: block`/`none` based on the current pathname, so any
// subsequent navigation to a previously-visited page is instant — no
// remount, no re-running effects, no skeleton flash, no re-fetch.
//
// First visit to a page IS a normal cold mount (lazy chunk + data fetch).
// We deliberately DON'T background-preload all pages on app entry — that
// caused a "page keeps reloading" flash because each lazy-chunk fetch
// triggers Suspense, and even with per-page Suspense boundaries the
// constant cold-mount work made the device feel laggy.
//
// Pages with URL params (`/session/:id`, `/cardio/:id`, etc.) are NOT
// kept alive — different IDs → different data, and we don't want
// unbounded memory growth from cached instances.
//
// Pages refresh their own data via existing mechanisms (Dashboard has a
// locationKey effect that bumps refreshKey on every navigation, which is
// effectively "refresh on become active"; pages with postgres_changes
// subscriptions stay live in real time).
const KEEP_ALIVE_MAP = {
  '/':                   Dashboard,
  '/workouts':           Workouts,
  '/exercises':          ExerciseLibraryPage,
  '/record':             QuickStart,
  '/community':          Community,
  '/social':             SocialFeed,
  '/challenges':         Challenges,
  '/notifications':      Notifications,
  '/notification-settings': NotificationSettings,
  '/progress':           Progress,
  '/profile':            Profile,
  '/settings':           MemberSettings,
  '/personal-info':      PersonalInfo,
  '/support':            Support,
  '/nutrition':          Nutrition,
  '/my-gym':             MyGym,
  '/classes':            Classes,
  '/checkin':            CheckIn,
  '/rewards':            Rewards,
  '/referrals':          Referrals,
  '/health-sync':        HealthSync,
  '/messages':           Messages,
};

const MemberRoutes = () => {
  const location = useLocation();
  const path = location.pathname;
  const isKeepAlivePath = path in KEEP_ALIVE_MAP;
  const [visited, setVisited] = useState(() => {
    const initial = new Set();
    if (path in KEEP_ALIVE_MAP) initial.add(path);
    return initial;
  });

  // Add the active path to the visited set when it changes. This covers
  // the case where the path on first render isn't a keep-alive path, then
  // the user navigates to one.
  useEffect(() => {
    if (!isKeepAlivePath) return;
    setVisited((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, [path, isKeepAlivePath]);

  return (
    <>
      {/* Every visited keep-alive page stays mounted, toggled by display.
          CRITICAL: each page gets its OWN Suspense boundary so a background
          preload's lazy chunk fetch doesn't suspend the parent tree and
          flash the skeleton over whatever the user is currently looking at.
          Active page suspending → shows skeleton briefly. Inactive pages
          suspending → render null (no DOM impact, mounts in background). */}
      {Array.from(visited).map((kaPath) => {
        const Comp = KEEP_ALIVE_MAP[kaPath];
        if (!Comp) return null;
        const active = kaPath === path;
        return (
          <div
            key={kaPath}
            style={{ display: active ? 'block' : 'none' }}
            aria-hidden={!active}
          >
            <Suspense fallback={active ? <Skeleton variant="page" /> : null}>
              <Comp />
            </Suspense>
          </div>
        );
      })}

      {/* Dynamic / one-shot routes — keep using <Routes> so each instance
          remounts fresh. Only rendered when current path isn't one of the
          keep-alive paths, to avoid double-rendering. */}
      {!isKeepAlivePath && (
        <Routes>
          <Route path="/workouts/:id/edit" element={<WorkoutBuilder />} />
          <Route path="/session/:id"       element={<ActiveSession />} />
          <Route path="/session-summary"   element={<SessionSummary />} />
          <Route path="/cardio-live"       element={<LiveCardio />} />
          <Route path="/cardio/:id"        element={<CardioSessionDetail />} />
          <Route path="/legal/privacy"     element={<LegalViewer page="privacy" />} />
          <Route path="/legal/terms"       element={<LegalViewer page="terms" />} />
          <Route path="/messages/:conversationId" element={<Messages />} />
          {/* Redirects */}
          <Route path="/workout-log"       element={<Navigate to="/progress?tab=log" replace />} />
          <Route path="/strength"          element={<Navigate to="/progress?tab=strength" replace />} />
          <Route path="/personal-records"  element={<Navigate to="/progress?tab=records" replace />} />
          <Route path="/metrics"           element={<Navigate to="/progress?tab=body" replace />} />
          <Route path="/leaderboard"       element={<Navigate to="/community?tab=leaderboard" replace />} />
          <Route path="*"                  element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </>
  );
};

// ── APP ────────────────────────────────────────────────────
function App() {
  const { user, profile, gymName, gymConfig, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const posthog = usePostHog();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation('common');
  const [watchQROpen, setWatchQROpen] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const deepLinkProcessed = useRef(false);

  // ── Register navigate for non-component callers (AuthContext, error
  // handlers, deep-link processors). Lets them call safeNavigate() instead of
  // window.location.href, which on Capacitor would reload the WebView from
  // disk and blow away JS state. ───────────────────────────────
  useEffect(() => {
    setNavigateFn(navigate);
    return () => setNavigateFn(null);
  }, [navigate]);

  // ── App-version gate ────────────────────────────────────────
  // Fires the first RPC immediately on mount and then polls every 15 min.
  // The UpdateRequiredModal subscribes independently and paints a hard
  // gate over the app the moment the server reports our bundled version
  // is below `min_required_version`.
  useEffect(() => {
    startVersionCheck();
  }, []);

  // ── Online / Offline awareness ──────────────────────────────
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Flush offline queue when connectivity is restored
  useEffect(() => {
    if (isOnline) {
      import('./lib/offlineQueue').then(({ flushQueue }) => {
        flushQueue(supabase);
      });
    }
  }, [isOnline]);

  // ── Route prefetch: once auth resolves, warm up the main tab chunks ──
  // The setTimeout-based prefetches at module scope still run, but kicking
  // them off the moment the user is known means tab switches after first
  // paint never wait on a dynamic import (no Suspense fallback flash).
  useEffect(() => {
    if (!user || loading) return;
    // Fire-and-forget — Vite caches the promise so duplicates are cheap.
    workoutsImport().catch(() => {});
    nutritionImport().catch(() => {});
    profileImport().catch(() => {});
    progressImport().catch(() => {});
    socialFeedImport().catch(() => {});
    messagesImport().catch(() => {});
    myGymImport().catch(() => {});
    challengesImport().catch(() => {});
    // Secondary routes — tapped less often but still benefit from being in
    // memory before the user navigates to them.
    import('./pages/CheckIn').catch(() => {});
    import('./pages/Notifications').catch(() => {});
    import('./pages/Rewards').catch(() => {});
  }, [user, loading]);

  // ── Data prefetch: populate React Query cache for the main tabs so each
  // page paints from cache on first navigation instead of triggering a fetch
  // with a spinner. We kick these off in parallel and don't await — if a page
  // mounts before prefetch finishes, React Query will still see the in-flight
  // query and avoid a duplicate request.
  useEffect(() => {
    if (!user?.id || loading || !profile?.id) return;
    const userId = user.id;
    const gymId = profile.gym_id;

    // Notifications list — key + columns + audience filter MUST match
    // useNotifications(userId,'member') or the prefetch lands under a
    // different cache entry and the hook refetches on mount anyway.
    queryClient.prefetchQuery({
      queryKey: ['notifications', userId, 'member'],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('notifications')
          .select('id, title, body, type, read_at, created_at, profile_id, audience, data')
          .or('audience.is.null,audience.eq.member')
          .eq('profile_id', userId)
          .is('dismissed_at', null)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return data;
      },
    }).catch(() => {});

    // Dashboard RPC — consolidates 8+ queries into one
    queryClient.prefetchQuery({
      queryKey: ['dashboard', userId],
      queryFn: async () => {
        const { data, error } = await supabase.rpc('get_dashboard_data');
        if (error) throw error;
        return data;
      },
    }).catch(() => {});

    // Recent workouts
    queryClient.prefetchQuery({
      queryKey: ['dashboard-sessions', userId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('workout_sessions')
          .select('id, name, completed_at, total_volume_lbs, duration_seconds, routine_id')
          .eq('profile_id', userId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return data;
      },
    }).catch(() => {});

    // Personal records
    queryClient.prefetchQuery({
      queryKey: ['personal-records', userId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('personal_records')
          .select('exercise_id, weight_lbs, reps, estimated_1rm, achieved_at, exercises(name, muscle_group)')
          .eq('profile_id', userId)
          .order('estimated_1rm', { ascending: false })
          .limit(100);
        if (error) throw error;
        return data;
      },
    }).catch(() => {});

    // Challenges (gym-scoped)
    if (gymId) {
      queryClient.prefetchQuery({
        queryKey: ['challenges', gymId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('challenges')
            .select('id, name, description, type, start_date, end_date, reward_description, gym_id')
            .eq('gym_id', gymId)
            .order('start_date', { ascending: false })
            .limit(50);
          if (error) throw error;
          return data;
        },
      }).catch(() => {});
    }

    // Check-in history (for the CheckIn / streak page)
    queryClient.prefetchQuery({
      queryKey: ['check-ins', userId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('check_ins')
          .select('id, checked_in_at, method')
          .eq('profile_id', userId)
          .order('checked_in_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return data;
      },
    }).catch(() => {});

    // Streak cache (drives the streak number on CheckIn + Navigation)
    queryClient.prefetchQuery({
      queryKey: ['streak-cache', userId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('streak_cache')
          .select('current_streak_days, longest_streak_days, last_activity_date')
          .eq('profile_id', userId)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
    }).catch(() => {});
  }, [user?.id, profile?.id, profile?.gym_id, loading, queryClient]);

  // Track page views
  useEffect(() => {
    if (posthog) posthog.capture('$pageview', { $current_url: `${window.location.origin}${location.pathname}` });
  }, [location.pathname, posthog]);

  // Listen for Watch-triggered actions
  useEffect(() => {
    const qrHandler = () => setWatchQROpen(true);
    const navHandler = (e) => {
      if (e.detail) {
        // Store in localStorage so it survives app restarts
        localStorage.setItem('watchPendingNav', e.detail);
        // Try navigating immediately if auth is ready
        if (user && !loading) {
          localStorage.removeItem('watchPendingNav');
          navigate(e.detail);
        }
      }
    };

    window.addEventListener('watch-open-qr', qrHandler);
    window.addEventListener('watch-navigate', navHandler);

    return () => {
      window.removeEventListener('watch-open-qr', qrHandler);
      window.removeEventListener('watch-navigate', navHandler);
    };
  }, [navigate, user, loading]);

  // Process pending Watch navigation once auth is loaded
  useEffect(() => {
    if (!loading && user) {
      const pending = localStorage.getItem('watchPendingNav') || window.__watchPendingNav;
      if (pending) {
        localStorage.removeItem('watchPendingNav');
        window.__watchPendingNav = null;
        navigate(pending);
      }
    }
  }, [loading, user, navigate]);

  // Register for push notifications once user is logged in + onboarded
  useEffect(() => {
    if (!loading && user?.id && profile?.gym_id && profile?.is_onboarded) {
      initPushNotifications({
        userId: user.id,
        gymId: profile.gym_id,
        onNotificationTap: (data) => {
          navigate(data?.route || '/notifications');
        },
      });
    }
  }, [loading, user?.id, profile?.gym_id, profile?.is_onboarded, navigate]);

  // ── In-app toast for newly inserted notifications ──
  // Native push covers OS-level pop-ups, but on web/PWA and while the app is
  // foregrounded there's no system banner. Subscribe to our own
  // `notifications` table so a toast pops the moment something lands —
  // announcements, friend activity, win-back messages, anything inserted by
  // broadcastNotification / sendNotification / DB triggers.
  // The Notifications page maintains its own list subscription; this one is
  // app-wide and only handles the live toast.
  useEffect(() => {
    if (!user?.id) return;
    const seen = new Set();
    // Don't toast notifications that were already in the DB before this
    // session started — only true "new" inserts. The realtime channel only
    // delivers events from the moment we subscribe, so any row whose
    // created_at is older than now() at subscribe-time is considered stale.
    const subscribedAt = Date.now();

    const channel = supabase
      .channel(`app-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload?.new;
          if (!row || !row.id || seen.has(row.id)) return;
          seen.add(row.id);

          // Suppress if the user was the one who triggered it (they're already
          // looking at the source UI). Also suppress if the row was created
          // before we subscribed — guards against any replayed events.
          const createdMs = row.created_at ? new Date(row.created_at).getTime() : Date.now();
          if (createdMs < subscribedAt - 5000) return;

          // Don't toast while the user is already on the notifications page —
          // the list updates inline.
          if (window.location?.pathname?.startsWith('/notifications')) return;

          const toastTitle = row.title || t('notifications.newTitle', { defaultValue: 'New notification' });
          const toastBody = row.body ? `${toastTitle} — ${row.body}` : toastTitle;
          showToast(toastBody, 'info', {
            durationMs: 6000,
            action: {
              label: t('notifications.viewAction', { defaultValue: 'View' }),
              onClick: () => {
                const route = row.data?.route || '/notifications';
                navigate(route);
              },
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, navigate, showToast, t]);

  // ── Handle native deep links from Capacitor appUrlOpen ──
  useEffect(() => {
    const handler = (e) => {
      const path = e.detail?.path;
      if (path) navigate(path, { replace: true });
    };
    window.addEventListener('deeplink', handler);
    return () => window.removeEventListener('deeplink', handler);
  }, [navigate]);

  // ── Deep link handling: /referral/:code, ?ref=:code, /add-friend/:code ──
  useEffect(() => {
    if (loading || deepLinkProcessed.current) return;

    const path = location.pathname;
    const searchParams = new URLSearchParams(location.search);

    // ── Handle /siri/* deep links (triggered by Siri Shortcuts / App Intents) ──
    const siriMatch = path.match(/^\/siri\/(.+)$/);
    if (siriMatch) {
      const siriAction = siriMatch[1];
      deepLinkProcessed.current = true;

      if (!user) {
        // Not authenticated — send to login, the action is lost (acceptable for Siri)
        navigate('/login', { replace: true });
        return;
      }

      const siriRoutes = {
        'start-workout': '/record',
        'check-in':      '/checkin',
        'gym-card':      '/profile?showQR=1',
        'streak':        '/profile',
        'log-food':      '/progress?tab=nutrition',
      };

      const target = siriRoutes[siriAction] || '/';
      navigate(target, { replace: true });
      return;
    }

    // ── Handle /invite/:code ──
    const inviteMatch = path.match(/^\/invite\/([^/]+)$/);
    if (inviteMatch) {
      const inviteCode = inviteMatch[1];
      deepLinkProcessed.current = true;
      if (user) {
        // Already logged in — invite codes are for new accounts
        showToast('Invite codes are for new accounts', 'info');
        navigate('/', { replace: true });
      } else {
        // Store code and redirect to signup with pre-filled invite code
        localStorage.setItem('pendingInviteCode', inviteCode.toUpperCase());
        navigate('/signup', { replace: true });
      }
      return;
    }

    // ── Handle /referral/:code ──
    const referralMatch = path.match(/^\/referral\/([^/]+)$/);
    const refParam = searchParams.get('ref');
    const referralCode = referralMatch?.[1] || refParam;

    if (referralCode) {
      deepLinkProcessed.current = true;
      if (user) {
        // User is already logged in — referral codes are for new signups
        showToast('Referral codes are for new signups', 'info');
        navigate('/', { replace: true });
      } else {
        // Store code and redirect to signup
        localStorage.setItem('pendingReferralCode', referralCode);
        navigate('/signup', { replace: true });
      }
      return;
    }

    // ── Handle /add-friend/:code ──
    const friendMatch = path.match(/^\/add-friend\/([^/]+)$/);
    if (friendMatch) {
      const friendCode = friendMatch[1];
      deepLinkProcessed.current = true;

      if (!user || !profile) {
        // Not logged in — store for later and redirect to login
        localStorage.setItem('pendingFriendCode', friendCode);
        navigate('/login', { replace: true });
        return;
      }

      // Look up the profile by friend_code and send a friend request
      (async () => {
        try {
          const { data: friendProfile, error: lookupErr } = await supabase
            .from('profiles')
            .select('id, full_name')
            .eq('friend_code', friendCode)
            .eq('gym_id', profile.gym_id)
            .single();

          if (lookupErr || !friendProfile) {
            showToast('Friend code not found', 'error');
            navigate('/', { replace: true });
            return;
          }

          // Don't send to self
          if (friendProfile.id === user.id) {
            navigate('/', { replace: true });
            return;
          }

          // Check if friendship already exists
          const { count } = await supabase
            .from('friendships')
            .select('id', { count: 'exact', head: true })
            .or(
              `and(requester_id.eq.${user.id},addressee_id.eq.${friendProfile.id}),and(requester_id.eq.${friendProfile.id},addressee_id.eq.${user.id})`
            );

          if (count > 0) {
            showToast('You are already friends or have a pending request', 'info');
            navigate('/', { replace: true });
            return;
          }

          // Insert friend request
          const { error: insertErr } = await supabase
            .from('friendships')
            .insert({
              requester_id: user.id,
              addressee_id: friendProfile.id,
              gym_id: profile.gym_id,
              status: 'pending',
            });

          if (insertErr) {
            showToast('Could not send friend request', 'error');
          } else {
            showToast(`Friend request sent to ${friendProfile.full_name}!`, 'success');
          }
        } catch {
          showToast('Could not send friend request', 'error');
        }
        navigate('/', { replace: true });
      })();
      return;
    }
  }, [loading, user, profile, location.pathname, location.search, navigate, showToast]);

  // Process pending friend code after login (stored from deep link while unauthenticated)
  useEffect(() => {
    if (loading || !user || !profile) return;
    const pendingFriendCode = localStorage.getItem('pendingFriendCode');
    if (!pendingFriendCode) return;

    localStorage.removeItem('pendingFriendCode');

    (async () => {
      try {
        const { data: friendProfile, error: lookupErr } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('friend_code', pendingFriendCode)
          .eq('gym_id', profile.gym_id)
          .single();

        if (lookupErr || !friendProfile || friendProfile.id === user.id) return;

        const { count } = await supabase
          .from('friendships')
          .select('id', { count: 'exact', head: true })
          .or(
            `and(requester_id.eq.${user.id},addressee_id.eq.${friendProfile.id}),and(requester_id.eq.${friendProfile.id},addressee_id.eq.${user.id})`
          );

        if (count > 0) {
          showToast('You are already friends or have a pending request', 'info');
          return;
        }

        const { error: insertErr } = await supabase
          .from('friendships')
          .insert({
            requester_id: user.id,
            addressee_id: friendProfile.id,
            gym_id: profile.gym_id,
            status: 'pending',
          });

        if (insertErr) {
          showToast('Could not send friend request', 'error');
        } else {
          showToast(`Friend request sent to ${friendProfile.full_name}!`, 'success');
        }
      } catch {
        showToast('Could not send friend request', 'error');
      }
    })();
  }, [loading, user, profile, showToast]);

  return (
    <Suspense fallback={<LoadingScreen />}>
    {/* App-version hard gate — overlays the entire app (including auth
        screens) the moment the API reports we're below min_required_version.
        Renders nothing while the client is up to date. */}
    <UpdateRequiredModal />
    {/* Maintenance lock — full-screen overlay for all non-super-admins while
        maintenance mode is on (toggled in platform Operations). */}
    <MaintenanceGate />
    {!isOnline && !offlineDismissed && (
      <div className="fixed top-0 left-0 right-0 z-[999] flex items-center justify-center gap-2 py-2 px-4 animate-slide-down"
        style={{ background: 'var(--color-warning, #F59E0B)', color: '#000' }}>
        <WifiOff size={14} />
        <span className="text-[12px] font-semibold">{t('offline')}</span>
        {(() => { const q = getQueue(); return q.length > 0 ? <span className="text-[11px] opacity-80">({q.length})</span> : null; })()}
        <button onClick={() => setOfflineDismissed(true)} className="ml-auto text-black/60 hover:text-black" aria-label="Dismiss">
          <span className="text-[16px] leading-none font-bold">&times;</span>
        </button>
      </div>
    )}
    {watchQROpen && profile?.qr_code_payload && (
      <QRCodeModal
        payload={profile.qr_code_payload}
        memberName={profile?.full_name}
        displayFormat={gymConfig?.qrDisplayFormat}
        gymName={gymName}
        onClose={() => setWatchQROpen(false)}
      />
    )}
    <ScrollToTop />
    {/* Outer ErrorBoundary catches throws from <Navigation>, route guards, and
        any teardown cascade (e.g. SIGNED_OUT triggering posthog.reset, realtime
        unsubscribe, theme reset). Per-route boundaries below are still useful
        for recovering inside a single page, but without this wrapper a throw
        in the auth-state cascade paints a black screen on Capacitor. */}
    <ErrorBoundary>
    <Routes>

      {/* Public — unauthenticated only */}
      <Route path="/login"  element={<PublicRoute><ErrorBoundary><Login /></ErrorBoundary></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><ErrorBoundary><Signup /></ErrorBoundary></PublicRoute>} />
      {/* Password reset landing — must be open to recovery sessions, not gated by PublicRoute. */}
      <Route path="/auth/reset-password" element={<ErrorBoundary><ResetPassword /></ErrorBoundary>} />

      {/* Deep link catch routes — the useEffect above handles redirect logic */}
      <Route path="/siri/*"            element={<LoadingScreen />} />
      <Route path="/invite/:code"     element={<LoadingScreen />} />
      <Route path="/referral/:code"   element={<LoadingScreen />} />
      <Route path="/add-friend/:code" element={<LoadingScreen />} />

      {/* Onboarding */}
      <Route path="/onboarding" element={<OnboardingRoute><ErrorBoundary><Onboarding /></ErrorBoundary></OnboardingRoute>} />

      {/* First-win welcome screen (post-onboarding, pre-dashboard) */}
      <Route path="/welcome" element={<ProtectedRoute><FirstWorkoutWelcome /></ProtectedRoute>} />

      {/* TV display — PUBLIC, code-gated. Gyms can't log a smart TV / Fire Stick /
          Apple TV into Supabase, so /tv-display now uses a per-gym 6-char code
          the owner enters once on the TV browser (see migration 0423 +
          tv_authenticate / tv_get_dashboard_data RPCs). All data access is
          validated via that code on every RPC call — no auth context needed. */}
      <Route path="/tv-display" element={<ErrorBoundary><TVDisplay /></ErrorBoundary>} />
      {/* Short alias for fast typing on a TV remote. */}
      <Route path="/tv" element={<ErrorBoundary><TVDisplay /></ErrorBoundary>} />

      {/* Public-facing trainer profile — viewable by members, trainers, and admins
          within the same gym (gym-id guard enforced inside the page). Standalone
          so all roles can land here without the member/admin/trainer route
          redirects bouncing them to their own dashboards. */}
      <Route
        path="/trainers/:trainerId"
        element={
          <AuthenticatedRoute>
            <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
                <PublicTrainerProfile />
              </Suspense>
            </ErrorBoundary>
          </AuthenticatedRoute>
        }
      />

      {/* Platform super-admin dashboard */}
      <Route
        path="/platform/*"
        element={
          <PlatformRoute>
            <PlatformLayout>
              <RouteErrorBoundary home="/platform/attention">
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                <Route path="/attention"           element={<Attention />} />
                <Route path="/notifications"       element={<PlatformNotifications />} />
                <Route path="/operations"          element={<Operations />} />
                <Route path="/"                    element={<GymsOverview />} />
                <Route path="/gym/:gymId"          element={<GymDetail />} />
                <Route path="/gym/:gymId/import"     element={<GymImport />} />
                <Route path="/gym/:gymId/diagnostic" element={<GymDiagnostic />} />
                <Route path="/gym/:gymId/ops"        element={<GymOps />} />
                <Route path="/analytics"    element={<PlatformAnalytics />} />
                <Route path="/gym-health"   element={<GymHealth />} />
                <Route path="/adoption"     element={<FeatureAdoption />} />
                <Route path="/cards"        element={<CardQueue />} />
                <Route path="/support"      element={<SupportConsole />} />
                <Route path="/settings"     element={<PlatformSettings />} />
                <Route path="/audit-log"    element={<AuditLog />} />
                <Route path="/error-logs"   element={<ErrorLogs />} />
                <Route path="*"             element={<Navigate to="/platform/attention" replace />} />
              </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </PlatformLayout>
          </PlatformRoute>
        }
      />

      {/* Print preview — auth-guarded but rendered OUTSIDE AdminLayout
          so the sidebar / mobile bottom-nav / mobile top-bar don't squeeze
          the 8.5x11 print sheets and don't leak into the printed output.
          Sits ABOVE /admin/* so the more-specific path wins in routing. */}
      <Route
        path="/admin/print-cards/preview"
        element={
          <AdminRoute>
            <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
                <PrintCardsView />
              </Suspense>
            </ErrorBoundary>
          </AdminRoute>
        }
      />

      {/* Platform print preview — same PrintCardsView, but gated by
          PlatformRoute (super_admin) instead of AdminRoute, so the platform
          card queue can preview/print any gym's cards (?gymId=<id>). Kept
          OUTSIDE PlatformLayout for the same print-sizing reason as above. */}
      <Route
        path="/platform/print-cards/preview"
        element={
          <PlatformRoute>
            <ErrorBoundary>
              <Suspense fallback={<Skeleton variant="page" />}>
                <PrintCardsView />
              </Suspense>
            </ErrorBoundary>
          </PlatformRoute>
        }
      />

      {/* Admin dashboard */}
      <Route
        path="/admin/*"
        element={
          <AdminRoute>
            <AdminLayout>
              <RouteErrorBoundary home="/admin">
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                <Route path="/"             element={<AdminOverview />} />
                <Route path="/members"      element={<AdminMembers />} />
                <Route path="/tv-setup"     element={<AdminTVDisplay />} />
                <Route path="/churn"        element={<AdminChurn />} />
                <Route path="/attendance"   element={<AdminAttendance />} />
                <Route path="/challenges"   element={<AdminChallenges />} />
                <Route path="/trainers"     element={<AdminTrainers />} />
                <Route path="/programs"     element={<AdminPrograms />} />
                <Route path="/leaderboard"  element={<AdminLeaderboard />} />
                <Route path="/announcements" element={<AdminAnnouncements />} />
                <Route path="/messages"      element={<AdminMessaging />} />
                <Route path="/outreach"      element={<AdminOutreach />} />
                <Route path="/store"        element={<AdminStore />} />
                <Route path="/revenue"     element={<AdminRevenue />} />
                <Route path="/analytics"    element={<AdminAnalytics />} />
                <Route path="/moderation"   element={<AdminModeration />} />
                <Route path="/classes"      element={<AdminClasses />} />
                <Route path="/segments"    element={<AdminSegments />} />
                <Route path="/audit-log"   element={<AdminAuditLog />} />
                <Route path="/reports"     element={<AdminReports />} />
                <Route path="/referrals"   element={<AdminReferrals />} />
                <Route path="/nps"         element={<AdminNPS />} />
                <Route path="/digest"      element={<AdminDigestConfig />} />
                <Route path="/ab-testing"  element={<AdminABTesting />} />
                <Route path="/email-templates" element={<AdminEmailTemplates />} />
                <Route path="/message-templates" element={<AdminMessageTemplates />} />
                <Route path="/print-cards"         element={<AdminPrintCards />} />
                <Route path="/rewards"     element={<AdminRewards />} />
                <Route path="/profile"     element={<AdminProfile />} />
                <Route path="/notifications" element={<AdminNotifications />} />
                <Route path="/settings"     element={<AdminSettings />} />
                <Route path="/settings/branding"     element={<AdminSettingsBranding />} />
                <Route path="/settings/hours"        element={<AdminSettingsHours />} />
                <Route path="/settings/cards"        element={<AdminSettingsCards />} />
                <Route path="/settings/registration" element={<AdminSettingsRegistration />} />
                <Route path="/settings/gym-info"     element={<AdminSettingsGymInfo />} />
                <Route path="/settings/digest"       element={<AdminDigestConfig />} />
                <Route path="*"            element={<Navigate to="/admin" replace />} />
              </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </AdminLayout>
          </AdminRoute>
        }
      />

      {/* Trainer dashboard */}
      <Route
        path="/trainer/*"
        element={
          <TrainerRoute>
            <TrainerLayout>
              <RouteErrorBoundary home="/trainer">
              <Suspense fallback={<Skeleton variant="page" />}>
              <Routes>
                <Route path="/"                         element={<TrainerHome />} />
                <Route path="/clients"                  element={<TrainerClients />} />
                <Route path="/clients/:clientId"        element={<TrainerClientDetail />} />
                <Route path="/payments"                 element={<TrainerPayments />} />
                <Route path="/calendar"                 element={<TrainerCalendar />} />
                <Route path="/plans"                    element={<TrainerPlans />} />
                <Route path="/messages"                 element={<TrainerMessages />} />
                <Route path="/messages/:conversationId" element={<TrainerMessages />} />
                <Route path="/notifications"            element={<TrainerNotifications />} />
                <Route path="/social"                   element={<TrainerSocial />} />
                <Route path="/classes"                  element={<TrainerClasses />} />
                <Route path="/profile"                  element={<TrainerProfile />} />
                <Route path="/settings"                 element={<TrainerSettings />} />
                <Route path="/help"                     element={<TrainerHelp />} />
                <Route path="/privacy"                  element={<TrainerPrivacy />} />
                <Route path="/live/:sessionId"          element={<TrainerLiveSession />} />
                <Route path="/notification-settings"    element={<NotificationSettings />} />
                {/* Backward-compatible redirects */}
                <Route path="/client/:clientId" element={<Navigate to="/trainer/clients/:clientId" replace />} />
                <Route path="/schedule"         element={<Navigate to="/trainer/calendar" replace />} />
                <Route path="/analytics"        element={<Navigate to="/trainer" replace />} />
                <Route path="/programs"         element={<Navigate to="/trainer/plans" replace />} />
                <Route path="*"                 element={<Navigate to="/trainer" replace />} />
              </Routes>
              </Suspense>
              </RouteErrorBoundary>
            </TrainerLayout>
          </TrainerRoute>
        }
      />

      {/* Protected — member app with nav */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <div className="app-wrapper">
              <a href="#main-content" className="skip-to-content">{t('adminNav.skipToMain')}</a>
              <Navigation />
              <AppTour userId={user?.id} />
              <div id="main-content" role="main">
              {/* resetKey=pathname lets the boundary auto-clear when the user
                  navigates away from the crashed page, so they don't have to
                  manually tap "Try Again" to recover. */}
              <RouteErrorBoundary home="/">
              <Suspense fallback={<Skeleton variant="page" />}>
                <MemberRoutes />
              </Suspense>
              </RouteErrorBoundary>
              </div>
            </div>
          </ProtectedRoute>
        }
      />

    </Routes>
    </ErrorBoundary>
    </Suspense>
  );
}

export default App;
