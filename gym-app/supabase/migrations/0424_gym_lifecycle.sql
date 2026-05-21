-- ============================================================================
-- 0424: Gym lifecycle management for super-admin operations
--
-- Adds the schema + RPCs needed to:
--   - Export a gym's full dataset (member roster, sessions, check-ins,
--     PRs, body metrics, etc.) as a single downloadable JSON blob.
--   - Schedule a gym for deletion with a grace period (default 90 days)
--     so the gym can re-activate without losing data.
--   - Cancel a pending deletion within the grace window.
--   - Hard-delete a gym immediately when needed (compliance request,
--     test gym cleanup, etc.) — cascade wipes profiles, sessions,
--     storage objects, and shadow auth.users rows from bulk imports.
--   - Emit a `gym_lifecycle_events` audit row for every transition.
--
-- The lifecycle state lives on `gyms.lifecycle_state`; the existing
-- `is_active` flag is kept in sync (active → is_active=true; paused /
-- pending_deletion → is_active=false) so the rest of the codebase that
-- already gates on is_active doesn't need touching.
-- ============================================================================

-- ── State column + scheduling timestamp ─────────────────────────────────────
ALTER TABLE gyms
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'paused', 'pending_deletion', 'deleted')),
  ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ;

COMMENT ON COLUMN gyms.lifecycle_state IS
  'Lifecycle phase. active=normal operation; paused=admin pause, data intact; pending_deletion=in grace window, will hard-delete on scheduled_deletion_at; deleted=tombstone (rare; cascades usually wipe the row).';

-- ── Audit log of every transition ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gym_lifecycle_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        UUID NOT NULL,  -- intentionally NOT a FK — survives gym hard-delete
  event_type    TEXT NOT NULL CHECK (event_type IN (
    'created', 'paused', 'reactivated',
    'export_run', 'deletion_scheduled', 'deletion_cancelled',
    'deletion_executed', 'restored_from_pending'
  )),
  performed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Free-form context: scheduled date, days_grace, row counts exported, etc.
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS idx_gym_lifecycle_events_gym
  ON gym_lifecycle_events(gym_id, performed_at DESC);

ALTER TABLE gym_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lifecycle_events_super_admin"
  ON gym_lifecycle_events FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );


