-- Waitlist support: add position tracking
ALTER TABLE gym_class_bookings
  ADD COLUMN IF NOT EXISTS waitlist_position INTEGER,
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

-- Update status check to include 'waitlisted'
ALTER TABLE gym_class_bookings DROP CONSTRAINT IF EXISTS gym_class_bookings_status_check;
ALTER TABLE gym_class_bookings ADD CONSTRAINT gym_class_bookings_status_check
  CHECK (status IN ('confirmed', 'cancelled', 'attended', 'waitlisted'));

-- Recurring bookings table
CREATE TABLE IF NOT EXISTS gym_class_recurring (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES gym_class_schedules(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES gym_classes(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(schedule_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_recurring_profile ON gym_class_recurring(profile_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_recurring_schedule ON gym_class_recurring(schedule_id) WHERE is_active;

ALTER TABLE gym_class_recurring ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_select_own" ON gym_class_recurring FOR SELECT
  USING (profile_id = auth.uid());
CREATE POLICY "recurring_insert_own" ON gym_class_recurring FOR INSERT
  WITH CHECK (profile_id = auth.uid());
CREATE POLICY "recurring_update_own" ON gym_class_recurring FOR UPDATE
  USING (profile_id = auth.uid());
CREATE POLICY "recurring_delete_own" ON gym_class_recurring FOR DELETE
  USING (profile_id = auth.uid());
CREATE POLICY "recurring_admin" ON gym_class_recurring FOR ALL
  USING (public.is_admin());

-- Updated book_class RPC with waitlist support
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
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN json_build_object('error', 'unauthorized'); END IF;

  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  -- Get capacity
  SELECT COALESCE(s.override_capacity, c.max_capacity, 30)
  INTO v_capacity
  FROM gym_class_schedules s
  JOIN gym_classes c ON c.id = s.class_id
  WHERE s.id = p_schedule_id;

  IF v_capacity IS NULL THEN
    RETURN json_build_object('error', 'class_not_found');
  END IF;

  -- Count current confirmed bookings
  SELECT COUNT(*) INTO v_booked
  FROM gym_class_bookings
  WHERE schedule_id = p_schedule_id
    AND booking_date = p_booking_date
    AND status = 'confirmed';

  IF v_booked >= v_capacity THEN
    -- Class full — add to waitlist
    SELECT COALESCE(MAX(waitlist_position), 0) + 1 INTO v_waitlist_pos
    FROM gym_class_bookings
    WHERE schedule_id = p_schedule_id
      AND booking_date = p_booking_date
      AND status = 'waitlisted';

    INSERT INTO gym_class_bookings (schedule_id, class_id, profile_id, gym_id, booking_date, status, waitlist_position)
    VALUES (p_schedule_id, p_class_id, uid, my_gym, p_booking_date, 'waitlisted', v_waitlist_pos)
    ON CONFLICT (schedule_id, profile_id, booking_date) DO NOTHING;

    RETURN json_build_object('success', true, 'status', 'waitlisted', 'position', v_waitlist_pos);
  END IF;

  -- Has capacity — confirm booking
  INSERT INTO gym_class_bookings (schedule_id, class_id, profile_id, gym_id, booking_date, status)
  VALUES (p_schedule_id, p_class_id, uid, my_gym, p_booking_date, 'confirmed')
  ON CONFLICT (schedule_id, profile_id, booking_date) DO NOTHING;

  RETURN json_build_object('success', true, 'status', 'confirmed');
END;
$$;

-- RPC: Cancel booking and promote waitlist
CREATE OR REPLACE FUNCTION public.cancel_class_booking(p_booking_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  v_booking RECORD;
  v_next_waitlisted RECORD;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN json_build_object('error', 'unauthorized'); END IF;

  SELECT * INTO v_booking FROM gym_class_bookings WHERE id = p_booking_id AND profile_id = uid;
  IF v_booking IS NULL THEN RETURN json_build_object('error', 'not_found'); END IF;

  -- Cancel the booking
  UPDATE gym_class_bookings SET status = 'cancelled', cancelled_at = now() WHERE id = p_booking_id;

  -- If was confirmed, promote first waitlisted person
  IF v_booking.status = 'confirmed' THEN
    SELECT * INTO v_next_waitlisted
    FROM gym_class_bookings
    WHERE schedule_id = v_booking.schedule_id
      AND booking_date = v_booking.booking_date
      AND status = 'waitlisted'
    ORDER BY waitlist_position ASC
    LIMIT 1;

    IF v_next_waitlisted IS NOT NULL THEN
      UPDATE gym_class_bookings
      SET status = 'confirmed', waitlist_position = NULL, promoted_at = now()
      WHERE id = v_next_waitlisted.id;

      -- Send notification to promoted member
      INSERT INTO notifications (profile_id, gym_id, type, title, body, dedup_key)
      VALUES (
        v_next_waitlisted.profile_id,
        v_next_waitlisted.gym_id,
        'class',
        'You got a spot!',
        'A spot opened up and you''ve been moved from the waitlist.',
        'waitlist_promote_' || v_next_waitlisted.id
      );
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'promoted', v_next_waitlisted IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_class_booking(UUID) TO authenticated;

-- RPC: Toggle recurring booking
CREATE OR REPLACE FUNCTION public.toggle_recurring_class(
  p_schedule_id UUID,
  p_class_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  my_gym UUID;
  v_existing UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN json_build_object('error', 'unauthorized'); END IF;
  SELECT gym_id INTO my_gym FROM profiles WHERE id = uid;

  SELECT id INTO v_existing FROM gym_class_recurring
  WHERE schedule_id = p_schedule_id AND profile_id = uid AND is_active = true;

  IF v_existing IS NOT NULL THEN
    UPDATE gym_class_recurring SET is_active = false WHERE id = v_existing;
    RETURN json_build_object('success', true, 'recurring', false);
  ELSE
    INSERT INTO gym_class_recurring (schedule_id, class_id, profile_id, gym_id)
    VALUES (p_schedule_id, p_class_id, uid, my_gym)
    ON CONFLICT (schedule_id, profile_id) DO UPDATE SET is_active = true;
    RETURN json_build_object('success', true, 'recurring', true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_recurring_class(UUID, UUID) TO authenticated;
