-- Track whether an admin has completed the admin dashboard welcome tour.
-- Persists across reinstalls / localStorage wipes — mirrors has_seen_tour
-- (0115) for the member AppTour. Without this, the admin tour was
-- localStorage-only and re-nagged on every launch whenever the WebView store
-- got cleared (Capgo bundle swap, reinstall, or a different device).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_seen_admin_tour BOOLEAN NOT NULL DEFAULT false;
