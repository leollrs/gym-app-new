-- =============================================================
-- 0682 — swag: physical merch from the platform to gyms to members
-- =============================================================
--
-- WHY
--
-- TuGymPR ships boxes of merch (backpacks, cups) to gyms, and gyms hand it to
-- members. None of that existed: no SKU, no box, no stock, and no record of who
-- received what. Verified across all 681 prior migrations and all of src/ —
-- zero notions of inventory, shipment, or cost of goods. Greenfield.
--
-- Three flows, one direction of value: platform → gym → member.
--   1. Super admin records a purchase           → their own stock goes up
--   2. Super admin packs a numbered box → gym   → their stock down, gym's up
--   3. Gym admin hands an item to a member      → that gym's stock goes down
--
-- Inventory is NOT a workflow — it is a subtraction, and only the super admin
-- ever sees it. Gym admins have exactly one verb: mark a gift delivered.
--
-- ON MEASURING "DO BACKPACKS RETAIN BETTER THAN CUPS"
--
-- This schema captures what's needed to ask that later (item, member, occasion,
-- delivered_at) but the answer is NOT a query over this table. Gyms give the
-- backpack at the 6-month milestone and the cup at signup, so the backpack
-- cohort is by construction made of members who already survived six months. It
-- will show a huge effect that means nothing, and more data makes the illusion
-- more convincing, not less. The honest version randomises at the milestone —
-- gym_swag_rules is shaped so a `sample_pct` column can be added for that
-- without a redesign.
--
-- TWO DELIBERATE DEPARTURES FROM THE OBVIOUS DESIGN
--
--   * Boxes are packed → shipped. There is NO 'received' state. Gyms never
--     confirm receipt in the app, so a state nobody sets would strand every
--     box's contents in limbo forever. Shipped means it is the gym's.
--
--   * The occasion engine is NOT duplicated. generate_print_cards_daily()
--     (0415:146, ~270 lines, 04:00 UTC) already computes who hits welcome /
--     habit_9in6 / tenure_* / milestone_* / returning / birthday every night.
--     generate_swag_grants_daily() runs 15 minutes later and MIRRORS its output
--     instead of re-deriving it. Nothing in the working card engine is touched.
--     Consequence to accept: an occasion switched off in gym_card_settings
--     produces no card, therefore no gift.
--
-- Idempotent. All new objects — no DDL on existing tables, so nothing live
-- takes an ACCESS EXCLUSIVE lock.
-- =============================================================

-- ── 1. Box code generator ────────────────────────────────────
-- Short, printable, unambiguous. Charset excludes I/O/0/1 for the same reason
-- CreateInviteModal's generateCode does — these get read off a label by hand.
CREATE OR REPLACE FUNCTION public.generate_swag_box_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_chars TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code  TEXT;
  v_try   INT := 0;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM swag_boxes WHERE box_code = v_code);
    v_try := v_try + 1;
    IF v_try > 20 THEN
      RAISE EXCEPTION 'Could not allocate a unique box code';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ── 2. Tables ────────────────────────────────────────────────

-- The SKU catalog. GLOBAL — no gym_id. A backpack is a backpack everywhere,
-- and this is deliberately NOT gym_products: that table is the gym's smoothie
-- bar (member-facing, has a `price`, keyed UNIQUE(gym_id, name), and super
-- admin only holds SELECT on it). Swag is the inverse — platform-owned, has a
-- COST not a price, and needs quantity on hand, which gym_products has no
-- column for.
CREATE TABLE IF NOT EXISTS public.swag_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  name_es         TEXT,
  emoji           TEXT,
  unit_cost_cents INT  NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "I bought 100 backpacks at $12." The `in` side of platform stock.
CREATE TABLE IF NOT EXISTS public.swag_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES public.swag_items(id) ON DELETE RESTRICT,
  qty             INT  NOT NULL CHECK (qty > 0),
  unit_cost_cents INT  NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  purchased_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note            TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A numbered box headed to one gym.
