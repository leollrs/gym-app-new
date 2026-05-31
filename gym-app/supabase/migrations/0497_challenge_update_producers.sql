-- ============================================================
-- 0497 — Challenge update notifications (activate the dead pipeline)
-- ============================================================
-- The Settings "Challenge Updates" toggle (notif_challenge_updates) had NO
-- working producer. Investigating revealed a BIGGER latent bug:
--
--   • 0186 award_challenge_prizes      — fires AFTER UPDATE OF status → 'completed'
--   • 0264 notify_challenge_completion — fires on the SAME transition
--
-- ...but NOTHING ever transitions challenges.status to 'completed'. The client
-- derives live/ended purely from DATES (statusOf()); AdminChallenges inserts
-- status='active' and only a MANUAL admin "settle prizes" button
-- (AdminChallenges.settlePrizes) ever flips it. So in practice challenge
-- WINNERS NEVER GOT THEIR PRIZE POINTS and no completion notification fired —
-- unless an admin happened to click settle. The admin UI even carries a banner
-- ("unsettled prizes … no status→completed transition happened") acknowledging
-- this.
--
-- This migration:
--   1. UPGRADES notify_challenge_completion (0264) to bilingual + native push
--      + final-rank, via _notify_push, gated by notif_challenge_updates, and
--      skipping staff. The existing 0264 trigger (AFTER UPDATE OF status) is
--      kept — so BOTH the manual settle button AND the new auto-settle cron
--      below produce the rich notification, and 0186 still awards prizes.
--   2. Adds run_challenge_lifecycle() (cron, every 15 min) that:
--        a. AUTO-SETTLES recently-ended active challenges (status→'completed'),
--           which fires 0186 (prizes) + the upgraded 0264 (notification). A
--           3-day window prevents a first-deploy blast over ancient challenges
--           (older unsettled ones remain available to the manual banner).
--        b. BROADCASTS newly-created challenges ("a new challenge is open") to
--           every non-staff member, exactly once, tracked by a new
--           challenges.new_broadcast_at stamp (existing rows backfilled as
--           already-broadcast → no back-blast, no repeated fan-out looping).
--
-- Both new/ended notifications are typed 'challenge_update' (already a valid
-- enum value, mapped to notif_challenge_updates in send-push-user this batch).
-- Every loop is EXCEPTION-wrapped so one failure can't abort the cron or roll
-- back the settle UPDATE.
--
-- DEPENDS ON 0440 (_notify_push), 0493 (profiles.is_staff), 0186 + 0264. Apply
-- after all of them.
-- ============================================================

-- ── One-shot "new challenge" broadcast tracking ───────────────────────────
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS new_broadcast_at TIMESTAMPTZ;
-- Backfill: treat every EXISTING challenge as already-broadcast so the cron
-- only ever picks up challenges created AFTER this migration. Without this, the
-- first cron tick would blast "new challenge" for every historical row.
UPDATE challenges SET new_broadcast_at = now() WHERE new_broadcast_at IS NULL;

-- ── 1. Upgrade completion notification: bilingual + push + rank ────────────
-- Replaces the 0264 body (was English-only, in-app-only, no rank). Trigger
-- trg_notify_challenge_completion (0264) stays attached and keeps firing on
-- status → 'completed'.
CREATE OR REPLACE FUNCTION public.notify_challenge_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p RECORD;
BEGIN
  IF NOT (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed') THEN
    RETURN NEW;
  END IF;

  FOR v_p IN
    SELECT cp.profile_id,
           ROW_NUMBER() OVER (ORDER BY cp.score DESC NULLS LAST) AS rnk,
           COUNT(*)     OVER ()                                   AS total
    FROM challenge_participants cp
    JOIN profiles p ON p.id = cp.profile_id
    WHERE cp.challenge_id = NEW.id
      AND COALESCE(p.is_staff, false) = false
  LOOP
    PERFORM public._notify_push(
      v_p.profile_id, NEW.gym_id, 'member'::user_role, 'challenge_update'::notification_type,
      'Challenge ended 🏁',
      'You finished #' || v_p.rnk || ' of ' || v_p.total || ' in "' || NEW.name || '". Check the results!',
      'Reto finalizado 🏁',
      'Terminaste #' || v_p.rnk || ' de ' || v_p.total || ' en «' || NEW.name || '». ¡Mira los resultados!',
      jsonb_build_object('route', '/challenges', 'challenge_id', NEW.id, 'rank', v_p.rnk),
      'chal_done_' || NEW.id::text || '_' || v_p.profile_id::text
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_challenge_completion failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_challenge_completion() FROM PUBLIC;

-- ── 2. Lifecycle cron: auto-settle ended + broadcast new ──────────────────
CREATE OR REPLACE FUNCTION public.run_challenge_lifecycle()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ch RECORD;
  v_m  RECORD;
BEGIN
  -- a. AUTO-SETTLE: flip recently-ended active challenges to completed. This
  --    fires award_challenge_prizes (0186) + notify_challenge_completion
  --    (upgraded above). 3-day lower bound avoids a first-deploy blast over
  --    long-past challenges (those stay available to the manual settle banner).
  UPDATE challenges
  SET status = 'completed', updated_at = now()
  WHERE status = 'active'
    AND end_date < now()
    AND end_date > now() - INTERVAL '3 days';

  -- b. BROADCAST NEW: one "new challenge" notification per non-staff member,
  --    exactly once per challenge (stamped via new_broadcast_at).
  FOR v_ch IN
    SELECT id, gym_id, name
    FROM challenges
    WHERE new_broadcast_at IS NULL
      AND status = 'active'
      AND end_date > now()
  LOOP
    BEGIN
      FOR v_m IN
        SELECT id FROM profiles
        WHERE gym_id = v_ch.gym_id
          AND role = 'member'
          AND COALESCE(is_staff, false) = false
      LOOP
        PERFORM public._notify_push(
          v_m.id, v_ch.gym_id, 'member'::user_role, 'challenge_update'::notification_type,
          'New challenge 🏆',
          '"' || v_ch.name || '" is open. Join and compete!',
          'Nuevo reto 🏆',
          '«' || v_ch.name || '» está abierto. ¡Únete y compite!',
          jsonb_build_object('route', '/challenges', 'challenge_id', v_ch.id),
          'chal_new_' || v_ch.id::text || '_' || v_m.id::text
        );
      END LOOP;
      UPDATE challenges SET new_broadcast_at = now() WHERE id = v_ch.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'challenge new-broadcast failed (%): %', v_ch.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_challenge_lifecycle() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_challenge_lifecycle() TO service_role;

-- Schedule every 15 min: new challenges broadcast within ~15 min, ended
-- challenges settle promptly. Both steps are idempotent + cheap (indexed,
-- usually 0 rows). No-op if pg_cron isn't installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'challenge-lifecycle') THEN
      PERFORM cron.unschedule('challenge-lifecycle');
    END IF;
    PERFORM cron.schedule(
      'challenge-lifecycle',
      '*/15 * * * *',
      $cron$ SELECT public.run_challenge_lifecycle(); $cron$
    );
  ELSE
    RAISE NOTICE '[0497] pg_cron not installed — schedule run_challenge_lifecycle() manually (*/15 * * * *). Manual admin "settle prizes" still works without it.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
