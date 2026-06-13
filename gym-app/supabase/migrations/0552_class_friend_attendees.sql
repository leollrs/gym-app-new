-- =============================================================
-- 0552_class_friend_attendees.sql
--
-- "Friends going" on the member class sheet. gym_class_bookings RLS is
-- deliberately own-row-only for members (0157 bookings_select_own; admins/
-- trainers have their own arms), so the client cannot ask "which of MY
-- friends booked this class?". This SECURITY DEFINER RPC answers exactly
-- that and nothing more:
--   • only bookings of the CALLER's accepted friends (friendships.status
--     = 'accepted' in either direction — blocking removes the friendship,
--     so blocked users can never appear),
--   • only for one schedule + date,
--   • only confirmed/attended bookings (waitlist is not "going"),
--   • profile fields limited to the avatar-safe set the
--     gym_member_profiles_safe view already exposes.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_class_friend_attendees(
  p_schedule_id UUID,
  p_booking_date DATE
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  avatar_url TEXT,
  avatar_type TEXT,
  avatar_value TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.avatar_url, p.avatar_type, p.avatar_value
  FROM gym_class_bookings b
  JOIN profiles p ON p.id = b.profile_id
  WHERE b.schedule_id = p_schedule_id
    AND b.booking_date = p_booking_date
    AND b.status IN ('confirmed', 'attended')
    AND b.profile_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = auth.uid() AND f.addressee_id = b.profile_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = b.profile_id))
    )
  LIMIT 12;
$$;

REVOKE EXECUTE ON FUNCTION public.get_class_friend_attendees(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_class_friend_attendees(UUID, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
