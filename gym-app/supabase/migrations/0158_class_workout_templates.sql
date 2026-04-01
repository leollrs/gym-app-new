-- Class workout templates: instructors can attach a routine to a class
ALTER TABLE gym_classes
  ADD COLUMN IF NOT EXISTS workout_template_id UUID REFERENCES routines(id) ON DELETE SET NULL;

-- Class attendance with rating and workout session linkage
ALTER TABLE gym_class_bookings
  ADD COLUMN IF NOT EXISTS attended BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS workout_session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL;

-- Index for looking up bookings by workout session
CREATE INDEX IF NOT EXISTS idx_class_bookings_session ON gym_class_bookings(workout_session_id) WHERE workout_session_id IS NOT NULL;

-- RPC: Check in to a class, optionally start a workout session from the class template
CREATE OR REPLACE FUNCTION public.checkin_class(
  p_booking_id UUID,
  p_rating INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  v_booking RECORD;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN json_build_object('error', 'unauthorized'); END IF;

  SELECT b.*, c.workout_template_id, c.name as class_name
  INTO v_booking
  FROM gym_class_bookings b
  JOIN gym_classes c ON c.id = b.class_id
  WHERE b.id = p_booking_id AND b.profile_id = uid;

  IF v_booking IS NULL THEN
    RETURN json_build_object('error', 'booking_not_found');
  END IF;

  -- Mark as attended
  UPDATE gym_class_bookings
  SET attended = TRUE,
      attended_at = now(),
      rating = COALESCE(p_rating, rating),
      notes = COALESCE(p_notes, notes),
      status = 'attended'
  WHERE id = p_booking_id;

  RETURN json_build_object(
    'success', true,
    'has_template', v_booking.workout_template_id IS NOT NULL,
    'template_id', v_booking.workout_template_id,
    'class_name', v_booking.class_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkin_class(UUID, INTEGER, TEXT) TO authenticated;

-- RPC: Link a completed workout session to a class booking
CREATE OR REPLACE FUNCTION public.link_class_workout(
  p_booking_id UUID,
  p_session_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN json_build_object('error', 'unauthorized'); END IF;

  UPDATE gym_class_bookings
  SET workout_session_id = p_session_id
  WHERE id = p_booking_id AND profile_id = uid;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_class_workout(UUID, UUID) TO authenticated;

-- Let admins see class attendance and ratings
CREATE POLICY "bookings_select_admin" ON gym_class_bookings FOR SELECT
  USING (public.is_admin());
