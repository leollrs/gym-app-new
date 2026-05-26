-- 0449_conversation_member_state.sql
-- ---------------------------------------------------------------------------
-- Per-user conversation state for the member Messages page:
--   • archive        (hide from the main list, viewable under "Archived")
--   • soft delete     (move to "Recently Deleted", restorable for 30 days)
--   • purge           (permanent, immediate — "re-delete")
-- Plus mark_conversation_read() — the canonical, RLS-proof way to clear unread
-- (the client's direct UPDATE on direct_messages could be silently blocked by
-- the gym-scoped messages_update policy, leaving the unread bubble stuck).
--
-- Model: state is PER PARTICIPANT. Deleting a chat hides it for you only; the
-- other person keeps theirs. The conversation + messages are hard-deleted only
-- once BOTH participants have purged (immediately, or after the 30-day window).
-- A new incoming message resurfaces a soft-deleted (but not purged) thread for
-- the recipient, so you never silently miss messages.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversation_member_state (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  archived_at     TIMESTAMPTZ,            -- non-null → in "Archived"
  deleted_at      TIMESTAMPTZ,            -- non-null → in "Recently Deleted"
  purged_at       TIMESTAMPTZ,            -- non-null → gone for this user forever
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_cms_profile        ON conversation_member_state(profile_id);
CREATE INDEX IF NOT EXISTS idx_cms_profile_deleted ON conversation_member_state(profile_id, deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;

ALTER TABLE conversation_member_state ENABLE ROW LEVEL SECURITY;

-- Read your own state only. All writes go through the SECURITY DEFINER RPCs
-- below (which enforce participant checks), so no direct write policy is needed.
DROP POLICY IF EXISTS "cms_select" ON conversation_member_state;
CREATE POLICY "cms_select" ON conversation_member_state FOR SELECT
  USING (profile_id = auth.uid());

GRANT SELECT ON conversation_member_state TO authenticated;

-- ── mark_conversation_read ────────────────────────────────────────────────
-- Clears unread for the caller across a whole conversation. SECURITY DEFINER
-- so it is not subject to the gym-scoped messages_update RLS policy.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = p_conversation_id
       AND (c.participant_1 = uid OR c.participant_2 = uid)
  ) THEN
    RETURN;
  END IF;

  UPDATE direct_messages
     SET read_at = now()
   WHERE conversation_id = p_conversation_id
     AND sender_id <> uid
     AND read_at IS NULL;
END;
$$;

-- ── set_conversation_archived ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_conversation_archived(p_conversation_id UUID, p_archived BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = p_conversation_id AND (c.participant_1 = uid OR c.participant_2 = uid)
  ) THEN RETURN; END IF;

  INSERT INTO conversation_member_state (conversation_id, profile_id, archived_at, deleted_at, purged_at, updated_at)
  VALUES (p_conversation_id, uid, CASE WHEN p_archived THEN now() ELSE NULL END, NULL, NULL, now())
  ON CONFLICT (conversation_id, profile_id) DO UPDATE
    SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
        deleted_at  = NULL,
        purged_at   = NULL,
        updated_at  = now();
END;
$$;

-- ── soft_delete_conversation ──────────────────────────────────────────────
-- Move to "Recently Deleted" (restorable for 30 days).
CREATE OR REPLACE FUNCTION public.soft_delete_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = p_conversation_id AND (c.participant_1 = uid OR c.participant_2 = uid)
  ) THEN RETURN; END IF;

  INSERT INTO conversation_member_state (conversation_id, profile_id, deleted_at, archived_at, purged_at, updated_at)
  VALUES (p_conversation_id, uid, now(), NULL, NULL, now())
  ON CONFLICT (conversation_id, profile_id) DO UPDATE
    SET deleted_at  = now(),
        archived_at = NULL,
        purged_at   = NULL,
        updated_at  = now();
END;
$$;

