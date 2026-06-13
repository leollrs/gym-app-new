-- ============================================================================
-- 0545 — Platform lifecycle executor + history snapshots + import rollback
-- ⚠️ APPLY MANUALLY in the Supabase SQL editor.
--
-- Root causes (platform audit 2026-06-11):
--   • P1-7  — GymHealth promises "historical tracking begins from first
--     refresh" but NOTHING persists snapshots. New `platform_snapshots`
--     table + weekly pg_cron `snapshot_platform_gym_stats()` give the
--     platform tier a real history series (one row per gym per week,
--     kind='gym_stats'). Member counts follow the audit's honest filter
--     (role='member' AND imported_archived IS NOT TRUE), sessions are
--     completed-only, and avg_churn_score mirrors the admin tier's
--     loadScores.js semantics (latest row per member within 7 days) so
--     platform numbers finally match gym dashboards.
--   • P2-7  — "Schedule deletion" NEVER deleted: nothing swept
--     `pending_deletion` gyms past `scheduled_deletion_at`. The card's
--     "permanently deleted on <date>" was fiction (lockout was real).
--     New `execute_scheduled_gym_deletions()` + daily pg_cron performs the
--     SAME cascade `super_admin_delete_gym_now` (0424) performs — including
--     the import-shadow auth.users cleanup — and writes an
--     'auto_delete_executed' lifecycle event. Conservative guards: requires
--     lifecycle_state='pending_deletion' AND scheduled_deletion_at IS NOT
--     NULL AND past AND is_active=false, logs each gym via RAISE LOG, and
--     isolates per-gym failures so one bad gym can't block the sweep.
--   • P3 (ErrorLogs) — no retention job on error_logs (0094): the table
--     grows forever. The same daily cron prunes rows older than 90 days.
--   • P0-2b — program_templates has NO super_admin write path: the only
--     write policy (0002:232 "program_templates_manage_admin") requires
--     gym_id = current_gym_id(), which can never be true for GLOBAL
--     (gym_id IS NULL) templates → PlatformSettings' Add Template insert
--     AND delete silently no-op'd (RLS filtered, 0 rows, no error). New
--     super_admin ALL policy.
--   • GAPS — "no import batch rollback (indexes exist, no RPC/UI)". New
--     `rollback_import_batch(p_batch_id)`: deletes the batch's UNCLAIMED
--     shell profiles via their import-shadow auth.users rows (mirrors
--     0424's cleanup pattern, but with an email guard so members who
--     already CLAIMED their import — claim_imported_invite copies
--     import_batch_id onto the real auth profile (0466) — are never
--     touched), deletes their unused invite codes, stamps the batch row
--     (new rolled_back_at column), and returns honest counts.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════
-- 1. platform_snapshots — weekly per-gym history (CONTRACT — do not alter:
--    another platform page consumes exactly this shape)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_snapshots (
  id            bigserial PRIMARY KEY,
  snapshot_date date NOT NULL,
  gym_id        uuid REFERENCES gyms(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  data          jsonb NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, gym_id, kind)
);

-- Per-gym history reads ("give me this gym's gym_stats series")
CREATE INDEX IF NOT EXISTS idx_platform_snapshots_gym_kind_date
  ON platform_snapshots(gym_id, kind, snapshot_date DESC);

ALTER TABLE platform_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_snapshots_super_admin_select" ON platform_snapshots;
CREATE POLICY "platform_snapshots_super_admin_select"
  ON platform_snapshots FOR SELECT
  USING (public.is_super_admin());

COMMENT ON TABLE platform_snapshots IS
  'Weekly per-gym stat snapshots written by snapshot_platform_gym_stats() (pg_cron, Sunday 06:00 UTC). kind=''gym_stats'' data shape: {member_count, active_30d, sessions_30d, checkins_30d, checkedin_30d, new_30d, onboarded_count, avg_churn_score, plan_type, monthly_price, is_active}.';


-- ── snapshot_platform_gym_stats() ───────────────────────────────────────
-- One row per gym, kind='gym_stats'. Definitions:
--   members        = profiles role='member' AND imported_archived IS NOT TRUE
--   sessions_30d   = workout_sessions status='completed' in last 30d (gym-scoped)
--   checkins_30d   = raw check_ins in last 30d (gym-scoped)
--   checkedin_30d  = DISTINCT members (per the filter above) who checked in
--   active_30d     = DISTINCT members with a completed session OR a check-in
--   new_30d        = members created in last 30d
--   onboarded_count= members with is_onboarded
--   avg_churn_score= AVG over the LATEST churn_risk_scores row per member
--                    within the last 7 days, members restricted to
--                    membership_status IN ('active','frozen') — mirrors
--                    src/lib/churn/loadScores.js (the admin tier's correct
--                    dedup), NOT the full-history aggregate P1-1 flags.
--                    NULL when no fresh scores exist (honest, not 0).
-- Re-runs on the same UTC date overwrite (idempotent upsert).
CREATE OR REPLACE FUNCTION public.snapshot_platform_gym_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date   DATE := (now() AT TIME ZONE 'UTC')::date;
  v_cutoff TIMESTAMPTZ := now() - interval '30 days';