CREATE TABLE IF NOT EXISTS public.swag_boxes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_code    TEXT NOT NULL UNIQUE DEFAULT public.generate_swag_box_code(),
  gym_id      UUID REFERENCES public.gyms(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'packed' CHECK (status IN ('packed','shipped')),
  shipped_at  TIMESTAMPTZ,
  note        TEXT,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.swag_box_items (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id  UUID NOT NULL REFERENCES public.swag_boxes(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.swag_items(id) ON DELETE RESTRICT,
  qty     INT  NOT NULL CHECK (qty > 0),
  CONSTRAINT swag_box_items_unique UNIQUE (box_id, item_id)
);

-- Which gift goes with which occasion, per gym. Platform-owned config: the gym
-- does not choose its own swag. Reuses card_occasion (0399:28 + 0415:40)
-- verbatim — no second enum to keep in sync.
CREATE TABLE IF NOT EXISTS public.gym_swag_rules (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id    UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  occasion  card_occasion NOT NULL,
  item_id   UUID NOT NULL REFERENCES public.swag_items(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gym_swag_rules_unique UNIQUE (gym_id, occasion)
);

-- The delivery record: this item, to this member, on this occasion.
CREATE TABLE IF NOT EXISTS public.swag_grants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id            UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  profile_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES public.swag_items(id) ON DELETE RESTRICT,

  -- Denormalized at creation, and load-bearing: swag_items is super-admin-only
  -- by RLS, so a gym admin joining through to it would read NULL and the front
  -- desk would be told "hand them their ___". Same denormalization print_cards
  -- does with headline/subline/reward_label. It also makes the row an accurate
  -- historical record if the SKU is later renamed.
  item_name         TEXT NOT NULL,
  item_name_es      TEXT,
  item_emoji        TEXT,

  occasion          card_occasion,
  source_card_id    UUID REFERENCES public.print_cards(id) ON DELETE SET NULL,

  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','delivered','cancelled')),
  delivered_at      TIMESTAMPTZ,
  delivered_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- The person who physically handed it over may not be a system user, so this
  -- is a free-text name rather than only the FK. Same reasoning as
  -- print_cards.delivered_by_name (0506).
  delivered_by_name TEXT,
  delivery_note     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swag_grants_gym_status
  ON public.swag_grants (gym_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swag_grants_profile
  ON public.swag_grants (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swag_box_items_item
  ON public.swag_box_items (item_id);
CREATE INDEX IF NOT EXISTS idx_swag_boxes_gym
  ON public.swag_boxes (gym_id, status);

-- One PENDING gift per member per occasion. Scoped to status='pending' on
-- purpose (mirrors idx_print_cards_pending_per_occasion, 0399:82): once a gift
-- is delivered the member can legitimately earn that occasion again — which
-- matters for habit_9in6, the one occasion that recurs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_swag_grants_pending_per_occasion
  ON public.swag_grants (profile_id, occasion)
  WHERE status = 'pending' AND occasion IS NOT NULL;

-- ── 3. RLS ───────────────────────────────────────────────────
-- Two distinct layers. The four platform-owned tables are invisible to gym
-- admins entirely — inventory and unit cost are none of their business.

ALTER TABLE public.swag_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swag_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swag_boxes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swag_box_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_swag_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swag_grants    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['swag_items','swag_purchases','swag_boxes','swag_box_items','gym_swag_rules']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_super_admin_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
      t || '_super_admin_all', t);
  END LOOP;
END $$;

-- Gym staff see and update their own gym's grants. Mirrors
-- print_cards_read_staff (0463:100) including the additional_roles arms —
-- without them a multi-role admin is RLS-dead on their own gym's data.
DROP POLICY IF EXISTS swag_grants_staff_read ON public.swag_grants;
CREATE POLICY swag_grants_staff_read
  ON public.swag_grants FOR SELECT TO authenticated
  USING (
    gym_id IN (
      SELECT p.gym_id FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'trainer')
          OR 'admin'::user_role       = ANY(COALESCE(p.additional_roles, '{}'))
          OR 'super_admin'::user_role = ANY(COALESCE(p.additional_roles, '{}'))
          OR 'trainer'::user_role     = ANY(COALESCE(p.additional_roles, '{}'))
        )
    )
  );

DROP POLICY IF EXISTS swag_grants_super_admin_all ON public.swag_grants;
CREATE POLICY swag_grants_super_admin_all
  ON public.swag_grants FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Note: gym staff get NO direct UPDATE policy. Delivery goes through
-- deliver_swag_grant() so there is exactly one code path that writes it.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.swag_items     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swag_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swag_boxes     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swag_box_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_swag_rules TO authenticated;
-- Full DML at the table level; RLS is what actually gates it. Gym staff hold a
-- SELECT-only policy, so these extra verbs only ever reach a super admin.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swag_grants    TO authenticated;

-- ── 4. Inventory readouts (super admin only) ─────────────────
-- RPCs rather than views, following the house rule the platform tier already
-- uses: aggregates go through a SECURITY DEFINER function with an explicit
-- is_super_admin() guard (platform_gym_stats, 0437:24), row lists go through a
-- super_admin RLS policy. A security_invoker view here would also have let a
-- gym admin read a nonsense negative number — their own grants minus box
-- contents they can't see.

-- What's left in MY warehouse: bought, minus everything already shipped out.
-- Packed-but-unshipped boxes still count as mine — the merch is physically here.
CREATE OR REPLACE FUNCTION public.platform_swag_stock()
RETURNS TABLE (
  item_id UUID, name TEXT, name_es TEXT, emoji TEXT,
  unit_cost_cents INT, is_active BOOLEAN,
  purchased INT, shipped_out INT, on_hand INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  SELECT
    i.id, i.name, i.name_es, i.emoji, i.unit_cost_cents, i.is_active,
    COALESCE(pur.qty, 0)::INT  AS purchased,
    COALESCE(shp.qty, 0)::INT  AS shipped_out,
    (COALESCE(pur.qty, 0) - COALESCE(shp.qty, 0))::INT AS on_hand
  FROM swag_items i
  LEFT JOIN (
    SELECT item_id, SUM(qty)::INT AS qty FROM swag_purchases GROUP BY item_id
  ) pur ON pur.item_id = i.id
  LEFT JOIN (
    SELECT bi.item_id, SUM(bi.qty)::INT AS qty
    FROM swag_box_items bi
    JOIN swag_boxes b ON b.id = bi.box_id
    WHERE b.status = 'shipped'
    GROUP BY bi.item_id
  ) shp ON shp.item_id = i.id
  ORDER BY i.name;
END;
$$;

-- What's left at each gym: shipped to them, minus handed to members.
CREATE OR REPLACE FUNCTION public.platform_gym_swag_stock()
RETURNS TABLE (
  gym_id UUID, gym_name TEXT, item_id UUID, item_name TEXT, emoji TEXT,
  received INT, delivered INT, on_hand INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin role required';
  END IF;

  RETURN QUERY
  WITH received AS (
    SELECT b.gym_id, bi.item_id, SUM(bi.qty)::INT AS qty
    FROM swag_box_items bi
    JOIN swag_boxes b ON b.id = bi.box_id
    WHERE b.status = 'shipped' AND b.gym_id IS NOT NULL
    GROUP BY b.gym_id, bi.item_id
  ),
  handed AS (
    SELECT g.gym_id, g.item_id, COUNT(*)::INT AS qty
    FROM swag_grants g
    WHERE g.status = 'delivered'
    GROUP BY g.gym_id, g.item_id
  )
  SELECT
    r.gym_id, gy.name, r.item_id, i.name, i.emoji,
    r.qty, COALESCE(h.qty, 0), (r.qty - COALESCE(h.qty, 0))::INT
  FROM received r
  JOIN gyms gy      ON gy.id = r.gym_id
  JOIN swag_items i ON i.id  = r.item_id
  LEFT JOIN handed h ON h.gym_id = r.gym_id AND h.item_id = r.item_id
  ORDER BY gy.name, i.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.platform_swag_stock()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_gym_swag_stock() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.platform_swag_stock()     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.platform_gym_swag_stock() TO authenticated;

-- ── 5. Nightly grant generation ──────────────────────────────
-- Mirrors the cards created in the last 24h. Does not re-derive a single
-- occasion rule — generate_print_cards_daily() already did that work at 04:00.
CREATE OR REPLACE FUNCTION public.generate_swag_grants_daily()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INTEGER := 0;
BEGIN
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
  -- Belt and braces alongside the NOT EXISTS: two cards for the same member and
  -- occasion inside one statement would both pass the subquery, which is
  -- evaluated against the pre-statement snapshot.
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;
  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_swag_grants_daily() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_swag_grants_daily() TO service_role;

-- 04:15 UTC — a quarter hour behind 'generate-print-cards' (0399:324, 04:00),
-- so the cards it mirrors already exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('generate-swag-grants')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-swag-grants');
    PERFORM cron.schedule(
      'generate-swag-grants',
      '15 4 * * *',
      $cron$ SELECT public.generate_swag_grants_daily(); $cron$
    );
  END IF;
END $$;

-- ── 6. Delivery ──────────────────────────────────────────────
-- ONE path, on purpose. Print cards have two and they disagree:
-- MarkDeliveredModal.jsx:48 writes all five fields including the mandatory
-- delivered_by_name, while ScanFeedback.markCardDelivered:152 writes three and
-- leaves the 0506 accountability columns NULL. Merch is worth more than a card,
-- so both surfaces call this and nothing writes the table directly.
--
-- The guard is copied from admin_create_member (0467:67-83), NOT from
-- attach_reward_to_print_card: 0595 replicated a pre-0463 body and silently
-- dropped additional_roles support there, so a multi-role admin passes the RLS
-- policy and is then rejected by the RPC.
CREATE OR REPLACE FUNCTION public.deliver_swag_grant(
  p_grant_id     UUID,
  p_handler_name TEXT DEFAULT NULL,
  p_note         TEXT DEFAULT NULL
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
  v_is_admin     BOOLEAN;
  v_grant        swag_grants%ROWTYPE;
BEGIN
  SELECT role::text, additional_roles, gym_id
    INTO v_caller_role, v_caller_extra, v_caller_gym
    FROM profiles WHERE id = auth.uid();

  v_is_super := (v_caller_role = 'super_admin'
                 OR 'super_admin'::user_role = ANY(COALESCE(v_caller_extra, '{}')));
  v_is_admin := (v_caller_role = 'admin'
                 OR 'admin'::user_role = ANY(COALESCE(v_caller_extra, '{}'))
                 OR v_caller_role = 'trainer'
                 OR 'trainer'::user_role = ANY(COALESCE(v_caller_extra, '{}')));

  IF NOT (v_is_admin OR v_is_super) THEN
    RETURN json_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_grant FROM swag_grants WHERE id = p_grant_id;
  IF v_grant.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  IF NOT v_is_super AND v_grant.gym_id IS DISTINCT FROM v_caller_gym THEN
    RETURN json_build_object('success', false, 'error', 'WRONG_GYM');
  END IF;

  IF v_grant.status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'NOT_PENDING', 'status', v_grant.status);
  END IF;

  UPDATE swag_grants
     SET status            = 'delivered',
         delivered_at      = NOW(),
         delivered_by      = auth.uid(),
         delivered_by_name = NULLIF(trim(COALESCE(p_handler_name, '')), ''),
         delivery_note     = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_grant_id;

  -- Audit must never be able to roll back the delivery it is recording.
  BEGIN
    PERFORM public.log_admin_action(
      'swag_delivered', 'swag_grant', p_grant_id,
      jsonb_build_object('item_id', v_grant.item_id, 'profile_id', v_grant.profile_id,
                         'occasion', v_grant.occasion, 'handler', p_handler_name),
      v_grant.gym_id
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN json_build_object('success', true, 'grant_id', p_grant_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deliver_swag_grant(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deliver_swag_grant(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.deliver_swag_grant(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- Verify:
--   SELECT * FROM platform_swag_stock();          -- purchased / shipped / on_hand
--   SELECT * FROM platform_gym_swag_stock();      -- per gym
--   SELECT generate_swag_grants_daily();          -- returns rows created
--   SELECT deliver_swag_grant('<grant>', 'Leonel', NULL);
--
-- As a GYM admin (not super), these must all return zero rows, not an error:
--   SELECT count(*) FROM swag_items;   -- 0, RLS
--   SELECT count(*) FROM swag_boxes;   -- 0, RLS
--   SELECT count(*) FROM swag_grants;  -- only their own gym's
-- =============================================================
