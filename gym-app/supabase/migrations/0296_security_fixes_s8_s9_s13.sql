-- =============================================================
-- SECURITY FIXES: S8, S9, S13
-- Migration: 0293_security_fixes_s8_s9_s13.sql
--
-- S8  — Block super_admin role escalation server-side
--       Currently only blocked in SupportConsole.jsx (client-side).
--       Add a trigger on profiles that rejects any attempt to set
--       role = 'super_admin' via a normal authenticated UPDATE unless
--       the current caller is already a super_admin (or is service_role/
--       postgres doing a direct DB operation, i.e. auth.uid() IS NULL).
--
-- S9  — Restrict trainer full-PII access to assigned clients only
--       Migration 0289 narrowed profiles_select so trainers can read all
--       same-gym rows but with full columns (PII included). Trainers should
--       only receive full-column access for profiles where is_trainer_of()
--       returns TRUE. Non-assigned member lookups (e.g. AddClient search)
--       must go through gym_member_profiles_safe view.
--
-- S13 — Social post body length DB constraint
--       Add a CHECK on feed_comments.content (≤ 1000 chars) and a trigger
--       on activity_feed_items that validates data->>'body' length (≤ 5000
--       chars) before INSERT or UPDATE.
-- =============================================================


-- ────────────────────────────────────────────────────────────────
-- S8: PREVENT super_admin ROLE ESCALATION VIA TRIGGER
-- ────────────────────────────────────────────────────────────────
-- The trigger fires BEFORE UPDATE on profiles. If the new role is
-- 'super_admin' and the old role was not already 'super_admin', the
-- caller must satisfy is_super_admin().
--
-- auth.uid() IS NULL means the operation originates from a
-- privileged DB session (service_role or postgres direct access),
-- which is allowed to bypass this check intentionally.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_super_admin_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only relevant when the role is being escalated TO super_admin
  IF NEW.role = 'super_admin' AND OLD.role <> 'super_admin' THEN
    -- Allow service_role / postgres direct access (auth.uid() is NULL)
    -- Block any authenticated user who is not already a super_admin
    IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Cannot escalate to super_admin role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_super_admin_escalation ON public.profiles;

CREATE TRIGGER trg_prevent_super_admin_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_super_admin_escalation();


-- ────────────────────────────────────────────────────────────────
-- S9: NARROW TRAINER profiles_select TO ASSIGNED CLIENTS ONLY
-- ────────────────────────────────────────────────────────────────
-- Before (migration 0289): trainers could read ALL same-gym profiles
-- with full columns (including PII fields like phone_number,
-- date_of_birth, bodyweight_lbs, admin_note, etc.).
--
-- After: trainers only get full-column SELECT on rows where
-- is_trainer_of(profiles.id) is TRUE (assigned clients) plus their
-- own row. For searching/browsing non-assigned members the frontend
-- must use the gym_member_profiles_safe view or the
-- get_gym_member_profiles_safe() RPC, which already exist and
-- exclude PII columns.
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    -- Always see your own row (full column access)
    id = auth.uid()

    -- Admins and super_admins see all same-gym profiles with full columns
    OR (
      gym_id = public.current_gym_id()
      AND public.current_user_role() IN ('admin', 'super_admin')
    )

    -- Trainers: full-column access restricted to assigned clients only
    OR (
      public.current_user_role() = 'trainer'
      AND public.is_trainer_of(profiles.id)
    )
  );


-- ────────────────────────────────────────────────────────────────
-- S13: SOCIAL POST BODY LENGTH CONSTRAINTS
-- ────────────────────────────────────────────────────────────────

-- 1. Hard CHECK on feed_comments.content (max 1000 characters)
--    Applied as a table constraint so it is enforced by Postgres
--    regardless of how the row is inserted (RPC, direct, trigger).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_comments_content_length'
  ) THEN
    ALTER TABLE public.feed_comments
      ADD CONSTRAINT feed_comments_content_length
      CHECK (char_length(content) <= 1000);
  END IF;
END;
$$;

-- 2. Trigger on activity_feed_items to validate data->>'body' length.
--    The 'post' feed item type stores the user-authored body text in
--    data->>'body'. Cap it at 5000 characters (generous for long posts
--    while preventing runaway payloads).
CREATE OR REPLACE FUNCTION public.validate_feed_item_body_length()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.data ? 'body' THEN
    IF char_length(NEW.data->>'body') > 5000 THEN
      RAISE EXCEPTION 'Feed post body cannot exceed 5000 characters';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_feed_item_body_length ON public.activity_feed_items;

CREATE TRIGGER trg_validate_feed_item_body_length
  BEFORE INSERT OR UPDATE ON public.activity_feed_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_feed_item_body_length();


NOTIFY pgrst, 'reload schema';
