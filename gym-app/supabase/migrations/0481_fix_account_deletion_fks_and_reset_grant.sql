-- 0481_fix_account_deletion_fks_and_reset_grant.sql
--
-- From the account-lifecycle audit (2026-05-30):
--
-- 1) increment_failed_reset_attempts(request_id) has authenticated EXECUTE and
--    no auth/ownership check -> a member can bump ANY reset request's
--    failed_attempts to force a victim into the lockout cap (reset griefing).
--    Only the reset-password edge function (service_role) needs it. Revoke.
--
-- 2) delete_user_account / admin_delete_gym_member can FAIL for an admin /
--    super_admin because several actor FKs to profiles are ON DELETE NO ACTION
--    and the deletion functions either reference the WRONG table name (so the
--    anonymization is silently skipped via EXCEPTION) or never touch them:
--      - activity_feed_items.deleted_by  (fn targets non-existent 'feed_posts')
--      - admin_kpi_targets.created_by     (fn targets non-existent 'kpi_targets', NOT NULL)
--      - sms_log.admin_id                 (fn targets non-existent 'sms_messages')
--      - gym_import_batches.created_by     (not handled at all, NOT NULL)
--    With NO ACTION, the final DELETE FROM profiles raises an FK violation, so
--    such accounts cannot be deleted. Members are unaffected (they don't create
--    these actor rows).
--
--    ROBUST FIX: switch these actor FKs to ON DELETE SET NULL (dropping NOT NULL
--    where needed). This makes account deletion succeed regardless of the
--    function's table-name bugs, and matches the existing "preserve the artifact,
--    anonymize the actor" pattern already used for gym_closures.created_by /
--    nps_surveys.created_by (both already nullable + SET NULL). The deleted
--    user's KPI targets / SMS log / moderated items / import batches survive with
--    a NULL actor.

-- ── 1. Lock down the reset-attempt counter ─────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.increment_failed_reset_attempts(uuid)
  FROM anon, authenticated, PUBLIC;

-- ── 2. Make actor FKs ON DELETE SET NULL (robust account deletion) ─────────
DO $$
DECLARE
  v       RECORD;
  v_con   TEXT;
  v_attr  TEXT;
BEGIN
  FOR v IN (
    SELECT * FROM (VALUES
      ('activity_feed_items', 'deleted_by'),
      ('admin_kpi_targets',   'created_by'),
      ('sms_log',             'admin_id'),
      ('gym_import_batches',  'created_by')
    ) AS t(tbl, col)
  ) LOOP
    -- Locate the existing single-column FK (-> profiles) on this column, if any.
    SELECT con.conname INTO v_con
    FROM pg_constraint con
    JOIN pg_class c     ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = v.tbl
      AND con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND (SELECT attname FROM pg_attribute
            WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) = v.col
    LIMIT 1;

    IF v_con IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v.tbl, v_con);
    END IF;

    -- Allow NULL so ON DELETE SET NULL can fire (no-op if already nullable).
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', v.tbl, v.col);

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
      || 'REFERENCES public.profiles(id) ON DELETE SET NULL',
      v.tbl, v.tbl || '_' || v.col || '_fkey', v.col
    );
  END LOOP;
END$$;

NOTIFY pgrst, 'reload schema';
