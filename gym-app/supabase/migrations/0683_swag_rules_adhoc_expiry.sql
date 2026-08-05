-- =============================================================
-- 0683 — swag: turn the engine on, allow ad-hoc gifts, expire the stale ones
-- =============================================================
--
-- Three gaps in 0682, found reviewing it:
--
--   1. THE FEATURE COULD NEVER FIRE. gym_swag_rules was created and read by
--      generate_swag_grants_daily(), but nothing could ever write it — there
--      was no UI and no RPC. The nightly job would insert zero rows forever.
--      That's fixed on the client (a Rules tab in /platform/swag); nothing is
--      needed here beyond the policies 0682 already granted super admins.
--
--   2. NO AD-HOC PATH. Only the cron created grants, so a member standing at
--      the desk could only be handed something an occasion had already queued.
--      admin_grant_swag() below is the "just give them one" path.
--
--   3. PENDING GRANTS NEVER EXPIRED. print_cards ages out at 30 days (0399:70);
--      a swag grant sat pending forever, so a member who never came back left a
--      permanent row in the front desk's panel and the list only ever grew.
--      60 days rather than 30: a physical gift keeps, and the member may take
--      longer to show up than a greeting card is worth holding.
--
-- The item picker problem worth naming: swag_items is super-admin-only by RLS
-- (0682), so a gym admin choosing what to hand over cannot read the catalog at
-- all. gym_swag_options() is the narrow door — id, name, emoji ONLY, for items
-- that gym has actually been shipped. No cost, no quantities, no other gyms.
-- Inventory stays invisible; picking works.
-- =============================================================

-- ── Tunable ──────────────────────────────────────────────────
--   SWAG_GRANT_TTL_DAYS = 60

-- ── 1. Expiry ────────────────────────────────────────────────
ALTER TABLE public.swag_grants
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.swag_grants
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '60 days');

-- Backfill rows created by 0682 before this column existed, so the first sweep
-- doesn't treat a NULL as "never expires" forever.
UPDATE public.swag_grants
   SET expires_at = created_at + INTERVAL '60 days'
 WHERE expires_at IS NULL;

-- Widen the status CHECK for 'expired'. Discovered from pg_constraint rather
-- than assumed by name — a differently-named constraint would otherwise survive
-- and keep rejecting the new value.
DO $$
DECLARE r record;
BEGIN
  SET LOCAL lock_timeout = '5s';
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t      ON t.oid = c.conrelid
    JOIN pg_namespace n  ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'swag_grants'
      AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.swag_grants DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE public.swag_grants
    ADD CONSTRAINT swag_grants_status_check
    CHECK (status IN ('pending','delivered','cancelled','expired'))
    NOT VALID;
END $$;

-- Superset of the old list, so every existing row already satisfies it.
ALTER TABLE public.swag_grants VALIDATE CONSTRAINT swag_grants_status_check;

-- ── 2. Daily job: sweep first, then mirror ───────────────────
CREATE OR REPLACE FUNCTION public.generate_swag_grants_daily()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INTEGER := 0;
BEGIN
  -- Expire before mirroring: freeing the (profile_id, occasion) pending slot
  -- first lets a member who earns the same occasion again actually get it.
  UPDATE swag_grants
     SET status = 'expired'
   WHERE status = 'pending'
     AND expires_at IS NOT NULL
     AND expires_at <= NOW();

  INSERT INTO swag_grants (
    gym_id, profile_id, item_id, item_name, item_name_es, item_emoji,
    occasion, source_card_id
  )
  SELECT pc.gym_id, pc.profile_id, r.item_id, i.name, i.name_es, i.emoji,
         pc.occasion, pc.id
  FROM print_cards pc
  JOIN gym_swag_rules r
    ON r.gym_id = pc.gym_id AND r.occasion = pc.occasion AND r.is_active
  JOIN swag_items i ON i.id = r.item_id AND i.is_active
  WHERE pc.created_at >= NOW() - INTERVAL '24 hours'
    AND pc.status <> 'dismissed'
    AND NOT EXISTS (
      SELECT 1 FROM swag_grants sg
      WHERE sg.profile_id = pc.profile_id
        AND sg.occasion   = pc.occasion
        AND sg.status     = 'pending'
    )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_swag_grants_daily() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_swag_grants_daily() TO service_role;