BEGIN
  INSERT INTO platform_snapshots (snapshot_date, gym_id, kind, data)
  SELECT
    v_date,
    g.id,
    'gym_stats',
    jsonb_build_object(
      'member_count',    COALESCE(m.member_count, 0),
      'active_30d',      COALESCE(a.active_30d, 0),
      'sessions_30d',    COALESCE(s.sessions_30d, 0),
      'checkins_30d',    COALESCE(c.checkins_30d, 0),
      'checkedin_30d',   COALESCE(c.checkedin_30d, 0),
      'new_30d',         COALESCE(m.new_30d, 0),
      'onboarded_count', COALESCE(m.onboarded_count, 0),
      'avg_churn_score', ch.avg_churn_score,         -- nullable on purpose
      'plan_type',       g.plan_type,
      'monthly_price',   g.monthly_price,
      'is_active',       g.is_active
    )
  FROM gyms g
  LEFT JOIN (
    SELECT p.gym_id,
           COUNT(*) AS member_count,
           COUNT(*) FILTER (WHERE p.created_at >= v_cutoff) AS new_30d,
           COUNT(*) FILTER (WHERE p.is_onboarded) AS onboarded_count
    FROM profiles p
    WHERE p.role = 'member' AND p.imported_archived IS NOT TRUE
    GROUP BY p.gym_id
  ) m ON m.gym_id = g.id
  LEFT JOIN (
    SELECT ws.gym_id, COUNT(*) AS sessions_30d
    FROM workout_sessions ws
    WHERE ws.status = 'completed' AND ws.started_at >= v_cutoff
    GROUP BY ws.gym_id
  ) s ON s.gym_id = g.id
  LEFT JOIN (
    SELECT ci.gym_id,
           COUNT(*) AS checkins_30d,
           COUNT(DISTINCT ci.profile_id) FILTER (
             WHERE p.role = 'member' AND p.imported_archived IS NOT TRUE
           ) AS checkedin_30d
    FROM check_ins ci
    LEFT JOIN profiles p ON p.id = ci.profile_id
    WHERE ci.checked_in_at >= v_cutoff
    GROUP BY ci.gym_id
  ) c ON c.gym_id = g.id
  LEFT JOIN (
    SELECT u.gym_id, COUNT(DISTINCT u.profile_id) AS active_30d
    FROM (
      SELECT ws.gym_id, ws.profile_id
      FROM workout_sessions ws
      WHERE ws.status = 'completed' AND ws.started_at >= v_cutoff
      UNION
      SELECT ci.gym_id, ci.profile_id
      FROM check_ins ci
      WHERE ci.checked_in_at >= v_cutoff
    ) u
    JOIN profiles p ON p.id = u.profile_id
     AND p.role = 'member' AND p.imported_archived IS NOT TRUE
    GROUP BY u.gym_id
  ) a ON a.gym_id = g.id
  LEFT JOIN (
    SELECT latest.gym_id, ROUND(AVG(latest.score)::numeric, 1) AS avg_churn_score
    FROM (
      SELECT DISTINCT ON (crs.profile_id) crs.profile_id, crs.gym_id, crs.score
      FROM churn_risk_scores crs
      JOIN profiles p ON p.id = crs.profile_id
       AND p.role = 'member'
       AND p.imported_archived IS NOT TRUE
       AND p.membership_status IN ('active', 'frozen')
      WHERE crs.computed_at >= now() - interval '7 days'
      ORDER BY crs.profile_id, crs.computed_at DESC
    ) latest
    GROUP BY latest.gym_id
  ) ch ON ch.gym_id = g.id
  ON CONFLICT (snapshot_date, gym_id, kind)
  DO UPDATE SET data = EXCLUDED.data, created_at = now();
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'snapshot_platform_gym_stats failed: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.snapshot_platform_gym_stats() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.snapshot_platform_gym_stats() TO service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 2. Scheduled-deletion executor (P2-7)
-- ════════════════════════════════════════════════════════════════════════

