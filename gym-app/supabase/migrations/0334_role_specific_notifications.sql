-- 0334_role_specific_notifications.sql
-- Adds role-specific notification types and an audience column so
-- members, trainers, and admins each see their own inbox even when
-- multi-role accounts switch views.

-- ── New trainer-specific notification types ────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'client_workout_logged';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'client_pr';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'client_no_show';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'client_review';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'client_adherence_drop';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'client_message';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_client_assigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'session_rescheduled';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'class_booking';

-- ── New admin-specific notification types ──────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'member_churn_alert';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_member_joined';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'class_waitlist_full';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'nps_response';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'moderation_flagged';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'low_attendance_alert';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'referral_redeemed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'password_reset_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trainer_added';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'daily_digest';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'system_alert';

-- ── audience column ────────────────────────────────────────────────
-- Reuses the existing user_role enum; NULL = legacy (treated as member).
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS audience user_role;

COMMENT ON COLUMN notifications.audience IS
  'Which role-view this notification is intended for. Lets multi-role accounts (trainers/admins who also use the member side) keep separate inboxes per view. NULL = legacy/member.';

CREATE INDEX IF NOT EXISTS idx_notifications_audience
  ON notifications(profile_id, audience, created_at DESC);

-- ── Backfill audience for existing rows by inferring from type ─────
UPDATE notifications SET audience = 'trainer'::user_role
WHERE audience IS NULL
  AND type::text IN (
    'client_workout_logged','client_pr','client_no_show','client_review',
    'client_adherence_drop','client_message','new_client_assigned',
    'session_rescheduled','class_booking'
  );

UPDATE notifications SET audience = 'admin'::user_role
WHERE audience IS NULL
  AND type::text IN (
    'member_churn_alert','new_member_joined','class_waitlist_full',
    'nps_response','moderation_flagged','low_attendance_alert',
    'referral_redeemed','password_reset_request','trainer_added',
    'daily_digest','system_alert','churn_followup'
  );

UPDATE notifications SET audience = 'member'::user_role
WHERE audience IS NULL;