-- ── 3. What a gym admin is allowed to pick from ──────────────
-- Deliberately narrow. Returns only what this gym has been SHIPPED — you can't
-- hand out a cup nobody sent you — and only the three fields needed to render a
-- picker. No unit_cost_cents, no counts, no other gyms' anything.
CREATE OR REPLACE FUNCTION public.gym_swag_options()
RETURNS TABLE (item_id UUID, name TEXT, name_es TEXT, emoji TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
BEGIN
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  IF NOT (v_caller_role IN ('admin','super_admin','trainer')
          OR 'admin'::user_role       = ANY(COALESCE(v_caller_extra, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'))
          OR 'trainer'::user_role     = ANY(COALESCE(v_caller_extra, '{}'))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF v_caller_gym IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT i.id, i.name, i.name_es, i.emoji
  FROM swag_box_items bi
  JOIN swag_boxes b ON b.id = bi.box_id
  JOIN swag_items i ON i.id = bi.item_id
  WHERE b.gym_id = v_caller_gym
    AND b.status = 'shipped'
    AND i.is_active
  ORDER BY i.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gym_swag_options() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gym_swag_options() FROM anon;
GRANT  EXECUTE ON FUNCTION public.gym_swag_options() TO authenticated;

-- ── 4. Ad-hoc grant ──────────────────────────────────────────
-- "Just give this member one." No occasion, so it sidesteps the
-- (profile_id, occasion) pending index entirely — a member can be handed as
-- many ad-hoc gifts as the gym wants, which is the point.
--
-- Guard copied from admin_create_member (0467:67-83), same as
-- deliver_swag_grant. Trainers included: they run the desk too.
CREATE OR REPLACE FUNCTION public.admin_grant_swag(
  p_profile_id UUID,
  p_item_id    UUID,
  p_note       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  TEXT;
  v_caller_extra user_role[];
  v_caller_gym   UUID;
  v_is_super     BOOLEAN;
  v_is_staff     BOOLEAN;
  v_member_gym   UUID;
  v_item         swag_items%ROWTYPE;
  v_grant_id     UUID;
BEGIN
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_staff := (v_caller_role IN ('admin','trainer')
                 OR 'admin'::user_role   = ANY(COALESCE(v_caller_extra, '{}'))
                 OR 'trainer'::user_role = ANY(COALESCE(v_caller_extra, '{}')));

  IF NOT (v_is_staff OR v_is_super) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT gym_id INTO v_member_gym FROM profiles WHERE id = p_profile_id;
  IF v_member_gym IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'MEMBER_NOT_FOUND');
  END IF;

  IF NOT v_is_super AND v_member_gym IS DISTINCT FROM v_caller_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  SELECT * INTO v_item FROM swag_items WHERE id = p_item_id AND is_active;
  IF v_item.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'ITEM_NOT_FOUND');
  END IF;

  -- The gym must actually have been shipped this item. Without this a gym
  -- could hand out stock nobody sent them and drive their on_hand negative.
  IF NOT v_is_super AND NOT EXISTS (
    SELECT 1 FROM swag_box_items bi
    JOIN swag_boxes b ON b.id = bi.box_id
    WHERE b.gym_id = v_member_gym AND b.status = 'shipped' AND bi.item_id = p_item_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'NOT_STOCKED');
  END IF;

  INSERT INTO swag_grants (
    gym_id, profile_id, item_id, item_name, item_name_es, item_emoji,
    occasion, delivery_note
  )
  VALUES (
    v_member_gym, p_profile_id, v_item.id, v_item.name, v_item.name_es, v_item.emoji,
    NULL, NULLIF(trim(COALESCE(p_note, '')), '')
  )
  RETURNING id INTO v_grant_id;

  BEGIN
    PERFORM public.log_admin_action(
      'swag_granted_adhoc', 'swag_grant', v_grant_id,
      jsonb_build_object('item_id', p_item_id, 'profile_id', p_profile_id),
      v_member_gym
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN json_build_object(
    'success', true, 'grant_id', v_grant_id,
    'item_name', v_item.name, 'item_emoji', v_item.emoji
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_grant_swag(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_grant_swag(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_swag(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verify:
--   SELECT * FROM gym_swag_options();                  -- as a gym admin
--   SELECT admin_grant_swag('<member>', '<item>', NULL);
--   SELECT generate_swag_grants_daily();               -- sweeps, then mirrors
--   SELECT status, count(*) FROM swag_grants GROUP BY status;
--
-- As a gym admin, still zero — the narrow door must not have widened:
--   SELECT count(*) FROM swag_items;
-- =============================================================
