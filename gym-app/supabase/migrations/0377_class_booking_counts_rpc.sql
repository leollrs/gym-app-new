-- ============================================================
-- 0377 — Aggregate booking counts visible to members
-- ============================================================
-- The bookings RLS (`bookings_select_own`, migration 0157) restricts
-- SELECT on gym_class_bookings to a member's own rows. That's correct
-- for privacy, but it also means a member's booking-count query
-- returned at most 1 (their own confirmed booking) — so the
-- "X / capacity" bar never reflected how full the class actually is.
--
-- Fix: a SECURITY DEFINER RPC that returns aggregate counts only
-- (schedule_id + booking_date + count) without leaking who booked.
-- Members can call it for their own gym; admins/trainers can call it
-- across their gym too.
--
-- For the admin attendee-list view (showing names of who booked), use
-- get_class_attendees() below — that one IS gated to admin/trainer
-- roles since it returns PII.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_class_booking_counts(
  p_gym_id    UUID,
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (
  schedule_id  UUID,
  booking_date DATE,
  confirmed    INT,
  waitlisted   INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.schedule_id,
    b.booking_date,
    COUNT(*) FILTER (WHERE b.status = 'confirmed')::INT  AS confirmed,
    COUNT(*) FILTER (WHERE b.status = 'waitlisted')::INT AS waitlisted
  FROM public.gym_class_bookings b
  WHERE b.gym_id = p_gym_id
    AND b.booking_date BETWEEN p_date_from AND p_date_to
    AND EXISTS (
      -- Caller must belong to the same gym (any role: member/trainer/admin).
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.gym_id = p_gym_id
    )
  GROUP BY b.schedule_id, b.booking_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_booking_counts(UUID, DATE, DATE) TO authenticated;


-- ============================================================
-- get_class_attendees(gym_id, schedule_id, booking_date)
-- Admin / trainer attendee list with names + status. Useful for
-- the AdminClasses page (numbered 1, 2, … per class) so staff can
-- see who's coming and who's on the waitlist.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_class_attendees(
  p_gym_id        UUID,
  p_schedule_id   UUID,
  p_booking_date  DATE
)
RETURNS TABLE (
  booking_id        UUID,
  profile_id        UUID,
  full_name         TEXT,
  avatar_url        TEXT,
  status            TEXT,
  waitlist_position INT,
  booked_at         TIMESTAMPTZ,
  rating            INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.profile_id,
    p.full_name,
    p.avatar_url,
    b.status,
    b.waitlist_position,
    b.booked_at,
    b.rating
  FROM public.gym_class_bookings b
  JOIN public.profiles p ON p.id = b.profile_id
  WHERE b.gym_id = p_gym_id
    AND b.schedule_id = p_schedule_id
    AND b.booking_date = p_booking_date
    AND b.status IN ('confirmed', 'waitlisted', 'attended')
    AND EXISTS (
      -- Admin or trainer of this gym only.
      SELECT 1 FROM public.profiles caller
       WHERE caller.id = auth.uid()
         AND caller.gym_id = p_gym_id
         AND caller.role IN ('admin', 'super_admin', 'trainer')
    )
  ORDER BY
    CASE b.status WHEN 'confirmed' THEN 0 WHEN 'attended' THEN 1 ELSE 2 END,
    b.waitlist_position NULLS LAST,
    b.booked_at;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_attendees(UUID, UUID, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
