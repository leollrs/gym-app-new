-- 0488_scheduled_announcement_broadcast_cron.sql
--
-- Fix: scheduled announcements never delivered their push at the scheduled time.
--
-- Before: AdminAnnouncements fired broadcastNotification() immediately on create
-- regardless of `published_at`. The member-facing feed (MyGym / Notifications)
-- correctly hides a future-dated announcement via `.lte('published_at', now())`,
-- but the push went out the instant the admin hit "Schedule". The frontend now
-- SUPPRESSES the immediate push when `published_at` is in the future — which left
-- a gap: nothing fired the push (or the in-app bell row) when the scheduled time
-- arrived. This cron closes that gap.
--
-- Design notes:
--  * We distinguish a *scheduled* announcement from an *immediate* one by
--    `published_at > created_at + interval '2 minutes'`. Immediate announcements
--    (published_at ≈ created_at) are delivered entirely by the client path and
--    are NEVER touched here — so there is no double-broadcast, and the frontend
--    needs no new column write.
--  * `broadcast_at` is an idempotency marker: once a due announcement is
--    broadcast, it's stamped so subsequent 5-minute ticks skip it.
--  * In-app rows are inserted with notification type 'announcement' (a valid
--    notification_type enum value). The announcement's own category (news/event/
--    maintenance) lives on the announcements row, not the notification.
--  * Native push is delivered via the existing `send-push` edge function (service
--    role), which already honors per-member notif_push_enabled +
--    notif_announcements_enabled opt-outs.

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS broadcast_at TIMESTAMPTZ;

COMMENT ON COLUMN public.announcements.broadcast_at IS
  'Set when the scheduled-announcement cron has delivered this announcement (in-app rows + push). NULL = not yet broadcast by the cron. Immediate (non-scheduled) announcements are delivered client-side and are never processed by the cron.';

-- ── The sweep function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.broadcast_due_announcements()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key TEXT;
  v_url TEXT;
  v_ann RECORD;
BEGIN
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;

  -- Find announcements that have become due but haven't been broadcast by the
  -- cron yet. Only genuinely-scheduled ones (published_at meaningfully after
  -- creation) — immediate ones are handled client-side.
  FOR v_ann IN
    SELECT id, gym_id, title, message, type
    FROM public.announcements
    WHERE published_at <= now()
      AND published_at > created_at + interval '2 minutes'
      AND broadcast_at IS NULL
    ORDER BY published_at ASC
    LIMIT 200
  LOOP
    -- Stamp first so a slow/failed push doesn't cause a re-broadcast on the
    -- next tick (at-most-once delivery; we prefer a missed push over a
    -- duplicate blast to the whole gym).
    UPDATE public.announcements SET broadcast_at = now() WHERE id = v_ann.id;

    -- In-app bell rows for every member of the gym (type 'announcement').
    INSERT INTO public.notifications (profile_id, gym_id, title, body, type)
    SELECT p.id, v_ann.gym_id, v_ann.title, v_ann.message, 'announcement'::notification_type
    FROM public.profiles p
    WHERE p.gym_id = v_ann.gym_id AND p.role = 'member';

    -- Native push to the gym's members (edge fn applies opt-outs). Best-effort:
    -- pg_net is async/fire-and-forget; a failure here doesn't roll back the
    -- in-app rows or the broadcast_at stamp.
    IF v_service_key IS NOT NULL AND v_url IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object(
          'gym_id', v_ann.gym_id,
          'title',  v_ann.title,
          'body',   v_ann.message,
          'trigger','scheduled_announcement'
        )
      );
    END IF;
  END LOOP;
END;
$$;

-- Lock it down — cron-only, never callable by app roles.
REVOKE ALL ON FUNCTION public.broadcast_due_announcements() FROM PUBLIC, anon, authenticated;

-- ── Schedule every 5 minutes ────────────────────────────────
-- Unschedule any prior copy so re-running this migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('broadcast-due-announcements');
EXCEPTION WHEN OTHERS THEN
  -- not scheduled yet — fine
  NULL;
END $$;

SELECT cron.schedule(
  'broadcast-due-announcements',
  '*/5 * * * *',
  $$ SELECT public.broadcast_due_announcements(); $$
);
