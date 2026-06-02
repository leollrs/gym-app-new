-- =============================================================
-- DAILY AT-RISK DIGEST → admin notifications inbox
-- Migration: 0502_daily_at_risk_digest.sql
--
-- Why: the admin notifications inbox only logs *event* crossings — e.g.
-- a member newly dropping to critical (trg_admin_churn_tier_crossing,
-- 0412). A gym whose at-risk population is already stable therefore sees
-- an EMPTY inbox even with dozens of members at risk. This adds a once-
-- daily standing-headcount digest so the inbox always reflects churn.
--
-- Distinct from 0406 (owner morning queue push, 11:00 UTC / 7am AST):
--   0406  → owner_queue_items pending count → "5 conversations waiting" → /admin
--   THIS  → standing at-risk headcount      → "32 members at risk"      → /admin/churn
--
-- At-risk definition MIRRORS src/lib/churn/loadScores.js so the digest
-- count agrees with what the Churn page shows:
--   active member AND ( NOT recently-active(30d) OR latest stored score >= 55 )
-- "recently active" = a check-in, workout session, or last_active_at within
-- 30 days. "NOT recently-active" captures both never-active and 30d+-inactive
-- members, which loadScores.js force-promotes to critical (95). Members who
-- are active but carry a high raw score are caught by the score >= 55 arm.
-- Stored score = latest churn_risk_scores row from the last 7 days
-- (compute-churn-scores writes nightly at 02:00 UTC).
--
-- Fan-out via _fan_out_admin_notification (0496): one in-app row per
-- admin/super_admin (multi-role aware), idempotent per gym per day via
-- dedup_key. In-app only by design — 0406 already covers the daily push.
-- NOTE: Spanish-only copy, matching the sibling member_churn_alert producer
-- in 0412. Making all member_churn_alert producers bilingual is a follow-up.
-- =============================================================

CREATE OR REPLACE FUNCTION public.send_daily_at_risk_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_today TEXT := CURRENT_DATE::text;
BEGIN
  FOR r IN
    WITH latest_scores AS (
      SELECT DISTINCT ON (profile_id)
             profile_id, score
      FROM   churn_risk_scores
      WHERE  computed_at >= now() - INTERVAL '7 days'
      ORDER  BY profile_id, computed_at DESC
    ),
    member_flags AS (
      SELECT
        p.gym_id,
        (
          COALESCE(p.last_active_at >= now() - INTERVAL '30 days', FALSE)
          OR EXISTS (
            SELECT 1 FROM check_ins ci
            WHERE  ci.profile_id = p.id
              AND  ci.checked_in_at >= now() - INTERVAL '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM workout_sessions ws
            WHERE  ws.profile_id = p.id
              AND  ws.started_at >= now() - INTERVAL '30 days'
          )
        )                       AS recently_active,
        COALESCE(ls.score, 0)   AS score
      FROM profiles p
      LEFT JOIN latest_scores ls ON ls.profile_id = p.id
      WHERE p.role = 'member'
        AND p.imported_archived = FALSE
        AND p.membership_status NOT IN ('cancelled', 'banned', 'deactivated')
    )
    SELECT gym_id, COUNT(*) AS at_risk
    FROM   member_flags
    WHERE  recently_active = FALSE
       OR  score >= 55
    GROUP  BY gym_id
    HAVING COUNT(*) > 0
  LOOP
    BEGIN
      PERFORM public._fan_out_admin_notification(
        r.gym_id,
        'member_churn_alert'::notification_type,
        r.at_risk::text || ' miembros en riesgo de abandono',
        'Revisa tu lista de churn y contacta a los que puedas hoy.',
        jsonb_build_object('route', '/admin/churn', 'at_risk_count', r.at_risk),
        'admin_atrisk_digest_' || r.gym_id::text || '_' || v_today
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'send_daily_at_risk_digest: gym % failed: %', r.gym_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.send_daily_at_risk_digest() FROM PUBLIC, anon, authenticated;

-- ── Schedule daily at 13:00 UTC (= 09:00 AST, after the 02:00 churn cron) ──
-- Unschedule any prior copy so re-running this migration is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-at-risk-digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-at-risk-digest',
  '0 13 * * *',
  $$ SELECT public.send_daily_at_risk_digest(); $$
);

NOTIFY pgrst, 'reload schema';
