// Centralized production URLs. Update PROD_WEB_URL here when the web hosting
// domain changes — every consumer (password reset email, invite links, trainer
// profile sharing) picks up the new value automatically.

export const PROD_WEB_URL = 'https://app.tugympr.com';

export const PROD_RESET_URL = `${PROD_WEB_URL}/auth/reset-password`;

// App store links for the "download the app" landing. Left empty until launch —
// AppDownloadLanding shows a "coming soon" state while these are blank, and real
// store buttons the moment they're filled in. Set both here and it updates
// everywhere automatically.
export const APP_STORE_URL = '';
export const PLAY_STORE_URL = '';

// Public share link for a trainer profile. Smart link:
//  • app installed → iOS/Android universal link opens the app on the profile
//    (appUrlOpen in main.jsx routes it to /trainers/:id)
//  • no app        → the browser renders AppDownloadLanding (download CTA),
//    never the bare website profile.
//
// IMPORTANT: this rides on the `/invite/*` applink, NOT a fresh `/t/*` path.
// iOS reads the AASA from Apple's CDN, which only re-crawls every day or so — a
// brand-new path opens the app only AFTER that crawl. `/invite/*` is already in
// Apple's CDN (it's how invite/challenge/class links open the app today), so a
// `/invite/t/:id` link opens the app IMMEDIATELY. The extra `/t/` segment keeps
// it clear of the single-segment `/invite/:code` handler (no collision).
export function trainerShareUrl(id) {
  return `${PROD_WEB_URL}/invite/t/${id || ''}`;
}

// Download-oriented share link. When a member shares a poster (workout, PR,
// achievement, streak, monthly recap, cardio…) the link in the caption should
// point a NON-user at downloading the app — not at the bare web app. This lands
// on the public `/get` page (App.jsx), which shows the store buttons (or a
// "coming soon" state pre-launch) plus an "Open in app" deep link.
//
//   appShareUrl('workout')        → https://app.tugympr.com/get?c=workout
//   appShareUrl('pr', 'abc123')   → https://app.tugympr.com/get?c=pr&id=abc123
//
// `kind` is a short slug describing what was shared; `id` is the optional record
// id (PR id, achievement key, session id…). Both are carried as query params so
// the /get page can forward them into the app via the tugympr:// scheme.
export function appShareUrl(kind, id) {
  const c = encodeURIComponent(kind || 'app');
  return `${PROD_WEB_URL}/get?c=${c}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
}

// ── Email / marketing deep links ────────────────────────────────────────────
// Section key → in-app route. Keys are stable, human-readable slugs used in the
// deep-link URL (e.g. /invite/go/workout); the route is what the app navigates
// to once it resolves the link. Targets are all proven in-app destinations
// (Siri-shortcut routes + real <Route> paths).
export const APP_SECTIONS = {
  home:        '/',
  workout:     '/record',                 // start / today's workout
  progress:    '/progress',
  log:         '/workout-log',
  checkin:     '/checkin',
  streak:      '/profile',                // streak lives on the profile header
  rewards:     '/rewards',
  nutrition:   '/progress?tab=nutrition',
  social:      '/social',
  classes:     '/classes',
  challenges:  '/challenges',
  messages:    '/messages',
  records:     '/personal-records',
  leaderboard: '/leaderboard',
  profile:     '/profile',
};

// Resolve a deep-link section key to its in-app route. Unknown/blank → home.
export function resolveAppSection(key) {
  return APP_SECTIONS[key] || APP_SECTIONS.home;
}

// Smart deep link for emails/marketing that opens the native app on `section`.
// Rides the already-CDN-propagated `/invite/*` applink (a fresh path prefix
// would wait on Apple's ~daily AASA re-crawl), and the two-segment `/invite/go/*`
// shape can't collide with the single-segment `/invite/:code` invite handler.
//   • app installed → universal link opens the app, routed to the section
//   • no app        → app.tugympr.com (the web app) opens the same section
export function appDeepLink(section) {
  const key = APP_SECTIONS[section] ? section : 'home';
  return `${PROD_WEB_URL}/invite/go/${key}`;
}
