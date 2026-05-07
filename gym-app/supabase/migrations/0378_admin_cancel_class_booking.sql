-- ============================================================
-- 0378 — admin_cancel_class_booking RPC
-- ============================================================
-- The existing cancel_class_booking() (migration 0162) hard-gates
-- on `profile_id = auth.uid()`, which is correct for member self-
-- service but blocks an admin from cancelling another member's
-- booking from the AdminClasses bookings tab.
--
-- New SECURITY DEFINER RPC for the admin path:
--   • caller must be admin/super_admin/trainer of the same gym as
--     the booking,
--   • flips status → 'cancelled', stamps cancelled_at,
--   • runs the same waitlist-promotion pass as the member RPC
--     (next waitlisted member gets confirmed + notified).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_cancel_class_booking(p_booking_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_gym  UUID;
  v_booking     RECORD;
  v_promoted    RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('error', 'unauthorized');
  END IF;

  SELECT role::TEXT, gym_id INTO v_caller_role, v_caller_gym
    FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'super_admin', 'trainer') THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_booking FROM public.gym_class_bookings
   WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RETURN json_build_object('error', 'not_found');
  END IF;

  -- Gym boundary — staff can only cancel bookings inside their own gym
  -- (super_admin can act across gyms).
  IF v_booking.gym_id <> v_caller_gym AND v_caller_role <> 'super_admin' THEN
    RETURN json_build_object('error', 'wrong_gym');
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN json_build_object('success', true, 'already_cancelled', true);
  END IF;

  UPDATE public.gym_class_bookings
     SET status = 'cancelled', cancelled_at = NOW()
   WHERE id = p_booking_id;

  -- Promote first waitlisted (if the cancelled row was confirmed).
  IF v_booking.status = 'confirmed' THEN
    SELECT * INTO v_promoted
      FROM public.gym_class_bookings
     WHERE schedule_id = v_booking.schedule_id
       AND booking_date = v_booking.booking_date
       AND status = 'waitlisted'
     ORDER BY waitlist_position ASC
     LIMIT 1;

    IF v_promoted IS NOT NULL THEN
      UPDATE public.gym_class_bookings
         SET status = 'confirmed', waitlist_position = NULL, promoted_at = NOW()
       WHERE id = v_promoted.id;

      -- Notify the promoted member (silent if notifications table missing).
      BEGIN
        INSERT INTO public.notifications (profile_id, gym_id, type, title, body, dedup_key)
        VALUES (
          v_promoted.profile_id,
          v_promoted.gym_id,
          'class_promoted',
          'Lugar disponible',
          'Subiste de la lista de espera. Tu reserva está confirmada.',
          'class_promoted_' || v_promoted.id::text
        );
      EXCEPTION WHEN OTHERS THEN
        -- ignore — promotion happened, notification is best-effort
        NULL;
      END;
    END IF;
  END IF;

  RETURN json_build_object('success', true, 'promoted_id', v_promoted.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_class_booking(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
