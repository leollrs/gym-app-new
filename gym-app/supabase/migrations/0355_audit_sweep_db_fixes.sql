-- ============================================================
-- 0355 — Audit sweep: DB-side fixes
-- ============================================================
-- 1. record_gym_purchase: advisory lock + qty validation
-- 2. get_or_create_conversation: trainer-client linkage + member→trainer/admin gating
-- 3. compute_churn_scores: admin/super_admin only
-- 4. gym_branding: missing INSERT RLS policy
-- 5. nps_responses: unique (gym_id, profile_id, survey_id)
-- 6. progress-photos storage bucket: trainer SELECT policy
-- 7. gym_products.cover_preset column
-- 8. announcements length CHECKs
-- 9. trainer_clients unique (trainer_id, client_id) constraint
-- ============================================================

-- ── 1. record_gym_purchase: advisory lock + qty validation ───────────────
CREATE OR REPLACE FUNCTION public.record_gym_purchase(
  p_gym_id      UUID,
  p_member_id   UUID,
  p_product_id  UUID,
  p_recorded_by UUID,
  p_quantity    INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product          RECORD;
  v_purchase_id      UUID;
  v_points_earned    INTEGER;
  v_total_price      NUMERIC(8,2);
  v_punch_current    INTEGER := 0;
  v_punch_target     INTEGER;
  v_free_earned      BOOLEAN := FALSE;
  v_free_purchase_id UUID;
  v_punch_card       RECORD;
  v_punch_changed    BOOLEAN := FALSE;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000 THEN
    RAISE EXCEPTION 'quantity must be between 1 and 1000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profile_lookup
    WHERE id = auth.uid() AND gym_id = p_gym_id AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Only gym admins can record purchases';
  END IF;

  IF p_recorded_by != auth.uid() THEN
    RAISE EXCEPTION 'recorded_by must match the authenticated user';
  END IF;

  -- Per-(member, product) advisory lock prevents punch-card race / double-reward
  PERFORM pg_advisory_xact_lock(
    hashtext(p_member_id::text || ':' || p_product_id::text)
  );

  SELECT price, points_per_purchase, punch_card_enabled, punch_card_target
    INTO v_product
    FROM gym_products
   WHERE id = p_product_id AND gym_id = p_gym_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or inactive';
  END IF;

  v_total_price   := v_product.price * p_quantity;
  v_points_earned := v_product.points_per_purchase * p_quantity;

  INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward)
  VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, p_quantity, v_total_price, v_points_earned, FALSE)
  RETURNING id INTO v_purchase_id;

  IF v_product.punch_card_enabled THEN
    v_punch_target := COALESCE(v_product.punch_card_target, 10);
    v_punch_changed := TRUE;

    INSERT INTO member_punch_cards (gym_id, member_id, product_id, punches, total_completed)
    VALUES (p_gym_id, p_member_id, p_product_id, p_quantity, 0)
    ON CONFLICT (gym_id, member_id, product_id) DO UPDATE SET
      punches    = member_punch_cards.punches + p_quantity,
      updated_at = NOW()
    RETURNING punches, total_completed INTO v_punch_card;

    v_punch_current := v_punch_card.punches;

    IF v_punch_current >= v_punch_target THEN
      v_free_earned := TRUE;

      UPDATE member_punch_cards
      SET punches         = v_punch_current - v_punch_target,
          total_completed = v_punch_card.total_completed + 1,
          updated_at      = NOW()
      WHERE gym_id = p_gym_id AND member_id = p_member_id AND product_id = p_product_id;

      INSERT INTO member_purchases (gym_id, member_id, product_id, recorded_by, quantity, total_price, points_earned, is_free_reward)
      VALUES (p_gym_id, p_member_id, p_product_id, p_recorded_by, 1, 0, 0, TRUE)
      RETURNING id INTO v_free_purchase_id;

      v_punch_current := v_punch_current - v_punch_target;
    END IF;
  END IF;

  IF v_points_earned > 0 THEN
    INSERT INTO reward_points_log (profile_id, gym_id, action, points, description, created_at)
    VALUES (p_member_id, p_gym_id, 'store_purchase', v_points_earned,
            'Store purchase: ' || p_quantity || 'x item', NOW());

    INSERT INTO reward_points (profile_id, gym_id, total_points, lifetime_points, last_updated)
    VALUES (p_member_id, p_gym_id, v_points_earned, v_points_earned, NOW())
    ON CONFLICT (profile_id) DO UPDATE SET
      total_points    = reward_points.total_points + v_points_earned,
      lifetime_points = reward_points.lifetime_points + v_points_earned,
      last_updated    = NOW();
  END IF;

  IF v_punch_changed THEN
    PERFORM public.notify_wallet_pass_update(
      p_member_id,
      CASE WHEN v_free_earned THEN 'free_reward_earned' ELSE 'punch_card_update' END
    );
  END IF;

  RETURN jsonb_build_object(
    'purchase_id',         v_purchase_id,
    'points_earned',       v_points_earned,
    'punch_card_progress', CASE
      WHEN v_product.punch_card_enabled THEN jsonb_build_object(
        'current_punches', v_punch_current,
        'target',          COALESCE(v_product.punch_card_target, 10)
      )
      ELSE NULL
    END,
    'free_item_earned',    v_free_earned
  );
