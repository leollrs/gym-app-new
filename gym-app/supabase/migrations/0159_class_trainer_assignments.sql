-- Assign classes to trainers
ALTER TABLE gym_classes
  ADD COLUMN IF NOT EXISTS trainer_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gym_classes_trainer ON gym_classes(trainer_id) WHERE trainer_id IS NOT NULL;

-- Trainers can read classes assigned to them
CREATE POLICY "trainer_read_assigned_classes" ON gym_classes FOR SELECT
  USING (trainer_id = auth.uid());

-- Trainers can update classes assigned to them (edit schedule, template, etc.)
CREATE POLICY "trainer_update_assigned_classes" ON gym_classes FOR UPDATE
  USING (trainer_id = auth.uid());

-- Trainers can read schedules for their classes
CREATE POLICY "trainer_read_class_schedules" ON gym_class_schedules FOR SELECT
  USING (class_id IN (SELECT id FROM gym_classes WHERE trainer_id = auth.uid()));

-- Trainers can manage schedules for their classes
CREATE POLICY "trainer_manage_class_schedules" ON gym_class_schedules FOR ALL
  USING (class_id IN (SELECT id FROM gym_classes WHERE trainer_id = auth.uid()));

-- Trainers can read bookings for their classes
CREATE POLICY "trainer_read_class_bookings" ON gym_class_bookings FOR SELECT
  USING (class_id IN (SELECT id FROM gym_classes WHERE trainer_id = auth.uid()));

-- Trainers can update bookings for their classes (mark attended, etc.)
CREATE POLICY "trainer_update_class_bookings" ON gym_class_bookings FOR UPDATE
  USING (class_id IN (SELECT id FROM gym_classes WHERE trainer_id = auth.uid()));

-- RPC: Get class analytics for a trainer's assigned classes
CREATE OR REPLACE FUNCTION public.get_trainer_class_analytics(p_class_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  v_result JSON;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Verify trainer owns this class or is admin
  IF NOT EXISTS (
    SELECT 1 FROM gym_classes
    WHERE id = p_class_id AND (trainer_id = uid OR EXISTS (
      SELECT 1 FROM profiles WHERE id = uid AND role IN ('admin', 'super_admin')
    ))
  ) THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT json_build_object(
    'total_bookings', (
      SELECT COUNT(*) FROM gym_class_bookings WHERE class_id = p_class_id AND booking_date >= CURRENT_DATE - INTERVAL '30 days'
    ),
    'total_attended', (
      SELECT COUNT(*) FROM gym_class_bookings WHERE class_id = p_class_id AND attended = true AND booking_date >= CURRENT_DATE - INTERVAL '30 days'
    ),
    'avg_rating', (
      SELECT ROUND(AVG(rating)::NUMERIC, 1) FROM gym_class_bookings WHERE class_id = p_class_id AND rating IS NOT NULL
    ),
    'rating_distribution', (
      SELECT json_object_agg(r, cnt) FROM (
        SELECT rating AS r, COUNT(*) AS cnt FROM gym_class_bookings
        WHERE class_id = p_class_id AND rating IS NOT NULL
        GROUP BY rating ORDER BY rating
      ) sub
    ),
    'recent_attendees', (
      SELECT json_agg(row_to_json(t)) FROM (
        SELECT b.profile_id, b.rating, b.notes, b.attended_at, b.booking_date,
               p.full_name, p.avatar_url, p.avatar_type, p.avatar_value,
               ws.total_volume_lbs, ws.completed_at
        FROM gym_class_bookings b
        JOIN profiles p ON p.id = b.profile_id
        LEFT JOIN workout_sessions ws ON ws.id = b.workout_session_id
        WHERE b.class_id = p_class_id AND b.attended = true
        ORDER BY b.attended_at DESC
        LIMIT 30
      ) t
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trainer_class_analytics(UUID) TO authenticated;
