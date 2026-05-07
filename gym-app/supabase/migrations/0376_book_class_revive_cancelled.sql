-- ============================================================
-- 0376 — book_class: allow re-booking after cancel
-- ============================================================
-- gym_class_bookings has UNIQUE (schedule_id, profile_id, booking_date)
-- to keep a member from double-booking a class. The book_class RPC used
-- `ON CONFLICT DO NOTHING`, which ALSO silently no-ops the re-book case:
--   1. Member books a class       → row inserted, status = 'confirmed'.
--   2. Member cancels              → status flipped to 'cancelled'.
--   3. Member taps Reservar again  → INSERT conflicts on the unique
--      tuple, DO NOTHING fires, no row mutated. Frontend gets a
--      "success" response but nothing actually changes — the cancelled
--      row is still there, and the page stubbornly shows the class as
--      not booked.
--
-- Fix: switch to `ON CONFLICT DO UPDATE` with a WHERE clause that only
-- "revives" cancelled rows, mirroring the original insert payload back
-- onto the existing row. Active bookings still no-op (the WHERE rejects
-- them) so the unique constraint still protects against double-booking.
-- ============================================================

CREATE OR REPLACE FUNCTION public.book_class(
  p_schedule_id UUID,
  p_class_id UUID,
  p_booking_date DATE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  v_capacity INTEGER;
  v_booked INTEGER;
  v_waitlist_pos INTEGER;
  v_existing_status TEXT;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN json_build_object('error', 'unauthorized'); END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  -- Capacity for this schedule.
  SELECT COALESCE(s.override_capacity, c.max_capacity, 30)
  INTO v_capacity
  FROM gym_class_schedules s
  JOIN gym_classes c ON c.id = s.class_id
  WHERE s.id = p_schedule_id;

  IF v_capacity IS NULL THEN
    RETURN json_build_object('error', 'class_not_found');
  END IF;

  -- If there's an active row for this triple already, short-circuit so
  -- the response describes the existing state instead of re-incrementing
  -- counts in some downstream caller.
  SELECT status INTO v_existing_status
  FROM gym_class_bookings
  WHERE schedule_id = p_schedule_id
    AND profile_id = uid
    AND booking_date = p_booking_date
    AND status IN ('confirmed', 'waitlisted', 'attended');
  IF v_existing_status IS NOT NULL THEN
    RETURN json_build_object('success', true, 'status', v_existing_status, 'already_booked', true);
  END IF;

  -- Count current confirmed bookings.
  SELECT COUNT(*) INTO v_booked
  FROM gym_class_bookings
  WHERE schedule_id = p_schedule_id
    AND booking_date = p_booking_date
    AND status = 'confirmed';

  IF v_booked >= v_capacity THEN
    -- Class full — add to waitlist. Either insert a new row OR revive a
    -- previously cancelled row for this same triple by flipping status
    -- back to 'waitlisted' and giving it a fresh queue position.
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_pos
    FROM gym_class_bookings
    WHERE schedule_id = p_schedule_id
      AND booking_date = p_booking_date
      AND status = 'waitlisted';

    INSERT INTO gym_class_bookings (schedule_id, class_id, profile_id, gym_id, booking_date, status, waitlist_position)
    VALUES (p_schedule_id, p_class_id, uid, my_gym, p_booking_date, 'waitlisted', v_waitlist_pos)
    ON CONFLICT (schedule_id, profile_id, booking_date) DO UPDATE
      SET status            = 'waitlisted',
          cancelled_at      = NULL,
          waitlist_position = EXCLUDED.waitlist_position,
          booked_at         = NOW()
      WHERE gym_class_bookings.status = 'cancelled';

    RETURN json_build_object('success', true, 'status', 'waitlisted', 'position', v_waitlist_pos);
  END IF;

  -- Has capacity — confirm booking. Same dual-mode INSERT/REVIVE logic.
  INSERT INTO gym_class_bookings (schedule_id, class_id, profile_id, gym_id, booking_date, status)
  VALUES (p_schedule_id, p_class_id, uid, my_gym, p_booking_date, 'confirmed')
  ON CONFLICT (schedule_id, profile_id, booking_date) DO UPDATE
    SET status            = 'confirmed',
        cancelled_at      = NULL,
        waitlist_position = NULL,
        booked_at         = NOW()
    WHERE gym_class_bookings.status = 'cancelled';

  RETURN json_build_object('success', true, 'status', 'confirmed');
END;
$$;

NOTIFY pgrst, 'reload schema';