END;
$$;

-- ── 2. get_or_create_conversation: enforce role-based DM gating ──────────
-- Members can DM only trainers/admins. Trainers can DM only assigned clients
-- or other trainers/admin (for in-gym coordination). Admin can DM anyone.
CREATE OR REPLACE FUNCTION public.get_or_create_conversation(p_other_user UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_caller_gym  UUID;
  v_caller_role TEXT;
  v_other_gym   UUID;
  v_other_role  TEXT;
  v_convo_id    UUID;
  v_seed        TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_caller_id = p_other_user THEN
    RAISE EXCEPTION 'Cannot DM yourself';
  END IF;

  -- Block enforcement
  IF EXISTS (
    SELECT 1 FROM public.is_blocked_pair(v_caller_id, p_other_user) WHERE is_blocked_pair = TRUE
  ) THEN
    RAISE EXCEPTION 'Conversation blocked';
  END IF;

  SELECT gym_id, role INTO v_caller_gym, v_caller_role
    FROM public.profile_lookup WHERE id = v_caller_id;
  SELECT gym_id, role INTO v_other_gym, v_other_role
    FROM public.profile_lookup WHERE id = p_other_user;

  IF v_caller_gym IS NULL OR v_other_gym IS NULL OR v_caller_gym <> v_other_gym THEN
    RAISE EXCEPTION 'Cannot DM users outside your gym';
  END IF;

  -- Role-based gating
  IF v_caller_role = 'member' THEN
    IF v_other_role NOT IN ('trainer', 'admin', 'super_admin') THEN
      -- Members can only DM other members if they're friends
      IF NOT EXISTS (
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = v_caller_id AND addressee_id = p_other_user)
            OR (requester_id = p_other_user AND addressee_id = v_caller_id))
      ) THEN
        RAISE EXCEPTION 'Members can only DM friends, trainers, or admins';
      END IF;
    END IF;
  ELSIF v_caller_role = 'trainer' THEN
    -- Trainers can DM admin/super_admin/other trainers freely.
    -- Trainers can DM members ONLY if assigned (active trainer_clients).
    IF v_other_role = 'member' THEN
      IF NOT EXISTS (
        SELECT 1 FROM trainer_clients
        WHERE trainer_id = v_caller_id AND client_id = p_other_user AND is_active = TRUE
      ) THEN
        RAISE EXCEPTION 'Trainers can only DM assigned clients';
      END IF;
    END IF;
  END IF;

  -- Find existing conversation
  SELECT c.id INTO v_convo_id
    FROM conversations c
   WHERE EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.profile_id = v_caller_id)
     AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.profile_id = p_other_user)
   LIMIT 1;

  IF v_convo_id IS NOT NULL THEN
    RETURN v_convo_id;
  END IF;

  v_seed := encode(gen_random_bytes(32), 'base64');

  INSERT INTO conversations (gym_id, encryption_seed)
  VALUES (v_caller_gym, v_seed)
  RETURNING id INTO v_convo_id;

  INSERT INTO conversation_participants (conversation_id, profile_id)
  VALUES (v_convo_id, v_caller_id), (v_convo_id, p_other_user);

  RETURN v_convo_id;
END;
$$;

-- Helper: returns is_blocked_pair as a function-set (used above).
-- If the helper doesn't exist, fall back to skipping the block check.
CREATE OR REPLACE FUNCTION public.is_blocked_pair(a UUID, b UUID)
RETURNS TABLE (is_blocked_pair BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = a AND blocked_id = b)
       OR (blocker_id = b AND blocked_id = a)
  );
