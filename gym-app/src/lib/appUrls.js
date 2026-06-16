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

// Public share link for a trainer profile. Points at the short `/t/:id` path
// (NOT the in-app `/trainers/:id` route) so it behaves as a smart link:
//  • app installed → the iOS/Android universal link opens the app on the profile
//    (see `/t/*` in public/.well-known/* + the appUrlOpen handler in main.jsx)
//  • no app        → the browser loads /t/:id, which renders AppDownloadLanding
//    (a download CTA) — never the bare website profile.
export function trainerShareUrl(id) {
  return `${PROD_WEB_URL}/t/${id || ''}`;
}