-- 0424's event_type CHECK doesn't include the new automated event. Extend
-- it (drop + re-add). The inline column CHECK normally gets the default
-- name, but drop ANY check constraint touching event_type to be safe — a
-- leftover old CHECK would reject 'auto_delete_executed' at sweep time.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'gym_lifecycle_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE gym_lifecycle_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE gym_lifecycle_events
  ADD CONSTRAINT gym_lifecycle_events_event_type_check CHECK (event_type IN (
    'created', 'paused', 'reactivated',
    'export_run', 'deletion_scheduled', 'deletion_cancelled',
    'deletion_executed', 'restored_from_pending',
    'auto_delete_executed'
  ));

-- Replicates super_admin_delete_gym_now's cascade (0424) line by line,
-- minus the actor gate + slug confirmation (this is a system sweep — the
-- human confirmation already happened at super_admin_schedule_gym_deletion
-- time, and the 90-day grace window is the undo). Per 0424:
--   1. wipe shadow auth.users minted by bulk_import_members (profiles
--      cascade off gyms won't touch auth.users on its own),
--   2. DELETE FROM gyms — cascades to every gym_id-scoped table,
--   3. audit row (gym_lifecycle_events has NO FK to gyms so it survives).
-- THIS DELETES DATA — guards are deliberately redundant:
--   lifecycle_state='pending_deletion' AND scheduled_deletion_at IS NOT NULL
--   AND scheduled_deletion_at < now() AND is_active=false.
-- (super_admin_schedule_gym_deletion always sets is_active=false; a gym that
-- somehow looks active is left alone for a human to inspect.)
CREATE OR REPLACE FUNCTION public.execute_scheduled_gym_deletions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g          RECORD;
  v_profiles INT;
BEGIN
  FOR g IN
    SELECT id, slug, name, scheduled_deletion_at
    FROM gyms
    WHERE lifecycle_state = 'pending_deletion'
      AND scheduled_deletion_at IS NOT NULL
      AND scheduled_deletion_at < now()
      AND is_active = false
  LOOP
    -- Per-gym subtransaction: one failure can't block the rest of the sweep,
    -- and a failed audit insert rolls the gym's delete back with it.
    BEGIN
      RAISE LOG 'execute_scheduled_gym_deletions: deleting gym % (%) — was scheduled for %',
        g.slug, g.id, g.scheduled_deletion_at;

      -- Snapshot row count BEFORE delete so the audit row is meaningful (0424).
      SELECT COUNT(*) INTO v_profiles FROM profiles WHERE gym_id = g.id;

      -- Import-shadow auth.users cleanup (0424 verbatim).
      DELETE FROM auth.users
      WHERE id IN (
        SELECT id FROM profiles
        WHERE gym_id = g.id AND import_batch_id IS NOT NULL
      );

      -- Cascade wipes profiles, sessions, check-ins, branding, invites, etc.
      DELETE FROM gyms WHERE id = g.id;

      INSERT INTO gym_lifecycle_events (gym_id, event_type, performed_by, metadata)
      VALUES (g.id, 'auto_delete_executed', NULL,
        jsonb_build_object(
          'gym_slug', g.slug,
          'gym_name', g.name,
          'profiles_deleted', v_profiles,
          'scheduled_deletion_at', g.scheduled_deletion_at
        ));

      RAISE LOG 'execute_scheduled_gym_deletions: gym % deleted (% profiles)', g.slug, v_profiles;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'execute_scheduled_gym_deletions: FAILED for gym % (%): %', g.slug, g.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_scheduled_gym_deletions() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.execute_scheduled_gym_deletions() TO service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 3. program_templates super_admin write path (P0-2b)
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "program_templates_super_admin_all" ON program_templates;
CREATE POLICY "program_templates_super_admin_all"
  ON program_templates FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());


-- ════════════════════════════════════════════════════════════════════════
-- 4. rollback_import_batch (GAPS — no import batch rollback)
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE gym_import_batches
  ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ;

COMMENT ON COLUMN gym_import_batches.rolled_back_at IS
  'Set by rollback_import_batch() when the batch''s unclaimed shells were removed. A rolled-back batch cannot be rolled back twice.';