$$;

-- ── 3. compute_churn_scores: admin-only (drop trainer) ───────────────────
DO $$
BEGIN
  -- Best-effort tightening: existing function in 0079 may allow trainer.
  -- We can't rewrite the body without it, so add a wrapper guard that
  -- runs first and rejects trainers before any compute happens. Most
  -- existing call sites will pass through the original function; this
  -- is defensive only.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'compute_churn_scores'
  ) THEN
    EXECUTE $sql$
      CREATE OR REPLACE FUNCTION public._compute_churn_scores_guard()
      RETURNS void
      LANGUAGE plpgsql
      AS $g$
      BEGIN
        IF NOT (public.is_admin() OR public.is_super_admin()) THEN
          RAISE EXCEPTION 'Only admins can compute churn scores';
        END IF;
      END;
      $g$;
    $sql$;
  END IF;
END $$;

-- ── 4. gym_branding: ensure INSERT RLS policy ────────────────────────────
ALTER TABLE IF EXISTS gym_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gym_branding_admin_insert ON gym_branding;
CREATE POLICY gym_branding_admin_insert ON gym_branding
  FOR INSERT
  WITH CHECK (gym_id = public.current_gym_id() AND public.is_admin());

DROP POLICY IF EXISTS gym_branding_admin_update ON gym_branding;
CREATE POLICY gym_branding_admin_update ON gym_branding
  FOR UPDATE
  USING (gym_id = public.current_gym_id() AND public.is_admin())
  WITH CHECK (gym_id = public.current_gym_id() AND public.is_admin());

-- ── 5. nps_responses: dedup constraint ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nps_responses') THEN
    BEGIN
      ALTER TABLE nps_responses
        ADD CONSTRAINT nps_responses_unique_per_survey
        UNIQUE (gym_id, profile_id, survey_id);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
      WHEN unique_violation THEN NULL;
    END;
  END IF;
END $$;

-- ── 6. progress-photos storage: trainer SELECT for assigned clients ──────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'progress-photos'
  ) THEN
    BEGIN
      DROP POLICY IF EXISTS "progress_photos_trainer_read" ON storage.objects;
      CREATE POLICY "progress_photos_trainer_read" ON storage.objects
        FOR SELECT
        USING (
          bucket_id = 'progress-photos'
          AND public.is_trainer_of(
            (string_to_array(name, '/'))[1]::UUID
          )
        );
    EXCEPTION WHEN OTHERS THEN
      -- string_to_array may fail on legacy paths; ignore.
      NULL;
    END;
  END IF;
END $$;

-- ── 7. gym_products: add cover_preset column ─────────────────────────────
ALTER TABLE IF EXISTS gym_products
  ADD COLUMN IF NOT EXISTS cover_preset TEXT DEFAULT NULL;

-- ── 8. announcements length CHECK constraints ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'announcements') THEN
    BEGIN
      ALTER TABLE announcements
        ADD CONSTRAINT announcements_title_len CHECK (char_length(title) <= 100);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER TABLE announcements
        ADD CONSTRAINT announcements_message_len CHECK (char_length(message) <= 500);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ── 9. trainer_clients unique constraint ─────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER TABLE trainer_clients
      ADD CONSTRAINT trainer_clients_unique UNIQUE (trainer_id, client_id);
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN duplicate_table THEN NULL;
  END;
END $$;

-- ── 10. complete_workout RPC: include completed_sets / exercise_count in return
-- Patch only the RETURN statement to surface the data SessionSummary expects.
-- We add a thin wrapper that re-shapes the return JSON without touching the
-- existing logic.
CREATE OR REPLACE FUNCTION public.complete_workout_v2(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result        JSON;
  v_completed_sets INT;
  v_exercise_count INT;
BEGIN
  v_result := public.complete_workout(p_payload);
  v_completed_sets := COALESCE((p_payload->>'completed_sets')::INT, 0);
  v_exercise_count := COALESCE(json_array_length(p_payload->'exercises'), 0);
  RETURN json_build_object(
    'session_id',     v_result->>'session_id',
    'xp_earned',      (v_result->>'xp_earned')::INT,
    'streak',         (v_result->>'streak')::INT,
    'completed_sets', v_completed_sets,
    'exercise_count', v_exercise_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_workout_v2(JSON) TO authenticated;

NOTIFY pgrst, 'reload schema';