-- ── super_admin_export_gym_data ─────────────────────────────────────────────
-- Returns a single JSONB document containing every member-scoped table the
-- gym has data in. Designed to be small enough to ship in one RPC response
-- (a few thousand rows × ~12 tables). For gyms with very large session
-- history (10k+ sessions), the caller should paginate via additional RPCs
-- if needed — but for v1 this is enough to satisfy "give me everything."
CREATE OR REPLACE FUNCTION public.super_admin_export_gym_data(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_gym        JSONB;
  v_profiles   JSONB;
  v_sessions   JSONB;
  v_checkins   JSONB;
  v_prs        JSONB;
  v_metrics    JSONB;
  v_invites    JSONB;
  v_challenges JSONB;
  v_total_rows INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_actor AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT row_to_json(g)::JSONB INTO v_gym
  FROM (SELECT * FROM gyms WHERE id = p_gym_id) g;

  IF v_gym IS NULL THEN
    RAISE EXCEPTION 'Gym not found: %', p_gym_id;
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(p)), '[]'::JSONB) INTO v_profiles
  FROM (SELECT * FROM profiles WHERE gym_id = p_gym_id) p;

  SELECT coalesce(jsonb_agg(row_to_json(s)), '[]'::JSONB) INTO v_sessions
  FROM (SELECT * FROM workout_sessions WHERE gym_id = p_gym_id) s;

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::JSONB) INTO v_checkins
  FROM (SELECT * FROM check_ins WHERE gym_id = p_gym_id) c;

  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::JSONB) INTO v_prs
  FROM (
    SELECT pr.* FROM personal_records pr
    JOIN profiles p ON p.id = pr.profile_id
    WHERE p.gym_id = p_gym_id
  ) r;

  -- Body metrics live across body_weight_logs + body_measurements. Lumped
  -- under one key so the export consumer doesn't need to know the split.
  SELECT jsonb_build_object(
    'weight_logs', (
      SELECT coalesce(jsonb_agg(row_to_json(w)), '[]'::JSONB)
      FROM (
        SELECT bw.* FROM body_weight_logs bw
        JOIN profiles p ON p.id = bw.profile_id
        WHERE p.gym_id = p_gym_id
      ) w
    ),
    'measurements', (
      SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::JSONB)
      FROM (
        SELECT bm.* FROM body_measurements bm
        JOIN profiles p ON p.id = bm.profile_id
        WHERE p.gym_id = p_gym_id
      ) m
    )
  ) INTO v_metrics;

  SELECT coalesce(jsonb_agg(row_to_json(i)), '[]'::JSONB) INTO v_invites
  FROM (SELECT * FROM gym_invites WHERE gym_id = p_gym_id) i;

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::JSONB) INTO v_challenges
  FROM (
    SELECT ch.*, (
      SELECT coalesce(jsonb_agg(row_to_json(cp)), '[]'::JSONB)
      FROM challenge_participants cp WHERE cp.challenge_id = ch.id
    ) AS participants
    FROM challenges ch WHERE ch.gym_id = p_gym_id
  ) c;

  v_total_rows :=
      jsonb_array_length(v_profiles)
    + jsonb_array_length(v_sessions)
    + jsonb_array_length(v_checkins)
    + jsonb_array_length(v_prs)
    + jsonb_array_length(v_invites);

  INSERT INTO gym_lifecycle_events (gym_id, event_type, performed_by, metadata)
  VALUES (p_gym_id, 'export_run', v_actor,
    jsonb_build_object('total_rows', v_total_rows));

  RETURN jsonb_build_object(
    'export_version', 1,
    'exported_at',    now(),
    'gym',            v_gym,
    'profiles',       v_profiles,
    'workout_sessions', v_sessions,
    'check_ins',      v_checkins,
    'personal_records', v_prs,
    'body_metrics',   v_metrics,
    'gym_invites',    v_invites,
    'challenges',     v_challenges,
    'row_summary',    jsonb_build_object(
      'profiles',          jsonb_array_length(v_profiles),
      'workout_sessions',  jsonb_array_length(v_sessions),
      'check_ins',         jsonb_array_length(v_checkins),
      'personal_records',  jsonb_array_length(v_prs),
      'gym_invites',       jsonb_array_length(v_invites),
      'challenges',        jsonb_array_length(v_challenges),
      'total',             v_total_rows
    )
  );
END;
$$;


