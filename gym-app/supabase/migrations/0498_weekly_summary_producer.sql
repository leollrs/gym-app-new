-- ============================================================
-- 0498 — Weekly summary notification producer
-- ============================================================
-- The Settings "Weekly Summary" toggle (notif_weekly_summary) had NO producer
-- — it controlled nothing. This wires a real weekly recap.
--
-- A weekly pg_cron job computes each active member's last-7-day training stats
-- (workouts, volume from workout_sessions; PRs from pr_history — NOTE:
-- workout_sessions has NO prs_hit column, the PR count must come from
-- pr_history) and sends ONE bilingual "your week" notification — in-app
-- (audience 'member') + push via _notify_push (0440).
--
-- New enum value 'weekly_summary':
--   • mapped to notif_weekly_summary in send-push-user (this batch), so push
--     honors the toggle, and
--   • icon-mapped in Notifications.jsx (this batch) for the in-app row.
--   Following the 0442 precedent, the value is ADDED here and only REFERENCED
--   inside a function body (never executed during this migration) — safe on PG15.
--
-- Preference handling: unlike transactional producers (which always insert
-- in-app and gate only push), the weekly summary is a pure digest — so we
-- PRE-FILTER on notif_weekly_summary AND the master notif_push_enabled in the
-- cron query. An opted-out member gets neither in-app nor push.
--
-- Positivity guard: only members with >=1 completed workout in the window get
-- a summary. Inactive members are served by lifecycle / win-back instead — a
-- "0 workouts this week" recap would be demotivating.
--
-- DEPENDS ON 0440 (_notify_push), 0493 (profiles.is_staff). Apply after both.
-- ============================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'weekly_summary';

CREATE OR REPLACE FUNCTION public.run_weekly_summary_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec     RECORD;
  v_vol     BIGINT;
  v_body_en TEXT;
  v_body_es TEXT;
  v_pr_en   TEXT;
  v_pr_es   TEXT;
  v_week    TEXT := to_char(CURRENT_DATE, 'IYYY"-W"IW'); -- ISO week, e.g. 2026-W22
BEGIN
  FOR v_rec IN
    SELECT ws.profile_id,
           ws.gym_id,
           COUNT(*)                               AS workouts,
           COALESCE(SUM(ws.total_volume_lbs), 0)  AS volume,
           -- PR count from pr_history (authoritative; no prs_hit column exists)
           ( SELECT COUNT(*)
             FROM pr_history ph
             WHERE ph.profile_id = ws.profile_id
               AND ph.achieved_at >= now() - INTERVAL '7 days' ) AS prs
    FROM workout_sessions ws
    JOIN profiles p ON p.id = ws.profile_id
    WHERE ws.completed_at IS NOT NULL
      AND ws.completed_at >= now() - INTERVAL '7 days'
      AND ws.status = 'completed'
      AND ws.gym_id IS NOT NULL
      AND p.role = 'member'
      AND COALESCE(p.is_staff, false) = false
      AND COALESCE(p.notif_push_enabled, true) <> false
      AND COALESCE(p.notif_weekly_summary, true) <> false
    GROUP BY ws.profile_id, ws.gym_id
    HAVING COUNT(*) >= 1
  LOOP
    v_vol := round(v_rec.volume)::bigint;

    IF v_rec.prs > 0 THEN
      v_pr_en := ' · ' || v_rec.prs || CASE WHEN v_rec.prs = 1 THEN ' PR' ELSE ' PRs' END;
      v_pr_es := ' · ' || v_rec.prs || CASE WHEN v_rec.prs = 1 THEN ' récord' ELSE ' récords' END;
    ELSE
      v_pr_en := '';
      v_pr_es := '';
    END IF;

    v_body_en := v_rec.workouts || CASE WHEN v_rec.workouts = 1 THEN ' workout' ELSE ' workouts' END
              || ' · ' || v_vol || ' lbs lifted' || v_pr_en || '. Keep it up!';
    v_body_es := v_rec.workouts || CASE WHEN v_rec.workouts = 1 THEN ' entrenamiento' ELSE ' entrenamientos' END
              || ' · ' || v_vol || ' lbs levantadas' || v_pr_es || '. ¡Sigue así!';

    PERFORM public._notify_push(
      v_rec.profile_id, v_rec.gym_id, 'member'::user_role, 'weekly_summary'::notification_type,
      'Your week 💪', v_body_en,
      'Tu semana 💪', v_body_es,
      jsonb_build_object('route', '/profile'),
      'weekly_' || v_rec.profile_id::text || '_' || v_week
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'run_weekly_summary_pushes failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_weekly_summary_pushes() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_weekly_summary_pushes() TO service_role;

-- Schedule: Sundays at 23:00 UTC (~Sunday evening in the Americas, where the
-- gyms are). One summary per member per ISO week (dedup key carries the week).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-summary-pushes') THEN
      PERFORM cron.unschedule('weekly-summary-pushes');
    END IF;
    PERFORM cron.schedule(
      'weekly-summary-pushes',
      '0 23 * * 0',
      $cron$ SELECT public.run_weekly_summary_pushes(); $cron$
    );
  ELSE
    RAISE NOTICE '[0498] pg_cron not installed — schedule run_weekly_summary_pushes() manually (Sun 23:00 UTC).';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