-- ── restore_conversation ──────────────────────────────────────────────────
-- Back to the active list (from Recently Deleted or Archived).
CREATE OR REPLACE FUNCTION public.restore_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  UPDATE conversation_member_state
     SET deleted_at = NULL, archived_at = NULL, purged_at = NULL, updated_at = now()
   WHERE conversation_id = p_conversation_id AND profile_id = uid;
END;
$$;

-- ── _maybe_hard_delete_conversation (internal) ────────────────────────────
-- Hard-delete the conversation + messages once BOTH participants have purged.
CREATE OR REPLACE FUNCTION public._maybe_hard_delete_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_p1 UUID; v_p2 UUID; v_purged INT;
BEGIN
  SELECT participant_1, participant_2 INTO v_p1, v_p2
    FROM conversations WHERE id = p_conversation_id;
  IF v_p1 IS NULL THEN RETURN; END IF;

  SELECT count(*) INTO v_purged
    FROM conversation_member_state
   WHERE conversation_id = p_conversation_id
     AND purged_at IS NOT NULL
     AND profile_id IN (v_p1, v_p2);

  IF v_purged >= 2 THEN
    DELETE FROM direct_messages WHERE conversation_id = p_conversation_id;
    DELETE FROM conversations   WHERE id = p_conversation_id;  -- cms rows cascade
  END IF;
END;
$$;

-- ── purge_conversation ────────────────────────────────────────────────────
-- Permanent + immediate ("re-delete" from Recently Deleted).
CREATE OR REPLACE FUNCTION public.purge_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
     WHERE c.id = p_conversation_id AND (c.participant_1 = uid OR c.participant_2 = uid)
  ) THEN RETURN; END IF;

  INSERT INTO conversation_member_state (conversation_id, profile_id, deleted_at, purged_at, updated_at)
  VALUES (p_conversation_id, uid, now(), now(), now())
  ON CONFLICT (conversation_id, profile_id) DO UPDATE
    SET purged_at = now(), updated_at = now();

  PERFORM public._maybe_hard_delete_conversation(p_conversation_id);
END;
$$;

-- ── resurface on new message ──────────────────────────────────────────────
-- A new incoming message un-deletes a soft-deleted (not purged) thread for the
-- recipient, so deleting a chat never makes you silently miss future messages.
CREATE OR REPLACE FUNCTION public.resurface_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_other UUID;
BEGIN
  SELECT CASE WHEN c.participant_1 = NEW.sender_id THEN c.participant_2 ELSE c.participant_1 END
    INTO v_other
    FROM conversations c WHERE c.id = NEW.conversation_id;
  IF v_other IS NULL THEN RETURN NEW; END IF;

  UPDATE conversation_member_state
     SET deleted_at = NULL, updated_at = now()
   WHERE conversation_id = NEW.conversation_id
     AND profile_id = v_other
     AND deleted_at IS NOT NULL
     AND purged_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resurface_on_message ON direct_messages;
CREATE TRIGGER trg_resurface_on_message
  AFTER INSERT ON direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.resurface_conversation_on_message();

-- ── 30-day purge sweep ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_deleted_conversations()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  UPDATE conversation_member_state
     SET purged_at = now(), updated_at = now()
   WHERE deleted_at IS NOT NULL
     AND purged_at IS NULL
     AND deleted_at < now() - INTERVAL '30 days';

  FOR r IN
    SELECT DISTINCT conversation_id
      FROM conversation_member_state
     WHERE purged_at IS NOT NULL
  LOOP
    PERFORM public._maybe_hard_delete_conversation(r.conversation_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_archived(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_conversation(UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_conversation(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_conversation(UUID)                TO authenticated;

-- Daily sweep at 03:00 UTC. Idempotent re-schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('purge-old-deleted-conversations');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'purge-old-deleted-conversations',
  '0 3 * * *',
  $$ SELECT public.purge_old_deleted_conversations(); $$
);