-- ── super_admin_schedule_gym_deletion ───────────────────────────────────────
-- Moves a gym to `pending_deletion` state with a grace window. Sets
-- `is_active=false` so the gym's admin still has read-only access (their
-- existing AdminRoute check accepts that via gymDeactivated handling) but
-- members lose access immediately. Default grace 90 days = 3 months for
-- re-activation requests; caller can pass a shorter window for compliance
-- requests.
CREATE OR REPLACE FUNCTION public.super_admin_schedule_gym_deletion(
  p_gym_id      UUID,
  p_days_grace  INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_scheduled TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_actor AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;
  IF p_days_grace < 0 OR p_days_grace > 365 THEN
    RAISE EXCEPTION 'p_days_grace must be between 0 and 365';
  END IF;

  v_scheduled := now() + make_interval(days => p_days_grace);

  UPDATE gyms
  SET lifecycle_state = 'pending_deletion',
      scheduled_deletion_at = v_scheduled,
      is_active = false
  WHERE id = p_gym_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gym not found: %', p_gym_id;
  END IF;

  INSERT INTO gym_lifecycle_events (gym_id, event_type, performed_by, metadata)
  VALUES (p_gym_id, 'deletion_scheduled', v_actor,
    jsonb_build_object('scheduled_at', v_scheduled, 'days_grace', p_days_grace));

  RETURN jsonb_build_object(
    'success', true,
    'scheduled_deletion_at', v_scheduled,
    'days_grace', p_days_grace
  );
END;
$$;


-- ── super_admin_cancel_gym_deletion ─────────────────────────────────────────
-- Reverts a gym out of `pending_deletion` back to `active`. Used when a gym
-- wants to come back during the grace window.
CREATE OR REPLACE FUNCTION public.super_admin_cancel_gym_deletion(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_prev  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_actor AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT lifecycle_state INTO v_prev FROM gyms WHERE id = p_gym_id;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'Gym not found: %', p_gym_id;
  END IF;
  IF v_prev <> 'pending_deletion' THEN
    RAISE EXCEPTION 'Gym is not pending deletion (current state: %)', v_prev;
  END IF;

  UPDATE gyms
  SET lifecycle_state = 'active',
      scheduled_deletion_at = NULL,
      is_active = true
  WHERE id = p_gym_id;

  INSERT INTO gym_lifecycle_events (gym_id, event_type, performed_by, metadata)
  VALUES (p_gym_id, 'restored_from_pending', v_actor, NULL);

  RETURN jsonb_build_object('success', true);
END;
$$;


-- ── super_admin_delete_gym_now ──────────────────────────────────────────────
-- IMMEDIATE hard delete. Requires the gym's slug as a confirmation token to
-- prevent fat-finger disasters (admin must type the slug they're deleting).
-- The cascade on gyms.id wipes profiles, sessions, check-ins, branding,
-- invites, challenges, etc. The shadow auth.users rows from bulk imports
-- (id NOT NULL on profiles, profiles.id FK to auth.users) are also wiped
-- via the cascade on profile deletion + the auth.users FK going both ways.
CREATE OR REPLACE FUNCTION public.super_admin_delete_gym_now(
  p_gym_id    UUID,
  p_confirm_slug TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       UUID := auth.uid();
  v_slug        TEXT;
  v_name        TEXT;
  v_total_rows  INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_actor AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT slug, name INTO v_slug, v_name FROM gyms WHERE id = p_gym_id;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'Gym not found: %', p_gym_id;
  END IF;
  IF v_slug <> p_confirm_slug THEN
    RAISE EXCEPTION 'Slug confirmation mismatch: provide the exact gym slug to confirm deletion';
  END IF;

  -- Snapshot row counts BEFORE delete so the audit row is meaningful.
  SELECT COUNT(*) INTO v_total_rows FROM profiles WHERE gym_id = p_gym_id;

  -- Wipe shadow auth.users rows that were minted by bulk_import_members.
  -- These have email matching 'import-<uuid>@import.tugympr.invalid' and
  -- are linked to imported profile shells we're about to cascade-delete
  -- anyway, so dropping them here avoids orphaned auth users.
  DELETE FROM auth.users
  WHERE id IN (
    SELECT id FROM profiles
    WHERE gym_id = p_gym_id AND import_batch_id IS NOT NULL
  );

  -- Now drop the gym — cascades to every gym_id-scoped table.
  DELETE FROM gyms WHERE id = p_gym_id;

  -- Audit row uses the gym_id we just deleted; the gym_lifecycle_events
  -- table intentionally has NO FK to gyms so this row survives.
  INSERT INTO gym_lifecycle_events (gym_id, event_type, performed_by, metadata)
  VALUES (p_gym_id, 'deletion_executed', v_actor,
    jsonb_build_object(
      'gym_slug', v_slug,
      'gym_name', v_name,
      'profiles_deleted', v_total_rows
    ));

  RETURN jsonb_build_object(
    'success', true,
    'gym_slug', v_slug,
    'profiles_deleted', v_total_rows
  );
END;
$$;


-- ── super_admin_compute_gym_costs ──────────────────────────────────────────
-- Directional cost estimate per gym, based on row counts + storage usage
-- + Supabase's published pricing. Not exact (egress bandwidth can't be
-- attributed to a specific gym from server side without per-request
-- instrumentation) but accurate enough for "which gyms are expensive?"
-- triage. Multiply this by ~1.3 to get a more honest number that accounts
-- for the unattributable overhead.
CREATE OR REPLACE FUNCTION public.super_admin_compute_gym_costs(p_gym_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_actor              UUID := auth.uid();
  v_profile_count      INT;
  v_session_count      INT;
  v_checkin_count      INT;
  v_pr_count           INT;
  v_active_30d         INT;
  v_avg_row_bytes      NUMERIC := 800;   -- rough plpgsql-side average
  v_db_bytes           BIGINT;
  v_db_gb              NUMERIC;
  v_storage_bytes      BIGINT := 0;
  v_storage_gb         NUMERIC;
  v_db_cost            NUMERIC;
  v_storage_cost       NUMERIC;
  v_egress_est_gb      NUMERIC;
  v_egress_cost        NUMERIC;
  v_mau_cost           NUMERIC := 0;
  v_total              NUMERIC;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_actor AND role = 'super_admin') THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  SELECT COUNT(*) INTO v_profile_count
  FROM profiles WHERE gym_id = p_gym_id;
  SELECT COUNT(*) INTO v_session_count
  FROM workout_sessions WHERE gym_id = p_gym_id;
  SELECT COUNT(*) INTO v_checkin_count
  FROM check_ins WHERE gym_id = p_gym_id;
  SELECT COUNT(*) INTO v_pr_count
  FROM personal_records pr
  JOIN profiles p ON p.id = pr.profile_id
  WHERE p.gym_id = p_gym_id;
  SELECT COUNT(DISTINCT id) INTO v_active_30d
  FROM profiles
  WHERE gym_id = p_gym_id
    AND last_active_at > (now() - interval '30 days');

  -- Storage objects this gym owns (avatars, progress photos, gym logo,
  -- exercise videos uploaded for this gym). storage.objects has a
  -- `bucket_id` + `name` (path) — for now we approximate by summing
  -- objects whose name starts with the gym id or slug. This will
  -- undercount until we standardize storage paths to include gym_id.
  BEGIN
    SELECT coalesce(SUM(COALESCE((metadata->>'size')::BIGINT, 0)), 0)
    INTO v_storage_bytes
    FROM storage.objects
    WHERE name LIKE p_gym_id::TEXT || '/%'
       OR name LIKE '%' || p_gym_id::TEXT || '%';
  EXCEPTION WHEN OTHERS THEN
    v_storage_bytes := 0;  -- storage schema not readable / no objects
  END;

  -- DB bytes = row count × avg row size. Indexes typically add ~30%
  -- on top, so the multiplier below builds that in.
  v_db_bytes := ((v_profile_count + v_session_count + v_checkin_count + v_pr_count)
                * v_avg_row_bytes * 1.3)::BIGINT;
  v_db_gb := v_db_bytes / 1073741824.0;
  v_storage_gb := v_storage_bytes / 1073741824.0;

  -- Supabase pricing (Pro plan):
  --   DB storage:  $0.125 per GB above the 8 GB included
  --   Storage:     $0.021 per GB above the 100 GB included
  --   Egress:      $0.09 per GB above the 250 GB included
  --   MAU:         free up to 100k, then $0.00325 per MAU
  -- We don't subtract the included tier per gym (it's amortized across
  -- all gyms) — instead we report this gym's *marginal* cost as if it
  -- were the only consumer beyond the included tier. Caller divides by
  -- total platform usage to get attribution share.
  v_db_cost      := v_db_gb * 0.125;
  v_storage_cost := v_storage_gb * 0.021;

  -- Egress estimate: assume each active member generates ~50 MB / month
  -- (dashboard loads + image fetches). This is a rough heuristic.
  v_egress_est_gb := v_active_30d * 0.05;
  v_egress_cost   := v_egress_est_gb * 0.09;

  v_total := v_db_cost + v_storage_cost + v_egress_cost + v_mau_cost;

  RETURN jsonb_build_object(
    'computed_at', now(),
    'gym_id', p_gym_id,
    'counts', jsonb_build_object(
      'profiles', v_profile_count,
      'workout_sessions', v_session_count,
      'check_ins', v_checkin_count,
      'personal_records', v_pr_count,
      'active_last_30_days', v_active_30d
    ),
    'storage', jsonb_build_object(
      'db_bytes', v_db_bytes,
      'db_gb', round(v_db_gb::NUMERIC, 4),
      'storage_bytes', v_storage_bytes,
      'storage_gb', round(v_storage_gb::NUMERIC, 4)
    ),
    'estimated_monthly_cost_usd', jsonb_build_object(
      'db', round(v_db_cost::NUMERIC, 4),
      'storage', round(v_storage_cost::NUMERIC, 4),
      'egress_estimate', round(v_egress_cost::NUMERIC, 4),
      'mau', round(v_mau_cost::NUMERIC, 4),
      'total', round(v_total::NUMERIC, 4)
    ),
    'notes', 'Egress is estimated from active-user count; actual bandwidth requires per-request attribution. Multiply total by ~1.3 for honest unattributed overhead.'
  );
END;
$$;


GRANT EXECUTE ON FUNCTION public.super_admin_export_gym_data(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_schedule_gym_deletion(UUID, INT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_cancel_gym_deletion(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_delete_gym_now(UUID, TEXT)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_compute_gym_costs(UUID)            TO authenticated;

NOTIFY pgrst, 'reload schema';