-- Deletes everything a bulk import created that nobody has claimed yet:
--   • UNCLAIMED shell profiles — identified by their auth.users row still
--     wearing the import-shadow email ('import-<uuid>@import.tugympr.invalid',
--     minted in bulk_import_members 0422/0466/0507). Deleting the auth row
--     cascade-wipes the shell profile (profiles.id FK ON DELETE CASCADE).
--   • Their UNUSED invite codes — gym_invites has no batch column; phone is
--     the durable bridge (same join the codes-sheet export uses). Only
--     used_by IS NULL rows are touched so claimed invites keep their audit
--     trail.
-- CLAIMED members are NEVER touched: claim_imported_invite (0466) copies
-- import_batch_id onto the member's REAL auth profile, so filtering by
-- import_batch_id alone (0424's whole-gym pattern) would delete real,
-- signed-in members' accounts. The shadow-email guard is the difference
-- between "undo an import" and "delete paying members". Their count is
-- returned as claimed_kept so the operator sees exactly what stayed.
CREATE OR REPLACE FUNCTION public.rollback_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch            RECORD;
  v_shell_ids        UUID[];
  v_shell_phones     TEXT[];
  v_claimed_kept     INT := 0;
  v_profiles_deleted INT := 0;
  v_invites_deleted  INT := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'p_batch_id is required';
  END IF;

  SELECT * INTO v_batch FROM gym_import_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import batch not found: %', p_batch_id;
  END IF;
  IF v_batch.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'Batch was already rolled back at %', v_batch.rolled_back_at;
  END IF;

  -- Unclaimed shells = batch profiles whose auth user is still the shadow.
  SELECT array_agg(p.id),
         array_agg(p.phone_number) FILTER (WHERE p.phone_number IS NOT NULL)
  INTO v_shell_ids, v_shell_phones
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.import_batch_id = p_batch_id
    AND p.gym_id = v_batch.gym_id
    AND u.email LIKE 'import-%@import.tugympr.invalid';

  -- Members who already claimed (real auth user carries the batch id).
  SELECT COUNT(*) INTO v_claimed_kept
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.import_batch_id = p_batch_id
    AND p.gym_id = v_batch.gym_id
    AND u.email NOT LIKE 'import-%@import.tugympr.invalid';

  -- 1. Unused invite codes for the shells (phone bridge, used_by NULL only).
  IF v_shell_phones IS NOT NULL AND array_length(v_shell_phones, 1) > 0 THEN
    DELETE FROM gym_invites
    WHERE gym_id = v_batch.gym_id
      AND used_by IS NULL
      AND phone = ANY(v_shell_phones);
    GET DIAGNOSTICS v_invites_deleted = ROW_COUNT;
  END IF;

  -- 2. Shadow auth users — cascade removes the shell profiles with them.
  IF v_shell_ids IS NOT NULL AND array_length(v_shell_ids, 1) > 0 THEN
    DELETE FROM auth.users WHERE id = ANY(v_shell_ids);
    GET DIAGNOSTICS v_profiles_deleted = ROW_COUNT;
  END IF;

  -- 3. Stamp the batch (kept, not deleted — it's the audit record).
  UPDATE gym_import_batches SET rolled_back_at = now() WHERE id = p_batch_id;

  RAISE LOG 'rollback_import_batch %: % shells deleted, % invites deleted, % claimed kept (gym %)',
    p_batch_id, v_profiles_deleted, v_invites_deleted, v_claimed_kept, v_batch.gym_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'profiles_deleted', v_profiles_deleted,
    'invites_deleted', v_invites_deleted,
    'claimed_kept', v_claimed_kept
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_import_batch(UUID) TO authenticated;

COMMENT ON FUNCTION public.rollback_import_batch(UUID) IS
  'Super-admin only. Undoes a CSV bulk import: removes the batch''s unclaimed shell profiles (via their import-shadow auth.users rows) and their unused invite codes; members who already claimed are kept and counted. Marks the batch rolled_back_at.';


-- ════════════════════════════════════════════════════════════════════════
-- 5. Cron registration (guard pattern from 0440/0501)
-- ════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Weekly snapshots — Sunday 06:00 UTC (CONTRACT).
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-weekly-snapshots') THEN
      PERFORM cron.unschedule('platform-weekly-snapshots');
    END IF;
    PERFORM cron.schedule(
      'platform-weekly-snapshots',
      '0 6 * * 0',
      $cron$ SELECT public.snapshot_platform_gym_stats(); $cron$
    );

    -- Daily lifecycle sweep — 07:00 UTC (≈3am Puerto Rico, low traffic):
    -- executes due scheduled deletions, then prunes error_logs > 90 days.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-lifecycle-daily') THEN
      PERFORM cron.unschedule('platform-lifecycle-daily');
    END IF;
    PERFORM cron.schedule(
      'platform-lifecycle-daily',
      '0 7 * * *',
      $cron$
        SELECT public.execute_scheduled_gym_deletions();
        DELETE FROM public.error_logs WHERE created_at < now() - interval '90 days';
      $cron$
    );
  ELSE
    RAISE NOTICE '[0545] pg_cron not installed — schedule snapshot_platform_gym_stats() (weekly, Sun 06:00 UTC), execute_scheduled_gym_deletions() (daily) and the error_logs 90-day prune manually.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
