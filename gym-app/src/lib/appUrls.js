// Centralized production URLs. Update PROD_WEB_URL here when the web hosting
// domain changes — every consumer (password reset email, invite links, trainer
// profile sharing) picks up the new value automatically.

export const PROD_WEB_URL = 'https://app.tugympr.com';

export const PROD_RESET_URL = `${PROD_WEB_URL}/auth/reset-password`;

// App store links for the "download the app" landing. AppDownloadLanding shows
// the real store badges when these are set and a "coming soon" pill when they
// are blank, so emptying them is a safe kill switch.
//
// NOTE: this is only HALF the wiring. The invite/access emails read their store
// links from `app_config` (the same row `get_app_version` serves the update
// banner), because an edge function can't import from src/. Both have to be
// filled in — super-admin → Settings → App Version covers the DB side.
//
// Live as of 2026-08-03. The Play link deliberately drops the
// `&pcampaignid=web_share` that Google's share sheet appends — that parameter
// attributes the install to "someone tapped share inside the Play app", which is
// not where any of these links come from. Baking it in would misreport every
// install we drive from an invite, an email or a shared poster.
export const APP_STORE_URL = 'https://apps.apple.com/us/app/tugympr/id6761966829';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.tugympr.app';

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

// What a printed equipment sticker's QR encodes.
//
// This used to be `tugympr://equipment/<slug>`, and that was the wrong shape for
// how these are actually used. Nobody opens the app to scan a machine — they
// point the PHONE CAMERA at it, the way everyone scans everything. A custom
// scheme in a camera-scanned QR is a dead end: with the app missing there is no
// page to fall back to, so the sticker does *nothing at all*. Not a broken link
// — no result. An https URL costs nothing when the app IS installed (the OS
// hands it straight over) and degrades into a real web page when it isn't.
//
// Rides `/invite/*` for the same reason trainerShareUrl does: that prefix is
// already in Apple's AASA CDN and in the Android intent-filter, so it opens
// installed apps today. A fresh `/e/*` prefix would need a new AASA, a new
// manifest, a store release AND Apple's re-crawl — and Android only re-verifies
// on install/update, so existing installs would ignore it until they updated.
// The `/e/` segment keeps it clear of the single-segment `/invite/:code`
// handler, exactly like `/invite/t/` and `/invite/go/`.
export function equipmentQrUrl(slug) {
  return `${PROD_WEB_URL}/invite/e/${slug || ''}`;
}

// Member invite link. Rides the `/invite/:code` universal link + web fallback,
// both served from app.tugympr.com — the ONLY host in the app's iOS
// associated-domains and Android assetlinks. Earlier builds hardcoded a dead
// `tugympr.app` host, which is not app-link-associated, so those links never
// opened the app AND never reached the working web /invite handler. Always
// build invite links from PROD_WEB_URL so they deep-link (or web-fallback)
// correctly.
export function inviteUrl(code) {
  return `${PROD_WEB_URL}/invite/${code || ''}`;
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

// Link for an EXPRESSIVE share — a monthly recap, a run, a PR, a streak.
//
// These are different from a class or a referral: nobody taps "join my monthly
// recap". The link isn't a door, it's a signature — its job is to say WHERE
// this happened. So it points at the gym, not at an install funnel.
//
// The URL stays on app.tugympr.com because whoever owns the domain answers the
// crawler's "what card do I show?" — point it straight at the gym's site and
// the card becomes their homepage's, not "Leonel logged 12 workouts at Casa
// Hierro". middleware.js serves the branded card to bots and forwards humans on
// to the gym's own website, which is the marketing the gym is paying for.
//
// Falls back to the download page when the gym has no slug (impersonation,
// cold cache), so a share is never left without a link.
export function gymShareUrl(slug, kind) {
  const s = String(slug || '').trim();
  if (!s) return appShareUrl(kind);
  const from = kind ? `?from=${encodeURIComponent(kind)}` : '';
  return `${PROD_WEB_URL}/g/${encodeURIComponent(s)}${from}`;
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

// ── Siri Shortcuts (iOS AppIntents) ─────────────────────────────────────────
// Each Siri intent opens tugympr://siri/<action>. Single source of truth for
// the action→route map, shared by the native URL handler (main.jsx appUrlOpen)
// and the web reactive handler (App.jsx /siri/* path). Keep in sync with the
// intents declared in ios/App/App/AppIntents.swift.
export const SIRI_ROUTES = {
  'start-workout': '/record',                 // PhoneStartWorkoutIntent
  'check-in':      '/checkin',                 // PhoneCheckInIntent
  'gym-card':      '/checkin',                 // PhoneShowGymCardIntent (QR card lives on /checkin)
  'streak':        '/profile',                 // PhoneCheckStreakIntent (streak on profile header)
  'log-food':      '/progress?tab=nutrition',  // PhoneLogNutritionIntent
};

// Resolve a Siri action slug to its in-app route. Unknown/blank → null so the
// caller can decide (native no-ops; web falls back to home).
export function resolveSiriRoute(action) {
  return SIRI_ROUTES[action] || null;
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
