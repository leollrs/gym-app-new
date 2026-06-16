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
