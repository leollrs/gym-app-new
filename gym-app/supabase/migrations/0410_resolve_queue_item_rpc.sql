-- =============================================================
-- RESOLVE QUEUE ITEM RPC
-- Migration: 0410_resolve_queue_item_rpc.sql
--
-- Purpose: When an owner marks a morning-queue card as "done"
-- with a positive outcome (reached_out / returned), reflect that
-- real-world attention back to the member as an in-app notification.
--
-- The notification CANNOT claim more than what actually happened.
-- The owner reached out in real life; we don't put words in their
-- mouth. The message is generic-but-true: "Your gym noticed you."
--
-- Software is the memory prosthetic. The owner's attention is
-- the real product — this RPC just makes that attention visible
-- to the member, the way analog print cards do.
--
-- The function is SECURITY DEFINER so it can write the
-- notification on behalf of the staff member without granting
-- members write access to notifications.profile_id != auth.uid().
-- Authorization is double-checked inside via the gym/role membership
-- check (the existing owner_queue_items RLS already enforces this
-- on direct UPDATEs, but SECURITY DEFINER bypasses RLS, so we
-- re-check explicitly).
-- =============================================================

CREATE OR REPLACE FUNCTION resolve_queue_item(
  p_item_id UUID,
  p_outcome TEXT,
  p_note    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gym_id      UUID;
  v_profile_id  UUID;
  v_lang        TEXT;
  v_title       TEXT;
  v_body        TEXT;
BEGIN
  -- ── 1. Validate outcome up front (cheap, no DB round-trip) ──
  IF p_outcome NOT IN ('reached_out', 'returned', 'no_response', 'lost') THEN
    RAISE EXCEPTION 'invalid outcome: %', p_outcome
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- ── 2. Load the queue item's gym + member context ──
  SELECT gym_id, profile_id
    INTO v_gym_id, v_profile_id
  FROM owner_queue_items
  WHERE id = p_item_id;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'queue item not found: %', p_item_id
      USING ERRCODE = 'P0002';  -- no_data_found
  END IF;

  -- ── 3. Authorization: caller must be staff for this gym ──
  -- Mirrors the owner_queue_update_staff RLS policy from 0398.
  -- SECURITY DEFINER bypasses RLS, so we enforce explicitly.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND gym_id = v_gym_id
      AND role IN ('admin', 'super_admin', 'trainer')
  ) THEN
    RAISE EXCEPTION 'not authorized for gym %', v_gym_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- ── 4. Update the queue row ──
  UPDATE owner_queue_items
  SET status           = 'done',
      resolved_at      = NOW(),
      resolved_by      = auth.uid(),
      resolved_outcome = p_outcome,
      resolved_note    = p_note
  WHERE id = p_item_id;

  -- ── 5. Member-facing reflection notification ──
  -- Only for outcomes that imply the owner actually reached out
  -- (or the member returned because of past outreach). 'no_response'
  -- and 'lost' don't get a reflection — there's nothing to reflect.
  --
  -- Body is intentionally generic. "Someone here was thinking of you"
  -- is true (the owner just resolved a card about this member). It
  -- does NOT claim Maria said anything specific.
  IF p_outcome IN ('reached_out', 'returned') THEN
    SELECT COALESCE(preferred_language, 'en')
      INTO v_lang
    FROM profiles
    WHERE id = v_profile_id;

    IF v_lang = 'es' THEN
      v_title := 'Tu gimnasio te notó';
      v_body  := 'Alguien aquí pensó en ti hoy.';
    ELSE
      v_title := 'Your gym noticed you';
      v_body  := 'Someone here was thinking of you today.';
    END IF;

    -- dedup_key keyed on the queue item id — re-resolving the same
    -- card (e.g. status flap) will not generate a duplicate
    -- notification. The unique partial index from migration 0155
    -- enforces this at the DB layer.
    INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
    VALUES (
      v_profile_id,
      v_gym_id,
      'admin_message',
      v_title,
      v_body,
      'queue_reflection_' || p_item_id::TEXT
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN p_item_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_queue_item(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION resolve_queue_item(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
