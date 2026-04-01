-- Feature toggle
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS classes_enabled BOOLEAN DEFAULT FALSE;

-- Class definitions
CREATE TABLE IF NOT EXISTS gym_classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_es TEXT,
    description TEXT,
    description_es TEXT,
    image_url TEXT,
    instructor_name TEXT,
    duration_minutes INTEGER DEFAULT 60,
    max_capacity INTEGER,
    color TEXT DEFAULT '#D4AF37',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Class schedule (recurring)
CREATE TABLE IF NOT EXISTS gym_class_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES gym_classes(id) ON DELETE CASCADE,
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    override_capacity INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Bookings
CREATE TABLE IF NOT EXISTS gym_class_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES gym_class_schedules(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES gym_classes(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    booking_date DATE NOT NULL,
    status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'attended')),
    booked_at TIMESTAMPTZ DEFAULT now(),
    cancelled_at TIMESTAMPTZ,
    UNIQUE(schedule_id, profile_id, booking_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_gym_classes_gym ON gym_classes(gym_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_class_schedules_gym ON gym_class_schedules(gym_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_class_bookings_profile ON gym_class_bookings(profile_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_class_bookings_schedule ON gym_class_bookings(schedule_id, booking_date);

-- RLS
ALTER TABLE gym_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_class_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_class_bookings ENABLE ROW LEVEL SECURITY;

-- Members read classes/schedules for their gym
CREATE POLICY "gym_classes_select" ON gym_classes FOR SELECT
  USING (gym_id = public.current_gym_id());
CREATE POLICY "gym_class_schedules_select" ON gym_class_schedules FOR SELECT
  USING (gym_id = public.current_gym_id());

-- Members read/manage own bookings
CREATE POLICY "bookings_select_own" ON gym_class_bookings FOR SELECT
  USING (profile_id = auth.uid());
CREATE POLICY "bookings_insert_own" ON gym_class_bookings FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND gym_id = public.current_gym_id());
CREATE POLICY "bookings_update_own" ON gym_class_bookings FOR UPDATE
  USING (profile_id = auth.uid());

-- Admins manage all
CREATE POLICY "gym_classes_admin" ON gym_classes FOR ALL
  USING (public.is_admin());
CREATE POLICY "gym_class_schedules_admin" ON gym_class_schedules FOR ALL
  USING (public.is_admin());
CREATE POLICY "bookings_admin" ON gym_class_bookings FOR ALL
  USING (public.is_admin());

-- RPC to book a class with capacity check
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
  v_result JSON;
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

  -- Count current bookings
  SELECT COUNT(*) INTO v_booked
  FROM gym_class_bookings
  WHERE schedule_id = p_schedule_id
    AND booking_date = p_booking_date
    AND status = 'confirmed';

  IF v_booked >= v_capacity THEN
    RETURN json_build_object('error', 'class_full');
  END IF;

  -- Insert booking
  INSERT INTO gym_class_bookings (schedule_id, class_id, profile_id, gym_id, booking_date)
  VALUES (p_schedule_id, p_class_id, uid, my_gym, p_booking_date)
  ON CONFLICT (schedule_id, profile_id, booking_date) DO NOTHING;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_class(UUID, UUID, DATE) TO authenticated;
