-- ============================================================
-- 0442 — Member notification producers (Tier 1 gaps)
-- ============================================================
-- Wires five member-facing notifications that previously had no producer:
--
--   1. friend_request_received    — someone sends you a friend request
--   2. friend_request_accepted    — your friend request was accepted
--   3. class_booking_confirmation — your class booking is confirmed
--   4. goal_completed             — you achieved a goal
--   5. reward_ready               — a reward was granted (referral/manual), claim it
--
-- All are delivered in-app (audience 'member') + push, bilingual by the
-- recipient's profiles.language, via the _notify_push helper from 0440.
-- Every producer is EXCEPTION-wrapped so a notification failure can never roll
-- back the underlying write (friendship / booking / goal update).
--
-- DEPENDS ON 0440 (public._notify_push). Apply after 0440.
-- ============================================================

-- Dedicated member types (render with their own icon in the member inbox).
-- Only cast at runtime inside function bodies below, so adding + using them in
-- one migration is safe on PG15.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reward';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'goal';

-- ── 1. Friend request received → addressee ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_friend_request_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Someone') INTO v_from
  FROM profiles WHERE id = NEW.requester_id;

  PERFORM public._notify_push(
    NEW.addressee_id, NEW.gym_id, 'member'::user_role, 'friend_activity'::notification_type,
    'New friend request',
    v_from || ' sent you a friend request.',
    'Nueva solicitud de amistad',
    v_from || ' te envió una solicitud de amistad.',
    jsonb_build_object('route', '/social', 'friendship_id', NEW.id, 'from_id', NEW.requester_id),
    'friend_req_recv_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_friend_request_received failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friend_request_received ON friendships;
CREATE TRIGGER trg_friend_request_received
  AFTER INSERT ON friendships
  FOR EACH ROW EXECUTE FUNCTION fire_friend_request_received();

-- ── 2. Friend request accepted → requester ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_friend_request_accepted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_who TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'accepted' OR OLD.status IS NOT DISTINCT FROM 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(full_name, ''), 'Someone') INTO v_who
  FROM profiles WHERE id = NEW.addressee_id;

  PERFORM public._notify_push(
    NEW.requester_id, NEW.gym_id, 'member'::user_role, 'friend_activity'::notification_type,
    'Friend request accepted',
    v_who || ' accepted your friend request. Say hi 👋',
    'Solicitud de amistad aceptada',
    v_who || ' aceptó tu solicitud de amistad. Salúdalo 👋',
    jsonb_build_object('route', '/social', 'friendship_id', NEW.id, 'friend_id', NEW.addressee_id),
    'friend_req_acc_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_friend_request_accepted failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friend_request_accepted ON friendships;
CREATE TRIGGER trg_friend_request_accepted
  AFTER UPDATE OF status ON friendships
  FOR EACH ROW EXECUTE FUNCTION fire_friend_request_accepted();

-- ── 3. Class booking confirmation → the member ────────────────────────────
CREATE OR REPLACE FUNCTION public.fire_member_class_booking_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_en TEXT;
  v_es TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), 'your class'),
         COALESCE(NULLIF(name_es, ''), NULLIF(name, ''), 'tu clase')
    INTO v_en, v_es
  FROM gym_classes WHERE id = NEW.class_id;

  PERFORM public._notify_push(
    NEW.profile_id, NEW.gym_id, 'member'::user_role, 'class_booking'::notification_type,
    'You''re booked',
    'You''re confirmed for ' || v_en || ' on ' || to_char(NEW.booking_date, 'Mon DD') || '.',
    'Reserva confirmada',
    'Tu lugar en ' || v_es || ' está confirmado para el ' || to_char(NEW.booking_date, 'DD Mon') || '.',
    jsonb_build_object('route', '/classes', 'class_id', NEW.class_id, 'booking_id', NEW.id, 'booking_date', NEW.booking_date),
    'class_conf_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_class_booking_confirm failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_class_booking_confirm ON gym_class_bookings;
CREATE TRIGGER trg_member_class_booking_confirm
  AFTER INSERT ON gym_class_bookings
  FOR EACH ROW EXECUTE FUNCTION fire_member_class_booking_confirm();

-- ── 4. Goal achieved → the member ─────────────────────────────────────────
-- member_goals.achieved_at transitions NULL → NOT NULL when a goal is hit.
CREATE OR REPLACE FUNCTION public.fire_member_goal_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire only on the completion TRANSITION (NULL → set). UPDATE-only trigger,
  -- so OLD always exists. Deliberately NOT on INSERT: onboarding seeds goals
  -- with achieved_at already set (a baseline, not an achievement), and firing
  -- there would mean a spurious "Goal achieved" on signup.
  IF NEW.achieved_at IS NULL OR OLD.achieved_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public._notify_push(
    NEW.profile_id, NEW.gym_id, 'member'::user_role, 'goal'::notification_type,
    'Goal achieved 🎉',
    'You hit your goal: ' || COALESCE(NULLIF(NEW.title, ''), 'your target') || '. Time to set the next one.',
    '¡Meta alcanzada! 🎉',
    'Lograste tu meta: ' || COALESCE(NULLIF(NEW.title, ''), 'tu objetivo') || '. Hora de fijar la siguiente.',
    jsonb_build_object('route', '/profile', 'goal_id', NEW.id, 'goal_type', NEW.goal_type),
    'goal_done_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_goal_completed failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_goal_completed ON member_goals;
CREATE TRIGGER trg_member_goal_completed
  AFTER UPDATE OF achieved_at ON member_goals
  FOR EACH ROW EXECUTE FUNCTION fire_member_goal_completed();

-- ── 5. Reward ready to claim → the member ─────────────────────────────────
-- Fires when a reward is GRANTED (referral milestone / manual grant). Birthday
-- grants are excluded — migration 0350 already sends a 'birthday' notification,
-- so firing here too would double-notify.
CREATE OR REPLACE FUNCTION public.fire_member_reward_ready()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label    TEXT;
  v_label_es TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'birthday' THEN
    RETURN NEW; -- already covered by the birthday notification (0350)
  END IF;

  v_label    := COALESCE(NULLIF(NEW.reward_label, ''), 'A reward');
  v_label_es := COALESCE(NULLIF(NEW.reward_label_es, ''), v_label);

  PERFORM public._notify_push(
    NEW.profile_id, NEW.gym_id, 'member'::user_role, 'reward'::notification_type,
    'You earned a reward 🎁',
    v_label || ' is ready — claim it at the front desk.',
    'Ganaste una recompensa 🎁',
    v_label_es || ' está lista — recógela en recepción.',
    jsonb_build_object('route', '/rewards', 'earned_reward_id', NEW.id, 'source', NEW.source),
    'reward_ready_' || NEW.id::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'fire_member_reward_ready failed (%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_reward_ready ON earned_rewards;
CREATE TRIGGER trg_member_reward_ready
  AFTER INSERT ON earned_rewards
  FOR EACH ROW EXECUTE FUNCTION fire_member_reward_ready();

NOTIFY pgrst, 'reload schema';
