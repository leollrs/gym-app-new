-- Add soft-delete column to notifications.
-- When a member dismisses a notification, we set dismissed_at instead of deleting
-- the row. This keeps the dedup_key in place so the scheduler / unique index
-- prevents the same notification from being re-created.
--
-- NOTE: We intentionally do NOT filter dismissed_at in RLS because the
-- notification scheduler queries (wasNotificationSentSince, etc.) run
-- client-side and must see ALL notifications (including dismissed ones) to
-- correctly prevent re-sends. Application-level queries (useNotifications,
-- fetchUnreadNotifications) filter with `.is('dismissed_at', null)`.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Ensure members can update their own notifications (for marking read + soft-delete).
-- Drop common policy names first, then recreate.
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "Members can update own notifications" ON notifications';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "Users can update own notifications" ON notifications';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    EXECUTE 'DROP POLICY IF EXISTS "members_update_own_notifications" ON notifications';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END
$$;

CREATE POLICY "Members can update own notifications"
  ON notifications
  FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
